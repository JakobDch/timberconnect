import {
  BarChart3,
  FileText,
  Hammer,
  MapPin,
  MessageCircle,
  Recycle,
  Scale,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppView } from '../types';
import type { ProductStage } from '../services/productImageService';

/**
 * Registry der Anwendungsfaelle -- die EINZIGE Wahrheitsquelle.
 *
 * Vorher pflegten Startseite, Seitenmenue und Anwendungsfall-Raster je eine
 * eigene, hartkodierte Liste. Sie liefen auseinander: derselbe Anwendungsfall
 * hiess an drei Stellen anders, und ein freigeschalteter Fall blieb anderswo
 * als "Demnaechst" stehen. Genau das soll hier nicht mehr passieren.
 *
 * Ein Anwendungsfall gilt als verfuegbar, sobald er ein ``view`` hat -- also
 * eine Ansicht, die man oeffnen kann. Es gibt bewusst KEIN separates
 * active-Flag: zwei Wahrheiten koennten wieder auseinanderlaufen. Wer einen
 * neuen Fall fertigstellt, traegt hier ``view`` ein, und Startseite, Menue,
 * Raster und Navigation ziehen automatisch mit.
 *
 * Die Reihenfolge ist dem Nutzer freigestellt: erst scannen, dann den Fall
 * waehlen -- oder erst den Fall waehlen und danach scannen. Im zweiten Fall
 * merkt sich App.tsx die Auswahl und springt nach dem Scan direkt hinein,
 * ohne noch einmal zu fragen.
 *
 * Einen neuen Anwendungsfall ergaenzen:
 *   1. Eintrag in USE_CASES aufnehmen (ohne ``view`` = "Demnaechst")
 *   2. Ansicht bauen und in AppView + App.tsx rendern
 *   3. ``view`` hier eintragen -- fertig, ueberall sichtbar
 *
 * Stand 21.08.2026 hat JEDER Eintrag ein ``view``. Die drei unfertigen Faelle
 * (PEFC/FSC-Zertifizierung, DGNB-Zertifizierung, Wartungs- und Inspektions-
 * management) wurden entfernt: als "Demnaechst"-Kachel versprachen sie etwas,
 * das der Datenraum nicht einloest. Die Mechanik dafuer bleibt bestehen --
 * wer den naechsten Fall baut, kann Schritt 1 weiterhin nutzen.
 */
export interface UseCaseDefinition {
  /** Stabile Id, auch fuer die Persistenz der Toggles. */
  id: string;
  /** Titel -- ueberall identisch, das war vorher der Hauptunterschied. */
  title: string;
  /** Kurzbeschreibung fuer das Menue und die Kopfzeile der Ansicht. */
  description: string;
  /**
   * Fachliche Beschreibung fuer den Infoblock, der sich beim Anklicken der
   * Kachel oeffnet (Texte Anni, 26.08.2026).
   *
   * Bewusst getrennt von ``description``: die Kachel selbst traegt keinen
   * Untertitel mehr -- weitere Informationen erscheinen erst beim Anklicken.
   * Das haelt das Raster ruhig und gibt dem Text den Platz, den ein Satz wie
   * die EN-15804-Definition braucht.
   */
  longDescription: string;
  icon: LucideIcon;
  /**
   * Zielansicht. Gesetzt = der Fall ist nutzbar und wird ueberall als
   * verfuegbar gezeigt; fehlt sie, erscheint "Demnaechst".
   */
  view?: AppView;
}

/**
 * Reihenfolge nach Vorgabe Anni (26.08.2026): erst die fachlichen Nachweise
 * entlang der Wertschoepfungskette, dann der Produktpass als Buendelung
 * aller Daten, zuletzt der Assistent.
 */
