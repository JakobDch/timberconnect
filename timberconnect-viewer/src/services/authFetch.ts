/**
 * Authenticated Fetch Provider
 *
 * The service modules (sparqlService, catalogService, ...) live outside the React
 * tree and cannot call useAuth(). This module holds a single injectable fetch so
 * those services can issue authenticated requests against Solid Pods.
 *
 * Default is the global `fetch` (unauthenticated, the pre-auth behaviour). Once a
 * Solid session is restored or established, AuthContext calls setAuthFetch(session.fetch),
 * after which all service reads carry the Bearer/DPoP token transparently.
 */

let currentFetch: typeof fetch = (...args) => fetch(...args);
let currentRoleIri: string | null = null;

/**
 * Inject the authenticated fetch (session.fetch). Called by AuthContext on
 * session restore/login, and reset to the global fetch on logout.
 */
export function setAuthFetch(fetchFn: typeof fetch | null): void {
  currentFetch = fetchFn ?? ((...args) => fetch(...args));
}

/**
 * Get the current fetch to use for Solid Pod requests. Returns session.fetch
 * when logged in, otherwise the global fetch.
 */
export function getAuthFetch(): typeof fetch {
  return currentFetch;
}

/**
 * Inject the logged-in user's role IRI so service-layer code (e.g. the query
 * pre-filter) can reason about role permissions without React context.
 * Reset to null on logout or when the role is not yet known.
 */
export function setCurrentRole(roleIri: string | null): void {
  currentRoleIri = roleIri;
}

/** Get the logged-in user's role IRI, or null if unknown/unauthenticated. */
export function getCurrentRole(): string | null {
  return currentRoleIri;
}
