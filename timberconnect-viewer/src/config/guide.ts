import { UserPlus, ShieldCheck, Upload, Nfc } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Anleitung -- Inhalte der Hilfeseiten im Seitenmenue.
 *
 * Gewuenscht von den Praxispartnern ("Feedback App_Allgemein", 17.09.2026,
 * Folie 3): ein Menuepunkt "Anleitung" mit den Unterpunkten Registrierung,
 * Rechtemanagement, Daten teilen und Daten abrufen. Die endgueltigen Texte
 * und Screenshots liefern die Partner nach; bis dahin stehen hier VORSCHLAEGE,
 * die den tatsaechlichen Ablauf der Anwendung beschreiben (Stand 17.09.2026),
 * und je Schritt ein Platzhalter fuer den Screenshot.
 *
 * Die Inhalte sind bewusst Daten und kein JSX: wer einen Text austauscht,
 * aendert eine Zeichenkette und muss die Darstellung nicht kennen. Kommt ein
 * Screenshot, wird sein Pfad (unter public/guide/) in ``screenshot``
 * eingetragen -- die Platzhalterflaeche verschwindet dann von selbst.
 *
 * ``draft`` markiert, dass ein Thema noch auf die Freigabe der Partner
 * wartet; der Hinweis oben im Sheet haengt daran.
 */

export type GuideTopicId = 'registration' | 'access' | 'share' | 'retrieve';

export interface GuideStep {
  title: string;
  text: string;
  /** Pfad relativ zu BASE_URL, z.B. "guide/registrierung-1.png". */
  screenshot?: string;
}

export interface GuideTopic {
  id: GuideTopicId;
  title: string;
  /** Untertitel im Menue und im Kopf des Sheets. */
  summary: string;
  icon: LucideIcon;
  /** Einleitender Absatz. */
  intro: string;
  steps: GuideStep[];
  /** Wartet noch auf den endgueltigen Text der Praxispartner. */
  draft: boolean;
}

