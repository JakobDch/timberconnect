/**
 * Pfadregeln im Pod — reine Zeichenkettenlogik, ohne Abhaengigkeiten.
 *
 * Bewusst ein eigenes Modul: Diese Regeln entscheiden, WO etwas im Pod landet,
 * und sind damit prueffbar wichtig. In `pdfDocumentService` waeren sie nur
 * ueber `pdfjs-dist` erreichbar, das beim Import ein `DOMMatrix` verlangt und
 * sich weder in Node noch in jsdom laden laesst — die Regel waere ungetestet
 * geblieben, obwohl sie nichts mit PDF-Verarbeitung zu tun hat.
 */

/**
 * Wohin ein hochgeladenes PDF gehoert.
 *
 * Ist der Vorgangs-Container gesetzt, landet das Dokument DORT statt in einem
 * eigenen Ordner je Dokument-Hash — wie beim maschinenlesbaren Upload, der das
 * schon so macht (siehe convertAndUploadWithSession, Parameter
 * processContainerUrl).
 *
 * Ohne ihn zerfiel ein Vorgang im Pod in mehrere Container: der Vorgang selbst
 * plus einen je PDF-Anhang. In der Loeschliste standen sie als gleichrangige
 * Eintraege nebeneinander ("Transportauftrag Rundholz" neben "Faellvorgang"),
 * obwohl der Transportauftrag ein Anhang des Faellvorgangs ist — man haette den
 * Vorgang loeschen und seine Anhaenge einzeln nachraeumen muessen.
 *
 * Der abschliessende Slash wird erzwungen: Aus ihm werden die Dateinamen
 * zusammengesetzt, und fehlt er, entsteht ein Geschwisterpfad statt eines
 * Kindes ("data/VG-1_dokument.pdf" statt "data/VG-1/_dokument.pdf").
 */
export function containerForPdf(
  podBase: string,
  docId: string,
  processContainerUrl?: string | null,
): string {
  const target = processContainerUrl?.trim();
  if (!target) return `${podBase}data/${docId}/`;
  return target.endsWith('/') ? target : `${target}/`;
}
