import { useState, useCallback, useEffect, useRef } from 'react';
import { Header, SideMenu } from './components/Layout';
import { RoleSetup } from './components/Auth/RoleSetup';
import { LandingView } from './components/Landing';
import { ScanView } from './components/Scanner';
import { UploadSheet } from './components/Upload/UploadSheet';
import { FileBrowserSheet } from './components/Files';
import { PodResetSheet } from './components/Settings';
import { UseCaseGrid } from './components/UseCases';
import { ProductPassView } from './components/ProductPass';
import { CO2BalanceView } from './components/CO2';
import { OriginProofView } from './components/Origin';
import { DeconstructionView } from './components/Deconstruction';
import { DocumentationView } from './components/Documentation';
import { LiabilityView } from './components/Liability';
import { ChatView } from './components/Chat';
import { findUseCase, isAvailable, type UseCaseDefinition } from './config/useCases';
import { PartnerSheet } from './components/Partners';
import { GuideSheet } from './components/Guide';
import type { GuideTopicId } from './config/guide';
import {
  fetchProductData,
  fetchScanPreview,
  invalidateSourceCache,
  type SourceStatus,
  type ProductDataResult,
  type SparqlBinding,
} from './services/sparqlService';
import type { ChainScope } from './services/supplyChainWalk';
import { mapToProduct, mapToSupplyChain } from './services/productMapper';
import { addRecentScan } from './services/recentActivity';
import { initializeCatalog, refreshCatalog } from './config/solidPods';
import {
  collectExtractedDatapoints,
  estimateExtractionCost,
  commitPurchase,
  type CostEstimate,
} from './services/pricingService';
import { WalletSheet, CostConfirmSheet } from './components/Wallet';
import { MultiTagSheet } from './components/Scanner/MultiTagSheet';
import { LoginModal } from './components/Auth/LoginModal';
import { useAuth } from './auth/AuthContext';
import { useWallet } from './wallet/WalletContext';
import { useScanInput } from './hooks/useScanInput';
import { attachSequencer, beginRun, waitForIdle } from './services/dataspaceSequencer';
import { describeProblem } from './services/identifiers';
import type { ParsedIdentifier, ScanSource } from './services/identifiers';
import type { AppView, Product, SupplyChainStep } from './types';
import { FundingLogos } from './components/Brand/FundingLogos';

/**
 * Welche Abfrageergebnisse ein Anwendungsfall tatsaechlich anzeigt.
 *
 * Grundlage der Bezahlung: berechnet wird nur, was DIESER Fall aus den
 * Pod-Daten liest. Der Scan selbst ist kostenlos -- wer nur die ID erfasst,
 * soll nicht fuer Daten zahlen, die er vielleicht nie oeffnet.
 *
 * Ueberschneidungen sind ausdruecklich gewollt und kosten NICHT doppelt: das
 * Kaufregister (purchaseService) arbeitet auf Datenpunkt-Schluesseln, nicht auf
 * Anwendungsfaellen. Wer die Herkunft gekauft hat, bekommt dieselben Wald- und
 * Lieferkettenpunkte im Produktpass gratis -- bezahlt wird dort nur, was
 * wirklich hinzukommt.
 */
const USE_CASE_DATA: Record<string, (d: ProductDataResult) => SparqlBinding[][]> = {
  // Die Lieferkette des Passes ist seit 17.09.2026 die Akteursliste des
  // Herkunftsnachweises (mapToProvenance) -- deshalb zaehlen hier auch
  // Transportauftraege und Akteure mit, aus denen sie ihre Stationen liest.
  dbpp: (d) => [
    d.product,
    d.stem,
    d.forest,
    d.sawmill,
    d.bspWerk,
    d.supplyChain,
    d.businessPartners,
    d.transportOrders,
    d.dbpp,
  ],
  co2: (d) => [d.product, d.lca, d.transportOrders, d.declarations],
  'origin-proof': (d) => [
    d.forest,
    d.stem,
    d.supplyChain,
    d.businessPartners,
    d.transportOrders,
    d.certificates,
  ],
  liability: (d) => [d.liability, d.declarations, d.deconstruction, d.product],
  deconstruction: (d) => [d.deconstruction, d.product],
  documentation: (d) => [d.documentation, d.deconstruction, d.product],
  // Der Assistent rechnet selbst ab (useProductChat: bezahlt wird, was er
  // zitiert). Das Oeffnen der Ansicht ist deshalb frei.
  chatbot: () => [],
};

/** Datenpunkt-Schluessel eines Anwendungsfalls fuer das gescannte Bauteil. */
function useCaseDatapointKeys(
  useCaseId: string,
  data: ProductDataResult | null,
): Set<string> {
  if (!data) return new Set();
  const select = USE_CASE_DATA[useCaseId];
  if (!select) return new Set();
  return collectExtractedDatapoints(select(data));
}

