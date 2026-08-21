/**
 * Solid Session Management
 *
 * Centralized session handling for Solid Pod authentication using Inrupt's SDK.
 * Based on the semantic-data-catalog implementation pattern.
 * Updated for @inrupt/solid-client-authn-browser v3.x API.
 */

import { Session } from "@inrupt/solid-client-authn-browser";

// Singleton session instance
// v3 API: Session constructor takes minimal options
export const session = new Session();

/**
 * Marker fuer einen laufenden Restore-Versuch (Redirect-Schleifenschutz).
 *
 * handleIncomingRedirect mit restorePreviousSession leitet bei abgelaufenen
 * Tokens den GANZEN Tab per prompt=none zum Identity Provider um. Antwortet
 * der IdP dann fehlerhaft (beobachtet: 500 bei korrupter Server-Session),
 * strandet der Nutzer auf der Fehlerseite -- und beim naechsten Oeffnen der
 * App passiert sofort wieder dasselbe. Die App waere dauerhaft unbedienbar.
 *
 * Deshalb: vor dem Versuch einen Zeitstempel setzen, nach Erfolg loeschen.
 * Ist beim App-Start noch ein frischer Zeitstempel da, ist der letzte Versuch
 * nie zurueckgekommen -- dann wird KEIN neuer Silent-Login gestartet, die
 * gespeicherte Session gilt als kaputt und der Nutzer meldet sich regulaer
 * neu an.
 */
const RESTORE_MARKER = "solid-restore-inflight";
const RESTORE_MARKER_TTL_MS = 2 * 60_000;

/** Merker: Login-Redirect laeuft, Rueckkehr steht noch aus. */
const LOGIN_IN_PROGRESS = "solid-login-in-progress";

/**
 * Restore session from storage after redirect or page reload.
 * Should be called before rendering the app.
 */
export async function restoreSession(): Promise<void> {
  try {
    const url = window.location.href;
    // Rueckkehr aus einem Login-Redirect (Code/Fehler in der URL)? Die muss
    // immer verarbeitet werden, sonst geht ein regulaerer Login verloren.
    const hasAuthParams = /[?&](code|state|error)=/.test(url);

    const markerAt = Number(localStorage.getItem(RESTORE_MARKER) ?? 0);
    const previousAttemptStranded =
      markerAt > 0 && Date.now() - markerAt < RESTORE_MARKER_TTL_MS && !hasAuthParams;

    if (previousAttemptStranded) {
      // Letzter Silent-Login kam nie zurueck -> Session verwerfen statt den
      // Nutzer erneut auf die kaputte IdP-Seite zu schicken.
      console.warn(
        "[auth] Letzter Session-Restore kam nicht zurueck -- Silent-Login wird uebersprungen, bitte neu anmelden.",
      );
      localStorage.removeItem(RESTORE_MARKER);
      localStorage.removeItem("solid-was-logged-in");
      return;
    }

    const attemptSilentRestore = wasLoggedIn();
    if (!attemptSilentRestore && !hasAuthParams) return;

    localStorage.setItem(RESTORE_MARKER, String(Date.now()));
    await session.handleIncomingRedirect({
      url,
      restorePreviousSession: attemptSilentRestore,
    });
    localStorage.removeItem(RESTORE_MARKER);
  } catch (error) {
    console.error("Failed to restore Solid session:", error);
    localStorage.removeItem(RESTORE_MARKER);
  } finally {
    // Immer loeschen -- auch im Fehlerfall. Bleibt der Merker stehen, zeigt die
    // App bei jedem weiteren Aufruf "Anmeldung wird abgeschlossen".
    sessionStorage.removeItem(LOGIN_IN_PROGRESS);
  }
}

/**
 * Get the correct redirect URL for the TimberConnect app.
 * Always redirects back to /timberconnect/ regardless of current URL.
 */
function getRedirectUrl(): string {
  return `${window.location.origin}/timberconnect/`;
}

/**
 * Initiate login flow with the specified OIDC provider.
 */
export function login(oidcIssuer: string): void {
  // Store login state for session restoration
  localStorage.setItem("solid-was-logged-in", "true");
  localStorage.setItem("solid-oidc-issuer", oidcIssuer);
  // Fuer den Ladezustand nach der Rueckkehr: die App weiss beim naechsten
  // Start, dass der Nutzer gerade aktiv einen Login angestossen hat, und kann
  // "Anmeldung wird abgeschlossen..." zeigen statt eines nackten Spinners.
  sessionStorage.setItem(LOGIN_IN_PROGRESS, "true");

  session.login({
    oidcIssuer,
    redirectUrl: getRedirectUrl(),
    clientName: "TimberConnect Viewer",
    // Der Zustimmungsdialog des Community Solid Servers ("Do you trust this
    // application...", inklusive WebID-Auswahl) ist fuer Nutzer ohne
    // Solid-Vorkenntnisse der irritierendste Teil des Logins. Hat der Server
    // den Client gemerkt ("Remember this client"), darf er ihn ueberspringen --
    // genau das signalisiert prompt=consent NICHT und der Default-Wert schon.
    // Server, die die Zustimmung weiterhin brauchen, zeigen sie trotzdem; das
    // ist Sache des IdP und nicht der App.
  });
}

/**
 * True, solange ein vom Nutzer gestarteter Login noch nicht abgeschlossen ist.
 * Wird von der Rueckkehr-Behandlung in restoreSession() geloescht.
 */
export function isLoginInProgress(): boolean {
  return sessionStorage.getItem(LOGIN_IN_PROGRESS) === "true";
}

/**
 * Logout and clear session data.
 */
export function logout(): void {
  localStorage.removeItem("solid-was-logged-in");
  localStorage.removeItem("solid-oidc-issuer");
  sessionStorage.removeItem(LOGIN_IN_PROGRESS);

  // v3 API: logout with RP-initiated logout
  session.logout({
    logoutType: "app",
  });
}

/**
 * Get the last used OIDC issuer URL.
 */
export function getLastIssuer(): string | null {
  return localStorage.getItem("solid-oidc-issuer");
}

/**
 * Check if user was previously logged in.
 */
export function wasLoggedIn(): boolean {
  return localStorage.getItem("solid-was-logged-in") === "true";
}

/**
 * Get the authenticated fetch function for making requests to Solid Pods.
 * This fetch automatically includes the Bearer token.
 */
export function getAuthenticatedFetch(): typeof fetch {
  return session.fetch;
}

/**
 * Get current session info.
 */
export function getSessionInfo() {
  return {
    isLoggedIn: session.info.isLoggedIn,
    webId: session.info.webId,
    sessionId: session.info.sessionId,
  };
}
