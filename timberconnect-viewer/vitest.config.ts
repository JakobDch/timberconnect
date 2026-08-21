import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Testlauf getrennt von der Build-Konfiguration.
 *
 * Der forks-Pool startet die jsdom-Umgebung auf Windows unzuverlaessig
 * ("Timeout waiting for worker to respond"); mit threads laeuft es stabil.
 */
export default defineConfig({
  // Fuer die Komponententests: uebersetzt JSX (sonst "React is not defined").
  plugins: [react()],
  test: {
    pool: 'threads',
    environment: 'node',
    // Nur die Hook-Tests brauchen ein DOM — per Datei-Kommentar gesetzt
    // (@vitest-environment jsdom), damit die reinen Parser-Tests schnell bleiben.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
