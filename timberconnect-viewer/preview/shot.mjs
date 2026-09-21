/**
 * Screenshots der Mobile-Vorschau bei Handybreite -- ueber das Chrome
 * DevTools Protocol, ohne Zusatzpakete (Node >= 22 hat WebSocket).
 *
 * Warum nicht ``chrome --screenshot --window-size=390,...``: Chrome haelt
 * unter Windows eine Mindestfensterbreite von rund 500 px; das Layout wurde
 * dann bei ~600 px gerechnet und nur der Ausschnitt gespeichert. Erst die
 * Geraete-Emulation liefert ein echtes 390-px-Layout.
 *
 *   node preview/shot.mjs [ausgabeordner] [breite]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'dist-preview/shots';
const WIDTH = Number(process.argv[3] ?? 390);
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';
const PORT = 9333;
const VIEWS = [
  'landing',
  'scanner',
  'usecases-lamella',
  'usecases-panel',
  'usecases-unknown',
  'picker-upstream',
  'menu',
  'guide',
  'partners',
  'origin',
  'dataspace',
  'dataspace-active',
];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!CHROME) throw new Error('Kein Chrome/Edge gefunden');

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'tc-preview-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* noch nicht bereit */
    }
    await sleep(200);
  }
  throw new Error('DevTools nicht erreichbar');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((l) => l(msg));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method) {
    return new Promise((resolve) => {
      const l = (msg) => {
        if (msg.method === method) {
          this.listeners = this.listeners.filter((x) => x !== l);
          resolve(msg.params);
        }
      };
      this.listeners.push(l);
    });
  }
}

try {
  const wsUrl = await waitForDevtools();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const cdp = new Cdp(ws);

  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });

  for (const view of VIEWS) {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${BASE}?view=${view}` });
    await loaded;
    // Die Datenraum-Animation laeuft in Etappen (Hinweg ~0,9 s, Rueckweg
    // ~0,8 s). Ein fester Zeitpunkt trifft immer nur einen Moment; ueber
    // PREVIEW_DELAY laesst sich gezielt einer davon abwarten.
    await sleep(Number(process.env.PREVIEW_DELAY ?? 2500));

    const { contentSize, cssVisualViewport } = await cdp.send('Page.getLayoutMetrics');
    const height = Math.min(Math.ceil(contentSize.height), 6000);
    // Waagerechter Ueberlauf ist der eigentliche Pruefpunkt: breiter als der
    // Viewport heisst, irgendein Element schiebt die Seite ueber den Rand.
    const overflow = contentSize.width > cssVisualViewport.clientWidth + 1;
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 },
    });
    writeFileSync(join(OUT, `${view}.png`), Buffer.from(shot.data, 'base64'));
    console.log(
      `${view.padEnd(18)} ${WIDTH}x${height}px  contentWidth=${contentSize.width}` +
        (overflow ? '  !!! WAAGERECHTER UEBERLAUF' : ''),
    );
  }
  ws.close();
} finally {
  chrome.kill();
}
