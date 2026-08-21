import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Overlay-Infrastruktur für Bottom-Sheets/Modals.
 *
 * SheetPortal rendert direkt unter document.body: position:fixed darf sich
 * dadurch nie an einem transformierten/gefilterten Vorfahren verankern
 * (backdrop-filter, framer-motion-Transforms), sondern immer am Viewport.
 */
export function SheetPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

/** Sperrt das Scrollen der Seite, solange ein Overlay geöffnet ist. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
