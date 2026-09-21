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
import type { ChainScope } from '../services/supplyChainWalk';

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
    // Navigation. Der angezeigte Name hiess vom 26.08. bis 17.09.2026
    // "DPP EU (Digitaler Produktpass)"; seither wieder DBPP -- Wortlaut von
    // Titel und Beschreibung sind die Vorgabe des Projektpartners
    // ("Anmerkungen App_DPP EU", 17.09.2026) und werden nicht umformuliert.
    id: 'dbpp',
    title: 'Digitaler Bauproduktpass (DBPP)',
    description: 'Branchenspezifischer Vorläufer zum EU-Produktpass für Holzbauteile',
    longDescription:
      'Der Digitale Bauproduktpass (DBPP) wird im Forschungsprojekt TimberConnect als branchenspezifischer Vorläufer zum Digital Product Passport (DPP) gemäß der Bauproduktenverordnung (EU) 2024/3110 für Holzbauteile entwickelt.',
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
  /**
   * Stufen, die DOWNSTREAM des erfassten Bauteils liegen -- was aus ihm
   * entstanden ist. Nur beim Umfang "Gesamte Kette" gefuellt.
   *
   * Erlaubt die nur-fuer-BSP-Faelle auch dann, wenn ein Vorprodukt gescannt
   * wurde, die Platte aber in der geladenen Kette liegt.
   */
  downstreamStages: ProductStage[];
  /**
   * Wie weit die Kette geladen wurde. Bestimmt mit, welche Faelle sich
   * sinnvoll oeffnen lassen -- siehe die Regel in useCaseAvailability.
   */
  scope: ChainScope;
}

/**
 * Faelle, die es NUR fuer die fertige BSP-Platte gibt.
 *
 * Vorgabe der Praxispartner ("Feedback App_Allgemein", 17.09.2026, Folie 8):
 *   BSP                          -> alle Anwendungsfaelle
 *   Schnittholz, Rundholz, Baum  -> alle bis auf CO2-Bilanz und Rueckbaubarkeit
 *
 * Die CO2-Bilanz ist nur fuer die Platte definiert (fuer Vorprodukte
 * verschoeben sich die Lebenszyklusmodule), die Rueckbaubarkeit bewertet
 * Verbindungstechnik und Wiederverwendbarkeit des BAUTEILS -- ein Stamm hat
 * keine Verbindungsart. Alles andere (Herkunft, Dokumentation, Haftung,
 * Produktpass, Assistent) trifft auch fuer ein Vorprodukt eine vollstaendige
 * Aussage, nur eine kuerzere.
 *
 * Bis 17.09.2026 sperrte zusaetzlich der Umfang: im eingeschraenkten Umfang
 * blieben fuer Vorprodukte nur Herkunft und Assistent offen. Das ist mit der
 * Vorgabe entfallen -- der Umfang bestimmt seither nur noch, wie weit die
 * Kette geladen wird, nicht mehr, welche Faelle sich oeffnen lassen.
 *
 * SEIT 18.09.2026 mit einer Ausnahme, und zwar der, um die es der Vorgabe
 * eigentlich geht: Wer "Gesamte Kette" waehlt, laedt AUCH die Platte, die aus
 * dem erfassten Vorprodukt entstanden ist. Dann gibt es die Angaben -- nur
 * eben ueber die Platte. Sie deshalb zu verschweigen, waere das Gegenteil
 * dessen, was der Umfang verspricht.
 *
 * Die Freigabe haengt an ``downstreamStages``, nicht am Umfang allein: ein
 * Stamm, aus dem noch keine Platte hergestellt wurde, hat auch bei "Gesamte
 * Kette" nichts vorzuweisen, und die Kachel muss das sagen statt eine leere
 * Ansicht zu oeffnen.
 *
 * Wichtig fuer die ANSICHTEN: Sie zeigen dann Werte der Platte, waehrend der
 * Nutzer ein Vorprodukt erfasst hat. Wofuer die Zahlen gelten, muss dort
 * dranstehen -- ``useCaseSubject`` liefert den Bezug.
 */