function App() {
  const { isLoggedIn, webId } = useAuth();
  const { balance, pay } = useWallet();
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [productId, setProductId] = useState<string>('');
  const [product, setProduct] = useState<Product | null>(null);
  const [supplyChain, setSupplyChain] = useState<SupplyChainStep[]>([]);
  // Rohe Abfrageergebnisse: der Herkunftsnachweis braucht Felder, die beim
  // Mappen auf Product/SupplyChain wegfallen. Wird immer zusammen mit
  // setProduct gesetzt, damit es nie an der Bezahlschranke vorbeikommt.
  const [productData, setProductData] = useState<ProductDataResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Zusammenfassung des EPCIS-Abrufs ("6 Event(s) gefunden, 1 EPC(s)
  // aufgeloest"). Stand bis 17.09.2026 als Warnhinweis ueber der Kurzinfo --
  // fuer Anwender ohne technischen Hintergrund eher verwirrend (Rueckmeldung
  // Praxispartner, "Feedback App_Allgemein", Folie 5). Seither ist sie ein
  // aufklappbares Detail am Erfolgsbanner, getrennt von echten Warnungen.
  const [epcisSummary, setEpcisSummary] = useState<string | null>(null);
  // Offenes Thema der Anleitung (Seitenmenue).
  const [guideTopic, setGuideTopic] = useState<GuideTopicId | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  // Zuerst gewaehlter Anwendungsfall, fuer den noch ein Produkt fehlt.
  // Nach dem Scan wird direkt hierhin gesprungen -- die Auswahl steht ja schon.
  const [pendingUseCase, setPendingUseCase] = useState<UseCaseDefinition | null>(null);
  // Produkt ist da, der gemerkte Fall soll geoeffnet werden -- der Effekt
  // unten erledigt das, sobald der State steht (siehe consumePendingUseCase).
  const [awaitingUseCase, setAwaitingUseCase] = useState<UseCaseDefinition | null>(null);
  // Kostenpflichtiger Anwendungsfall: gewaehlt, aber noch nicht bezahlt. Die
  // Ansicht oeffnet erst nach Bestaetigung + Token-Transfer.
  const [pendingUseCaseCost, setPendingUseCaseCost] = useState<UseCaseDefinition | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  // Welcher Anwendungsfall wird gerade geoeffnet?
  //
  // Zwischen Klick und Ansicht liegen das Nachladen der vollstaendigen
  // Pod-Daten und die Kostenberechnung -- je nach Umfang der Kette dauert das
  // spuerbar. Ohne Rueckmeldung an der Kachel wirkt der Klick folgenlos. Es ist
  // die ID und nicht nur ein Flag, weil der Spinner an DER angeklickten Kachel
  // stehen muss, nicht an allen.
  const [openingUseCaseId, setOpeningUseCaseId] = useState<string | null>(null);
  // Anwendungsfaelle, die in dieser Sitzung schon bezahlt (oder gratis
  // freigeschaltet) wurden -- ein zweiter Aufruf oeffnet ohne Nachfrage.
  //
  // Der Schluessel traegt den Umfang mit: nach einer Erweiterung der Kette
  // enthaelt derselbe Fall MEHR Datenpunkte. Ohne den Umfang im Schluessel
  // oeffnete er ungeprueft und die hinzugekommenen Punkte blieben unbezahlt.
  const [unlockedUseCases, setUnlockedUseCases] = useState<Set<string>>(new Set());
  // Wie weit die Kette geladen wird. Voreinstellung ist die ganze Kette --
  // erst wer sieht, was vorhanden ist, kann sinnvoll einschraenken.
  const [chainScope, setChainScope] = useState<ChainScope>('full');
  const [isPaying, setIsPaying] = useState(false);
  // Mehrere Tags aus einem RFID-Sweep, aus denen der Nutzer waehlt.
  const [scanSession, setScanSession] = useState<ParsedIdentifier[] | null>(null);
  // Woher die zuletzt verwendete ID kam -- fuer die Quellenanzeige.
  const [scanSource, setScanSource] = useState<ScanSource | null>(null);
  const scanInputRef = useRef<{ submit: (raw: string, source: ScanSource) => void } | null>(null);
  // Ob die Erfassung offen ist — der globale Scan-Hook pausiert dann.
  const [scanInputOpen, setScanInputOpen] = useState(false);

  // Initialize catalog on app startup (pre-fetch for better UX)
  useEffect(() => {
    // Den Datenraum-Sequenzer GLEICH beim Start anhaengen, nicht erst wenn
    // der Graph gemountet wird: sonst laufen die ersten Meldungen eines
    // fruehen Scans ins Leere und die Folge beginnt mittendrin.
    attachSequencer();
    initializeCatalog().catch((err) => {
      console.warn('[App] Catalog initialization failed:', err);
    });
  }, []);

  /**
   * Gemerkten Anwendungsfall einloesen, sobald ein Produkt vorliegt.
   * Gibt true zurueck, wenn dadurch navigiert wurde.
   *
   * Nur die ANKUENDIGUNG: geoeffnet wird der Fall im Effekt weiter unten,
   * sobald ``product``/``productData`` wirklich im State stehen. Direkt hier
   * zu oeffnen wuerde openUseCase mit den Daten des VORIGEN Scans rechnen
   * lassen -- und damit den falschen Preis nennen.
   */
  const consumePendingUseCase = useCallback((): boolean => {
    if (!pendingUseCase?.view) return false;
    setAwaitingUseCase(pendingUseCase);
    return true;
  }, [pendingUseCase]);

  /**
   * Daten eines Bauteils laden.
   *
   * ``preview`` holt nur, was die Scan-Ansicht zeigt: Ident und Produktart.
   * Das ist der Normalfall nach dem Erfassen -- der Scan ist kostenlos, und
   * die Daten der Anwendungsfaelle werden erst gebraucht, wenn einer davon
   * geoeffnet wird. Ohne diese Trennung lief nach jedem Scan die volle
   * Abfrage ueber den ganzen Katalog, samt Kettenverfolgung.
   */
  const loadProductData = useCallback(
    async (
      traceId: string,
      scope: ChainScope = 'full',
      preview = false,
    ): Promise<Product | null> => {
      setIsLoading(true);
      setError(null);
      setWarnings([]);
      setEpcisSummary(null);
      setSourceStatus([]);

      try {
        console.log(
          `[App] Loading product data for traceId: ${traceId} ` +
            `(${preview ? 'nur Kurzinfo' : `Umfang: ${scope}`})`,
        );

        // Die Folge ANKUENDIGEN, bevor abgefragt wird: liegen alle Quellen im
        // Cache, meldet niemand etwas, und der Graph bliebe ohne diesen
        // Anstoss stumm (siehe beginRun).
        beginRun();

        const data = preview
          ? await fetchScanPreview(traceId)
          : await fetchProductData(traceId, undefined, scope);

        // Die Datenraum-Animation zu Ende laufen lassen, BEVOR die Daten
        // erscheinen.
        //
        // Liegen die Quellen im Cache, ist die Abfrage in Millisekunden
        // zurueck -- der Graph blitzte dann kurz auf oder war gar nicht zu
        // sehen, und vom Aufwand im Hintergrund bemerkte der Nutzer nichts
        // (Rueckmeldung 21.09.2026). Genau das soll die Darstellung ja
        // zeigen. Laeuft nichts, kehrt waitForIdle sofort zurueck; es wird
        // also nie kuenstlich gewartet, wo es nichts zu sehen gibt.
        await waitForIdle();

        console.log('[App] Received data:', data);

        // Store source status for UI display
        setSourceStatus(data.sourceStatus);

        // EPCIS-Zusammenfassung getrennt von den Warnungen: sie ist eine
        // technische Auskunft, kein Problem.
        if (data.epcisInfo) {
          const i = data.epcisInfo;
          setEpcisSummary(
            `EPCIS: ${i.eventsReturned} Event(s) gefunden, ${i.epcsResolved} EPC(s) aufgelöst` +
              (i.eventsFilteredOut > 0 ? ` (${i.eventsFilteredOut} per Consent gefiltert)` : ''),
          );
        }
        if (data.errors.length > 0) {
          setWarnings(data.errors);
        }

        // Log source availability
        const availableSources = data.sourceStatus.filter((s) => s.available);
        const unavailableSources = data.sourceStatus.filter((s) => !s.available);
        if (availableSources.length > 0) {
          console.log(
            '[App] Data loaded from pods:',
            availableSources.map((s) => s.pod).join(', ')
          );
        }
        if (unavailableSources.length > 0) {
          console.warn(
            '[App] Unavailable pods:',
            unavailableSources.map((s) => s.pod).join(', ')
          );
        }

        // Map the SPARQL results to our UI types
        const mapped = mapToProduct(
          data.product,
          data.stem,
          data.forest,
          data.bspWerk
        );

        // Die erfasste ID nachtragen: mapToProduct liest sie aus tc:traceId,
        // das es nur im Trace-Id-Weg gibt. Beim EPC-Weg blieb die Produkt-ID
        // deshalb leer und der Name stand als blosses "Holzprodukt" da.
        const mappedProduct = mapped
          ? { ...mapped, id: mapped.id || traceId }
          : mapped;

        const mappedSupplyChain = mapToSupplyChain(
          data.forest,
          data.sawmill,
          data.bspWerk,
          data.supplyChain,
          data.businessPartners,
          data.stem
        );

        if (mappedProduct) {
          // Der SCAN selbst ist kostenlos. Bezahlt wird erst beim Oeffnen eines
          // Anwendungsfalls (openUseCase) -- vorher weiss der Nutzer ja gar
          // nicht, welche Daten er ueberhaupt sehen will. Die Rohdaten liegen ab
          // hier zwar im Speicher, sichtbar wird davon aber nur, was die
          // Kurzinfo zeigt: ID und Produktart. Alles andere haengt an der
          // Bezahlschranke des jeweiligen Anwendungsfalls.
          setProduct(mappedProduct);
          setSupplyChain(mappedSupplyChain);
          setProductData(data);
          return mappedProduct;
        } else {
          // Kein Treffer — der Grund steht in data.errors, sofern die Abfrage
          // selbst gescheitert ist. Den echten Grund zeigen statt pauschal die
          // ID zu verdaechtigen: eine fehlende Anmeldung sieht sonst aus wie
          // eine falsche ID, und man sucht an der voellig falschen Stelle.
          console.log('[App] No product data found in Solid Pod', data.errors);
          const blocked = data.errors.find(
            (e) => /nicht authentifiziert|anmeld|berechtigung|rolle/i.test(e),
          );
          setError(
            blocked
              ? `${blocked} Ohne Anmeldung liefert der EPCIS-Dienst keine Events.`
              : data.errors[0] ||
                  'Keine Daten für dieses Produkt gefunden. Prüfen Sie, ob die Produkt-ID korrekt ist.',
          );
          setProduct(null);
          setSupplyChain([]);
          setProductData(null);
          return null;
        }
      } catch (err) {
        console.error('[App] Error loading product data:', err);
        setError(err instanceof Error ? err.message : 'Fehler beim Laden der Produktdaten');
        setProduct(null);
        setSupplyChain([]);
        setProductData(null);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [webId]
  );

  // Kosten bestätigt: Token transferieren, dann den Anwendungsfall oeffnen.
  const handleConfirmCost = async () => {
    if (!pendingUseCaseCost || !costEstimate) return;
    setIsPaying(true);
    try {
      const result = await pay(
        costEstimate.byRecipient.map((r) => ({
          recipientWebId: r.recipientWebId,
          amount: r.tokens,
          reason: `${pendingUseCaseCost.title} — ${productId}`,
        })),
      );
      // Erst nach erfolgreicher Zahlung ins Kaufregister — ein WalletError
      // (Guthaben reicht nicht) darf nie eine unbezahlte Berechtigung eintragen.
      await commitPurchase(webId, costEstimate);
      if (result.warnings.length > 0) {
        setWarnings((prev) => [...prev, ...result.warnings]);
      }
      const target = pendingUseCaseCost.view;
      setPendingUseCaseCost(null);
      setCostEstimate(null);
      setPendingUseCase(null);
      if (target) setCurrentView(target);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Token-Transfer fehlgeschlagen',
      );
    } finally {
      setIsPaying(false);
    }
  };

  // Abgebrochen: der Anwendungsfall bleibt zu, nichts abgebucht. Das Bauteil
  // bleibt erfasst -- nur die Ansicht wird nicht geoeffnet.
  const handleCancelCost = () => {
    setPendingUseCaseCost(null);
    setCostEstimate(null);
    setPendingUseCase(null);
    setError('Anzeige abgebrochen — es wurden keine Token abgebucht.');
  };

  // Scan-Flow: nach einem Treffer geht es direkt auf die Produktseite mit den
  // Anwendungsfaellen. Frueher erschien nur ein Sheet mit einem einzigen
  // Weiter-Knopf zum Produktpass — die uebrigen Faelle waren von dort aus nicht
  // erreichbar. War vorher schon ein Fall gewaehlt, wird dieser geoeffnet.
  const handleProductScanned = async (id: string) => {
    setProductId(id);
    setUnlockedUseCases(new Set());
    // Nur die Kurzinfo: Ident und Produktart. Die Daten der Anwendungsfaelle
    // folgen erst beim Oeffnen -- vorher weiss niemand, welche gebraucht werden.
    const mapped = await loadProductData(id, 'full', true);
    if (mapped) {
      addRecentScan({ id, name: mapped.name });
      // Der Scan ist kostenlos -- es geht immer direkt weiter. Die
      // Bezahlschranke sitzt jetzt in openUseCase, nicht mehr hier.
      if (!consumePendingUseCase()) setCurrentView('usecases');
    }
  };

  /**
   * Ein gedeuteter Scan (Hardware, Kamera, Eingabe) fuehrt zum Bauteil.
   *
   * Konnte keine ID bestimmt werden, wird der Grund konkret gemeldet statt
   * eines allgemeinen "nicht gefunden" -- beim Einrichten der Geraete ist der
   * Unterschied zwischen "falsch gelesen" und "korrekt gelesen, aber unbekannt"
   * der wichtigste Hinweis ueberhaupt.
   */
  const handleParsedScan = useCallback(
    (parsed: ParsedIdentifier) => {
      setScanSource(parsed.source);
      const id = parsed.urn ?? parsed.candidates?.[0] ?? null;

      if (!id) {
        setError(describeProblem(parsed) ?? `Scan nicht erkannt: ${parsed.raw}`);
        setCurrentView('scanner');
        return;
      }

      if (currentView !== 'scanner' && !product) setCurrentView('scanner');
      void handleProductScanned(id);
    },
    // handleProductScanned ist bewusst nicht memoisiert; die Abhaengigkeiten
    // hier decken alles ab, was sich auf das Verhalten auswirkt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentView, product],
  );

  const handleMultipleScans = useCallback((items: ParsedIdentifier[]) => {
    setScanSession(items);
  }, []);

  /**
   * Eingaben aus dem Scan-Screen (Kamera, manuelle Eingabe, Katalogliste).
   *
   * Alles laeuft durch den Uebersetzer, damit ein eingefuegter Elementstring
   * oder ein Hex-EPC genauso funktioniert wie eine fertige URN. Bereits
   * kanonische IDs reicht der Uebersetzer unveraendert durch, deshalb bleiben
   * Katalog- und Verlaufseintraege unberuehrt.
   */
  const handleScanViewInput = useCallback(
    (raw: string, source: ScanSource = 'manual') => {
      scanInputRef.current?.submit(raw, source);
    },
    [],
  );

  // Der Hardware-Scanner wirkt global: bei einem Pistolengriff-Geraet soll der
  // Auslöser aus jeder Ansicht heraus funktionieren. Nur wenn ein Dialog die
  // Eingabe braucht, wird pausiert.
  // Der globale Hardware-Scan wirkt aus jeder Ansicht heraus: bei einem
  // Pistolengriff-Geraet soll der Auslöser immer greifen. Er pausiert, solange
  // ein Dialog die Eingabe braucht — insbesondere die Erfassung selbst, die
  // sonst denselben Scan ein zweites Mal verarbeiten wuerde.
  const scanInput = useScanInput({
    enabled:
      !uploadOpen &&
      !filesOpen &&
      !resetOpen &&
      !walletOpen &&
      !loginOpen &&
      !pendingUseCaseCost &&
      !scanInputOpen,
    onSingle: handleParsedScan,
    onMultiple: handleMultipleScans,
  });

  // Ueber ein Ref erreichbar, damit handleScanViewInput oberhalb der
  // Hook-Deklaration stehen kann, ohne bei jedem Render neu erzeugt zu werden.
  useEffect(() => {
    scanInputRef.current = scanInput;
  }, [scanInput]);

  /**
   * Anwendungsfall waehlen -- unabhaengig davon, ob schon ein Produkt da ist.
   *
   * Mit Produkt: direkt oeffnen. Ohne Produkt: Auswahl merken und sofort den
   * Scanner oeffnen; nach dem Scan geht es von selbst in die Ansicht.
   *
   * Bewusst OHNE Sonderfall fuer standalone-Faelle: einen Anwendungsfall
   * waehlt man, um ihn fuer ein Bauteil zu sehen. Wer ihn ohne Produkt
   * oeffnete, landete nur im Leerzustand -- der Klick fuehlte sich folgenlos
   * an. Fehlt das Produkt, ist der Scan der einzig sinnvolle naechste Schritt.
   */
  const openUseCase = useCallback(
    (useCase: UseCaseDefinition) => {
      if (!isAvailable(useCase) || !useCase.view) return;

      if (!product) {
        setPendingUseCase(useCase);
        setCurrentView('scanner');
        return;
      }

      setPendingUseCase(null);

      // In dieser Sitzung schon freigeschaltet -> direkt oeffnen.
      //
      // Der Umfang gehoert in den Schluessel: nach einer Erweiterung der Kette
      // zeigt derselbe Fall MEHR Datenpunkte, die noch nicht bezahlt sind.
      // Ohne ihn oeffnete er hier ungeprueft.
      const unlockKey = `${useCase.id}:${chainScope}`;
      if (unlockedUseCases.has(unlockKey)) {
        setCurrentView(useCase.view);
        return;
      }

      // Bezahlschranke pro Anwendungsfall: berechnet wird nur, was DIESER Fall
      // tatsaechlich aus den Pod-Daten liest -- und davon nur, was der Nutzer
      // nicht ohnehin schon besitzt.
      const target = useCase.view;
      setOpeningUseCaseId(useCase.id);
      void (async () => {
        try {
          // Erst JETZT die vollstaendigen Daten holen. Nach dem Scan liegt nur
          // die Kurzinfo vor (Ident + Produktart) -- das reicht fuer die
          // Kachelanzeige, nicht fuer den Anwendungsfall und nicht fuer die
          // Kostenberechnung.
          let data = productData;
          if (!data?.loadedFully) {
            data = await fetchProductData(productId, undefined, chainScope).catch((err) => {
              console.error('[App] Nachladen fehlgeschlagen:', err);
              return null;
            });
            if (!data) {
              setError('Die Daten zu diesem Bauteil konnten nicht geladen werden.');
              return;
            }
            setProductData(data);
            setSourceStatus(data.sourceStatus);
            const nachgeladen = mapToProduct(data.product, data.stem, data.forest, data.bspWerk);
            if (nachgeladen) setProduct({ ...nachgeladen, id: nachgeladen.id || productId });
            setSupplyChain(
              mapToSupplyChain(
                data.forest,
                data.sawmill,
                data.bspWerk,
                data.supplyChain,
                data.businessPartners,
                data.stem,
              ),
            );
          }

          let estimate: CostEstimate | null = null;
          try {
            estimate = await estimateExtractionCost(
              useCaseDatapointKeys(useCase.id, data),
              (data.sourceStatus ?? []).filter((s) => s.available).map((s) => s.url),
              webId,
            );
          } catch (err) {
            // Eine kaputte Kostenberechnung darf den Anwendungsfall nicht
            // verschlucken -- dann wird er kostenlos gezeigt.
            console.warn('[App] Kostenberechnung fehlgeschlagen:', err);
          }

          if (estimate && estimate.totalTokens > 0) {
            setPendingUseCaseCost(useCase);
            setCostEstimate(estimate);
            return;
          }

          // Gratis -- trotzdem als Erwerb verbuchen, sonst gelten dieselben
          // Datenpunkte spaeter wieder als neu.
          if (estimate) await commitPurchase(webId, estimate);
          setUnlockedUseCases((prev) => new Set(prev).add(unlockKey));
          setCurrentView(target);
        } finally {
          // In JEDEM Fall zuruecksetzen -- auch bei den frueheren return-Wegen
          // (Ladefehler, Kostenbestaetigung). Bliebe der Spinner dort stehen,
          // liefe er weiter, waehrend der Kaufdialog auf eine Antwort wartet.
          setOpeningUseCaseId(null);
        }
      })();
    },
    [product, productData, sourceStatus, webId, unlockedUseCases, chainScope],
  );

  // Ziel kommt aus der Registry -- keine if-Kette, die beim naechsten
  // Anwendungsfall wieder vergessen wird.
  const handleSelectUseCase = (useCaseId: string) => {
    const useCase = findUseCase(useCaseId);
    if (useCase) openUseCase(useCase);
  };

  // Vorgemerkter Anwendungsfall (erst Fall gewaehlt, dann gescannt): jetzt
  // sind Produkt und Rohdaten im State, also kann openUseCase korrekt
  // rechnen -- inklusive Bezahlschranke.
  useEffect(() => {
    if (!awaitingUseCase || !product || !productData) return;
    setAwaitingUseCase(null);
    setPendingUseCase(null);
    openUseCase(awaitingUseCase);
  }, [awaitingUseCase, product, productData, openUseCase]);

  /** Kontext-Chip oben rechts im Header (PDF-Vorgabe). */
  const contextChipFor = (view: AppView): string | undefined => {
    if (view === 'co2') return 'CO₂ Bilanz';
    if (view === 'origin') return 'Herkunft';
    if (view === 'deconstruction') return 'Rückbaubarkeit';
    if (view === 'documentation') return 'Dokumentation';
    if (view === 'liability') return 'Haftungsnachweis';
    if (view === 'chat') return 'Assistent';
    return undefined;
  };

  const resetProduct = () => {
    setProductId('');
    setProduct(null);
    setSupplyChain([]);
    setProductData(null);
    setError(null);
    setPendingUseCaseCost(null);
    setCostEstimate(null);
    setPendingUseCase(null);
    // Freischaltungen gelten je Bauteil: ein anderes Produkt bringt andere
    // Datenpunkte. Das Kaufregister im Pod sorgt dafuer, dass wirklich
    // gekaufte Punkte trotzdem gratis bleiben.
    setUnlockedUseCases(new Set());
    setChainScope('full');
    setEpcisSummary(null);
  };

  /**
   * Umfang der Kette wechseln -- laedt das Bauteil neu.
   *
   * Ein reines Filtern der vorhandenen Daten genuegt nicht: der Umfang
   * bestimmt schon, WELCHE Idente ueberhaupt abgefragt werden. "Nur dieses
   * Produkt" spart bei einer Platte mit 169 Lamellen entsprechend viele
   * Abfragen -- und genau das macht es guenstiger und schneller.
   */
  const handleScopeChange = (next: ChainScope) => {
    if (next === chainScope || !productId) return;
    setChainScope(next);
    // KEIN Nachladen hier. Der Umfang wirkt erst, wenn ein Anwendungsfall
    // geoeffnet wird -- dort wird ohnehin geladen, und zwar genau einmal mit
    // dem dann gueltigen Umfang. Sofort nachzuladen hiess, bei jedem Tippen
    // auf den Schalter die volle Abfrage ueber den Katalog zu starten, deren
    // Ergebnis in der Kachelansicht gar nicht sichtbar wird.
    //
    // Bereits geladene Daten verwerfen: sie gehoeren zum alten Umfang.
    setProductData((prev) => (prev ? { ...prev, loadedFully: false } : prev));
  };

  const handleBackToScanner = () => {
    setCurrentView('scanner');
    resetProduct();
  };

  const handleLogoClick = () => {
    setCurrentView('landing');
    resetProduct();
  };

  return (
    <div className="min-h-screen flex flex-col bg-night-900">
      <RoleSetup />
      <Header
        onLogoClick={handleLogoClick}
        showScanReady={currentView === 'scanner'}
        onWalletClick={() => setWalletOpen(true)}
        onMenuClick={() => setMenuOpen(true)}
        contextChip={contextChipFor(currentView)}
      />

      {/* Seitenfenstermenü (Drawer, PDF-Vorgabe) */}
      <SideMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        onScanClick={() => setCurrentView('scanner')}
        onPartnersClick={() => setPartnersOpen(true)}
        onFilesClick={() => setFilesOpen(true)}
        onResetClick={() => setResetOpen(true)}
        isLoggedIn={isLoggedIn}
        onUseCaseClick={handleSelectUseCase}
        onGuideClick={setGuideTopic}
      />

      <main className="flex-1 flex flex-col relative">
        {currentView === 'landing' && (
          <LandingView
            onScanClick={() => setCurrentView('scanner')}
            onUploadClick={() => setUploadOpen(true)}
            onPartnersClick={() => setPartnersOpen(true)}
            onUseCaseClick={handleSelectUseCase}
          />
        )}

        {currentView === 'scanner' && (
          <ScanView
            onProductScanned={handleScanViewInput}
            isLoading={isLoading}
            error={error}
            scannedProduct={product}
            scanSource={scanSource}
            targetUseCaseTitle={pendingUseCase?.title ?? null}
            autoOpenInput={pendingUseCase !== null}
            onDismissError={() => setError(null)}
            onInputOpenChange={setScanInputOpen}
          />
        )}

        {currentView === 'usecases' && (
          <div className="flex-1 flex flex-col bg-night-900">
            <UseCaseGrid
              productId={productId}
              product={product}
              productData={productData}
              supplyChain={supplyChain}
              onSelectUseCase={handleSelectUseCase}
              onBack={handleBackToScanner}
              openingUseCaseId={openingUseCaseId}
              isLoading={isLoading}
              error={error}
              warnings={warnings}
              epcisSummary={epcisSummary}
              sourcePods={sourceStatus.filter((s) => s.available).map((s) => s.pod)}
              scope={chainScope}
              onScopeChange={handleScopeChange}
            />
          </div>
        )}

        {currentView === 'productpass' && (
          <div className="flex-1 flex flex-col bg-night-900">
            <ProductPassView
              productId={productId}
              product={product}
              productData={productData}
              supplyChain={supplyChain}
              onBack={() => setCurrentView(product ? 'usecases' : 'landing')}
              onScanClick={() => setCurrentView('scanner')}
            />
          </div>
        )}

        {currentView === 'co2' && (
          <CO2BalanceView
            productId={productId || undefined}
            product={product}
            productData={productData}
            onBack={() => setCurrentView(product ? 'usecases' : 'landing')}
            onAddProduct={() => setCurrentView('scanner')}
          />
        )}

        {currentView === 'origin' && (
          <div className="flex-1 flex flex-col bg-night-900">
            <OriginProofView
              productId={productId}
              product={product}
              supplyChain={supplyChain}
              productData={productData}
              onBack={() => setCurrentView(product ? 'usecases' : 'landing')}
              onScanClick={() => setCurrentView('scanner')}
            />
          </div>
        )}

        {currentView === 'deconstruction' && (
          <div className="flex-1 flex flex-col bg-night-900">
            <DeconstructionView
              productId={productId}
              product={product}
              productData={productData}
              onBack={() => setCurrentView(product ? 'usecases' : 'landing')}
              onScanClick={() => setCurrentView('scanner')}
            />
          </div>
        )}

        {currentView === 'documentation' && (
          <div className="flex-1 flex flex-col bg-night-900">
            <DocumentationView
              productId={productId}
              product={product}
              productData={productData}
              onBack={() => setCurrentView(product ? 'usecases' : 'landing')}
              onScanClick={() => setCurrentView('scanner')}
            />
          </div>
        )}

        {currentView === 'liability' && (
          <div className="flex-1 flex flex-col bg-night-900">
            <LiabilityView
              productId={productId}
              product={product}
              productData={productData}
              onBack={() => setCurrentView(product ? 'usecases' : 'landing')}
              onScanClick={() => setCurrentView('scanner')}
            />
          </div>
        )}

        {/* min-h-0 statt nur flex-1: der Chat scrollt in sich selbst, die
            Seite darf nicht mitwachsen -- sonst rutscht die Eingabe raus. */}
        {currentView === 'chat' && (
          <div className="flex-1 flex flex-col min-h-0 bg-night-900">
            <ChatView
              productId={productId}
              product={product}
              supplyChain={supplyChain}
              onBack={() => setCurrentView(product ? 'usecases' : 'landing')}
              onScanClick={() => setCurrentView('scanner')}
              onBuyTokens={() => setWalletOpen(true)}
              onLogin={() => setLoginOpen(true)}
            />
          </div>
        )}
      </main>

      {/* Upload Bottom-Sheet (Startseite "Daten hochladen") */}
      <UploadSheet
        isOpen={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          // Nach einem Upload koennen neue Tripel in bestehenden Quellen
          // stehen. Der Cache haelt sonst bis zu fuenf Minuten den alten
          // Stand, und das frisch Hochgeladene bliebe unsichtbar.
          invalidateSourceCache();
        }}
        isLoading={isLoading}
      />

      {/* Datei-Browser (Startseite "Dateien durchsuchen"): prüft erst die
          Rollen-Berechtigungen, dann Suche/Filter/Extraktion der Originale */}
      <FileBrowserSheet
        isOpen={filesOpen}
        onClose={() => setFilesOpen(false)}
      />

      {/* Uploads zurücksetzen: löscht ausschließlich die eigenen Vorgänge unter
          data/ samt Katalog-Einträgen. Danach den Katalog neu laden, sonst
          zeigt die App die gerade gelöschten Produkte weiter an. */}
      <PodResetSheet
        isOpen={resetOpen}
        onClose={() => setResetOpen(false)}
        onResetComplete={() => {
          // Auch die geladenen Tripel verwerfen: sie stammen aus Dateien, die
          // es gerade nicht mehr gibt.
          invalidateSourceCache();
          refreshCatalog().catch(() => {
            // Der Reset selbst ist durch; ein fehlgeschlagener Neuaufbau des
            // Katalogs kostet hoechstens eine veraltete Liste bis zum Reload.
          });
        }}
      />

      {/* Wallet: Guthaben + Token kaufen (Demo-Zahlung) */}
      <WalletSheet isOpen={walletOpen} onClose={() => setWalletOpen(false)} />

      {/* Kosten-Bestätigung: Preis + Empfänger anzeigen, erst nach Bestätigung
          werden die Token transferiert und die Daten sichtbar */}
      <CostConfirmSheet
        isOpen={pendingUseCaseCost !== null && costEstimate !== null}
        estimate={costEstimate}
        balance={balance}
        isLoggedIn={isLoggedIn}
        isPaying={isPaying}
        onConfirm={handleConfirmCost}
        onCancel={handleCancelCost}
        onBuyTokens={() => setWalletOpen(true)}
        onLogin={() => setLoginOpen(true)}
      />

      <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />

      {/* Mehrere Tags aus einem RFID-Sweep: Auswahl statt Stapelabruf, weil
          jede Abfrage Token kostet */}
      <MultiTagSheet
        items={scanSession}
        onSelect={(id) => {
          setScanSession(null);
          void handleProductScanned(id);
        }}
        onClose={() => setScanSession(null)}
      />

      {/* Praxispartner (Startseite / Seitenmenü) */}
      <PartnerSheet isOpen={partnersOpen} onClose={() => setPartnersOpen(false)} />

      {/* Anleitung (Seitenmenue) */}
      <GuideSheet
        topicId={guideTopic}
        onClose={() => setGuideTopic(null)}
        onSelectTopic={setGuideTopic}
      />

      {/* Footer: Foerderhinweis als gebundene Logo-Kombination,
          Vorgaben siehe FundingLogos. */}
      <footer className="bg-night-900 border-t border-white/5 py-5 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-5">
          <p className="text-sm text-night-300">
            TimberConnect – Transparenz in der Holzlieferkette
          </p>
          <FundingLogos variant="footer" />
        </div>
      </footer>
    </div>
  );
}

export default App;