export const USE_CASES: UseCaseDefinition[] = [
  {
    id: 'origin-proof',
    title: 'Herkunftsnachweis',
    description: 'Herkunft des Holzes auf der Karte',
    longDescription:
      'Nachweis der Rohstoffherkunft (u.a. Holzart, Herkunftsregion, Zertifizierung) des verarbeiteten Holz entlang der Wertschöpfungskette.',
    icon: MapPin,
    view: 'origin',
  },
  {
    id: 'co2',
    title: 'CO₂-Bilanz',
    description: 'CO₂-Bilanz über die Lebenszyklusmodule A1–A5',
    longDescription:
      'Ausweisung der produktbezogenen Treibhausgasemissionen für die Herstellungsphase (A1–A3) sowie den Bauprozess (A4–A5) in Anlehnung an EN 15804+A2.',
    icon: BarChart3,
    view: 'co2',
  },
  {
    id: 'deconstruction',
    title: 'Rückbaubarkeit',
    description: 'Verbindungsarten und Wiederverwendbarkeit',
    longDescription:
      'Bewertung der technischen Trenn- und Wiederverwendbarkeit am Ende der Nutzungsphase, maßgeblich beeinflusst durch die verwendete Verbindungstechnik.',
    icon: Recycle,
    view: 'deconstruction',
  },
  {
    id: 'documentation',
    title: 'Dokumentation',
    description: 'Produktbegleitende Dokumentation bis zum Einbau',
    longDescription:
      'Nachvollziehbarkeit von Einbauort, Menge und produktspezifischen Eigenschaften der verbauten BSP-Platte innerhalb des konkreten Bauwerks.',
    icon: Wrench,
    view: 'documentation',
  },
  {
    id: 'liability',
    title: 'Nachweis der Haftung',
    description: 'Haftungsnachweis über die Lieferkette',
    longDescription:
      'Zuordnung von Verantwortlichkeiten und Gewährleistungsansprüchen entlang der Wertschöpfungskette bei Qualitätsmängeln oder Abweichungen von deklarierten Produkteigenschaften.',
    icon: Scale,
    view: 'liability',
  },
  {
    // Id bleibt 'dbpp': sie steckt in gespeicherten Rollen-Toggles und in der
    // Navigation. DBPP und DPP bezeichnen dieselbe Sache -- geaendert hat sich
    // nur der angezeigte Name (Vorgabe Anni, 26.08.2026).
    id: 'dbpp',
    title: 'DPP EU (Digitaler Produktpass)',
    description: 'Alle Produktdaten in der Struktur eines digitalen Produktpasses',
    longDescription:
      'Digitaler Produktpass in Anlehnung an künftige EU-Vorgaben (ESPR), der produktspezifische Herkunfts-, Zusammensetzungs- und Nachhaltigkeitsdaten über den gesamten Lebenszyklus hinweg bereitstellt.',
    icon: FileText,
    view: 'productpass',
  },
  {
    id: 'chatbot',
    title: 'Sprich mit deinem Bauteil',
    description: 'Frage dein Bauteil direkt nach Herkunft, Daten und Nachweisen',
    // Im Stil der uebrigen Texte formuliert; von Anni nicht mitgeliefert,
    // weil ihre Liste nur die sechs fachlichen Nachweise umfasst.
    longDescription:
      'Abfrage der produktbezogenen Daten in natürlicher Sprache; der Assistent beantwortet Fragen zu Herkunft, Eigenschaften und Nachweisen ausschließlich aus den im Datenraum hinterlegten Angaben des Bauteils.',
    icon: MessageCircle,
    view: 'chat',
  },
];

/** Ein Anwendungsfall ist nutzbar, sobald er eine Ansicht hat. */
export function isAvailable(useCase: UseCaseDefinition): boolean {
  return useCase.view !== undefined;
}

/**
 * Verfuegbarkeit fuer ein KONKRETES Bauteil.
 *
 * `isAvailable` sagt nur, ob der Fall ueberhaupt gebaut ist. Ob er sich fuer
 * das gescannte Bauteil oeffnen laesst, haengt zusaetzlich an den Daten: ein
 * Herkunftsnachweis ohne Waldangaben oder eine Rueckbaubarkeit ohne
 * Verbindungsdaten waere eine leere Seite.
 *
 * Der Grund wird mitgeliefert, damit die Oberflaeche ihn nennen kann, statt
 * die Kachel wortlos auszugrauen — dann sucht niemand den Fehler bei sich.
 */
export interface UseCaseAvailability {
  available: boolean;
  /** Kurzer Grund, wenn nicht verfuegbar. */
  reason?: string;
}

/** Datenlage eines Bauteils, soweit sie fuer die Pruefung zaehlt. */
export interface ProductDataFacts {
  hasProduct: boolean;
  hasForest: boolean;
  hasSupplyChain: boolean;
  hasDeconstruction: boolean;
  hasCertificates: boolean;
  hasCertifications: boolean;
  /**
   * Wertschoepfungsstufe des GESCANNTEN Objekts aus dem RDF-Typ der
   * Stammdaten (detectProductStage); null = nicht bestimmbar. Bewusst nicht
   * product.productType: der raet "finished", sobald irgendwo in der
   * geladenen Kette BSP-Werk-Daten liegen -- damit waere jeder Stamm eine
   * Platte.
   */
  productStage: ProductStage | null;
}