const CLT_PANEL_ONLY_USE_CASES = new Set(['co2', 'deconstruction']);

/**
 * Bezieht sich der Anwendungsfall auf ein ANDERES Bauteil als das erfasste?
 *
 * Genau dann, wenn ein nur-fuer-BSP-Fall ueber die Platte downstream
 * freigegeben wurde. Die Ansicht nennt den Bezug damit im Kopf, sonst liest
 * jemand die CO2-Bilanz der Platte als die seines Schnittholzes.
 */
export function useCaseRefersToDownstreamPanel(
  useCaseId: string,
  productStage: ProductStage | null,
  downstreamStages: ProductStage[] | undefined,
): boolean {
  // ``null`` faellt hier heraus wie in useCaseAvailability: ohne erkannte
  // Vorstufe wird der Fall gar nicht erst freigegeben, also gibt es auch
  // nichts zu erklaeren.
  return (
    CLT_PANEL_ONLY_USE_CASES.has(useCaseId) &&
    productStage !== null &&
    productStage !== 'clt-panel' &&
    (downstreamStages ?? []).includes('clt-panel')
  );
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

  // Nur-BSP-Faelle. Es gibt zwei Wege hinein: das erfasste Bauteil IST die
  // Platte -- oder es ist ein Vorprodukt, aus dem eine Platte entstanden ist,
  // und diese Platte wurde mitgeladen ("Gesamte Kette"). Im zweiten Fall
  // gelten die Angaben der Platte; die Ansicht sagt das im Kopf dazu
  // (useCaseRefersToDownstreamPanel).
  if (CLT_PANEL_ONLY_USE_CASES.has(useCase.id) && facts.productStage !== 'clt-panel') {
    // Bei unbestimmbarer Produktart (null) wird gesperrt statt geraten
    // (Philosophie von detectProductStage) -- die vorsichtige Richtung ist
    // die engere.
    //
    // Das gilt AUCH, wenn downstream eine Platte liegt, und diese Reihenfolge
    // ist der Punkt: Ohne bekannte Stufe ist gar nicht gesagt, dass das
    // Erfasste ein Vorprodukt DIESER Platte ist -- es koennte ein Beleg sein,
    // der nur zufaellig in derselben Quelle steht. Die Freigabe unten setzt
    // eine erkannte Vorstufe voraus.
    if (facts.productStage === null) {
      return {
        available: false,
        reason: `${useCase.title} gibt es nur für BSP-Platten; die Produktart dieses Objekts ist aus den Stammdaten nicht bestimmbar.`,
      };
    }

    // Die Platte liegt in der geladenen Kette: die Angaben gibt es, nur eben
    // ueber sie. Die Ansicht nennt den Bezug im Kopf.
    if (facts.downstreamStages.includes('clt-panel')) {
      return { available: true };
    }

    // Der Umfang ist der Grund, an dem der Nutzer etwas aendern KANN --
    // deshalb steht er zuerst. Bei "Vorangegangene Kette" wurde gar nicht
    // nach unten gesucht; es kann also durchaus eine Platte geben.
    if (facts.scope !== 'full') {
      return {
        available: false,
        reason:
          `${useCase.title} gibt es nur für die fertige BSP-Platte. Mit dem Umfang ` +
          '„Gesamte Kette" werden die Angaben der Platte einbezogen, die aus diesem Bauteil entstanden ist.',
      };
    }

    return {
      available: false,
      reason:
        useCase.id === 'co2'
          ? // Awf-Vorgabe (Rueckmeldung Anni, 18.08.2026)
            'Die CO₂-Bilanz ist nur für die fertige BSP-Platte definiert — für Vorprodukte würden sich die Lebenszyklusmodule verschieben. Zu diesem Bauteil ist keine Platte in der Kette hinterlegt.'
          : 'Die Rückbaubarkeit ist nur für die fertige BSP-Platte definiert — Verbindungsart und Wiederverwendbarkeit betreffen das Bauteil, nicht seine Vorprodukte. Zu diesem Bauteil ist keine Platte in der Kette hinterlegt.',
    };
  }

  switch (useCase.id) {
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
