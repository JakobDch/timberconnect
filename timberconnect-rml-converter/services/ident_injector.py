"""
Identifier Injector

Enriches RML-materialised RDF (Turtle) with the GS1 EPCIS identifiers produced
by the timberconnect-epcis service. Identification is done EXCLUSIVELY through
GS1 identifiers (SGTIN / LGTIN) — there is no TimberConnect trace id.

Strategy
--------
- tc:sgtin        : attached to the tc:Stem / tc:Log subject whose StemKey/LogKey
                    is recovered from the SGTIN serial ("S<session>T<stem>L<log>").
                    This is the object-level case (e.g. StanForD HPR).
                    Falls back to the document resource when no subject matches.
- tc:lgtin        : attached to the document resource together with quantity/uom
                    (lot-based items from ELDAT/VLEX carry no per-piece subject).
                    This is the document-level case.
- tc:derivedFrom  : the raw material consumed by a transformation document
                    (Leistungserklaerung, ERP-Auszug). Kept apart from tc:epc on
                    purpose -- input and output are opposite statements, and
                    merging them would erase the direction of the material flow.
- tc:EpcisDocument: one resource per upload, identified by the canonical document
                    identity (reported by timber-event's --hash mode). Bundles
                    every EPC and the bizTransaction URL (the EPCIS<->SOLID
                    namespace bridge). Every wood subject links to it via
                    tc:hasEpcisEvent.
                    NOTE: the identity is NOT always a hash, and not always the
                    last segment of the bizTransaction URL -- eldat's idpattern
                    makes that segment "<name>_<hash>.eldat", and the JSON
                    formats use a document number from the file itself.

Lifecycle linking (forest -> sawmill -> BSP) is carried by the EPCIS
transformation events in the EPCAT repository; tc:derivedFrom mirrors the input
side into the RDF so the pod alone can answer "what was this made from".

The injector is defensive: if rdflib cannot parse the TTL, or no subjects match,
it still appends a self-contained EpcisDocument block so the identifiers are
never lost.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from rdflib import Graph, Literal, Namespace, RDF, URIRef
from rdflib.namespace import XSD

from services.epcis_client import EPCISResult

logger = logging.getLogger(__name__)

TC = Namespace("http://timberconnect.2050.de/ontology#")
TCR = Namespace("http://timberconnect.2050.de/resource/")
EPCIS = Namespace("https://ref.gs1.org/epcis/")

# SGTIN serial built by the hpr handler: S<SessionId>T<StemKey>L<LogKey>
_SGTIN_SERIAL_RE = re.compile(r"\.S(?P<session>\d+)T(?P<stem>\d+)L(?P<log>\d+)$")

STEM_TPL = "http://timberconnect.2050.de/resource/stem/{stem}"
LOG_TPL = "http://timberconnect.2050.de/resource/stem/{stem}/log/{log}"


# --- Zuordnung EPC -> Stamm/Abschnitt aus dem Quelldokument -----------------
#
# Der Serial-Weg oben funktioniert nur bei Identen, die das System SELBST
# gebaut hat -- dort steckt der StemKey im Serial ("...S1605T56441L1").
# Vorgegebene Idente sehen anders aus: die NIBIO-Referenzdatei nutzt
# fortlaufende Nummern ("0013247"), die Demo-Idente der Projektpartner
# alphanumerische Serials ("12A3D4567"). Aus ihnen laesst sich kein StemKey
# lesen -- fruher landeten sie deshalb samtlich auf der Dokumentebene.
#
# Das ist ein echter Verlust und nicht bloss unschoen: eine SGTIN bezeichnet
# EIN Stueck Holz. Haengt sie am Dokument, sind die Messwerte dieses einen
# Stammes (Durchmesser, Erntedatum, Koordinate) ueber seinen Ident nicht mehr
# erreichbar, obwohl sie im Graph stehen.
#
# Die Zuordnung muss aber nicht geraten werden: sie steht im Dokument. Eine
# StanForD-Datei traegt den Ident als <Identity>-Element INNERHALB des <Log>,
# der zu einem <Stem> mit seinem <StemKey> gehoert. Diese Schachtelung wird
# hier gelesen -- damit ist die Zuordnung so verlaesslich wie die Datei selbst
# und unabhaengig davon, wie das Serial aufgebaut ist.
_HPR_KEY_OR_IDENT_RE = re.compile(
    r"<StemKey>\s*([^<\s]+)\s*</StemKey>"
    r"|<LogKey>\s*([^<\s]+)\s*</LogKey>"
    r"|<Identity\b[^>]*>\s*([^<\s]+)\s*</Identity>"
)


def map_hpr_idents(source: bytes) -> dict[str, tuple[str, str]]:
    """EPC -> (stemKey, logKey), gelesen aus einer StanForD-HPR-Datei.

    Nutzt die Schachtelung der Datei: der zuletzt gesehene StemKey/LogKey vor
    einem <Identity> ist der, zu dem der Ident gehoert. Bewusst kein XML-
    Parser -- die Funktion soll auch bei einer Datei mit kaputtem Namespace
    oder abgeschnittenem Ende noch liefern, was lesbar ist, und niemals
    werfen: sie ist eine Verbesserung der Zuordnung, keine Vorbedingung.
    """
    try:
        text = source.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - defensiv, siehe Docstring
        return {}

    mapping: dict[str, tuple[str, str]] = {}
    stem_key = ""
    log_key = ""
    for match in _HPR_KEY_OR_IDENT_RE.finditer(text):
        stem, log, ident = match.groups()
        if stem is not None:
            stem_key, log_key = stem, ""   # neuer Stamm -> Log-Kontext faellt weg
        elif log is not None:
            log_key = log
        elif ident is not None and stem_key:
            mapping[ident] = (stem_key, log_key)
    return mapping


def _epcis_doc_uri(epcis: EPCISResult) -> URIRef:
    """URI of the bundling EpcisDocument resource.

    Identified by the canonical document hash (stable, GS1-derived). Falls back
    to the full bizTransaction URL, then to the data type, so a resource always
    exists even if the hash is missing.
    """
    if epcis.doc_hash:
        return URIRef(f"{TCR}epcisDocument/{epcis.doc_hash}")
    if epcis.biz_transaction_url:
        return URIRef(epcis.biz_transaction_url)
    return URIRef(f"{TCR}epcisDocument/{epcis.data_type}")


def _parse_sgtin(sgtin: str) -> Optional[tuple[str, str]]:
    """Return (stemKey, logKey) recovered from an SGTIN serial, or None."""
    m = _SGTIN_SERIAL_RE.search(sgtin)
    if not m:
        return None
    return m.group("stem"), m.group("log")


def inject_idents(
    ttl_bytes: bytes,
    epcis: EPCISResult,
    source: Optional[bytes] = None,
) -> bytes:
    """Return TTL with EPCIS identifiers injected. Best-effort; never raises.

    ``source`` ist das hochgeladene Originaldokument. Wird es mitgegeben und
    ist es eine StanForD-HPR-Datei, liefert sie die Zuordnung Ident -> Stamm
    (siehe map_hpr_idents). Ohne sie bleibt es beim Serial-Muster, das nur bei
    selbst erzeugten Identen greift -- die Signatur ist deshalb rueckwaerts-
    kompatibel: Aufrufer ohne Originaldokument arbeiten weiter wie bisher.
    """
    try:
        return _inject(ttl_bytes, epcis, source)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Ident injection failed, returning original TTL: %s", exc)
        return ttl_bytes


def _inject(
    ttl_bytes: bytes,
    epcis: EPCISResult,
    source: Optional[bytes] = None,
) -> bytes:
    graph = Graph()
    graph.parse(data=ttl_bytes.decode("utf-8", errors="replace"), format="turtle")
    graph.bind("tc", TC)
    graph.bind("tcr", TCR)
    graph.bind("epcis", EPCIS)

    doc_uri = _epcis_doc_uri(epcis)

    # --- the bundling EpcisDocument resource ---
    graph.add((doc_uri, RDF.type, TC.EpcisDocument))
    if epcis.biz_transaction_url:
        graph.add((doc_uri, TC.bizTransaction, URIRef(epcis.biz_transaction_url)))
    # Only the produced material goes under tc:epc. Consumed raw material is
    # tc:derivedFrom -- deliberately NOT a sub-property of tc:epc, so a query
    # for the log's ident does not also return the boards sawn from it (see the
    # ontology comment on tc:derivedFrom).
    for epc in epcis.output_epcs:
        graph.add((doc_uri, TC.epc, URIRef(epc)))
    for epc in epcis.consumed_epcs:
        graph.add((doc_uri, TC.derivedFrom, URIRef(epc)))

    linked_subjects: set[URIRef] = set()

    # Zuordnung aus dem Quelldokument. Sie hat Vorrang vor dem Serial-Muster,
    # weil sie die im Dokument getroffene Aussage wiedergibt statt sie aus der
    # Form des Idents zu erschliessen.
    doc_keys = map_hpr_idents(source) if source else {}
    if doc_keys:
        logger.info(
            "Ident-Zuordnung aus dem Quelldokument: %d Ident(e) einem Stamm zugeordnet",
            len(doc_keys),
        )

    # --- SGTINs -> per-piece Stem/Log subjects (object level, e.g. HPR) ---
    for sgtin in epcis.sgtins:
        keys = doc_keys.get(sgtin) or _parse_sgtin(sgtin)
        targets: list[URIRef] = []
        if keys:
            stem_key, log_key = keys
            stem_uri = URIRef(STEM_TPL.format(stem=stem_key))
            # Den Abschnitt bevorzugen, wenn es ihn gibt -- er ist das
            # genauere Subjekt. Ohne LogKey (Ident haengt am Stamm, nicht am
            # Abschnitt) entfaellt dieser Schritt.
            if log_key:
                log_uri = URIRef(LOG_TPL.format(stem=stem_key, log=log_key))
                if (log_uri, None, None) in graph:
                    targets.append(log_uri)
            if not targets and (stem_uri, None, None) in graph:
                targets.append(stem_uri)
        if not targets:
            targets = [doc_uri]  # fallback so the SGTIN is never dropped
        for target in targets:
            graph.add((target, TC.sgtin, URIRef(sgtin)))
            linked_subjects.add(target)

    # --- LGTINs + quantity (document level: ELDAT/VLEX lots, no per-piece subject) ---
    for q in epcis.quantities:
        epc_class = q.get("epcClass")
        if not epc_class:
            continue
        graph.add((doc_uri, TC.lgtin, URIRef(epc_class)))
        if q.get("quantity") is not None:
            graph.add((doc_uri, TC.gs1Quantity, Literal(q["quantity"], datatype=XSD.decimal)))
        if q.get("uom"):
            graph.add((doc_uri, TC.gs1Uom, Literal(q["uom"])))

    # --- link every wood subject of the document to the EpcisDocument ---
    for subject in linked_subjects:
        if subject != doc_uri:  # don't self-link the bundling resource
            graph.add((subject, TC.hasEpcisEvent, doc_uri))

    return graph.serialize(format="turtle").encode("utf-8")
