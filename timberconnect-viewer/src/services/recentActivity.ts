/**
 * Lokale Verlaufslisten fuer die neue UI:
 * "Zuletzt gescannt" (Scan-Screen) und "Zuletzt hochgeladen" (Upload-Panel).
 * Rein clientseitig via localStorage, keine Serveranbindung.
 */

export interface RecentScan {
  id: string;
  name: string;
  date: string; // ISO
}

export interface RecentUpload {
  name: string;
  size: number; // Bytes
  date: string; // ISO
}

const SCANS_KEY = 'tc.recentScans';
const UPLOADS_KEY = 'tc.recentUploads';
const MAX_ENTRIES = 5;

function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // localStorage nicht verfuegbar (z.B. private mode) -> Verlauf entfaellt
  }
}

export function getRecentScans(): RecentScan[] {
  return readList<RecentScan>(SCANS_KEY);
}

export function addRecentScan(entry: { id: string; name: string }): void {
  const list = getRecentScans().filter((s) => s.id !== entry.id);
  list.unshift({ ...entry, date: new Date().toISOString() });
  writeList(SCANS_KEY, list);
}

export function getRecentUploads(): RecentUpload[] {
  return readList<RecentUpload>(UPLOADS_KEY);
}

export function addRecentUploads(files: { name: string; size: number }[]): void {
  const now = new Date().toISOString();
  const list = [
    ...files.map((f) => ({ ...f, date: now })),
    ...getRecentUploads(),
  ];
  writeList(UPLOADS_KEY, list);
}

/** Kurzes deutsches Datumsformat wie in der Vorlage: "23.06." */
export function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

/** Dateigroesse lesbar formatieren: "2.4 MB" */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
