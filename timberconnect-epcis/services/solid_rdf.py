"""
Read role + EPCIS-consent metadata from Solid pods (server side of the proxy).

The viewer writes these decentralised documents on each owner's pod:
  {pod}profile/role.ttl        -> <webid> tc:hasRole <roleIri>
  {pod}access/epcis-consent.ttl -> per-EPC / per-document allowed roles

Both are public-readable by design (see the RBAC plan), so the proxy can read
them with a plain unauthenticated GET. We parse them with rdflib.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

import httpx
from rdflib import Graph, URIRef

logger = logging.getLogger(__name__)

TC_NS = "http://timberconnect.2050.de/ontology#"
TC_HAS_ROLE = URIRef(TC_NS + "hasRole")
TC_ALLOWS_ROLE = URIRef(TC_NS + "allowsRole")
TC_EPC = URIRef(TC_NS + "epc")

_DOMAIN_ALIASES = {
    "tmdt-solid-community-server.de": "solid-community-server.tmdt.info",
}

# Rollen wurden umbenannt; alte Schreibweisen liegen weiterhin in den Pods.
#
# Der Viewer uebersetzt beim Lesen (siehe LEGACY_ROLE_IDS in
# src/config/roles.ts) -- dieser Dienst tat es nicht. Ein Consent-Dokument mit
# der ALTEN Schreibweise liess deshalb eine Rolle mit der NEUEN nicht durch,
# und umgekehrt: die Ereignisse wurden herausgefiltert, obwohl die Freigabe
# vorlag. Sichtbar wurde das als "fuer Ihre Rolle nicht freigegeben", ohne
# dass jemand etwas gesperrt haette.
#
# Beide Richtungen, weil beide Seiten veralten koennen: das Profil einer
# laenger nicht angemeldeten WebID ebenso wie ein aelteres Consent-Dokument.
# Eintraege duerfen erst entfallen, wenn kein Pod die alte Form mehr traegt.
_LEGACY_ROLE_IDS = {
    "Forst": "Forstbetrieb",
    "BspWerk": "Holzwerkstoffproduzent",
    "Holzbauplanung": "FachplanerHolzbau",
}


def _role_aliases(role_iri: str) -> set[str]:
    """Alle Schreibweisen einer Rolle -- die heutige und ihre Altformen."""
    if not role_iri.startswith(TC_NS):
        return {role_iri}

    local = role_iri[len(TC_NS) :]
    current = _LEGACY_ROLE_IDS.get(local, local)
    names = {local, current}
    names.update(old for old, new in _LEGACY_ROLE_IDS.items() if new == current)
    return {TC_NS + name for name in names}


def normalise_webid(web_id: str) -> str:
    for old, new in _DOMAIN_ALIASES.items():
        if f"//{old}/" in web_id:
            return web_id.replace(f"//{old}/", f"//{new}/")
    return web_id


def pod_base_from_webid(web_id: str) -> str:
    """https://host/podname/profile/card#me -> https://host/podname/"""
    m = re.match(r"^(https?://[^/]+/[^/]+/)", web_id)
    if m:
        return m.group(1)
    # Fall back to origin
    m = re.match(r"^(https?://[^/]+/)", web_id)
    return m.group(1) if m else web_id


async def _fetch_graph(url: str, timeout: float) -> Optional[Graph]:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, headers={"Accept": "text/turtle"})
    except httpx.HTTPError as exc:
        logger.debug("RDF fetch error %s: %s", url, exc)
        return None
    if resp.status_code != 200:
        return None
    g = Graph()
    try:
        g.parse(data=resp.text, format="turtle", publicID=url)
    except Exception as exc:  # rdflib raises various parse errors
        logger.warning("Failed to parse RDF at %s: %s", url, exc)
        return None
    return g


async def get_role_for_webid(web_id: str, timeout: float = 10.0) -> Optional[str]:
    """Return the role IRI declared by a WebID in its profile/role.ttl, or None."""
    web_id = normalise_webid(web_id)
    pod = pod_base_from_webid(web_id)
    g = await _fetch_graph(f"{pod}profile/role.ttl", timeout)
    if g is None:
        return None
    for _, _, role in g.triples((URIRef(web_id), TC_HAS_ROLE, None)):
        return str(role)
    return None


async def get_consent_for_owner(owner_pod: str, timeout: float = 10.0) -> "ConsentDoc":
    """Read an owner pod's access/epcis-consent.ttl into a queryable structure."""
    g = await _fetch_graph(f"{owner_pod}access/epcis-consent.ttl", timeout)
    return ConsentDoc(g)


class ConsentDoc:
    """Per-EPC role consent. Subjects are EPC URIs (or a #default subject)."""

    DEFAULT_SUBJECT = URIRef(TC_NS + "defaultConsent")

    def __init__(self, graph: Optional[Graph]):
        self.graph = graph

    def has_any(self) -> bool:
        return self.graph is not None and len(self.graph) > 0

    def _allowed_for_subject(self, subject: URIRef) -> set[str]:
        if self.graph is None:
            return set()
        return {str(o) for _, _, o in self.graph.triples((subject, TC_ALLOWS_ROLE, None))}

    def _has_subject(self, subject: URIRef) -> bool:
        """True if this subject carries a consent statement at all.

        Distinguishes "explicitly released to nobody" from "no rule, use the
        default" — an empty role set is a decision, not an absence.
        """
        if self.graph is None:
            return False
        return (subject, None, None) in self.graph

    def allowed_roles_for_epc(self, epc: str) -> set[str]:
        """Roles allowed to receive events for this EPC.

        An explicit per-EPC entry wins; otherwise the #default consent applies.

        The viewer writes a per-EPC subject for every document that carries a
        document-level rule (access/doc-policy.ttl). A document restricted to
        no role at all yields a subject WITHOUT any tc:allowsRole. Falling back
        to #default there would hand out exactly the events the owner just
        locked down, so the presence of the subject — not the size of its role
        set — decides which level applies.
        """
        subject = URIRef(epc)
        if self._has_subject(subject):
            return self._allowed_for_subject(subject)
        return self._allowed_for_subject(self.DEFAULT_SUBJECT)

    def role_may_see_epc(self, role_iri: Optional[str], epc: str) -> bool:
        """Darf diese Rolle die Ereignisse dieses EPC sehen?

        Verglichen wird ueber ALLE Schreibweisen der Rolle (siehe
        _role_aliases): eine Freigabe an tc:Forstbetrieb gilt auch fuer ein
        Profil, das noch tc:Forst traegt, und umgekehrt. Ein reiner
        Zeichenkettenvergleich hat nach der Rollenumbenennung stillschweigend
        gefiltert, obwohl die Freigabe vorlag.
        """
        if role_iri is None:
            return False
        return bool(_role_aliases(role_iri) & self.allowed_roles_for_epc(epc))
