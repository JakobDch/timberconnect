/**
 * Authentication Context
 *
 * React Context for managing Solid authentication state throughout the app.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  session,
  restoreSession,
  login as solidLogin,
  logout as solidLogout,
  getSessionInfo,
  isLoginInProgress,
} from "./solidSession";
import { LoginReturnScreen } from "../components/Auth/LoginReturnScreen";
import { getSolidDataset, getThing, getStringNoLocale, getUrl } from "@inrupt/solid-client";
import { FOAF, VCARD } from "@inrupt/vocab-common-rdf";
import { setAuthFetch, setCurrentRole } from "../services/authFetch";
import {
  getOwnSetup,
  setOwnRole,
  ensureRoleAllowed,
} from "../services/accessControlService";
import { invalidateCompanyPrefixes } from "../services/companyPrefixService";
import {
  ensureRegisteredInFederation,
  invalidateMemberRoles,
  refreshOwnGroupDocs,
  resolveRoleMembers,
} from "../services/registryService";
import { isDemoRole, type RoleDef } from "../config/roles";
import { saveProfile, type UserProfile } from "../services/profileService";

interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean;
  webId: string | null;
  userName: string | null;
  userPhoto: string | null;
  /** The user's own role (from {pod}profile/role.ttl), or null if not yet set. */
  role: RoleDef | null;
  /** GS1 Company Prefix — bei der Registrierung gesetzt, danach unveränderlich. */
  companyPrefix: string | null;
  /** True once we know the user is logged in but role/prefix are not set yet. */
  needsRoleSetup: boolean;
}

interface AuthContextType extends AuthState {
  login: (issuer: string) => void;
  logout: () => void;
  authenticatedFetch: typeof fetch;
  /** Persist role + company prefix to the pod and update context. */
  setRole: (role: RoleDef, companyPrefix: string) => Promise<void>;
  /** Persist the editable WebID profile and update name/photo in the context. */
  saveUserProfile: (profile: UserProfile) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [authState, setAuthState] = useState<AuthState>({
    isLoggedIn: false,
    isLoading: true,
    webId: null,
    userName: null,
    userPhoto: null,
    role: null,
    companyPrefix: null,
    needsRoleSetup: false,
  });

  // Einmalig beim ersten Render festhalten: Kommt der Nutzer gerade von der
  // Anmeldeseite zurueck? Der Merker wird von restoreSession() geloescht,
  // deshalb der Lazy-Initializer statt einer Abfrage im Render-Body.
  const [returningFromLogin] = useState(isLoginInProgress);

  // Fetch user profile info from Solid Pod
  const fetchUserProfile = useCallback(async (webId: string) => {
    try {
      const dataset = await getSolidDataset(webId, { fetch: session.fetch });
      const profile = getThing(dataset, webId);

      if (profile) {
        // Match the same priority as solid-dataspace-manager: VCARD.fn > FOAF.name > given+family name
        // Kein Fallback auf "Solid User": ein leerer Name bedeutet "noch nicht
        // gepflegt" und wird in der UI als Aufforderung dargestellt (ProfileSheet).
        const name =
          getStringNoLocale(profile, VCARD.fn) ||
          getStringNoLocale(profile, FOAF.name) ||
          `${getStringNoLocale(profile, VCARD.given_name) || ""} ${getStringNoLocale(profile, VCARD.family_name) || ""}`.trim() ||
          null;

        // Get user photo if available
        const photo = getUrl(profile, VCARD.hasPhoto) || getUrl(profile, FOAF.img) || null;

        setAuthState((prev) => ({
          ...prev,
          userName: name,
          userPhoto: photo,
        }));
      }
    } catch (error) {
      console.error("Failed to fetch user profile:", error);
    }
  }, []);

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      await restoreSession();

      const info = getSessionInfo();

      // Inject the (possibly authenticated) session fetch into the service layer
      // so catalog/Comunica reads carry the token once a session is active.
      if (info.isLoggedIn) {
        setAuthFetch(session.fetch);
      }

      setAuthState({
        isLoggedIn: info.isLoggedIn,
        isLoading: false,
        webId: info.webId || null,
        userName: null,
        userPhoto: null,
        role: null,
        companyPrefix: null,
        needsRoleSetup: false,
      });

