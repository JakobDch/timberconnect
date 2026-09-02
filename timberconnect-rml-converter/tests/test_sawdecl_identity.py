"""
Die Dokumentidentitaet der Leistungserklaerung Schnittholz.

Warum es diesen Test gibt: ``timber-event`` nimmt ``fields.nr`` als Identitaet
des sawdecl-Treibers. Fehlt sie, bricht der Treiber ab

    "format 'sawdecl' produced no document identity;
     the identifying field is missing (sawdecl: fields.nr)"

und es entsteht KEIN TransformationEvent. Dieses Ereignis ist die einzige Kante
zwischen Stamm und Lamelle -- ohne es endet die Kette der BSP-Platte bei den
Lamellen, die Forstdaten werden nie geladen und der Faellort fehlt im
Herkunftsnachweis.

Der Fehler war unsichtbar: der Upload faengt EPCISClientError bewusst ab, um
TTL und JSON trotzdem in den Pod zu schreiben. Er lief also "erfolgreich"
durch, und die Luecke zeigte sich erst Stufen spaeter in der Ansicht.

``nr`` war einmal optional (weil Katharinas Saegewerks-PDF das AcroForm-Feld
nicht trug) -- genau das hat den Schaden verursacht. Diese Tests halten fest,
dass das Feld Pflicht bleibt UND dass die Demo-Datei es traegt.

Ausfuehren:  python tests/test_sawdecl_identity.py   (benoetigt pypdf)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from pypdf import PdfReader  # noqa: E402

from services.pdf_template_service import (  # noqa: E402
    TEMPLATES,
    pdf_fields_to_form_data,
)

REPO = Path(__file__).resolve().parents[2]
DEMO_PDF = (
    REPO
    / "demo-dateien_v3"
    / "3_Aufsaegevorgang"
    / "PFLICHT_leistungserklaerung_schnittholz.pdf"
)

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"OK   {message}")
    else:
        print(f"FEHL {message}")
        failures.append(message)


def field_def(template_id: str, key: str) -> dict | None:
    for section in TEMPLATES[template_id]["sections"]:
        for field in section["fields"]:
            if field["key"] == key:
                return field
    return None


def test_nr_is_required() -> None:
    """Ohne Pflicht rutscht ein Upload ohne Identitaet stillschweigend durch."""
    fd = field_def("pdf_leistungserklaerung", "nr")
    check(fd is not None, "Registry kennt das Feld 'nr'")
    if fd:
        check(
            fd.get("required") is True,
            "'nr' ist PFLICHT (sonst entsteht kein TransformationEvent)",
        )
        check(
            fd.get("pdf") == "Nummer",
            f"'nr' liest das AcroForm-Feld 'Nummer' (ist: {fd.get('pdf')!r})",
        )


def test_bsp_nr_stays_required() -> None:
    """Die BSP-Leistungserklaerung hatte die Pflicht immer -- sie bleibt."""
    fd = field_def("pdf_leistungserklaerung_bsp", "nr")
    check(
        bool(fd) and fd.get("required") is True,
        "'nr' der BSP-Leistungserklaerung ist weiterhin Pflicht",
    )


def test_demo_pdf_carries_the_number() -> None:
    """Die Demo-Datei muss hochladbar sein, ohne dass jemand nachtraegt.

    Katharinas Original trug das Feld nicht (v2 hatte es, v3 nicht mehr).
    Fehlt es, laesst sich die Demo-Kette nicht durchspielen.
    """
    if not DEMO_PDF.is_file():
        check(False, f"Demo-Datei gefunden ({DEMO_PDF})")
        return
    fields = PdfReader(str(DEMO_PDF)).get_fields() or {}
    check("Nummer" in fields, "Demo-PDF hat das AcroForm-Feld 'Nummer'")
    value = str((fields.get("Nummer") or {}).get("/V") or "")
    check(bool(value.strip()), f"Demo-PDF: 'Nummer' ist gefuellt (ist: {value!r})")

    # Die versteckte Ident-Ablage darf dabei nicht verloren gegangen sein.
    check("Identity" in fields, "Demo-PDF hat weiterhin das Feld 'Identity'")


def test_demo_pdf_maps_to_nr() -> None:
    """Der Weg PDF -> Registry-Key muss tatsaechlich ``nr`` ergeben."""
    if not DEMO_PDF.is_file():
        return
    fields = PdfReader(str(DEMO_PDF)).get_fields() or {}
    acro = {
        k: (str(v.get("/V")) if v.get("/V") is not None else "")
        for k, v in fields.items()
    }
    form = pdf_fields_to_form_data("pdf_leistungserklaerung", acro)
    nr = (form.get("fields") or {}).get("nr")
    check(
        bool(nr and str(nr).strip()),
        f"AcroForm 'Nummer' wird zu fields.nr (ist: {nr!r})",
    )


if __name__ == "__main__":
    test_nr_is_required()
    test_bsp_nr_stays_required()
    test_demo_pdf_carries_the_number()
    test_demo_pdf_maps_to_nr()

    print()
    if failures:
        print(f"FEHLGESCHLAGEN: {len(failures)}")
        for f in failures:
            print(f" - {f}")
        sys.exit(1)
    print("Alle Pruefungen bestanden.")
