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
} from "./solidSession";
import { getSolidDataset, getThing, getStringNoLocale, getUrl } from "@inrupt/solid-client";
import { FOAF, VCARD } from "@inrupt/vocab-common-rdf";

interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean;
  webId: string | null;
  userName: string | null;
  userPhoto: string | null;
}

interface AuthContextType extends AuthState {
  login: (issuer: string) => void;
  logout: () => void;
  authenticatedFetch: typeof fetch;
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
  });

  // Fetch user profile info from Solid Pod
  const fetchUserProfile = useCallback(async (webId: string) => {
    try {
      const dataset = await getSolidDataset(webId, { fetch: session.fetch });
      const profile = getThing(dataset, webId);

      if (profile) {
        // Match the same priority as solid-dataspace-manager: VCARD.fn > FOAF.name > given+family name
        const name =
          getStringNoLocale(profile, VCARD.fn) ||
          getStringNoLocale(profile, FOAF.name) ||
          `${getStringNoLocale(profile, VCARD.given_name) || ""} ${getStringNoLocale(profile, VCARD.family_name) || ""}`.trim() ||
          "Solid User";

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
      setAuthState((prev) => ({
        ...prev,
        userName: "Solid User",
      }));
    }
  }, []);

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      await restoreSession();

      const info = getSessionInfo();

      setAuthState({
        isLoggedIn: info.isLoggedIn,
        isLoading: false,
        webId: info.webId || null,
        userName: null,
        userPhoto: null,
      });

      // Fetch user profile if logged in
      if (info.isLoggedIn && info.webId) {
        fetchUserProfile(info.webId);
      }
    };

    initAuth();
  }, [fetchUserProfile]);

  // Login handler
  const login = useCallback((issuer: string) => {
    solidLogin(issuer);
  }, []);

  // Logout handler
  const logout = useCallback(() => {
    solidLogout();
    setAuthState({
      isLoggedIn: false,
      isLoading: false,
      webId: null,
      userName: null,
      userPhoto: null,
    });
    // Force reload to clear state
    window.location.reload();
  }, []);

  const value: AuthContextType = {
    ...authState,
    login,
    logout,
    authenticatedFetch: session.fetch,
  };

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