      // Fetch user profile and role if logged in
      if (info.isLoggedIn && info.webId) {
        const webId = info.webId;
        fetchUserProfile(webId);

        // Selbstheilende Föderation (fire-and-forget): (1) den User im
        // Föderations-Register eintragen, falls er dort noch fehlt — sonst
        // landet er nie in den acl:agentGroups fremder Pods; (2) die eigenen
        // Rollen-Gruppen aus dem aktuellen Register-Stand neu materialisieren,
        // damit seit dem letzten Login registrierte Nutzer Zugriff erhalten.
        ensureRegisteredInFederation(webId)
          .then(() => refreshOwnGroupDocs(webId))
          .catch((err) => {
            console.warn("Federation registration/refresh failed:", err);
          });

        // Resolve role + company prefix; flag users with incomplete
        // registration (no role OR no prefix) for the one-time setup.
        getOwnSetup(info.webId)
          .then(({ role, companyPrefix }) => {
            setCurrentRole(role?.iri ?? null);
            setAuthState((prev) => ({
              ...prev,
              role,
              companyPrefix,
              needsRoleSetup:
                prev.isLoggedIn && (role === null || companyPrefix === null),
            }));
          })
          .catch((err) => {
            console.error("Failed to load user role:", err);
          });
      }
    };

    initAuth();
  }, [fetchUserProfile]);

  // Login handler
  const login = useCallback((issuer: string) => {
    solidLogin(issuer);
  }, []);

  // Persist role + company prefix to the pod, then update context.
  // Der Prefix ist Write-once: ein bereits gespeicherter gewinnt immer
  // (setOwnRole gibt den effektiv gespeicherten Wert zurück).
  const setRole = useCallback(
    async (role: RoleDef, companyPrefix: string) => {
      const webId = authState.webId;
      if (!webId) throw new Error("Cannot set role: not logged in");
      const effectivePrefix = await setOwnRole(webId, role, companyPrefix);
      // Der Prefix bestimmt die Scan-Auflösung mit (companyPrefixService liest
      // ihn aus allen Pods der Föderation). Ohne Invalidierung zählte ein
      // frisch registrierter Teilnehmer bis zu fünf Minuten lang nicht mit —
      // seine eigenen Barcodes lösten so lange auf die falsche Lesart auf.
      invalidateCompanyPrefixes();
      // Gleiches fuer den Rollen-Cache des Registers: die eigene, gerade
      // geschriebene Rolle muss die Gruppenaufloesung sofort sehen.
      invalidateMemberRoles();
      setCurrentRole(role.iri);
      setAuthState((prev) => ({
        ...prev,
        role,
        companyPrefix: effectivePrefix,
        needsRoleSetup: false,
      }));
      // Das Demo-Konto gibt sich selbst frei, sonst filtert der EPCIS-Proxy
      // die eigenen Ereignisse weg (Begruendung bei ensureRoleAllowed).
      // Fire-and-forget: Scheitert das, bleibt die Rolle trotzdem gesetzt;
      // die Freigabe laesst sich in den Zugriffseinstellungen nachholen.
      if (isDemoRole(role.id)) {
        ensureRoleAllowed(webId, role.iri, resolveRoleMembers).catch((err) => {
          console.warn("Self-release of demo role failed:", err);
        });
      }
    },
    [authState.webId],
  );

  // Profil in das WebID-Dokument schreiben und den Kontext sofort nachziehen,
  // damit Header/Menü den neuen Namen ohne Reload zeigen.
  const saveUserProfile = useCallback(
    async (profile: UserProfile) => {
      const webId = authState.webId;
      if (!webId) throw new Error("Cannot save profile: not logged in");
      await saveProfile(webId, profile);
      setAuthState((prev) => ({
        ...prev,
        userName: profile.name.trim() || null,
        userPhoto: profile.photo.trim() || null,
      }));
    },
    [authState.webId],
  );

  // Logout handler
  const logout = useCallback(() => {
    // Reset the service layer back to the unauthenticated global fetch.
    setAuthFetch(null);
    setCurrentRole(null);
    solidLogout();
    setAuthState({
      isLoggedIn: false,
      isLoading: false,
      webId: null,
      userName: null,
      userPhoto: null,
      role: null,
      companyPrefix: null,
      needsRoleSetup: false,
    });
    // Force reload to clear state
    window.location.reload();
  }, []);

  const value: AuthContextType = {
    ...authState,
    login,
    logout,
    setRole,
    saveUserProfile,
    authenticatedFetch: session.fetch,
  };

  // Waehrend der Rueckkehr vom Anmelde-Server die App zurueckhalten, statt kurz
  // den abgemeldeten Zustand zu zeigen. Nur beim aktiv gestarteten Login --
  // ein stiller Session-Restore laeuft weiterhin unsichtbar im Hintergrund.
  if (returningFromLogin && authState.isLoading) {
    return (
      <AuthContext.Provider value={value}>
        <LoginReturnScreen />
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access authentication context.
 * Must be used within an AuthProvider.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Hook to get the authenticated fetch function.
 * Useful for components that only need to make authenticated requests.
 */
export function useAuthenticatedFetch(): typeof fetch {
  const { authenticatedFetch } = useAuth();
  return authenticatedFetch;
}
