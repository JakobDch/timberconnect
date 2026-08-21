"""
Konsistenz-Check: Registry (services/pdf_template_service.py) <-> AcroForm-
Feldnamen der Template-PDFs (pdf_templates/*.pdf).

Prueft fuer jedes Template:
  1. Jeder in der Registry hinterlegte ``pdf``-Feldname existiert im PDF
     (Zeilen-Muster "{n}" wird 1..row_count expandiert).
  2. Jedes ausfuellbare PDF-Feld ist in der Registry abgedeckt (kein
     Datenpunkt geht verloren).

Ausfuehren:  python tests/test_pdf_field_names.py   (benoetigt pypdf)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from pypdf import PdfReader  # noqa: E402

from services.pdf_template_service import TEMPLATES, PDF_TEMPLATES_DIR  # noqa: E402


def registry_pdf_names(template: dict) -> set[str]:
    names: set[str] = set()
    for section in template["sections"]:
        # Der Materialbezug wird im Viewer ausgewaehlt, nicht in der PDF
        # eingetragen -- er hat bewusst kein AcroForm-Feld.
        if section.get("material_ref"):
            continue
        row_count = section.get("row_count", 1)
        for field in section["fields"]:
            pdf_name = field["pdf"]
            if not pdf_name:
                continue
            if section.get("repeatable"):
                for n in range(1, row_count + 1):
                    names.add(pdf_name.replace("{n}", str(n)))
            else:
                names.add(pdf_name)
    return names


def main() -> int:
    failures: list[str] = []

    for tid, template in TEMPLATES.items():
        pdf_path = PDF_TEMPLATES_DIR / f"{tid}.pdf"
        if not pdf_path.exists():
            failures.append(f"{tid}: Template-PDF fehlt ({pdf_path.name})")
            continue

        reader = PdfReader(str(pdf_path))
        acro_fields = reader.get_fields() or {}
        # Nur ausfuellbare Endfelder (Eltern-Knoten haben kein /FT)
        pdf_names = {name for name, fld in acro_fields.items() if fld.get("/FT")}

        reg_names = registry_pdf_names(template)

        missing_in_pdf = reg_names - pdf_names
        uncovered = pdf_names - reg_names

        if missing_in_pdf:
            failures.append(
                f"{tid}: Registry-Felder ohne PDF-Feld: {sorted(missing_in_pdf)}"
            )
        if uncovered:
            failures.append(
                f"{tid}: PDF-Felder ohne Registry-Eintrag: {sorted(uncovered)}"
            )
        if not missing_in_pdf and not uncovered:
            print(f"OK   {tid}: {len(pdf_names)} PDF-Felder vollständig gemappt")

    if failures:
        print("\nFEHLER:")
        for f in failures:
            print(" -", f)
        return 1
    print("\nAlle Template-PDFs vollständig und exakt gemappt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
