import { getRoleByIri } from '../../config/roles';

/**
 * Kurzfassung einer Freigabe fuer Listen: "Sägewerk, Zertifizierer +2".
 *
 * Eigene Datei, weil Fast Refresh nur greift, wenn ein Modul ausschliesslich
 * Komponenten exportiert — diese Funktion teilen sich Sheet und Verwaltung.
 */
export function summariseRoles(roleIris: string[], max = 2): string {
  if (roleIris.length === 0) return 'niemand';
  const labels = roleIris
    .map((iri) => getRoleByIri(iri)?.label)
    .filter((l): l is string => !!l);
  if (labels.length === 0) return 'niemand';
  const shown = labels.slice(0, max).join(', ');
  return labels.length > max ? `${shown} +${labels.length - max}` : shown;
}
