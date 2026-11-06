"""
Vorab-Pruefung: Sind die Idente eines Vorgangs im EPCAT schon vergeben?

Hintergrund (Befund 19.10.2026): Die Demo-Idente trugen im Live-Repository
bereits gestapelte Events aus mehreren Pods -- Stamm 1 allein 31 Events, davon
8 identische aus derselben Datei. Nichts im Stack prueft vor dem Capture, ob
ein Ident schon erzeugt wurde; jeder Upload derselben Datei erzeugt dasselbe
Event noch einmal, und der Viewer vermischt dann die Daten aller Pods, die
denselben Ident fuehren.

Diese Pruefung laeuft VOR dem ersten Schreibzugriff. Sie beantwortet je
Dokument drei Fragen:

  1. Hat irgendein Event die AUSGANGS-Idente dieses Dokuments bereits
     ERZEUGT?  Nur die erzeugende Seite zaehlt: ein Stamm, der im
     TransformationEvent des Saegewerks als Input steht, ist dort verbraucht,
     nicht vergeben.
  2. Falls ja: Gehoeren diese Events dem Aufrufer (bizTransaction zeigt in
     seinen Pod) und sagen sie exakt dasselbe aus (gleicher Ereignistyp,
     gleiche Eingangs- und Ausgangs-Idente)?  Dann muss ins EPCAT nichts
     Neues -- nur die Produktdaten im Pod werden ersetzt.
  3. Existieren die EINGANGS-Idente ueberhaupt?  Fehlen sie, haengt der
     Vorgang in der Luft. Das ist eine Warnung, keine Sperre.

Bewusst reine Funktionen ohne HTTP: Die Entscheidung muss sich ohne
laufendes EPCAT testen lassen. Den Netzverkehr erledigt main.py.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# Dieselbe Regel wie pod_base_from_webid in solid_rdf.py -- hier wiederholt,
# damit dieses Modul ohne rdflib laeuft und die Pruefung ueberall testbar ist.
_POD_BASE_RE = re.compile(r"^(https?://[^/]+/[^/]+/)")


def pod_base_of(url: str) -> Optional[str]:
    """https://host/podname/data/x -> https://host/podname/ (None ohne Pod-Segment)."""
    m = _POD_BASE_RE.match(url)
    return m.group(1) if m else None


# Ein Event-Typ je Dokument -- so wie epcis_builder sie erzeugt.
OBJECT_EVENT = "ObjectEvent"
TRANSFORMATION_EVENT = "TransformationEvent"

# Status je Dokument. Die Oberflaeche formuliert daraus den Klartext.
STATUS_FREE = "free"                    # nichts vergeben -> normaler Upload
STATUS_OWN_IDENTICAL = "own-identical"  # eigener, inhaltsgleicher Vorgang
STATUS_OWN_DIFFERENT = "own-different"  # eigener Vorgang, andere Ident-Listen
STATUS_FOREIGN = "foreign"              # anderer Teilnehmer haelt die Idente
STATUS_UNASSIGNED = "unassigned"        # Events ohne Pod-Bezug


@dataclass
class ProposedDocument:
    """Was ein Upload hervorbringen wuerde -- die Sicht VOR dem Capture."""

    label: str
    event_type: str
    output_epcs: list[str] = field(default_factory=list)
    input_epcs: list[str] = field(default_factory=list)


@dataclass
class ExistingGroup:
    """Die erzeugenden Events EINER Quelle (gleiche bizTransaction).

    ObjectEvents werden beim Capture in Bloecke zu 50 Identen zerlegt
    (epcis_builder, OpenEPCIS-Grenze). Verglichen wird deshalb nicht Event
    gegen Event, sondern die Vereinigung je Quelle gegen das Dokument.
    """

    biz_transaction: str
    owner_pod: Optional[str]
    event_types: set[str] = field(default_factory=set)
    output_epcs: set[str] = field(default_factory=set)
    input_epcs: set[str] = field(default_factory=set)
    event_count: int = 0


@dataclass
class Assessment:
    label: str
    status: str
    # Pods, die erzeugende Events fuer die Ausgangs-Idente halten.
    owner_pods: list[str] = field(default_factory=list)
    # bizTransaction-URLs der eigenen Treffer -- der Rueckweg zum Container.
    own_biz_transactions: list[str] = field(default_factory=list)
    # Ausgangs-Idente, die bereits vergeben sind.
    taken_epcs: list[str] = field(default_factory=list)
    # Eingangs-Idente, die in keinem Event vorkommen.
    missing_inputs: list[str] = field(default_factory=list)
    existing_event_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "status": self.status,
            "owner_pods": self.owner_pods,
            "own_biz_transactions": self.own_biz_transactions,
            "taken_epcs": self.taken_epcs,
            "missing_inputs": self.missing_inputs,
            "existing_event_count": self.existing_event_count,
        }


# ------------------------------------------------------------- Events lesen --
def _epc_classes(quantity_list: Any) -> list[str]:
    if not isinstance(quantity_list, list):
        return []
    return [
        str(q["epcClass"])
        for q in quantity_list
        if isinstance(q, dict) and q.get("epcClass")
    ]


def _str_list(value: Any) -> list[str]:
    return [str(v) for v in value] if isinstance(value, list) else []


