"""Vorab-Pruefung der Idente: wann ist ein Vorgang frei, eigen oder fremd?

Die Faelle bilden den Befund vom 19.10.2026 nach: Demo-Stamm 1 trug im
Live-EPCAT 8 identische Events aus user2, dazu fremde aus sawmill/bspwerk und
Events ohne jeden Pod-Bezug. Jede dieser Lagen braucht eine andere Antwort.

Ausfuehren aus timberconnect-epcis:
    python -m pytest tests/test_ident_check.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ident_check import (  # noqa: E402
    OBJECT_EVENT,
    STATUS_FOREIGN,
    STATUS_FREE,
    STATUS_OWN_DIFFERENT,
    STATUS_OWN_IDENTICAL,
    STATUS_UNASSIGNED,
    TRANSFORMATION_EVENT,
    ProposedDocument,
    assess_document,
    creating_epcs,
)

HOST = "https://solid-community-server.tmdt.info"
OWN_POD = f"{HOST}/user2/"
STAMM_1 = "urn:epc:id:sgtin:404711145.0100.12A3D4567"
STAMM_2 = "urn:epc:id:sgtin:404711145.0100.56KCTQMJM"
LAMELLE = "urn:epc:id:sgtin:404711146.0212.120231002917"
SAATGUT = "urn:epc:class:lgtin:404711145.0001.Pflanzung01"


def object_event(epcs, biz_tx, event_id="urn:uuid:a", action="ADD"):
    return {
        "type": OBJECT_EVENT,
        "eventID": event_id,
        "action": action,
        "epcList": list(epcs),
        "bizTransactionList": [{"bizTransaction": biz_tx}] if biz_tx else [],
    }


def transformation_event(inputs, outputs, biz_tx, event_id="urn:uuid:t"):
    return {
        "type": TRANSFORMATION_EVENT,
        "eventID": event_id,
        "inputEPCList": list(inputs),
        "outputEPCList": list(outputs),
        "bizTransactionList": [{"bizTransaction": biz_tx}] if biz_tx else [],
    }


def faellvorgang():
    return ProposedDocument(
        label="Harvesterprotokoll", event_type=OBJECT_EVENT,
        output_epcs=[STAMM_1, STAMM_2],
    )


def test_ohne_events_ist_frei():
    result = assess_document(faellvorgang(), [], OWN_POD)
    assert result.status == STATUS_FREE
    assert result.taken_epcs == []


def test_verbrauch_durch_andere_ist_keine_vergabe():
    # Das Saegewerk hat Stamm 1 als Input verarbeitet -- der Ident ist damit
    # verbraucht, aber nicht von jemand anderem ERZEUGT. Ein Faellvorgang
    # darf ihn weiterhin registrieren (die Erzeugung fehlt ja gerade noch).
    events = [transformation_event([STAMM_1], [LAMELLE], f"{HOST}/sawmill/data/DoP-1")]
    result = assess_document(faellvorgang(), events, OWN_POD)
    assert result.status == STATUS_FREE


def test_eigene_identische_events_erlauben_ersetzen():
    # 8 identische Captures aus derselben Datei in user2 -- in Bloecken.
    events = [
        object_event([STAMM_1], f"{OWN_POD}data/f65c", event_id=f"urn:uuid:{i}")
        for i in range(8)
    ] + [object_event([STAMM_2], f"{OWN_POD}data/f65c", event_id="urn:uuid:chunk2")]
    result = assess_document(faellvorgang(), events, OWN_POD)
    assert result.status == STATUS_OWN_IDENTICAL
    assert result.own_biz_transactions == [f"{OWN_POD}data/f65c"]
    assert result.existing_event_count == 9


def test_herkunftskante_macht_eigenen_vorgang_nicht_fremd():
    # Zum Faellvorgang gehoert die bestaetigte Kante Pflanzung -> Rundholz:
    # ein TransformationEvent mit denselben Staemmen als Ausgang. Sie ist Teil
    # desselben Vorgangs, kein widersprechender zweiter.
    events = [
        object_event([STAMM_1, STAMM_2], f"{OWN_POD}data/f65c"),
        {
            "type": TRANSFORMATION_EVENT,
            "eventID": "urn:uuid:origin",
            "inputQuantityList": [{"epcClass": SAATGUT, "quantity": 200, "uom": "GRM"}],
            "outputEPCList": [STAMM_1, STAMM_2],
            "bizTransactionList": [
                {"bizTransaction": f"{OWN_POD}data/VG-2026-0902-7a04/f65c_forst.ttl"}
            ],
        },
    ]
    result = assess_document(faellvorgang(), events, OWN_POD)
    assert result.status == STATUS_OWN_IDENTICAL


def test_eigener_vorgang_mit_anderen_identen_ist_gesperrt():
    # Frueher nur Stamm 1 registriert, jetzt kommt Stamm 2 dazu: andere
    # Ident-Liste, also ein anderer Vorgang auf einem vergebenen Ident.
    events = [object_event([STAMM_1], f"{OWN_POD}data/f65c")]
    result = assess_document(faellvorgang(), events, OWN_POD)
    assert result.status == STATUS_OWN_DIFFERENT
    assert result.taken_epcs == [STAMM_1]


def test_fremder_pod_sperrt_auch_neben_eigenem_treffer():
    events = [
        object_event([STAMM_1, STAMM_2], f"{OWN_POD}data/f65c", event_id="urn:uuid:own"),
        object_event([STAMM_1, STAMM_2], f"{HOST}/forst/data/abcd", event_id="urn:uuid:f"),
    ]
    result = assess_document(faellvorgang(), events, OWN_POD)
    assert result.status == STATUS_FOREIGN
    assert result.owner_pods == [f"{HOST}/forst/", OWN_POD]


def test_events_ohne_pod_bezug_sind_herrenlos():
    events = [object_event([STAMM_1], "")]
    result = assess_document(faellvorgang(), events, OWN_POD)
    assert result.status == STATUS_UNASSIGNED


def test_ohne_angemeldeten_pod_gilt_nichts_als_eigen():
    events = [object_event([STAMM_1, STAMM_2], f"{OWN_POD}data/f65c")]
    result = assess_document(faellvorgang(), events, None)
    assert result.status == STATUS_FOREIGN


def test_transformation_vergleicht_beide_seiten():
    proposed = ProposedDocument(
        label="Leistungserklaerung", event_type=TRANSFORMATION_EVENT,
        output_epcs=[LAMELLE], input_epcs=[STAMM_1],
    )
    same = [transformation_event([STAMM_1], [LAMELLE], f"{OWN_POD}data/DoP-1")]
    assert assess_document(proposed, same, OWN_POD).status == STATUS_OWN_IDENTICAL

    other_input = [transformation_event([STAMM_2], [LAMELLE], f"{OWN_POD}data/DoP-1")]
    assert assess_document(proposed, other_input, OWN_POD).status == STATUS_OWN_DIFFERENT

    # Gleiche Idente, aber als ObjectEvent erfasst: nicht dasselbe Ereignis.
    as_object = [object_event([LAMELLE], f"{OWN_POD}data/DoP-1")]
    assert assess_document(proposed, as_object, OWN_POD).status == STATUS_OWN_DIFFERENT


def test_fehlende_eingaenge_werden_gemeldet_aber_nicht_gesperrt():
    proposed = ProposedDocument(
        label="Leistungserklaerung", event_type=TRANSFORMATION_EVENT,
        output_epcs=[LAMELLE], input_epcs=[STAMM_1, STAMM_2],
    )
    events = [object_event([STAMM_1], f"{HOST}/forst/data/abcd")]
    result = assess_document(proposed, events, OWN_POD)
    assert result.status == STATUS_FREE
    assert result.missing_inputs == [STAMM_2]


def test_observe_erzeugt_nichts():
    assert creating_epcs(object_event([STAMM_1], "", action="OBSERVE")) == set()
    assert creating_epcs({"type": "AggregationEvent", "childEPCs": [STAMM_1]}) == set()


def test_mengenliste_zaehlt_als_erzeugt():
    event = {
        "type": OBJECT_EVENT,
        "action": "ADD",
        "quantityList": [{"epcClass": SAATGUT, "quantity": 200, "uom": "GRM"}],
    }
    assert creating_epcs(event) == {SAATGUT}
