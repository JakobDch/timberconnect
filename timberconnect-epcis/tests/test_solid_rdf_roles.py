"""Rollenvergleich der EPCIS-Freigaben.

Hintergrund: Rollen wurden umbenannt (tc:Forst -> tc:Forstbetrieb u.a.). Der
Viewer uebersetzt beim Lesen, dieser Dienst tat es nicht -- ein exakter
Zeichenkettenvergleich filterte Ereignisse heraus, obwohl die Freigabe vorlag.
Nach aussen sah das aus wie "fuer Ihre Rolle nicht freigegeben", ohne dass
jemand etwas gesperrt hatte.
"""

import sys
from pathlib import Path

import pytest
from rdflib import Graph

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.solid_rdf import TC_NS, ConsentDoc, _role_aliases  # noqa: E402

EPC = "urn:epc:id:sgtin:404711145.0100.12A3D4567"

FORST_ALT = TC_NS + "Forst"
FORST_NEU = TC_NS + "Forstbetrieb"
SAEGEWERK = TC_NS + "Saegewerk"


def consent(epc: str, *roles: str) -> ConsentDoc:
    """Ein Consent-Dokument, das den EPC fuer die genannten Rollen freigibt."""
    graph = Graph()
    ttl = "\n".join(
        f'<{epc}> <{TC_NS}allowsRole> <{role}> .' for role in roles
    )
    graph.parse(data=ttl, format="turtle")
    return ConsentDoc(graph)


class TestRoleAliases:
    def test_kennt_beide_schreibweisen(self):
        assert _role_aliases(FORST_NEU) == {FORST_ALT, FORST_NEU}
        assert _role_aliases(FORST_ALT) == {FORST_ALT, FORST_NEU}

    def test_laesst_unbekannte_rollen_unveraendert(self):
        assert _role_aliases(SAEGEWERK) == {SAEGEWERK}

    def test_ruehrt_fremde_namensraeume_nicht_an(self):
        fremd = "https://example.org/rollen#Irgendwas"
        assert _role_aliases(fremd) == {fremd}


class TestRoleMaySeeEpc:
    def test_neue_rolle_darf_bei_alter_freigabe(self):
        # Der Fall aus der Praxis: Pod traegt noch tc:Forst, Nutzer hat
        # tc:Forstbetrieb. Vorher gefiltert, obwohl freigegeben.
        assert consent(EPC, FORST_ALT).role_may_see_epc(FORST_NEU, EPC) is True

    def test_alte_rolle_darf_bei_neuer_freigabe(self):
        # Die Gegenrichtung: ein laenger nicht angemeldetes Profil.
        assert consent(EPC, FORST_NEU).role_may_see_epc(FORST_ALT, EPC) is True

    def test_gleiche_schreibweise_funktioniert_weiter(self):
        assert consent(EPC, FORST_NEU).role_may_see_epc(FORST_NEU, EPC) is True

    def test_fremde_rolle_bleibt_draussen(self):
        # Die Uebersetzung darf keine Tuer oeffnen: Saegewerk ist kein Alias
        # von Forstbetrieb.
        assert consent(EPC, FORST_NEU).role_may_see_epc(SAEGEWERK, EPC) is False

    def test_ohne_rolle_kein_zugriff(self):
        assert consent(EPC, FORST_NEU).role_may_see_epc(None, EPC) is False

    def test_leere_freigabe_sperrt(self):
        # Ein Dokument, das ausdruecklich an niemanden freigegeben ist.
        assert consent(EPC).role_may_see_epc(FORST_NEU, EPC) is False

    def test_anderer_epc_nicht_betroffen(self):
        anderer = "urn:epc:id:sgtin:404711145.0100.ANDERER"
        assert consent(EPC, FORST_NEU).role_may_see_epc(FORST_NEU, anderer) is False


class TestDefaultConsent:
    def test_default_gilt_ohne_eigenen_eintrag(self):
        graph = Graph()
        graph.parse(
            data=f'<{TC_NS}defaultConsent> <{TC_NS}allowsRole> <{FORST_ALT}> .',
            format="turtle",
        )
        doc = ConsentDoc(graph)
        # Auch hier muss die Uebersetzung greifen.
        assert doc.role_may_see_epc(FORST_NEU, EPC) is True

    def test_eigener_eintrag_schlaegt_default(self):
        graph = Graph()
        graph.parse(
            data=(
                f'<{TC_NS}defaultConsent> <{TC_NS}allowsRole> <{FORST_NEU}> .\n'
                f'<{EPC}> <{TC_NS}allowsRole> <{SAEGEWERK}> .'
            ),
            format="turtle",
        )
        doc = ConsentDoc(graph)
        # Der EPC-eigene Eintrag gilt -- Forstbetrieb steht dort nicht.
        assert doc.role_may_see_epc(FORST_NEU, EPC) is False
        assert doc.role_may_see_epc(SAEGEWERK, EPC) is True


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