def creating_epcs(event: dict[str, Any]) -> set[str]:
    """Idente, die dieses Event ERZEUGT (in die Kette einbringt).

    ObjectEvent mit action ADD: epcList + quantityList. OBSERVE/DELETE bringen
    nichts hervor. TransformationEvent: die Ausgangsseite. AggregationEvent
    erzeugt keine Idente (Behaelter und Inhalt gab es schon).
    """
    etype = str(event.get("type", ""))
    if etype == OBJECT_EVENT:
        if str(event.get("action", "ADD")).upper() != "ADD":
            return set()
        return set(_str_list(event.get("epcList"))) | set(
            _epc_classes(event.get("quantityList"))
        )
    if etype == TRANSFORMATION_EVENT:
        return set(_str_list(event.get("outputEPCList"))) | set(
            _epc_classes(event.get("outputQuantityList"))
        )
    return set()


def consuming_epcs(event: dict[str, Any]) -> set[str]:
    """Idente, die dieses Event VERBRAUCHT (Eingangsseite einer Umwandlung)."""
    if str(event.get("type", "")) != TRANSFORMATION_EVENT:
        return set()
    return set(_str_list(event.get("inputEPCList"))) | set(
        _epc_classes(event.get("inputQuantityList"))
    )


def biz_transaction_of(event: dict[str, Any]) -> str:
    """Erste http-bizTransaction des Events, sonst leer."""
    for bt in event.get("bizTransactionList", []) or []:
        url = bt.get("bizTransaction") if isinstance(bt, dict) else None
        if isinstance(url, str) and url.startswith("http"):
            return url
    return ""


def _owner_pod(biz_transaction: str) -> Optional[str]:
    if not biz_transaction:
        return None
    return pod_base_of(biz_transaction)


def _same_pod(a: Optional[str], b: Optional[str]) -> bool:
    if not a or not b:
        return False
    return a.rstrip("/").lower() == b.rstrip("/").lower()


# ---------------------------------------------------------------- Pruefung --
def group_creating_events(
    output_epcs: Iterable[str],
    events: Iterable[dict[str, Any]],
) -> list[ExistingGroup]:
    """Erzeugende Events fuer die Ausgangs-Idente, gebuendelt je Quelle."""
    wanted = set(output_epcs)
    groups: dict[str, ExistingGroup] = {}
    seen_ids: set[str] = set()

    for event in events:
        created = creating_epcs(event)
        if not created & wanted:
            continue
        # Dasselbe Event kommt ueber mehrere Ident-Abfragen herein.
        event_id = str(event.get("eventID") or id(event))
        if event_id in seen_ids:
            continue
        seen_ids.add(event_id)

        key = biz_transaction_of(event)
        group = groups.get(key)
        if group is None:
            group = ExistingGroup(biz_transaction=key, owner_pod=_owner_pod(key))
            groups[key] = group
        group.event_types.add(str(event.get("type", "")))
        group.output_epcs |= created
        group.input_epcs |= consuming_epcs(event)
        group.event_count += 1

    return list(groups.values())


def _is_identical(group: ExistingGroup, proposed: ProposedDocument) -> bool:
    return (
        group.event_types == {proposed.event_type}
        and group.output_epcs == set(proposed.output_epcs)
        and group.input_epcs == set(proposed.input_epcs)
    )


def assess_document(
    proposed: ProposedDocument,
    events: Iterable[dict[str, Any]],
    caller_pod: Optional[str],
) -> Assessment:
    """Die Entscheidung fuer EIN Dokument.

    ``events`` sind alle Events, in denen irgendein Ident des Dokuments
    (Eingang oder Ausgang) vorkommt. ``caller_pod`` ist die Pod-Basis des
    angemeldeten Nutzers; ohne sie kann kein Event als eigenes gelten.
    """
    events = list(events)
    groups = group_creating_events(proposed.output_epcs, events)

    # Eingangs-Idente muessen irgendwo vorkommen -- egal in welcher Rolle.
    known: set[str] = set()
    for event in events:
        known |= creating_epcs(event) | consuming_epcs(event)
        known |= set(_str_list(event.get("epcList")))
        known |= set(_epc_classes(event.get("quantityList")))
    missing_inputs = [e for e in proposed.input_epcs if e not in known]

    taken = sorted(
        {e for g in groups for e in g.output_epcs if e in set(proposed.output_epcs)}
    )
    event_count = sum(g.event_count for g in groups)

    if not groups:
        return Assessment(
            label=proposed.label,
            status=STATUS_FREE,
            missing_inputs=missing_inputs,
        )

    owner_pods = sorted({g.owner_pod for g in groups if g.owner_pod})
    own = [g for g in groups if _same_pod(g.owner_pod, caller_pod)]
    unassigned = [g for g in groups if g.owner_pod is None]
    foreign = [g for g in groups if g.owner_pod and not _same_pod(g.owner_pod, caller_pod)]

    base = dict(
        label=proposed.label,
        owner_pods=owner_pods,
        own_biz_transactions=[g.biz_transaction for g in own],
        taken_epcs=taken,
        missing_inputs=missing_inputs,
        existing_event_count=event_count,
    )

    # Fremde Treffer wiegen am schwersten: selbst wenn daneben ein eigener
    # Vorgang liegt, darf der Ident nicht noch einmal vergeben werden.
    if foreign:
        return Assessment(status=STATUS_FOREIGN, **base)
    if unassigned:
        return Assessment(status=STATUS_UNASSIGNED, **base)
    # EINE inhaltsgleiche eigene Quelle genuegt. Daneben darf es weitere
    # eigene Events auf denselben Ausgangs-Identen geben: Die bestaetigte
    # Herkunftskante Pflanzung -> Rundholz (captureOriginLink) ist ein
    # TransformationEvent mit denselben Staemmen als Ausgang -- sie gehoert
    # zum selben Vorgang und ist kein zweiter Vorgang.
    if any(_is_identical(g, proposed) for g in own):
        return Assessment(status=STATUS_OWN_IDENTICAL, **base)
    return Assessment(status=STATUS_OWN_DIFFERENT, **base)
