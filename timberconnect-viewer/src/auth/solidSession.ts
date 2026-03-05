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
 * Restore session from storage after redirect or page reload.
 * Should be called before rendering the app.
 */
export async function restoreSession(): Promise<void> {
  try {
    // v3 API: handleIncomingRedirect takes options object
    await session.handleIncomingRedirect({
      url: window.location.href,
      restorePreviousSession: true,
    });
  } catch (error) {
    console.error("Failed to restore Solid session:", error);
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

  session.login({
    oidcIssuer,
    redirectUrl: getRedirectUrl(),
    clientName: "TimberConnect Viewer",
  });
}

/**
 * Logout and clear session data.
 */
export function logout(): void {
  localStorage.removeItem("solid-was-logged-in");
  localStorage.removeItem("solid-oidc-issuer");

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
