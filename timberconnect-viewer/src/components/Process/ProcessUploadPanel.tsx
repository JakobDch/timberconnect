import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  Clock,
  Coins,
  FileText,
  Factory,
  HelpCircle,
  Loader2,
  LogIn,
  Plus,
  Ruler,
  TreePine,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  detectFiles,
  convertAndUploadWithSession,
  type DetectedFile,
  type AutoUploadResult,
} from '../../services/uploadService';
import {
  fetchPdfTemplates,
  uploadPdfDocument,
  type PdfDocumentResult,
  type PdfTemplate,
} from '../../services/pdfDocumentService';
import { preparePhoto, uploadProductPhoto } from '../../services/productPhotoService';
import { PdfTemplateSelect, PlantingAreaSheet } from '../PdfIntegration';
import type { PolygonGeoJson } from '../Map/PlantingAreaMap';
import { useAuth } from '../../auth/AuthContext';
import { TOKEN_SYMBOL } from '../../services/walletService';
import { addRecentUploads, formatFileSize } from '../../services/recentActivity';
import {
  attachProcessIdents,
  checkProcessIdents,
  createProcess,
  defaultProcessTitle,
  formatRegisteredAt,
  getProcess,
  getProcessType,
  registerProcessFiles,
  validateProcessDraft,
  type ProcessDraftFile,
  type ProcessFileRef,
  type ProcessRecord,
  type ProcessTypeId,
} from '../../services/processService';
import { extractPdfIdentity } from '../../services/pdfIdentityService';
import { isEpc } from '../../services/sparqlQueries';
import { ProcessTypePicker } from './ProcessTypePicker';
import { LeadDocumentSlot } from './LeadDocumentSlot';
import { ProcessSearchSheet } from './ProcessSearchSheet';

/**
 * Vorgangs-basierter Upload.
 *
 * Statt einzelne Dateien hochzuladen, registriert der Nutzer einen VORGANG im
 * Leben des Produkts (Pflanzung, Fällung, Aufsägung, Herstellung) und laedt
 * alle Dateien dieses Lebensabschnitts gemeinsam hoch.
 *
 * Ablauf:
 *   'choose'  — Vorgang waehlen (oder: Dateien zu bestehendem Vorgang nachreichen)
 *   'collect' — Pflichtdatei + weitere Dateien sammeln; je PDF wird gleich hier
 *               zugeordnet, um welches Dokument es sich handelt
 *   'done'    — Ergebnis
 *
 * Die Pflichtdatei ist hart erzwungen: ohne sie kein Vorgang. Sie traegt die
 * Verknuepfung zur Material-ID, auf deren Basis EPCIS-Events gebaut werden.
 *
 * PDFs verhalten sich wie die maschinenlesbaren Dateien: der Nutzer laedt die
 * AUSGEFUELLTE Vorlage hoch, die Werte werden beim Registrieren direkt aus dem
 * AcroForm gelesen und materialisiert. Es wird nichts mehr in der App
 * abgetippt.
 */

const DATA_TYPE_ICONS: Record<string, typeof TreePine> = {
  forst: TreePine,
  saegewerk: Factory,
  bspwerk: Building2,
  herstellung: Building2,
  planung: Ruler,
  dokument: FileText,
  unknown: HelpCircle,
};

type Step = 'choose' | 'collect' | 'done';

interface ProcessUploadPanelProps {
  onUploadSuccess: (traceId: string) => void;
  isLoading?: boolean;
  onLoginClick?: () => void;
}

function isPdf(item: ProcessDraftFile): boolean {
  return (
    item.dataType === 'dokument' ||
    item.file.type === 'application/pdf' ||
    item.file.name.toLowerCase().endsWith('.pdf')
  );
}

/** Erkennung fuer eine Dateiliste nachziehen (PDFs notfalls per Endung). */
async function detectAll(files: File[]): Promise<Map<string, DetectedFile>> {
  const map = new Map<string, DetectedFile>();
  try {
    const response = await detectFiles(files);
    for (const d of response.files) map.set(d.filename, d);
  } catch (err) {
    console.warn('[process-upload] Erkennung fehlgeschlagen:', err);
  }
  return map;
}

function toDraftFile(file: File, detection: DetectedFile | undefined): ProcessDraftFile {
  if (detection) {
    return { file, dataType: detection.data_type, isRecognized: detection.is_recognized };
  }
  // PDFs sind auch ohne Backend eindeutig (Endung/MIME).
  const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  return { file, dataType: pdf ? 'dokument' : null, isRecognized: pdf };
}

/**
 * Die Material-Idente einer Datei lesen, BEVOR sie hochgeladen wird.
 *
 * Zwei Quellen, je nach Dateiart:
 *   PDF            — das versteckte AcroForm-Feld, das die ausstellende
 *                    Stelle eingebettet hat (auch Saegevorgangs-Paare).
 *   Maschinendaten — die trace_id der Backend-Erkennung. Sie ist nicht immer
 *                    ein EPC (bei HPR ein StemKey); nur EPCs werden genommen,
 *                    alles andere waere fuer den Vergleich wertlos.
 *
 * Wirft nie: eine Datei ohne lesbaren Ident ist kein Fehler, sondern der
 * Normalfall bei Dokumenten, die einen Produkt-TYP beschreiben.
 */
/**
 * Den Ident aus einer IFC-Datei lesen, ohne sie hochzuladen.
 *
 * Sucht das Bauteilattribut "Identity" (gleiche Konvention wie das versteckte
 * AcroForm-Feld der PDFs). Bewusst eine schlichte Textsuche statt eines
 * IFC-Parsers: Es geht nur darum, ob das Eingabefeld noetig ist -- die
 * belastbare Auswertung macht der Konverter (services/ifc_service.py), der
 * denselben Wert noch einmal selbst liest.
 *
 * Findet sie nichts, ist das kein Fehler: dann traegt die Datei eben keinen
 * Ident und der Nutzer gibt ihn an.
 */