export const GUIDE_TOPICS: GuideTopic[] = [
  {
    id: 'registration',
    title: 'Registrierung',
    summary: 'Konto, Rolle und Company Prefix',
    icon: UserPlus,
    intro:
      'Um Daten zu teilen oder kostenpflichtige Anwendungsfälle zu öffnen, brauchen Sie ein Konto im Datenraum. Das Konto ist ein Solid Pod – ein eigener, dezentraler Datenspeicher, in dem Ihre Daten und Ihre Rolle liegen.',
    steps: [
      {
        title: 'Konto anlegen',
        text: 'Wählen Sie oben rechts „Registrieren“. Die Kontoanlage des Solid-Servers öffnet sich in einem neuen Tab. Vergeben Sie E-Mail-Adresse und Passwort. Dabei entstehen Ihr Konto, Ihr Pod und Ihre WebID – die Adresse, unter der Sie im Datenraum erkennbar sind.',
      },
      {
        title: 'Anmelden',
        text: 'Zurück in TimberConnect klicken Sie auf „Anmelden“. Sie werden zum Solid-Server weitergeleitet, bestätigen dort die Anmeldung und kehren automatisch in die Anwendung zurück.',
      },
      {
        title: 'Rolle wählen',
        text: 'Beim ersten Anmelden erscheint „Registrierung abschließen“. Wählen Sie die Rolle, die Ihr Unternehmen in der Wertschöpfungskette einnimmt – zum Beispiel Forstbetrieb, Sägewerk, Holzwerkstoffproduzent oder Fachplaner Holzbau. Die Rolle wird in Ihrem Pod gespeichert, steuert, wer Ihre Daten abfragen darf, und ist danach nicht mehr änderbar.',
      },
      {
        title: 'GS1 Company Prefix eintragen',
        text: 'Tragen Sie einmalig den GS1 Company Prefix Ihres Unternehmens ein (4–12 Ziffern). Aus ihm entstehen die Idente (SGTIN/LGTIN) der Bauteile, die Sie registrieren. Auch diese Angabe ist nach dem Speichern nicht mehr änderbar.',
      },
      {
        title: 'Profil ergänzen',
        text: 'Über das Benutzermenü oben rechts können Sie unter „Profil bearbeiten“ Anzeigename, Unternehmen und Kontaktdaten ergänzen. Diese Angaben sehen andere Teilnehmer, wenn Ihr Unternehmen in einer Lieferkette auftaucht.',
      },
    ],
    draft: true,
  },
  {
    id: 'access',
    title: 'Rechtemanagement',
    summary: 'Wer darf welche Daten sehen',
    icon: ShieldCheck,
    intro:
      'Ihre Daten bleiben in Ihrem Pod. Sie legen selbst fest, welche Rollen der Wertschöpfungskette darauf zugreifen dürfen – allgemein für den ganzen Pod und bei Bedarf feiner je Dokument.',
    steps: [
      {
        title: 'Zugriff verwalten öffnen',
        text: 'Öffnen Sie das Benutzermenü oben rechts und wählen Sie „Zugriff verwalten“.',
      },
      {
        title: 'Allgemeine Freigabe festlegen',
        text: 'Im Reiter „Allgemein“ kreuzen Sie die Rollen an, die Ihre Daten grundsätzlich abfragen dürfen. Diese Freigabe ist die Obergrenze: Kein einzelnes Dokument kann mehr freigeben, als hier erlaubt ist.',
      },
      {
        title: 'Freigabe je Dokument einschränken',
        text: 'Im Reiter „Dokumente“ können Sie für einzelne Dateien die Rollen weiter einschränken – etwa eine Kalkulation, die niemand außer Ihnen sehen soll. Wirksam ist immer die Schnittmenge aus allgemeiner Freigabe und Dokumentfreigabe.',
      },
      {
        title: 'Freigabe beim Registrieren eines Vorgangs',
        text: 'Nach jedem Upload fragt die Anwendung je Dokument, wer es sehen darf. Vorbelegt ist die allgemeine Freigabe – im Regelfall genügt „Weiter“, nur Abweichungen kosten einen Klick.',
      },
      {
        title: 'Was die Freigabe bewirkt',
        text: 'Die Freigabe gilt für die Dateien in Ihrem Pod und für die Ereignisse der Lieferkette (EPCIS). Ein Teilnehmer ohne passende Rolle sieht weder die Dokumente noch die daraus abgeleiteten Angaben in den Anwendungsfällen.',
      },
    ],
    draft: true,
  },
  {
    id: 'share',
    title: 'Daten teilen',
    summary: 'Einen Vorgang registrieren',
    icon: Upload,
    intro:
      'Daten gelangen vorgangsweise in den Datenraum: Jede Station der Kette registriert den Vorgang, den sie verantwortet – vom Pflanzvorgang bis zur Ausführungsplanung. Dafür ist eine Anmeldung erforderlich.',
    steps: [
      {
        title: '„Daten teilen“ wählen',
        text: 'Klicken Sie auf der Startseite auf „Daten teilen“. Ohne Anmeldung bittet die Anwendung zuerst um die Anmeldung.',
      },
      {
        title: 'Vorgang wählen',
        text: 'Wählen Sie den Vorgang: Pflanzvorgang, Fällvorgang, Aufsägevorgang, Herstellungsvorgang oder Ausführungsplanung. Angeboten werden nur die Vorgänge, die zu Ihrer Rolle passen.',
      },
      {
        title: 'Pflichtdokument hochladen',
        text: 'Jeder Vorgang hat ein Pflichtdokument – etwa das Stammzertifikat beim Pflanzvorgang, das Harvesterprotokoll beim Fällvorgang, den ERP-Export beim Herstellungsvorgang oder die IFC-Datei bei der Ausführungsplanung. Weitere Dokumente (ausgefüllte PDF-Vorlagen, Lieferscheine, Prüfberichte) können Sie ergänzen.',
      },
      {
        title: 'Angaben prüfen',
        text: 'Vor dem Upload zeigt die Prüfansicht die aus den Dateien gelesenen Werte und die erkannten Idente. Beim Pflanzvorgang zeichnen Sie außerdem die Pflanzfläche auf der Karte ein.',
      },
      {
        title: 'Freigabe festlegen',
        text: 'Legen Sie je Dokument fest, welche Rollen es sehen dürfen (siehe „Rechtemanagement“).',
      },
      {
        title: 'Fertig',
        text: 'Die Dokumente liegen in Ihrem Pod, die Idente und Ereignisse sind im Datenraum auffindbar. Ab jetzt findet ein Scan des Bauteils Ihre Daten – im Rahmen der Freigabe.',
      },
    ],
    draft: true,
  },
  {
    id: 'retrieve',
    title: 'Daten abrufen (Produkt scannen)',
    summary: 'Ein Bauteil identifizieren und auswerten',
    icon: Nfc,
    intro:
      'Ein Scan identifiziert das Bauteil und zeigt, welche Anwendungsfälle dafür verfügbar sind. Der Scan selbst ist kostenlos – bezahlt wird erst, wenn Sie einen Anwendungsfall öffnen.',
    steps: [
      {
        title: 'Produkt erfassen',
        text: 'Klicken Sie auf „Daten abrufen“ und erfassen Sie den DotCode, Barcode oder RFID-Tag mit dem Scanner – oder tippen Sie die ID ein. Ein Baum trägt keinen Code: Wählen Sie „Baum finden“ und bestimmen Sie ihn über GPS oder die Fläche auf der Karte.',
      },
      {
        title: 'Übersicht prüfen',
        text: 'Nach dem Scan sehen Sie die erfasste ID, die Produktart und die verfügbaren Anwendungsfälle. Für Baum, Rundholz und Schnittholz stehen alle Anwendungsfälle außer CO₂-Bilanz und Rückbaubarkeit zur Verfügung; für BSP alle.',
      },
      {
        title: 'Umfang wählen',
        text: 'Bei Baum, Rundholz und Schnittholz wählen Sie zwischen „Gesamte Kette“ (alles, was mit dem Bauteil verknüpft ist – auch was daraus entstanden ist) und „Vorangegangene Kette“ (nur die Stationen davor). Bei BSP wird immer die gesamte Kette angezeigt.',
      },
      {
        title: 'Anwendungsfall öffnen',
        text: 'Öffnen Sie einen Anwendungsfall. Vor der Anzeige nennt die Anwendung den Preis in TimberToken (1 Token = 1 Datenpunkt); nach der Bestätigung öffnet sich die Ansicht. Einmal bezahlte Datenpunkte bleiben für Sie freigeschaltet.',
      },
      {
        title: 'Fragen stellen',
        text: 'Über „Sprich mit deinem Bauteil“ fragen Sie das Bauteil in natürlicher Sprache nach Herkunft, Eigenschaften und Nachweisen. Der Assistent antwortet ausschließlich aus den Daten, die zu diesem Bauteil im Datenraum liegen.',
      },
    ],
    draft: true,
  },
];

export function findGuideTopic(id: GuideTopicId): GuideTopic | undefined {
  return GUIDE_TOPICS.find((topic) => topic.id === id);
}
