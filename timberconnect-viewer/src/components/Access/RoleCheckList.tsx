import { Check, Lock } from 'lucide-react';
import { ROLE_GROUPS, rolesByGroup, type RoleDef } from '../../config/roles';

/**
 * Rollenauswahl, nach Themengruppen gegliedert.
 *
 * Wird an zwei Stellen gebraucht — bei der Frage nach dem Upload und in der
 * nachtraeglichen Verwaltung — und ist deshalb eigenstaendig. 25 Rollen sind
 * als flache Liste nicht ueberblickbar; die Gruppen sind reine Ordnungshilfe
 * und stehen nicht im Pod.
 *
 * `available` begrenzt die Auswahl auf die Rollen der Pod-Freigabe: ein
 * Dokument kann nie mehr Rollen erreichen als der Pod insgesamt freigibt.
 * Rollen ausserhalb dieser Menge werden gesperrt gezeigt statt versteckt —
 * sonst waere unerklaerlich, warum eine erwartete Rolle fehlt.
 */

interface RoleCheckListProps {
  selected: Set<string>;
  onToggle: (iri: string) => void;
  /**
   * Rollen-IRIs, die ueberhaupt waehlbar sind (die Pod-Freigabe).
   * `null` = keine Begrenzung (Einsatz in der Pod-Einstellung selbst).
   */
  available?: string[] | null;
  disabled?: boolean;
  /** Kompaktere Darstellung ohne Beschreibungstexte. */
  compact?: boolean;
}

export function RoleCheckList({
  selected,
  onToggle,
  available = null,
  disabled = false,
  compact = false,
}: RoleCheckListProps) {
  const allowed = available === null ? null : new Set(available);

  return (
    <div className="space-y-4">
      {ROLE_GROUPS.map((group) => {
        const roles = rolesByGroup(group.id);
        if (roles.length === 0) return null;

        return (
          <div key={group.id}>
            <h4 className="text-[11px] font-bold tracking-[0.14em] text-night-400 uppercase mb-2">
              {group.label}
            </h4>
            <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
              {roles.map((role) => {
                // Nicht freigegebene Rollen werden ausgegraut GEZEIGT, nicht
                // herausgefiltert. Vorher verschwanden sie, und dann war
                // unerklaerlich, warum die Liste weniger Rollen enthielt als
                // der Zaehler darueber nannte -- man suchte den Fehler bei
                // sich, obwohl nur die Pod-Freigabe enger war.
                const locked = allowed !== null && !allowed.has(role.iri);
                return (
                  <RoleRow
                    key={role.id}
                    role={role}
                    checked={selected.has(role.iri)}
                    onToggle={() => onToggle(role.iri)}
                    disabled={disabled}
                    locked={locked}
                    compact={compact}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoleRow({
  role,
  checked,
  onToggle,
  disabled,
  locked = false,
  compact,
}: {
  role: RoleDef;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
  /** Nicht in der Pod-Freigabe: sichtbar, aber nicht waehlbar. */
  locked?: boolean;
  compact: boolean;
}) {
  return (
    <button
      type="button"
      onClick={locked ? undefined : onToggle}
      disabled={disabled || locked}
      aria-pressed={checked}
      title={
        locked
          ? 'Nicht in Ihrer allgemeinen Freigabe — ein Dokument kann nie mehr Rollen erreichen als der Pod insgesamt.'
          : undefined
      }
      className={`w-full px-3.5 ${compact ? 'py-2.5' : 'py-3'} rounded-xl border text-left transition-all flex items-start justify-between gap-3 disabled:cursor-not-allowed ${
        locked
          ? 'border-white/5 bg-night-800/40 opacity-45'
          : checked
            ? 'border-acid-400/50 bg-acid-400/10'
            : 'border-white/10 bg-night-700/40 hover:border-acid-400/30'
      } ${disabled && !locked ? 'opacity-50' : ''}`}
    >
      <span className="min-w-0">
        <span
          className={`block text-sm font-semibold ${locked ? 'text-night-300' : 'text-white'}`}
        >
          {role.label}
        </span>
        {!compact && (
          <span className="block text-xs text-night-300 mt-0.5 leading-relaxed">
            {locked ? 'Nicht in Ihrer allgemeinen Freigabe' : role.description}
          </span>
        )}
      </span>
      <span
        className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors flex-shrink-0 mt-0.5 ${
          locked
            ? 'border-white/10 text-night-400'
            : checked
              ? 'bg-acid-400 border-acid-400 text-night-950'
              : 'border-white/20'
        }`}
      >
        {locked ? <Lock className="w-3 h-3" /> : checked && <Check className="w-3.5 h-3.5" />}
      </span>
    </button>
  );
}

/**
 * Hinweis, wenn die Pod-Freigabe noch leer ist.
 *
 * Ohne freigegebene Rolle gibt es nichts auszuwaehlen — und der Grund liegt
 * nicht beim Dokument, sondern eine Ebene hoeher. Diesen Fall stumm mit einer
 * leeren Liste zu quittieren, wuerde wie ein Fehler wirken.
 */
export function EmptyPodPolicyHint({ onOpenSettings }: { onOpenSettings?: () => void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
      <Lock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-amber-300">
          Noch keine Rolle freigegeben
        </p>
        <p className="text-xs text-amber-300/80 mt-1 leading-relaxed">
          In Ihrer allgemeinen Freigabe ist bisher keine Rolle eingetragen.
          Solange das so ist, sehen nur Sie selbst diese Dokumente — einzelne
          Dokumente können nicht mehr freigeben als der Pod insgesamt.
        </p>
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="text-xs font-semibold text-amber-300 underline underline-offset-2 mt-2"
          >
            Allgemeine Freigabe öffnen
          </button>
        )}
      </div>
    </div>
  );
}
