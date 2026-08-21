/**
 * Rueckkehr vom Anmelde-Server
 *
 * Nach dem Login schickt der Solid-Server den Browser zurueck auf
 * /timberconnect/. Bis handleIncomingRedirect den Code eingeloest hat, wuerde
 * die App fuer einen Moment ihren abgemeldeten Startzustand zeigen -- also
 * genau den Bildschirm, von dem der Nutzer gerade weg wollte. Dieser Screen
 * ueberbrueckt die Luecke und schliesst den Vorgang sichtbar ab.
 *
 * Er erscheint nur, wenn der Nutzer den Login selbst angestossen hat
 * (isLoginInProgress), nicht beim stillen Wiederherstellen einer Session.
 */

import { Loader2 } from "lucide-react";
import { BrandWordmark } from "../Brand/TreeRingLogo";

export function LoginReturnScreen() {
  return (
    <div className="min-h-screen bg-night-950 flex flex-col items-center justify-center gap-8 px-6">
      <BrandWordmark />

      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="w-7 h-7 text-acid-300 animate-spin" />
        <p className="text-sm font-medium text-white">
          Anmeldung wird abgeschlossen
        </p>
        <p className="text-xs text-night-400 max-w-xs leading-relaxed">
          Ihre Daten werden vorbereitet. Das dauert nur einen Moment.
        </p>
      </div>
    </div>
  );
}
