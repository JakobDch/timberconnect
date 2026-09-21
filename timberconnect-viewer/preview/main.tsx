import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { AuthProvider } from '../src/auth/AuthContext';
import { WalletProvider } from '../src/wallet/WalletContext';
import { LandingView } from '../src/components/Landing';
import { ScanView } from '../src/components/Scanner';
import { UseCaseGrid, ChainScopePicker } from '../src/components/UseCases';
import { SideMenu } from '../src/components/Layout';
import { GuideSheet } from '../src/components/Guide';
import { PartnerSheet } from '../src/components/Partners';
import { OriginProofView } from '../src/components/Origin';
import { DataspacePanel } from '../src/components/Dataspace';
import { reportPodQuery } from '../src/services/dataspaceActivity';
import { attachSequencer, beginRun, resetSequencer } from '../src/services/dataspaceSequencer';
import type { Product } from '../src/types';
import type { ProductDataResult } from '../src/services/sparqlService';

/**
 * Mobile-Vorschau der Oberflaeche -- OHNE Pod, OHNE Anmeldung.
 *
 * Die Ansichten nach dem Scan brauchen im Betrieb Pod-Daten und eine
 * Session. Fuer eine Layout-Pruefung bei Handybreite reicht Beispielinhalt:
 * diese Seite rendert die geaenderten Komponenten mit festen Props, und
 * ``shot.mjs`` fotografiert sie headless bei 390 px. Sie ist NICHT Teil des
 * Docker-Builds (eigene Vite-Konfiguration, eigenes Ausgabeverzeichnis).
 *
 *   npx vite build -c vite.preview.config.ts
 *   npx vite preview -c vite.preview.config.ts --port 4173
 *   node preview/shot.mjs
 *
 * Ansicht per ?view=landing|scanner|usecases-lamella|usecases-panel|
 *                   usecases-unknown|menu|guide|partners
 */

const noop = () => {};

const TC = 'http://timberconnect.2050.de/ontology#';

function productData(typeLocalName: string | null): ProductDataResult {
  const rows = typeLocalName ? [{ type: { value: `${TC}${typeLocalName}` } }] : [];
  return {
    product: rows,
    scannedEpc: rows,
    stem: [],
    forest: [],
    sawmill: [],
    bspWerk: [],
    supplyChain: [],
    businessPartners: [],
    transportOrders: [],
    certificates: [],
    declarations: [],
    deconstruction: [],
    documentation: [],
    liability: [],
    lca: [],
    dbpp: [],
    epcisEvents: [],
    sourceStatus: [],
    errors: [],
    loadedFully: false,
  } as unknown as ProductDataResult;
}

const product: Product = {
  id: 'urn:epc:id:sgtin:404711148.0301.143138262901',
  name: 'Holzprodukt',
  woodType: 'Fichte',
};

function UseCases({ type }: { type: string | null }) {
  return (
    <UseCaseGrid
      productId={product.id}
      product={product}
      productData={productData(type)}
      onSelectUseCase={noop}
      onBack={noop}
      sourcePods={['a', 'b', 'c']}
      epcisSummary="EPCIS: 6 Event(s) gefunden, 1 EPC(s) aufgelöst"
      scope="full"
      onScopeChange={noop}
    />
  );
}

/** Herkunftsnachweis "Vorangegangene Kette" fuer Rundholz: Wald + Saegewerk. */
function originData(): ProductDataResult {
  const v = (value: string) => ({ value });
  return {
    ...productData('Stem'),
    stem: [
      {
        ownerName: v('Forstbetrieb A1 GmbH'),
        ownerCity: v('Arnsberg'),
        stemNumber: v('1'),
        harvestDate: v('2026-07-15'),
      },
    ],
    sawmill: [
      { destinationProduct: v('Fichte Kurzholz BC') },
      {
        company: v('EGGER Sägewerk Brilon GmbH'),
        street: v('Im Kissen 19'),
        postcode: v('59929'),
        city: v('Brilon'),
        deliveryDate: v('20/07/2026'),
      },
    ],
    loadedFully: true,
  } as unknown as ProductDataResult;
}

