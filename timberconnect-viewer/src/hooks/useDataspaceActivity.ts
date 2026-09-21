import { useEffect, useState } from 'react';
import {
  attachSequencer,
  getSequencerState,
  subscribeSequencer,
  type SequencerState,
} from '../services/dataspaceSequencer';

/**
 * Bindet den Datenraum-Graphen an die Abspielfolge.
 *
 * Die ganze Ablaufsteuerung sitzt im Sequenzer (services/dataspaceSequencer),
 * nicht hier: der Scan-Flow in App.tsx muss auf dieselbe Folge warten koennen,
 * und ein Komponenten-Hook waere fuer ihn nicht erreichbar.
 */
export function useDataspaceActivity(): SequencerState {
  const [state, setState] = useState<SequencerState>(getSequencerState);

  useEffect(() => {
    // Idempotent — der erste Aufrufer haengt den Sequenzer an die Meldungen.
    attachSequencer();
    return subscribeSequencer(setState);
  }, []);

  return state;
}
