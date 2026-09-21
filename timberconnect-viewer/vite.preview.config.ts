import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite-Konfiguration der Mobile-Vorschau (siehe preview/main.tsx).
 * Eigener Root und eigenes Ausgabeverzeichnis, damit nichts davon in den
 * produktiven Build (Dockerfile: ``tsc -b && vite build``) gelangt.
 */
export default defineConfig({
  plugins: [react()],
  root: 'preview',
  base: './',
  publicDir: '../public',
  build: { outDir: '../dist-preview', emptyOutDir: true },
  preview: { port: 4173, strictPort: true },
});
