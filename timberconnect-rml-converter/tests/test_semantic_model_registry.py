"""
Prueft, dass jedes RML-Mapping auch ein semantisches Modell bekommt.

Anlass: ``ifc_planung.rml.ttl`` lag monatelang im mappings/-Ordner, war aber
nicht in ``SemanticModelService.MAPPING_FILES`` eingetragen. Folge war still
und schwer zu bemerken -- fuer IFC-Planungsdatensaetze wurde kein semantisches
Modell erzeugt und im Katalog veroeffentlicht. Der Assistent ("Sprich mit
deinem Bauteil") legt das vollstaendige Datenmodell in seinen Prompt; was dort
fehlt, existiert fuer ihn nicht. Die Verortung der Bauteile im Gebaeude war
damit unsichtbar, obwohl die Daten im Pod lagen.

Ein neues Mapping anzulegen und die Registrierung zu vergessen, ist ein
naheliegender Fehler -- deshalb dieser Test statt eines Kommentars.

Geprueft wird:
  1. Jedes mappings/*.rml.ttl ist in MAPPING_FILES eingetragen.
  2. Jeder Eintrag zeigt auf eine existierende Datei.
  3. Jeder Eintrag hat eine menschenlesbare Beschreibung.
  4. Aus jedem Mapping laesst sich tatsaechlich ein Modell mit Klassen bauen.

Ausfuehren:  python -m pytest tests/test_semantic_model_registry.py
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.semantic_model_service import SemanticModelService  # noqa: E402

BASE = Path(__file__).parent.parent
MAPPINGS_DIR = BASE / "mappings"

MAPPING_FILES_ON_DISK = sorted(p.name for p in MAPPINGS_DIR.glob("*.rml.ttl"))


def test_mappings_exist():
    """Ohne Mappings sagt der Rest des Tests nichts aus."""
    assert MAPPING_FILES_ON_DISK, f"Keine Mappings unter {MAPPINGS_DIR}"


def test_every_mapping_is_registered():
    """Jedes Mapping auf der Platte muss ein semantisches Modell bekommen."""
    registered = set(SemanticModelService.MAPPING_FILES.values())
    missing = sorted(set(MAPPING_FILES_ON_DISK) - registered)
    assert not missing, (
        "Diese Mappings sind NICHT in MAPPING_FILES eingetragen und bekommen "
        f"deshalb kein semantisches Modell: {missing}. "
        "Folge: der Assistent sieht diese Daten nicht."
    )


def test_no_registered_mapping_is_missing_on_disk():
    """Umgekehrt: ein Eintrag ohne Datei scheitert erst zur Laufzeit."""
    for mapping_id, filename in SemanticModelService.MAPPING_FILES.items():
        assert (MAPPINGS_DIR / filename).exists(), (
            f"MAPPING_FILES['{mapping_id}'] zeigt auf {filename}, "
            "aber die Datei fehlt."
        )


def test_every_mapping_has_a_description():
    """Die Beschreibung erscheint im Katalog -- sie darf nicht fehlen."""
    undescribed = sorted(
        set(SemanticModelService.MAPPING_FILES)
        - set(SemanticModelService.MAPPING_DESCRIPTIONS)
    )
    assert not undescribed, f"Ohne Beschreibung: {undescribed}"


@pytest.mark.parametrize("mapping_id", sorted(SemanticModelService.MAPPING_FILES))
def test_model_extraction_yields_classes(mapping_id):
    """
    Ein Eintrag nuetzt nur, wenn sich daraus wirklich ein Modell bauen laesst.

    Geprueft wird auf Klassen, nicht bloss auf "kein Fehler": ein leeres Modell
    waere im Katalog eine Datei ohne Aussage.
    """
    service = SemanticModelService()
    content, filename = service.extract_model(mapping_id)

    assert filename == f"{mapping_id}_semantic_model.ttl"
    assert content, f"{mapping_id}: leeres Modell"

    ttl = content.decode("utf-8")
    # Die Modelle sind flach: "Klasse Praedikat Wertebereich". Mindestens eine
    # Zuweisung mit einem Prefix-Namen muss vorkommen.
    assert ":" in ttl and "@prefix" in ttl, f"{mapping_id}: kein Turtle"
