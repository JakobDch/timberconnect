/**
 * Loest die Transportstrecken A2/A4 der CO2-Bilanz auf.
 *
 * Die beiden Strecken stehen nicht als Zahl im Datenraum: A2 (Saegewerk ->
 * BSP-Werk) und A4 (BSP-Werk -> Baustelle) werden aus geocodierten Adressen
 * geschaetzt -- Luftlinie mal Umwegfaktor -- und als "abgeleitet" markiert.
 *
 * Warum ein Hook und keine Funktion in lcaService.ts: der Service ist
 * ausdruecklich frei von I/O, damit computeLca() unit-testbar bleibt (siehe
 * Kopfkommentar dort). Das Geocoding gehoert also nach aussen. Es steht aber
 * auch nicht mehr in der Ansicht, seit der Bauproduktpass dieselbe Zahl
 * braucht wie die CO2-Bilanz -- zwei Kopien waeren unweigerlich
 * auseinandergelaufen, und dann haette dasselbe Bauteil je nach Ansicht eine
 * andere CO2-Bilanz gehabt.
 *
 * Die Aufloesung laeuft schrittweise: A2 wird gesetzt, sobald es da ist, A4
 * danach. Nominatim wird sequentiell befragt (der Dienst bittet darum), und
 * jeder Fehlschlag endet als "nicht aufloesbar" mit Begruendung -- nie als
 * geratener Wert.
 */

import { useEffect, useState } from 'react';
import {
  LCA_CONSTANTS,
  type LcaInputs,
  type ResolvedDistances,
} from '../services/lcaService';
import { geocodeAddress } from '../services/geocodingService';
import { haversineKm } from '../services/geoService';

/** Ausgangszustand: noch nichts aufgeloest, Begruendung schon gesetzt. */
const PENDING: ResolvedDistances = {
  sawmillToBspKm: {
    value: null,
    availability: 'missing',
    note: 'Transportadressen von Sägewerk und BSP-Werk fehlen oder sind nicht geocodierbar.',
  },
  bspToSiteKm: {
    value: null,
    availability: 'missing',
    note: 'GPS-Gesamtstrecke (M-849) nicht im Datenraum; Abhol-/Lieferort fehlen oder sind nicht geocodierbar.',
  },
};

/**
 * Kandidaten der Reihe nach probieren.
 *
 * Nominatim findet nichts, sobald der Firmenname im Suchstring steht --
 * deshalb liefert buildAddressCandidates() "Strasse, PLZ Ort" zuerst und den
 * Volljoin nur als letzten Versuch.
 */
async function geocodeFirst(candidates: string[]) {
  for (const candidate of candidates) {
    const hit = await geocodeAddress(candidate);
    if (hit) return hit;
    console.warn('[LCA] Geocoding ohne Treffer fuer:', candidate);
  }
  return null;
}

/** Strassenentfernung zweier Adresslisten [km], oder null. */
async function resolveKm(from: string[], to: string[]): Promise<number | null> {
  if (from.length === 0 || to.length === 0) return null;
  const a = await geocodeFirst(from);
  const b = await geocodeFirst(to);
  if (!a || !b) return null;
  const km =
    haversineKm({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }) *
    LCA_CONSTANTS.detourFactor;
  return Math.round(km);
}

/**
 * @param inputs  Eingangsgroessen aus extractLcaInputs()
 */
export function useLcaDistances(inputs: LcaInputs): ResolvedDistances {
  const [distances, setDistances] = useState<ResolvedDistances>(PENDING);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const a2 = await resolveKm(
        inputs.sawmillGeoCandidates,
        inputs.bspWerkGeoCandidates,
      );
      if (cancelled) return;
      setDistances((prev) => ({
        ...prev,
        sawmillToBspKm:
          a2 !== null
            ? {
                value: a2,
                availability: 'derived',
                note: 'Aus den geocodierten Transportadressen geschätzt (Luftlinie × Umwegfaktor 1,3).',
              }
            : {
                value: null,
                availability: 'missing',
                // Zwei verschiedene Aussagen: "die Daten fehlen" vs. "der
                // Geocoder findet die Adressen nicht" -- fuer die Bewertung
                // des Datenraums macht das den Unterschied.
                note:
                  inputs.sawmillGeoCandidates.length === 0 ||
                  inputs.bspWerkGeoCandidates.length === 0
                    ? 'Die Transportadressen von Sägewerk bzw. BSP-Werk sind in den geladenen Quellen nicht hinterlegt.'
                    : 'Die Transportadressen konnten nicht geocodiert werden.',
              },
      }));

      const a4 = await resolveKm(
        inputs.pickupGeoCandidates,
        inputs.deliveryGeoCandidates,
      );
      if (cancelled) return;
      setDistances((prev) => ({
        ...prev,
        bspToSiteKm:
          a4 !== null
            ? {
                value: a4,
                availability: 'derived',
                note: 'GPS-Gesamtstrecke (M-849) nicht im Datenraum; aus Abhol- und Lieferort des ERP-Vorgangs geschätzt (Luftlinie × 1,3).',
              }
            : {
                value: null,
                availability: 'missing',
                note:
                  inputs.pickupGeoCandidates.length === 0 ||
                  inputs.deliveryGeoCandidates.length === 0
                    ? 'GPS-Gesamtstrecke (M-849) fehlt, und der ERP-Vorgang enthält keinen Abhol-/Lieferort — der Herstellungsvorgang wurde vermutlich ohne Transportauftrags-Blatt hochgeladen.'
                    : 'Abhol- und Lieferort konnten nicht geocodiert werden.',
              },
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, [inputs]);

  return distances;
}