async function readIfcIdentity(file: File): Promise<string | null> {
  try {
    const text = await file.text();
    // IFCPROPERTYSINGLEVALUE('Identity',$,IFCLABEL('urn:epc:...'),$)
    const match = text.match(
      /IFCPROPERTYSINGLEVALUE\(\s*'(?:identity|gs1[ -]?epc|material[ -]?id)'\s*,[^)]*?'(urn:epc:[^']+)'/i,
    );
    return match?.[1]?.trim() ?? null;
  } catch (err) {
    console.warn('[process-upload] IFC-Ident konnte nicht gelesen werden:', err);
    return null;
  }
}

async function readEpcs(
  file: File,
  detection: DetectedFile | undefined,
): Promise<string[]> {
  const isPdfFile =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdfFile) {
    try {
      const identity = await extractPdfIdentity(await file.arrayBuffer());
      if (!identity) return [];
      if (identity.sawings?.length) {
        return Array.from(
          new Set(
            identity.sawings.flatMap((s) => [...s.materialInputEpc, ...s.materialEpc]),
          ),
        );
      }
      return [identity.epc, ...(identity.inputEpc ? [identity.inputEpc] : [])];
    } catch (err) {
      console.warn('[process-upload] Ident konnte nicht gelesen werden:', err);
      return [];
    }
  }

  const trace = detection?.trace_id?.trim();
  return trace && isEpc(trace) ? [trace] : [];
}

