"""
Bettet einen GS1-Ident als verstecktes AcroForm-Feld in ein PDF ein.

Macht per Skript genau das, was die Anleitung fuer Adobe Acrobat Pro
beschreibt (Werkzeuge -> Formulare -> Textfeld "Identity", Sichtbarkeit
Ausgeblendet, Schreibgeschuetzt Ja, Standardwert = der Ident):

    /T  Identity              Feldname
    /FT /Tx                   Textfeld
    /Ff 1                     ReadOnly
    /F  6                     Hidden(2) + Print(4)
    /V  urn:epc:...           Wert
    /DV urn:epc:...           Standardwert

Gedacht fuer ausstellende Stellen, die den Ident nachtraeglich in bereits
ausgestellte (auch gescannte) Zertifikate einbringen wollen, ohne Acrobat Pro
zu bedienen. Der sichtbare Inhalt des Dokuments bleibt unveraendert -- das
Feld ist ausgeblendet und liegt ausserhalb des Textflusses.

Verwendung:

    python tools/embed_ident.py <pdf> <urn:epc:...> [-o <ausgabe.pdf>]

Ohne -o wird die Datei an Ort und Stelle ersetzt; daneben entsteht eine
Sicherungskopie "<name>.original.pdf". Ein bereits vorhandenes Identity-Feld
wird ueberschrieben, nicht dupliziert -- zwei Felder gleichen Namens waeren
im AcroForm mehrdeutig.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    BooleanObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

# Gleiches Muster wie im Viewer (pdfIdentityService.ts) und im Backend
# (pdf_template_service.py). Ein Ident, den die App spaeter ablehnt, darf hier
# gar nicht erst eingebettet werden.
EPC_URN_RE = re.compile(
    r"^urn:epc:(id:sgtin|class:lgtin):[0-9]+\.[0-9]+\.[A-Za-z0-9_-]+$"
)

FIELD_NAME = "Identity"

# Flags wie in der Acrobat-Anleitung.
FF_READONLY = 1
F_HIDDEN_PRINT = 6  # Hidden(2) | Print(4)


def build_identity_field(page_ref, epc: str, name: str = FIELD_NAME) -> DictionaryObject:
    """Das versteckte, schreibgeschuetzte Textfeld als Widget-Annotation."""
    field = DictionaryObject()
    field.update({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/FT"): NameObject("/Tx"),
        NameObject("/T"): TextStringObject(name),
        NameObject("/V"): TextStringObject(epc),
        NameObject("/DV"): TextStringObject(epc),
        NameObject("/Ff"): NumberObject(FF_READONLY),
        NameObject("/F"): NumberObject(F_HIDDEN_PRINT),
        NameObject("/DA"): TextStringObject("/Helv 12 Tf 0 g"),
        NameObject("/MK"): DictionaryObject(),
        # Nullflaeche: das Feld ist ohnehin ausgeblendet, aber ein Rechteck
        # der Groesse 0 kann auch dann nichts ueberdecken, wenn ein Betrachter
        # das Hidden-Flag ignoriert.
        NameObject("/Rect"): ArrayObject([
            FloatObject(0), FloatObject(0), FloatObject(0), FloatObject(0),
        ]),
        NameObject("/P"): page_ref,
    })
    return field


def embed_fields(pdf_bytes: bytes, fields: dict[str, str]) -> bytes:
    """Mehrere versteckte Ident-Felder auf einmal einbetten.

    ``fields`` bildet Feldname -> Wert ab, z.B. ``{"Identity": "urn:epc:..."}``
    oder fuer einen Saegevorgang ``{"Identity_1": "<Lamellen;...>",
    "IdentityInput_1": "<Staemme;...>"}``. Mehrere EPCs in einem Feld werden
    per Semikolon getrennt -- dieselbe Konvention, die Viewer
    (pdfIdentityService.ts) und Konverter beim Lesen erwarten.

    Gleichnamige vorhandene Felder werden ersetzt, nicht dupliziert: zwei
    Felder gleichen Namens waeren im AcroForm mehrdeutig, und welcher Wert
    gewinnt, haengt vom Betrachter ab.
    """
    import io

    reader = PdfReader(io.BytesIO(pdf_bytes))
    # Vollstaendig klonen, nicht nur die Seiten uebernehmen:
    # append_pages_from_reader kopiert das AcroForm-Woerterbuch NICHT. Der
    # Writer legt dann ein frisches AcroForm an, das nur noch das Identity-Feld
    # enthaelt -- saemtliche Formularfelder der Vorlage waeren verloren. Da die
    # ausgefuellten Felder beim Upload die Datenquelle sind, muessen sie
    # erhalten bleiben.
    writer = PdfWriter(clone_from=reader)

    page_ref = writer._pages["/Kids"][0]
    page = page_ref.get_object()
    names = set(fields)

    new_refs = [
        writer._add_object(build_identity_field(page_ref, value, name))
        for name, value in fields.items()
    ]

    existing = page.get("/Annots")
    kept = ArrayObject()
    if existing:
        for ref in existing:
            annot = ref.get_object()
            if str(annot.get("/T", "")) not in names:
                kept.append(ref)
    kept.extend(new_refs)
    page[NameObject("/Annots")] = kept

    root = writer._root_object
    acro = root.get("/AcroForm")
    if acro is None:
        acro = DictionaryObject()
        root[NameObject("/AcroForm")] = writer._add_object(acro)
    acro = root["/AcroForm"].get_object() if hasattr(root["/AcroForm"], "get_object") else acro

    existing_fields = acro.get("/Fields")
    if existing_fields is None:
        existing_fields = ArrayObject()
    remaining = ArrayObject(
        ref for ref in existing_fields
        if str(ref.get_object().get("/T", "")) not in names
    )
    remaining.extend(new_refs)
    acro[NameObject("/Fields")] = remaining

    if "/DA" not in acro:
        acro[NameObject("/DA")] = TextStringObject("/Helv 0 Tf 0 g")
    # Der Wert steht ohne Appearance-Stream im Feld; NeedAppearances weist den
    # Betrachter an, ihn selbst zu erzeugen. Fuer das Auslesen (pdfjs/pypdf
    # lesen /V direkt) ist das unerheblich, fuer Acrobat aber sauberer.
    acro[NameObject("/NeedAppearances")] = BooleanObject(True)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def embed(pdf_path: Path, epc: str, out_path: Path) -> None:
    """Ein einzelnes ``Identity``-Feld einbetten (Kommandozeile)."""
    out_path.write_bytes(embed_fields(pdf_path.read_bytes(), {FIELD_NAME: epc}))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bettet einen GS1-Ident als verstecktes AcroForm-Feld ein."
    )
    parser.add_argument("pdf", type=Path, help="PDF-Datei")
    parser.add_argument("epc", help="GS1-EPC als URN, z.B. urn:epc:id:sgtin:...")
    parser.add_argument(
        "-o", "--out", type=Path, default=None,
        help="Ausgabedatei (Standard: Original ersetzen, Kopie als .original.pdf)",
    )
    args = parser.parse_args()

    if not args.pdf.is_file():
        print(f"FEHLER: Datei nicht gefunden: {args.pdf}", file=sys.stderr)
        return 1
    if not EPC_URN_RE.match(args.epc):
        print(
            f"FEHLER: {args.epc!r} ist kein gueltiger GS1-EPC.\n"
            "Erwartet: urn:epc:id:sgtin:<gcp>.<itemref>.<serial> oder "
            "urn:epc:class:lgtin:<gcp>.<itemref>.<lot>",
            file=sys.stderr,
        )
        return 1

    in_place = args.out is None
    out_path = args.out or args.pdf.with_suffix(".ident.pdf")

    if in_place:
        backup = args.pdf.with_suffix(".original.pdf")
        if not backup.exists():
            shutil.copy2(args.pdf, backup)
            print(f"Sicherungskopie: {backup.name}")

    embed(args.pdf, args.epc, out_path)

    if in_place:
        shutil.move(str(out_path), str(args.pdf))
        out_path = args.pdf

    # Gegenprobe: der Wert muss so wieder lesbar sein, wie die App ihn liest.
    fields = PdfReader(str(out_path)).get_fields() or {}
    value = (fields.get(FIELD_NAME) or {}).get("/V")
    if value != args.epc:
        print(f"FEHLER: Gegenprobe fehlgeschlagen, gelesen: {value!r}", file=sys.stderr)
        return 1

    print(f"OK  {out_path.name}: Feld '{FIELD_NAME}' = {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
