import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Leaf,
  Nfc,
  Upload,
  Handshake,
} from 'lucide-react';
import { SupplyChainGraphic } from './SupplyChainGraphic';
import { UseCaseIcon, UseCaseInfoSheet } from '../UseCases';
import {
  USE_CASES,
  isAvailable,
  type UseCaseDefinition,
} from '../../config/useCases';

interface LandingViewProps {
  onScanClick: () => void;
  onUploadClick: () => void;
  onPartnersClick: () => void;
  /** Waehlt einen Anwendungsfall. Ohne Produkt fuehrt App.tsx zuerst zum
      Scan und springt danach automatisch in die Ansicht. */
  onUseCaseClick: (useCaseId: string) => void;
}

export function LandingView({
  onScanClick,
  onUploadClick,
  onPartnersClick,
  onUseCaseClick,
}: LandingViewProps) {
  // Der Anwendungsfall, dessen Infoblock offen ist. Auf der Startseite fuehrt
  // die Kachel bewusst hierhin und nicht direkt zum Scanner (Vorgabe Anni).
  const [infoUseCase, setInfoUseCase] = useState<UseCaseDefinition | null>(null);

  return (
    <div className="flex-1 bg-night-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
        {/* Hero */}
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Text + CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6"
          >
            {/* Badge */}
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-acid-400/40 text-acid-300 text-xs font-semibold">
              <Leaf className="w-3.5 h-3.5" />
              Lieferkettentransparenz
            </span>

            {/* Headline (Titelvorgabe Anni, 26.08.2026). "Wertschöpfungskette"
                traegt die Aussage und bekommt deshalb die Akzentfarbe. */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-[1.12] tracking-tight text-white">
              Transparenz und Datendurchgängigkeit in der{' '}
              <span className="text-acid-400">Wertschöpfungskette Holz</span>
            </h1>

            {/* Subline */}
            <p className="text-base sm:text-lg text-night-300 leading-relaxed max-w-xl">
              Verfolgen Sie Holzprodukte von der Forstwirtschaft bis zur
              Baustelle – verifiziert durch dezentrale Solid-Pod-Technologie.
            </p>

            {/* Grafik auf Mobile zwischen Text und Buttons (wie Vorlage) */}
            <div className="lg:hidden">
              <SupplyChainGraphic />
            </div>

            {/* CTAs -- beide Wege sind gleichwertig (Vorgabe Anni,
                26.08.2026): Daten abrufen und Daten einspeisen sind zwei
                Haelften derselben Anwendung, keine Haupt- und Nebenhandlung.
                Vorher war "Produkt scannen" breit und lime, "Vorgang
                registrieren" halb so breit und dunkel.
                "Mehr erfahren" ist von hier ins Seitenmenue gewandert -- es
                fuehrt aus der Anwendung heraus auf die Projektwebseite und
                gehoert damit nicht neben die beiden Haupthandlungen. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
              <button onClick={onScanClick} className="btn btn-acid btn-lg">
                <Nfc className="w-5 h-5" />
                <span>Produkt scannen</span>
              </button>
              <button onClick={onUploadClick} className="btn btn-acid btn-lg">
                <Upload className="w-5 h-5" />
                <span>Vorgang registrieren</span>
              </button>
            </div>
          </motion.div>

          {/* Grafik rechts auf Desktop */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="hidden lg:block"
          >
            <SupplyChainGraphic />
          </motion.div>
        </div>

        {/* Verfuegbare Anwendungsfaelle */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-14 sm:mt-20"
        >
          <div className="text-center mb-6 sm:mb-10">
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              Verfügbare Anwendungsfälle
            </h2>
            <p className="text-sm text-night-300 mt-1">
              Wählen Sie nach dem Scan den gewünschten Anwendungsfall
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 max-w-4xl mx-auto">
            {USE_CASES.map((useCase) => {
              const openable = isAvailable(useCase);
              const Tag = openable ? 'button' : 'div';
              return (
                <Tag
                  key={useCase.id}
                  // Oeffnet den Infoblock statt direkt den Scanner: auf der
                  // Startseite ist die offene Frage "was ist das?", nicht
                  // "welches Bauteil?".
                  onClick={openable ? () => setInfoUseCase(useCase) : undefined}
                  className={`relative bg-night-800 border rounded-2xl p-4 sm:p-5 flex flex-col text-left transition-colors ${
                    openable
                      ? 'border-white/10 hover:border-acid-400/40 cursor-pointer'
                      : 'border-white/5'
                  }`}
                >
                  {/* Kein Untertitel und kein Info-Icon mehr (Vorgabe Anni,
                      26.08.2026): weitere Informationen erst beim Anklicken.
                      Das Icon war ohnehin nur Dekoration -- es lag im
                      Karten-Button, ein Klick darauf oeffnete die Ansicht
                      statt einer Erklaerung. */}
                  <UseCaseIcon
                    useCase={useCase}
                    size="md"
                    muted={!openable}
                    className="mb-3 sm:mb-4"
                  />
                  <h3 className="text-sm sm:text-base font-semibold text-night-200 leading-snug">
                    {useCase.title}
                  </h3>
                  <span
                    className={`mt-3 self-start inline-flex px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-medium ${
                      openable
                        ? 'bg-acid-400/15 text-acid-300'
                        : 'bg-night-700 text-night-300'
                    }`}
                  >
                    {openable ? 'Verfügbar' : 'Demnächst'}
                  </span>
                </Tag>
              );
            })}
          </div>

          {/* Praxispartner (öffnet das Partner-Sheet) */}
          <button
            onClick={onPartnersClick}
            className="mt-6 w-full max-w-4xl mx-auto flex items-center justify-center gap-2.5 py-3.5 rounded-full border border-acid-400/30 text-acid-300 font-semibold hover:bg-acid-400/10 transition-colors"
          >
            <Handshake className="w-5 h-5" />
            <span>Praxispartner</span>
          </button>
        </motion.section>
      </div>

      {/* Infoblock zum Anwendungsfall. "Jetzt Produkt scannen" uebergibt an
          denselben Weg wie bisher: App.tsx merkt sich den Fall, oeffnet den
          Scanner und springt nach dem Scan direkt in die Ansicht. */}
      <UseCaseInfoSheet
        useCase={infoUseCase}
        onClose={() => setInfoUseCase(null)}
        onScan={(id) => {
          setInfoUseCase(null);
          onUseCaseClick(id);
        }}
      />
    </div>
  );
}