export function ProcessUploadPanel({
  onUploadSuccess,
  isLoading = false,
  onLoginClick,
}: ProcessUploadPanelProps) {
  const { isLoggedIn, authenticatedFetch, userName, webId, companyPrefix } = useAuth();

  const [step, setStep] = useState<Step>('choose');
  const [processType, setProcessType] = useState<ProcessTypeId | null>(null);
  const [title, setTitle] = useState('');
  const [leadDoc, setLeadDoc] = useState<ProcessDraftFile | null>(null);
  const [isDetectingLead, setIsDetectingLead] = useState(false);
  const [attachments, setAttachments] = useState<ProcessDraftFile[]>([]);
  const [isDetectingAttachments, setIsDetectingAttachments] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AutoUploadResult | null>(null);
  const [savedProcess, setSavedProcess] = useState<ProcessRecord | null>(null);

  /** Gesetzt, wenn Dateien zu einem BESTEHENDEN Vorgang nachgereicht werden. */
  const [targetProcess, setTargetProcess] = useState<ProcessRecord | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);


  /** Verfuegbare PDF-Vorlagen (Registry des Converter-Backends). */
  const [templates, setTemplates] = useState<PdfTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  /**
   * Zuordnung "welches Dokument ist diese Datei?", pro Dateiname. Nur PDFs
   * brauchen sie — bei maschinenlesbaren Formaten erkennt das Backend den Typ
   * aus dem Inhalt.
   */
  const [pdfTemplateIds, setPdfTemplateIds] = useState<Record<string, string>>({});
  /** Ergebnis der PDF-Uploads dieses Durchlaufs (fuer die Ergebnisansicht). */
  const [pdfResults, setPdfResults] = useState<PdfDocumentResult[]>([]);
  /**
   * Gezeichnete Pflanzflaechen je Dateiname. Der einzige Wert, den ein PDF
   * nicht tragen kann — er wird vor dem Registrieren auf der Karte erhoben.
   */
  const [plantingAreas, setPlantingAreas] = useState<Record<string, PolygonGeoJson>>({});
  /** Datei, fuer die die Karte gerade offen ist. */
  const [areaPrompt, setAreaPrompt] = useState<ProcessDraftFile | null>(null);
  /** Dateien, fuer die der Nutzer die Flaeche bewusst uebersprungen hat. */
  const [skippedAreas, setSkippedAreas] = useState<string[]>([]);
  /** Nach dem Karten-Schritt: Registrierung fortsetzen. */
  const [pendingSubmit, setPendingSubmit] = useState(false);
  /**
   * Material-ID des in der IFC geplanten Bauteils (Vorgang "Ausführungsplanung").
   *
   * RUECKFALLWEG: Traegt das Bauteil im Planungsmodell bereits das Attribut
   * "Identity" (wie die PDFs ihr verstecktes AcroForm-Feld), wird der Ident
   * von dort gelesen und dieses Feld gar nicht erst gezeigt. Nur wenn die
   * Datei ihn nicht mitbringt -- etwa weil die Planung vor der Fertigung
   * exportiert wurde --, muss er hier eingetragen werden.
   */
  const [ifcEpc, setIfcEpc] = useState('');
  /** Ident, den die gewaehlte IFC-Datei selbst mitbringt (null = keiner). */
  const [ifcFileEpc, setIfcFileEpc] = useState<string | null>(null);

  // Optionales Produktfoto -- zeigt spaeter das tatsaechliche Stueck statt des
  // Standardbilds der Produktart. Die Vorschau-URL wird beim Wechsel wieder
  // freigegeben, sonst haelt der Browser jedes gewaehlte Bild im Speicher.
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const attachInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  /**
   * Template-Vorschlaege des aktuellen Vorgangs: die Pflichtdatei-Vorlage
   * (Stammzertifikat, Leistungserklaerung) zuerst, dann die uebrigen typischen
   * Dokumente. Steuert nur die Vorsortierung — die Auswahl bleibt vollstaendig.
   */
  const suggestedTemplateIds = useMemo(() => {
    const type = targetProcess
      ? getProcessType(targetProcess.type)
      : processType
        ? getProcessType(processType)
        : null;
    if (!type) return [];
    return type.leadDoc.templateId
      ? [type.leadDoc.templateId, ...type.suggestedTemplates]
      : type.suggestedTemplates;
  }, [processType, targetProcess]);

  /** Vorlage einer Datei, sofern zugeordnet. */
  const templateForFile = useCallback(
    (item: ProcessDraftFile): PdfTemplate | null => {
      const id = pdfTemplateIds[item.file.name];
      return templates.find((t) => t.id === id) ?? null;
    },
    [pdfTemplateIds, templates],
  );

  /**
   * Vorlage einer Datei setzen oder loeschen. Verwirft dabei alles, was an der
   * alten Vorlage hing — eine Flaeche, die zu einem anderen Dokument gezeichnet
   * wurde, gehoert nicht zum neuen.
   */
  const setTemplateForFile = useCallback((fileName: string, templateId: string | null) => {
    setPdfTemplateIds((prev) => {
      if (templateId) return { ...prev, [fileName]: templateId };
      if (!(fileName in prev)) return prev;
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
    setPlantingAreas((prev) => {
      if (!(fileName in prev)) return prev;
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
    setSkippedAreas((prev) => prev.filter((name) => name !== fileName));
  }, []);

  /** Alles vergessen, was zu einer entfernten Datei gehoerte. */
  const forgetFile = useCallback((fileName: string) => {
    setTemplateForFile(fileName, null);
  }, [setTemplateForFile]);

  // PDF-Vorlagen einmalig laden; die Zuordnung passiert bereits beim Sammeln
  // der Dateien, nicht erst nach dem Upload.
  useEffect(() => {
    setIsLoadingTemplates(true);
    setTemplateError(null);
    fetchPdfTemplates()
      .then(setTemplates)
      .catch((err) => {
        console.error('[process-upload] Vorlagen konnten nicht geladen werden:', err);
        setTemplateError(
          err instanceof Error ? err.message : 'Vorlagen konnten nicht geladen werden',
        );
      })
      .finally(() => setIsLoadingTemplates(false));
  }, []);

  const activeType = processType ? getProcessType(processType) : null;

  /** Beim Nachreichen ist die Pflichtdatei bereits im Vorgang vorhanden. */
  const isAppendMode = targetProcess !== null;

  const validation = useMemo(() => {
    if (isAppendMode) {
      return attachments.length > 0
        ? { ok: true, error: null, hint: null }
        : { ok: false, error: 'Bitte mindestens eine Datei auswählen.', hint: null };
    }
    const base = validateProcessDraft({
      type: processType,
      title,
      leadDoc,
      attachments,
    });

    // Ausfuehrungsplanung: Der Bauteil-Ident ist Pflicht -- entweder traegt
    // ihn die Datei selbst (ifcFileEpc), oder er wird eingetragen. Ohne ihn
    // weist der Konverter die Datei ohnehin ab; besser hier melden.
    if (base.ok && processType === 'planung' && !ifcFileEpc && !isEpc(ifcEpc)) {
      return {
        ok: false,
        error: ifcEpc.trim()
          ? 'Die Material-ID ist keine gültige GS1-Kennung (urn:epc:id:sgtin:…).'
          : 'Bitte die Material-ID des geplanten Bauteils angeben.',
        hint: null,
      };
    }
    return base;
  }, [isAppendMode, processType, title, leadDoc, attachments, ifcEpc, ifcFileEpc]);

  /**
   * Beschreiben die gesammelten Dateien dasselbe Material?
   *
   * Bewusst getrennt von `validation`: das Ergebnis warnt, blockiert aber
   * nicht. Ein Dokument ohne passenden Ident kann fachlich richtig sein
   * (Produkt-TYP statt Charge), und eine Sperre wuerde genau die Faelle
   * abweisen, die der Nutzer bewusst zusammengestellt hat.
   */
  const identCheck = useMemo(
    () =>
      checkProcessIdents([
        ...(leadDoc && !isAppendMode ? [leadDoc] : []),
        ...attachments,
      ]),
    [leadDoc, isAppendMode, attachments],
  );

  // ---------------------------------------------------------------------
  // Dateiauswahl
  // ---------------------------------------------------------------------

  const handleLeadSelect = useCallback(
    async (file: File) => {
      setLeadDoc({ file, dataType: null, isRecognized: false });
      setError(null);
      // Welches Dokument die Pflichtdatei ist, steht durch den Vorgangstyp
      // fest — die Vorlage wird deshalb vorausgewaehlt, bleibt aber aenderbar.
      const leadTemplateId = activeType?.leadDoc.templateId;
      if (leadTemplateId) setTemplateForFile(file.name, leadTemplateId);
      setIsDetectingLead(true);
      const map = await detectAll([file]);
      const detection = map.get(file.name);
      const epcs = await readEpcs(file, detection);

      // Ausfuehrungsplanung: Traegt das Bauteil den Ident schon selbst,
      // entfaellt die Eingabe. Sonst bleibt sie Pflicht.
      const fileEpc = file.name.toLowerCase().endsWith('.ifc')
        ? await readIfcIdentity(file)
        : null;
      setIfcFileEpc(fileEpc);

      setLeadDoc({
        ...toDraftFile(file, detection),
        epcs: fileEpc ? [...new Set([...epcs, fileEpc])] : epcs,
      });
      setIsDetectingLead(false);
    },
    [activeType, setTemplateForFile],
  );

  const handleAttachmentsAdded = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    const pending = files.map((f) => ({ file: f, dataType: null, isRecognized: false }));
    setAttachments((prev) => [...prev, ...pending]);
    setIsDetectingAttachments(true);
    const map = await detectAll(files);
    // Idente je Datei lesen, damit die Zusammengehoerigkeit noch VOR dem
    // Upload geprueft werden kann (checkProcessIdents weiter unten).
    const epcsByName = new Map<string, string[]>();
    await Promise.all(
      files.map(async (f) => epcsByName.set(f.name, await readEpcs(f, map.get(f.name)))),
    );
    setAttachments((prev) =>
      prev.map((item) =>
        files.includes(item.file)
          ? {
              ...toDraftFile(item.file, map.get(item.file.name)),
              epcs: epcsByName.get(item.file.name) ?? [],
            }
          : item,
      ),
    );
    setIsDetectingAttachments(false);
  }, []);

  const resetDraft = () => {
    setProcessType(null);
    setTitle('');
    setLeadDoc(null);
    setAttachments([]);
    setTargetProcess(null);
    setError(null);
    setResult(null);
    setSavedProcess(null);
    setPdfResults([]);
    setPdfTemplateIds({});
    setPlantingAreas({});
    setAreaPrompt(null);
    setSkippedAreas([]);
    setPendingSubmit(false);
    setPhoto(null);
    setIfcEpc('');
    setIfcFileEpc(null);
    setStep('choose');
  };

  // ---------------------------------------------------------------------
  // Registrierung
  // ---------------------------------------------------------------------

  /** Alle Dateien dieses Durchlaufs: Pflichtdatei zuerst, dann Anhaenge. */
  const draftFiles = useMemo(
    () => [...(leadDoc && !targetProcess ? [leadDoc] : []), ...attachments],
    [leadDoc, targetProcess, attachments],
  );

  /**
   * Datei, deren Vorlage eine Pflanzflaeche verlangt, fuer die aber noch keine
   * gezeichnet wurde. Eine Flaeche laesst sich nicht ins PDF eintragen — ohne
   * diesen Schritt ginge der Geo-Bezug des Pflanzvorgangs verloren.
   */
  const fileNeedingArea = useMemo(
    () =>
      draftFiles.find((item) => {
        if (!isPdf(item)) return false;
        if (plantingAreas[item.file.name] || skippedAreas.includes(item.file.name)) {
          return false;
        }
        const template = templateForFile(item);
        return template?.sections.some((s) => s.plantingArea) ?? false;
      }) ?? null,
    [draftFiles, plantingAreas, skippedAreas, templateForFile],
  );

  /**
   * Absenden. Fehlt noch eine Pflanzflaeche, wird zuerst die Karte gezeigt;
   * der eigentliche Upload laeuft erst danach.
   */
  const handleSubmit = () => {
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (fileNeedingArea) {
      setError(null);
      setAreaPrompt(fileNeedingArea);
      return;
    }
    void runSubmit();
  };

  // Nach dem Karten-Schritt weitermachen: entweder die naechste Datei, die
  // eine Flaeche braucht, oder der eigentliche Upload.
  useEffect(() => {
    if (!pendingSubmit) return;
    setPendingSubmit(false);
    if (fileNeedingArea) {
      setAreaPrompt(fileNeedingArea);
      return;
    }
    void runSubmit();
    // runSubmit haengt an vielem, was sich waehrend des Uploads nicht aendert;
    // ausgeloest wird der Effekt allein durch pendingSubmit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmit]);

  const runSubmit = async () => {
    setIsUploading(true);
    setError(null);
    setResult(null);

    try {
      if (!isLoggedIn || !webId) {
        setError(
          'Bitte zuerst mit Ihrem Solid Pod anmelden. Ohne Anmeldung können die Daten nicht zugriffsgeschützt gespeichert werden.',
        );
        onLoginClick?.();
        return;
      }
      if (!companyPrefix) {
        setError(
          'Registrierung unvollständig: Bitte legen Sie zuerst Rolle und GS1 Company Prefix fest (Dialog öffnet sich nach dem Login automatisch).',
        );
        return;
      }

      // 1. Vorgang anlegen (oder bestehenden weiterverwenden)
      let record: ProcessRecord;
      if (targetProcess) {
        record = targetProcess;
        setProgress(`Dateien werden dem ${getProcessType(record.type).label} zugeordnet...`);
      } else {
        setProgress('Vorgang wird registriert...');
        record = await createProcess(
          {
            type: processType!,
            title: title.trim() || defaultProcessTitle(processType!),
            ownerWebId: webId,
          },
          authenticatedFetch,
        );
      }

      // 2. Alle Dateien des Vorgangs: Pflichtdatei zuerst, dann Anhaenge.
      const pdfItems = draftFiles.filter(isPdf);
      const machineItems = draftFiles.filter((f) => !isPdf(f));

      const uploadErrors: string[] = [];
      const newPdfResults: PdfDocumentResult[] = [];
      const registered: Omit<ProcessFileRef, 'addedAt'>[] = [];

      if (pdfItems.length > 0) {
        setProgress(
          pdfItems.length === 1
            ? 'PDF wird gespeichert und ausgelesen...'
            : `${pdfItems.length} PDFs werden gespeichert und ausgelesen...`,
        );
        for (const item of pdfItems) {
          try {
            const pdfResult = await uploadPdfDocument(
              item.file,
              templateForFile(item),
              authenticatedFetch,
              webId,
              userName,
              plantingAreas[item.file.name],
            );
            newPdfResults.push(pdfResult);
            if (pdfResult.warning) uploadErrors.push(pdfResult.warning);

            registered.push({
              name: item.file.name,
              size: item.file.size,
              // Wie beim maschinenlesbaren Upload zeigt der Vorgang auf die
              // materialisierte TTL, sofern es sie gibt — sonst auf das
              // Original.
              url: pdfResult.published?.ttlUrl ?? pdfResult.outcome.pdfUrl,
              isLeadDoc: item === leadDoc,
              dataType: item.dataType,
            });

            // Eingebettete Idente an den Vorgang heften — VOR
            // registerProcessFiles, damit process.ttl die tc:epc-Tripel gleich
            // mitschreibt und die Vorgangssuche ueber die Material-ID greift.
            const identity = pdfResult.outcome.identity;
            const embeddedEpcs = identity
              ? identity.sawings && identity.sawings.length > 0
                ? identity.sawings.flatMap((s) => [
                    ...s.materialEpc,
                    ...s.materialInputEpc,
                  ])
                : [identity.epc, ...(identity.inputEpc ? [identity.inputEpc] : [])]
              : [];
            if (embeddedEpcs.length > 0) {
              attachProcessIdents(record.id, { materialEpcs: embeddedEpcs });
            }
          } catch (err) {
            uploadErrors.push(
              `${item.file.name}: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`,
            );
          }
        }
      }

      let uploadResult: AutoUploadResult | null = null;
      if (machineItems.length > 0) {
        setProgress('Dateien werden konvertiert...');
        uploadResult = await convertAndUploadWithSession(
          machineItems.map((f) => f.file),
          undefined,
          authenticatedFetch,
          userName,
          webId,
          companyPrefix,
          // Nur die Ausfuehrungsplanung braucht ihn; sonst leer. Traegt die
          // Datei den Ident selbst, ist das Feld leer -- der Konverter liest
          // ihn dann direkt aus der IFC.
          isEpc(ifcEpc) ? ifcEpc.trim() : null,
        );
        setResult(uploadResult);

        if (uploadResult?.success) {
          // uploadResult.files ist nach data_type gekeyt (forst/saegewerk/
          // bspwerk/herstellung), nicht nach Dateiname — deshalb ueber den
          // data_type der Erkennung zuordnen.
          for (const item of machineItems) {
            const fileResult = item.dataType ? uploadResult.files[item.dataType] : undefined;
            registered.push({
              name: item.file.name,
              size: item.file.size,
              url: fileResult?.rdf_url || fileResult?.raw_url || '',
              isLeadDoc: item === leadDoc,
              dataType: item.dataType,
            });
            // Eingebettete Idente (ERP-Excel, Blatt "Identifikation") an den
            // Vorgang heften — VOR registerProcessFiles, damit process.ttl
            // die tc:epc-Tripel gleich mitschreibt und die Vorgangssuche
            // ueber die Material-ID funktioniert.
            const embeddedEpcs = [
              ...(fileResult?.epcs ?? []),
              ...(fileResult?.input_epcs ?? []),
            ];
            if (embeddedEpcs.length > 0) {
              attachProcessIdents(record.id, { materialEpcs: embeddedEpcs });
            }
          }
        }
      }

      // 2c. Optionales Produktfoto ablegen.
      //
      // Es landet im selben Container wie die Belege und erbt damit deren
      // Zugriffsregeln. Schlaegt das fehl, wird das gemeldet, der Vorgang
      // aber NICHT abgebrochen: das Foto ist Beiwerk, die Belege sind der
      // eigentliche Inhalt -- ein misslungener Bildupload darf einen sonst
      // vollstaendigen Vorgang nicht zunichtemachen.
      const photoTraceId = uploadResult?.trace_id ?? record.id;
      if (photo && webId) {
        try {
          setProgress('Produktfoto wird abgelegt...');
          const prepared = await preparePhoto(photo);
          const photoEpcs = Array.from(
            new Set([
              ...Object.values(uploadResult?.files ?? {}).flatMap((f) => f.epcs ?? []),
              ...(getProcess(record.id)?.materialEpcs ?? []),
            ]),
          );
          await uploadProductPhoto(
            authenticatedFetch,
            prepared,
            photoTraceId,
            photoEpcs,
            webId,
          );
        } catch (err) {
          uploadErrors.push(
            `Produktfoto: ${err instanceof Error ? err.message : 'Upload fehlgeschlagen'}`,
          );
        }
      }

      // 3. Dateien dem Vorgang zuordnen, process.ttl auffrischen
      setProgress('Vorgang wird abgeschlossen...');
      const updated = await registerProcessFiles(record.id, registered, authenticatedFetch);
      setSavedProcess(updated ?? record);

      setProgress(null);

      if (newPdfResults.length > 0) {
        setPdfResults((prev) => [...prev, ...newPdfResults]);
      }

      if (registered.length > 0) {
        addRecentUploads(registered.map((f) => ({ name: f.name, size: f.size })));
      }

      const messages = [
        ...(uploadResult && !uploadResult.success && uploadResult.message
          ? [uploadResult.message]
          : []),
        ...uploadErrors,
      ];
      if (messages.length > 0) setError(messages.join('; '));

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      setProgress(null);
    } finally {
      setIsUploading(false);
    }
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  return (
    <div className="space-y-5">
      {/* ---------- Schritt 1: Vorgang waehlen ---------- */}
      {step === 'choose' && (
        <>
          <div>
            <h3 className="text-sm font-bold text-white mb-1">
              Welcher Vorgang wird registriert?
            </h3>
            <p className="text-xs text-night-300 mb-4">
              Alle Dateien eines Lebensabschnitts werden gemeinsam hochgeladen.
              Jeder Vorgang braucht sein Pflichtdokument.
            </p>
            <ProcessTypePicker
              selected={processType}
              onSelect={(type) => {
                setProcessType(type);
                setTargetProcess(null);
                setTitle(defaultProcessTitle(type));
                setStep('collect');
              }}
              disabled={isUploading}
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-night-400">oder</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-night-700/50 hover:bg-night-700/80 border border-white/5 hover:border-acid-400/40 rounded-2xl text-left transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
              <Plus className="w-5 h-5 text-night-300" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-white">
                Datei zu bestehendem Vorgang nachreichen
              </span>
              <p className="text-xs text-night-400 mt-0.5">
                Vorgang über den Registrierungszeitpunkt suchen
              </p>
            </div>
          </button>
        </>
      )}

      {/* ---------- Schritt 2: Dateien sammeln ---------- */}
      {step === 'collect' && (activeType || targetProcess) && (
        <>
          <button
            onClick={resetDraft}
            disabled={isUploading}
            className="flex items-center gap-2 text-xs text-night-300 hover:text-white transition-colors disabled:opacity-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Anderen Vorgang wählen
          </button>

          {/* Kopf des gewaehlten Vorgangs */}
          <div className="bg-night-700/40 rounded-2xl border border-white/10 p-5">
            {targetProcess ? (
              <>
                <p className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase mb-2">
                  Nachreichen zu
                </p>
                <h3 className="text-base font-bold text-white">{targetProcess.title}</h3>
                <p className="text-xs text-night-400 mt-1">
                  {getProcessType(targetProcess.type).label} · registriert{' '}
                  {formatRegisteredAt(targetProcess.registeredAt)}
                </p>
                <p className="text-xs text-night-300 mt-2 font-mono">{targetProcess.id}</p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase mb-2">
                  Vorgang
                </p>
                <h3 className="text-base font-bold text-white mb-3">{activeType!.label}</h3>
                <label className="block text-xs font-semibold text-night-300 mb-1.5">
                  Bezeichnung
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isUploading}
                  placeholder={defaultProcessTitle(activeType!.id)}
                  className="w-full px-4 py-3 bg-night-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-acid-400/60 focus:ring-4 focus:ring-acid-400/10"
                />
                <p className="text-xs text-night-400 mt-2">
                  Hilft beim Wiederfinden. Der Vorgang ist zusätzlich über seinen
                  Registrierungszeitpunkt auffindbar.
                </p>
              </>
            )}
          </div>

          {/* Pflichtdatei — nur beim Anlegen, beim Nachreichen existiert sie schon */}
          {!targetProcess && activeType && (
            <LeadDocumentSlot
              processType={activeType}
              value={leadDoc}
              isDetecting={isDetectingLead}
              onSelect={handleLeadSelect}
              onRemove={() => {
                if (leadDoc) forgetFile(leadDoc.file.name);
                setLeadDoc(null);
                // Sonst bliebe die Bestaetigung der entfernten Datei stehen
                // und das Eingabefeld erschiene nicht wieder.
                setIfcFileEpc(null);
              }}
              disabled={isUploading}
            >
              {leadDoc && isPdf(leadDoc) && (
                <PdfTemplateSelect
                  templates={templates}
                  isLoading={isLoadingTemplates}
                  loadError={templateError}
                  value={pdfTemplateIds[leadDoc.file.name] ?? null}
                  onChange={(templateId) =>
                    setTemplateForFile(leadDoc.file.name, templateId)
                  }
                  suggestedTemplateIds={suggestedTemplateIds}
                  disabled={isUploading}
                />
              )}
            </LeadDocumentSlot>
          )}

          {/* Material-ID des geplanten Bauteils — nur bei der
              Ausfuehrungsplanung. Traegt das Bauteil den Ident bereits im
              Planungsmodell, wird er nur bestaetigt; sonst eingetragen. */}
          {!targetProcess && processType === 'planung' && leadDoc && (
            <div className="mt-3">
              <span className="block text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase mb-2">
                Material-ID des Bauteils
              </span>

              {ifcFileEpc ? (
                <div className="rounded-xl bg-acid-400/10 border border-acid-400/30 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-semibold text-acid-300">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    Aus der Planungsdatei gelesen
                  </span>
                  <code className="block text-xs text-night-100 mt-1.5 break-all">
                    {ifcFileEpc}
                  </code>
                  <p className="text-xs text-night-300 mt-2 leading-relaxed">
                    Das Bauteil trägt die Material-ID der verbauten Platte als
                    Attribut „Identity“ – wie die PDF-Dokumente ihr verstecktes
                    Ident-Feld. Es muss nichts eingegeben werden.
                  </p>
                </div>
              ) : (
                <>
                  <input
                    id="ifc-epc"
                    type="text"
                    value={ifcEpc}
                    onChange={(e) => setIfcEpc(e.target.value)}
                    placeholder="urn:epc:id:sgtin:404711148.0401.718871462389"
                    disabled={isUploading}
                    spellCheck={false}
                    className={`w-full px-3 py-2 rounded-xl bg-night-700/60 border text-sm text-white placeholder:text-night-400 outline-none transition-colors focus:border-acid-400 ${
                      ifcEpc.trim() && !isEpc(ifcEpc)
                        ? 'border-red-400/60'
                        : 'border-white/10'
                    }`}
                  />
                  <p className="text-xs text-night-300 mt-2 leading-relaxed">
                    Diese Planungsdatei nennt kein Bauteil-Attribut „Identity“ –
                    typisch für eine Planung, die vor der Fertigung exportiert
                    wurde. Geben Sie die Material-ID des Bauteils an, zu dem die
                    Planung gehört, damit die Daten im Datenraum auffindbar sind.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Weitere Dateien */}
          <div>
            <h4 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase mb-3">
              {targetProcess ? 'Dateien' : 'Weitere Dateien zu diesem Vorgang'}
            </h4>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`relative border border-dashed rounded-2xl p-6 transition-all cursor-pointer ${
                isDragging
                  ? 'border-acid-400 bg-acid-400/10'
                  : 'border-white/15 bg-night-700/40 hover:border-acid-400/50'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleAttachmentsAdded(Array.from(e.dataTransfer.files));
              }}
              onClick={() => attachInputRef.current?.click()}
            >
              <input
                ref={attachInputRef}
                type="file"
                multiple
                accept=".xml,.json,.hpr,.eldat,.pdf,.xlsx,.xls,.csv,.ifc"
                onChange={(e) => {
                  handleAttachmentsAdded(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
                className="hidden"
                disabled={isUploading}
              />
              <div className="flex flex-col items-center text-center pointer-events-none">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 border ${
                    isDragging
                      ? 'bg-acid-400 border-acid-300'
                      : 'bg-acid-400/15 border-acid-400/30'
                  }`}
                >
                  <UploadCloud
                    className={`w-5 h-5 ${isDragging ? 'text-night-950' : 'text-acid-300'}`}
                  />
                </div>
                <p className="text-sm font-bold text-white mb-1">Dateien hierher ziehen</p>
                <p className="text-xs text-night-300">
                  XML (StanForD), JSON (ELDAT, VLEX), IFC (Planung), PDF – max. 50 MB
                </p>
              </div>
            </motion.div>

            {attachments.length > 0 && (
              <div className="space-y-2 mt-3">
                <AnimatePresence>
                  {attachments.map((item, index) => {
                    const Icon = DATA_TYPE_ICONS[item.dataType || 'unknown'];
                    return (
                      <motion.div
                        key={`${item.file.name}-${index}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className={`px-4 py-3 rounded-2xl border ${
                          item.isRecognized
                            ? 'border-acid-400/30 bg-night-700/60'
                            : 'border-amber-500/30 bg-amber-500/5'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                              item.isRecognized
                                ? 'bg-acid-400/15 border border-acid-400/30 text-acid-300'
                                : 'bg-amber-500/15 border border-amber-500/30 text-amber-400'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">
                              {item.file.name}
                            </p>
                            <p className="text-xs text-night-400 mt-0.5">
                              {formatFileSize(item.file.size)}
                              {item.dataType ? ` · ${item.dataType}` : ' · nicht erkannt'}
                            </p>
                            {/* Der gelesene Ident macht die Zuordnung
                                nachvollziehbar: der Nutzer sieht, WORAUF sich
                                die Datei bezieht, bevor er sie hochlaedt. */}
                            {item.epcs && item.epcs.length > 0 && (
                              <p className="text-[11px] text-acid-300/80 mt-1 font-mono truncate">
                                {item.epcs.length === 1
                                  ? item.epcs[0]
                                  : `${item.epcs.length} Idente · ${item.epcs[0]}`}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setAttachments((prev) => prev.filter((_, i) => i !== index));
                              forgetFile(item.file.name);
                            }}
                            disabled={isUploading}
                            className="p-1 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                            aria-label="Datei entfernen"
                          >
                            <X className="w-4 h-4 text-night-400" />
                          </button>
                        </div>

                        {/* Bei PDFs: gegen welche Vorlage wird ausgelesen? */}
                        {isPdf(item) && (
                          <div className="mt-3 pt-3 border-t border-white/10">
                            <PdfTemplateSelect
                              templates={templates}
                              isLoading={isLoadingTemplates}
                              loadError={templateError}
                              value={pdfTemplateIds[item.file.name] ?? null}
                              onChange={(templateId) =>
                                setTemplateForFile(item.file.name, templateId)
                              }
                              suggestedTemplateIds={suggestedTemplateIds}
                              disabled={isUploading}
                            />
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Hinweis bei noch nicht implementiertem Pflichtformat */}
          {validation.hint && (
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">{validation.hint}</p>
            </div>
          )}

          {/* Produktfoto — optional.

              Ohne Foto zeigt die App das Standardbild der Produktart. Mit
              Foto sieht der spaetere Betrachter das tatsaechliche Stueck.
              ``capture="environment"`` oeffnet auf dem Handy direkt die
              Ruecckamera; am Rechner bleibt es ein normaler Dateidialog. */}
          <div className="px-4 py-3 bg-night-700/40 border border-white/10 rounded-2xl">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={isUploading}
                className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-white/10 bg-night-800 flex items-center justify-center hover:border-acid-400/40 transition-colors disabled:opacity-50"
                aria-label="Produktfoto auswählen oder aufnehmen"
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Camera className="w-5 h-5 text-night-300" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">
                  Produktfoto <span className="text-night-400 font-normal">(optional)</span>
                </p>
                <p className="text-xs text-night-300 mt-0.5">
                  {photo
                    ? photo.name
                    : 'Ohne eigenes Foto wird das Standardbild der Produktart gezeigt.'}
                </p>
              </div>

              {photo ? (
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  disabled={isUploading}
                  className="text-night-300 hover:text-red-300 transition-colors flex-shrink-0 disabled:opacity-50"
                  aria-label="Produktfoto entfernen"
                >
                  <X className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={isUploading}
                  className="px-3 py-1.5 rounded-xl bg-night-800 border border-white/10 text-xs font-semibold text-night-200 hover:text-white hover:border-white/20 transition-colors flex-shrink-0 disabled:opacity-50"
                >
                  Auswählen
                </button>
              )}
            </div>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setPhoto(file);
                e.target.value = '';
              }}
              className="hidden"
              disabled={isUploading}
            />
          </div>

          {/* Passen die Idente der Dateien zueinander? Warnung, keine Sperre —
              der Nutzer kennt seinen Vorgang besser als die Heuristik. */}
          {identCheck.warning && (
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-300">
                  Unterschiedliches Material
                </p>
                <p className="text-xs text-amber-300/80 mt-0.5">{identCheck.warning}</p>
              </div>
            </div>
          )}

          {/* Login-Hinweis */}
          {!isLoggedIn && (
            <div className="flex items-start gap-3 px-4 py-3 bg-sky-500/10 border border-sky-500/30 rounded-xl">
              <LogIn className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-sky-300">Anmeldung erforderlich</p>
                <p className="text-sm text-sky-400/80 mt-1">
                  Um einen Vorgang im Solid Pod zu registrieren, müssen Sie sich anmelden.
                </p>
                {onLoginClick && (
                  <button
                    onClick={onLoginClick}
                    className="mt-2 text-sm font-medium text-sky-300 hover:text-sky-200 underline"
                  >
                    Jetzt anmelden
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Blockierender Validierungsfehler */}
          {!validation.ok && validation.error && !error && (
            <div className="flex items-start gap-3 px-4 py-3 bg-night-700/60 border border-white/10 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-night-300">{validation.error}</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {progress && (
            <div className="flex items-center gap-3 px-4 py-3 bg-acid-400/10 border border-acid-400/30 rounded-xl">
              <Loader2 className="w-5 h-5 text-acid-300 animate-spin" />
              <span className="text-sm text-acid-200">{progress}</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={
              isUploading ||
              isLoading ||
              !validation.ok ||
              isDetectingLead ||
              isDetectingAttachments
            }
            className="btn btn-acid btn-lg w-full"
          >
            {isUploading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Wird verarbeitet...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Upload className="w-5 h-5" />
                {targetProcess ? 'Dateien hinzufügen' : 'Vorgang registrieren'}
              </span>
            )}
          </button>
        </>
      )}

      {/* ---------- Schritt 3: Ergebnis ---------- */}
      {step === 'done' && savedProcess && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="bg-acid-400/10 border border-acid-400/30 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle2 className="w-6 h-6 text-acid-300" />
              <h3 className="font-semibold text-white">
                {isAppendMode ? 'Dateien hinzugefügt' : 'Vorgang registriert'}
              </h3>
            </div>
            <p className="text-sm text-night-200">{savedProcess.title}</p>
            <p className="text-xs text-night-400 mt-1">
              {getProcessType(savedProcess.type).label} · registriert{' '}
              {formatRegisteredAt(savedProcess.registeredAt)}
            </p>
            <p className="text-xs text-night-300 mt-2 font-mono">{savedProcess.id}</p>

            <div className="space-y-1.5 mt-4">
              {savedProcess.files.map((f, i) => (
                <div key={`${f.url}-${i}`} className="flex items-center gap-2 text-xs">
                  {f.isLeadDoc && (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-acid-400/20 text-acid-300 border border-acid-400/30 flex-shrink-0">
                      Pflicht
                    </span>
                  )}
                  <span className="text-night-300 truncate">{f.name}</span>
                </div>
              ))}
            </div>
          </div>

          {result?.success && result.total_datapoints !== undefined && result.total_datapoints > 0 && (
            <div className="p-4 bg-night-700/60 border border-acid-400/30 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <Coins className="w-5 h-5 text-acid-300" />
                <span className="text-sm font-semibold text-white">
                  Wert Ihrer Daten:{' '}
                  <span className="text-acid-300">
                    {result.total_datapoints.toLocaleString('de-DE')} {TOKEN_SYMBOL}
                  </span>
                </span>
              </div>
              <p className="text-xs text-night-300">
                {result.total_datapoints.toLocaleString('de-DE')} Datenpunkte — fällig
                bei vollständiger Extraktion.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* PDFs des Vorgangs + KG-Status */}
          {pdfResults.length > 0 && (
            <div className="bg-night-700/40 border border-white/10 rounded-2xl p-5">
              <h4 className="text-sm font-semibold text-white mb-3">
                Dokumente dieses Vorgangs
              </h4>
              <div className="space-y-2">
                {pdfResults.map(({ outcome, published }) => (
                  <div
                    key={outcome.docId}
                    className="flex items-center gap-3 px-4 py-3 bg-night-800/60 border border-white/10 rounded-2xl"
                  >
                    <div className="w-9 h-9 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-acid-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {outcome.file.name}
                      </p>
                      {published ? (
                        <p className="text-xs text-acid-300 mt-0.5">
                          {outcome.fieldCount} Felder übernommen —{' '}
                          {published.datapoints.toLocaleString('de-DE')} {TOKEN_SYMBOL}
                        </p>
                      ) : (
                        <p className="text-xs text-night-400 mt-0.5">
                          Nur Original gespeichert
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={resetDraft} className="btn btn-night flex-1">
              Weiterer Vorgang
            </button>
            {result?.success && (
              <button
                onClick={() => onUploadSuccess(result.trace_id)}
                className="btn btn-acid flex-1"
              >
                Produkt anzeigen
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Vorgangssuche (Nachreichen) */}
      <ProcessSearchSheet
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(record) => {
          setTargetProcess(record);
          setProcessType(record.type);
          setTitle(record.title);
          setLeadDoc(null);
          setIfcFileEpc(null);
          setAttachments([]);
          setSearchOpen(false);
          setStep('collect');
        }}
      />

      {/* Der einzige verbliebene Eingabeschritt: die Flaeche, die sich nicht
          ins PDF eintragen laesst. */}
      <PlantingAreaSheet
        isOpen={areaPrompt !== null}
        template={areaPrompt ? templateForFile(areaPrompt) : null}
        fileName={areaPrompt?.file.name ?? null}
        onConfirm={(area) => {
          if (!areaPrompt) return;
          setPlantingAreas((prev) => ({ ...prev, [areaPrompt.file.name]: area }));
          setAreaPrompt(null);
          setPendingSubmit(true);
        }}
        onCancel={() => {
          // Bewusst ohne Flaeche fortfahren: der Vorgang darf daran nicht
          // scheitern. Der Verzicht wird vermerkt, damit nicht erneut gefragt
          // wird — sonst haenge der Nutzer in einer Schleife fest.
          if (!areaPrompt) return;
          setSkippedAreas((prev) => [...prev, areaPrompt.file.name]);
          setAreaPrompt(null);
          setPendingSubmit(true);
        }}
      />
    </div>
  );
}