export function useCaseAvailability(
  useCase: UseCaseDefinition,
  facts: ProductDataFacts | null,
): UseCaseAvailability {
  if (!isAvailable(useCase)) {
    return {
      available: false,
      reason: 'Dieser Anwendungsfall ist noch in Entwicklung.',
    };
  }

  // Ohne Bauteil ist kein Anwendungsfall auswertbar -- ausnahmslos. Jeder
  // Fall trifft eine Aussage UEBER EIN PRODUKT; ohne Produkt gaebe es nur
  // einen Leerzustand oder, schlimmer, Demo-Werte, die wie echte Daten
  // aussehen. Frueher waren CO2 und Herkunftsnachweis hiervon ausgenommen
  // (Flag ``standalone``); das ist ersatzlos entfallen.
  if (!facts) {
    return { available: false, reason: 'Zuerst ein Bauteil erfassen.' };
  }

  switch (useCase.id) {
    case 'co2':
      // Awf-Vorgabe (Rueckmeldung Anni, 18.08.2026): Die CO2-Bilanz ist nur
      // fuer die FERTIGE BSP-Platte definiert -- fuer Vorprodukte wuerden
      // sich die Lebenszyklusmodule verschieben. Deshalb ist der Fall fuer
      // alles andere gesperrt; bei unbestimmbarer Produktart wird ebenfalls
      // gesperrt statt geraten (Philosophie von detectProductStage).
      return facts.productStage === 'clt-panel'
        ? { available: true }
        : {
            available: false,
            reason:
              facts.productStage === null
                ? 'Die CO₂-Bilanz ist nur für BSP-Platten definiert; die Produktart dieses Objekts ist aus den Stammdaten nicht bestimmbar.'
                : 'Die CO₂-Bilanz ist nur für die fertige BSP-Platte definiert — für Vorprodukte würden sich die Lebenszyklusmodule verschieben.',
          };
    case 'origin-proof':
      return facts.hasForest || facts.hasSupplyChain
        ? { available: true }
        : {
            available: false,
            reason:
              'Zu diesem Bauteil liegen keine Wald- oder Lieferkettendaten vor.',
          };
    case 'deconstruction':
      return facts.hasDeconstruction
        ? { available: true }
        : {
            available: false,
            reason:
              'Zu diesem Bauteil sind keine Verbindungs- und Rückbaudaten hinterlegt.',
          };
    case 'documentation':
      // Dieselbe Datengrundlage wie die Rueckbaubarkeit (ERP-Panel,
      // Leistungserklaerung, Klebstoff) -- die Verortung aus der
      // Ausfuehrungsplanung kommt hinzu, ist aber optional: fehlt sie, weist
      // die Ansicht die Kategorie als Luecke aus, statt zu verschwinden.
      return facts.hasDeconstruction || facts.hasProduct
        ? { available: true }
        : {
            available: false,
            reason: 'Zu diesem Bauteil sind keine Produktdokumente hinterlegt.',
          };
    case 'liability':
      // Dieselbe Datengrundlage wie die Dokumentation: Pruefbericht,
      // Leistungserklaerungen, Klebstoff-Datenblatt und ERP-Panel. Der
      // Haftungsnachweis bleibt auch dann sinnvoll, wenn einzelne Nachweise
      // fehlen -- gerade DANN: die Ansicht weist die Luecke je Prozessstufe
      // aus, und genau das ist im Schadensfall die relevante Aussage.
      return facts.hasDeconstruction || facts.hasProduct
        ? { available: true }
        : {
            available: false,
            reason: 'Zu diesem Bauteil sind keine Nachweisdokumente hinterlegt.',
          };
    case 'dbpp':
      return facts.hasProduct
        ? { available: true }
        : { available: false, reason: 'Keine Produktdaten in den Quellen gefunden.' };
    case 'chatbot':
      // Der Assistent fragt die Pod-Quellen ab, die am gescannten Bauteil
      // haengen. Ohne Produktdaten gaebe es nichts abzufragen -- der Chat
      // koennte nur noch aus dem Modellwissen raten, und genau das soll er
      // nicht: geantwortet wird ausschliesslich aus den Daten dieses Bauteils.
      return facts.hasProduct
        ? { available: true }
        : {
            available: false,
            reason:
              'Zu diesem Bauteil liegen keine Daten vor, über die der Assistent Auskunft geben könnte.',
          };
    default:
      return { available: true };
  }
}

/** Alle nutzbaren Anwendungsfaelle. */
export function availableUseCases(): UseCaseDefinition[] {
  return USE_CASES.filter(isAvailable);
}

/** Nachschlagen per Id -- fuer die Navigation in App.tsx. */
export function findUseCase(id: string): UseCaseDefinition | undefined {
  return USE_CASES.find((useCase) => useCase.id === id);
}

/** Fallback-Icon, wenn ein Eintrag (noch) keines mitbringt. */
export const DEFAULT_USE_CASE_ICON: LucideIcon = Hammer;
