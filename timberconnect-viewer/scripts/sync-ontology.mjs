/**
 * Haelt die ausgelieferte Ontologie mit der Quelle im Konverter synchron.
 *
 * Warum es diese Kopie ueberhaupt gibt: der Assistent liest die deutschen
 * rdfs:label aus der Ontologie, um Klassen und Eigenschaften nachschlagbar zu
 * machen ("Decklage BSP Seite 1" statt vlex:decklageBspSeite1). Der Viewer
 * braucht die Datei also zur Laufzeit im Browser. Der Docker-Build kopiert aber
 * nur ``timberconnect-viewer/`` in den Container -- aus dem Build-Kontext ist
 * der Konverter-Ordner gar nicht erreichbar. Deshalb liegt hier eine Kopie
 * unter ``public/``.
 *
 * Zwei Kopien laufen erfahrungsgemaess auseinander. Dieses Skript ist die
 * Gegenmassnahme:
 *
 *   npm run sync:ontology         -- kopiert die Quelle hierher
 *   npm run sync:ontology -- --check   -- meldet nur Abweichung (Exit 1)
 *
 * Die Pruefvariante ist fuer CI gedacht; lokal genuegt der Aufruf ohne Argument,
 * nachdem die Ontologie im Konverter geaendert wurde.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(
  here,
  '../../timberconnect-rml-converter/ontology/timberconnect_ontology_v6.ttl',
);
const TARGET = resolve(here, '../public/ontology/timberconnect_ontology_v6.ttl');

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (!existsSync(SOURCE)) {
  console.error(`[sync-ontology] Quelle fehlt: ${SOURCE}`);
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');
const targetExists = existsSync(TARGET);
const inSync = targetExists && sha(SOURCE) === sha(TARGET);

if (inSync) {
  console.log('[sync-ontology] aktuell — keine Änderung nötig.');
  process.exit(0);
}

if (checkOnly) {
  console.error(
    '[sync-ontology] Die ausgelieferte Ontologie weicht von der Quelle ab.\n' +
      '                Beheben mit: npm run sync:ontology',
  );
  process.exit(1);
}

mkdirSync(dirname(TARGET), { recursive: true });
copyFileSync(SOURCE, TARGET);
console.log('[sync-ontology] aktualisiert:', TARGET);