const stemProduct: Product = {
  ...product,
  id: 'urn:epc:id:sgtin:404711148.0201.143138262901',
  origin: {
    region: 'Sauerland',
    country: 'Deutschland',
    coordinates: { lat: 51.38, lng: 8.07 },
  },
};

/**
 * Spielt Aktivitaet ein, damit der aktive Zustand begutachtet werden kann.
 *
 * NUR fuer die Vorschau: in der echten App melden ausschliesslich die Dienste
 * (loadSource, queryEpcisEvents), und zwar nur fuer tatsaechlich abgesetzte
 * Anfragen. Hier gibt es weder Pod noch Anmeldung, also wird gemeldet, als
 * liefe ein Scan.
 */
function DataspaceDemo() {
  useEffect(() => {
    // Der Fall aus der Rueckmeldung: ein Holzwerkstoffproduzent fragt beim
    // Fachplaner an. Der Strom laeuft ueber die Station Transport HINWEG.
    // Die Meldungen kommen auf einen Schlag -- der Sequenzer reiht sie auf
    // und spielt sie NACHEINANDER ab, genau wie im Betrieb.
    // Ohne Anmeldung gilt der Forstbetrieb (Station 0) als Ausgangspunkt --
    // ein Ziel AUF dieser Station ergaebe keinen Weg. Deshalb hier nur Ziele
    // weiter hinten in der Kette.
    beginRun();
    reportPodQuery('https://solid-community-server.tmdt.info/planing/data/x.ttl', 'hit');
    reportPodQuery('https://solid-community-server.tmdt.info/sawmill/data/x.ttl', 'hit');
    // Ein 'miss' waere wirkungslos -- der Sequenzer spielt nur Treffer ab.
    reportPodQuery('https://solid-community-server.tmdt.info/bspwerk/data/x.ttl', 'hit');
    return () => resetSequencer();
  }, []);

  return (
    <div className="p-4 bg-night-900 min-h-screen">
      <DataspacePanel isLoading />
    </div>
  );
}

attachSequencer();

function View() {
  const view = new URLSearchParams(window.location.search).get('view') ?? 'landing';
  switch (view) {
    case 'origin':
      return (
        <OriginProofView
          productId={stemProduct.id}
          product={stemProduct}
          productData={originData()}
          supplyChain={[]}
          onBack={noop}
          onScanClick={noop}
        />
      );
    case 'scanner':
      return <ScanView onProductScanned={noop} />;
    // Der Datenraum-Graph waehrend einer laufenden Abfrage. Ohne diese
    // Ansicht liesse sich nur der Ruhezustand begutachten -- die Bewegung ist
    // aber der Grund, warum es den Graphen ueberhaupt gibt.
    case 'dataspace-active':
      return <DataspaceDemo />;
    case 'dataspace':
      return (
        <div className="p-4 bg-night-900 min-h-screen">
          <DataspacePanel />
        </div>
      );
    case 'usecases-lamella':
      return <UseCases type="SawnTimber" />;
    case 'usecases-panel':
      return <UseCases type="CLT" />;
    case 'usecases-unknown':
      return <UseCases type={null} />;
    case 'picker-upstream':
      return (
        <div className="p-4">
          <ChainScopePicker stage="stem" scope="upstream" onChange={noop} />
        </div>
      );
    case 'menu':
      return (
        <SideMenu
          isOpen
          onClose={noop}
          onScanClick={noop}
          onPartnersClick={noop}
          onFilesClick={noop}
          onResetClick={noop}
          isLoggedIn
          onUseCaseClick={noop}
          onGuideClick={noop}
        />
      );
    case 'guide':
      return <GuideSheet topicId="registration" onClose={noop} onSelectTopic={noop} />;
    case 'partners':
      return <PartnerSheet isOpen onClose={noop} />;
    default:
      return (
        <LandingView
          onScanClick={noop}
          onUploadClick={noop}
          onPartnersClick={noop}
          onUseCaseClick={noop}
        />
      );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <WalletProvider>
        <div className="min-h-screen flex flex-col bg-night-900">
          <View />
        </div>
      </WalletProvider>
    </AuthProvider>
  </StrictMode>,
);
