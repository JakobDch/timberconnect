# Macht tests/ zum Paket.
#
# test_ident_query.py importiert Hilfsfunktionen aus test_pdf_templates
# ("from tests.test_pdf_templates import build_form_data"). Ohne diese Datei
# findet Python das Modul nicht und die Sammlung der GESAMTEN Suite bricht ab,
# nicht nur dieser eine Test.
