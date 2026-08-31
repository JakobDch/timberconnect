/**
 * User Menu Component
 *
 * Displays logged-in user info with logout option.
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, LogOut, ChevronDown, UserCog, Shield, Lock } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { RoleAccessSettings } from "./RoleAccessSettings";
import { ProfileSheet } from "./ProfileSheet";

export function UserMenu() {
  const { userName, userPhoto, webId, logout, role, companyPrefix } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Kein gepflegter Name -> das sagen wir offen und bieten die Bearbeitung an,
  // statt anonym "Solid User" anzuzeigen.
  const hasName = Boolean(userName && userName.trim());
  const displayName = hasName ? (userName as string) : "Name ergänzen";
  // Statt der rohen WebID (".../bspwerk/profile/card#me") nur den Kontonamen --
  // der ist wiedererkennbar, die URL drumherum ist fuer Nutzer ohne
  // Solid-Kenntnisse nur Rauschen. Die vollstaendige WebID bleibt im
  // Profil-Sheet unter "Technische Kennung" einsehbar.
  const accountName = (() => {
    if (!webId) return "";
    try {
      const segments = new URL(webId).pathname.split("/").filter(Boolean);
      // Pod-Wurzel ist das erste Segment; "profile/card" faellt weg.
      return segments[0] ?? new URL(webId).host;
    } catch {
      return "";
    }
  })();

  /** Initialen für den Avatar, solange kein Bild hinterlegt ist. */
  const initials = hasName
    ? (userName as string)
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("")
    : "";

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 sm:px-3 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex-shrink-0"
      >
        <div className="w-8 h-8 rounded-full bg-acid-400 flex items-center justify-center overflow-hidden flex-shrink-0">
          {userPhoto ? (
            <img src={userPhoto} alt="" className="w-full h-full object-cover" />
          ) : initials ? (
            <span className="text-xs font-bold text-night-950">{initials}</span>
          ) : (
            <User className="w-4 h-4 text-night-950" />
          )}
        </div>
        {/* Der Name kostet bis zu 120px -- auf dem Telefon genuegt das
            Avatarbild, der Name steht ohnehin im aufgeklappten Menue. */}
        <span
          className={`hidden sm:block text-sm font-medium max-w-[120px] truncate ${
            hasName ? "text-white" : "text-night-300 italic"
          }`}
        >
          {displayName}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-night-300 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute right-0 mt-2 w-64 bg-night-800 rounded-2xl shadow-2xl shadow-black/50 border border-white/10 overflow-hidden z-50"
          >
            {/* User Info */}
            <div className="p-4 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-acid-400/15 border border-acid-400/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {userPhoto ? (
                    <img src={userPhoto} alt="" className="w-full h-full object-cover" />
                  ) : initials ? (
                    <span className="text-sm font-bold text-acid-300">{initials}</span>
                  ) : (
                    <User className="w-6 h-6 text-acid-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={`font-semibold truncate ${
                      hasName ? "text-white" : "text-night-300 italic"
                    }`}
                  >
                    {displayName}
                  </div>
                  {accountName && (
                    <div className="text-xs text-night-300 truncate">
                      Konto {accountName}
                    </div>
                  )}
                  {role && (
                    <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 bg-acid-400/10 border border-acid-400/30 rounded-full">
                      <Shield className="w-3 h-3 text-acid-300" />
                      <span className="text-xs font-medium text-acid-300">{role.label}</span>
                    </div>
                  )}
                  {companyPrefix && (
                    <div
                      className="mt-1 flex items-center gap-1.5"
                      title="GS1 Company Prefix — bei der Registrierung festgelegt, nicht änderbar"
                    >
                      <Lock className="w-3 h-3 text-night-400 flex-shrink-0" />
                      <span className="text-xs text-night-300">
                        GCP <span className="font-mono text-night-200">{companyPrefix}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-2">
              <button
                onClick={() => {
                  setIsOpen(false);
                  setProfileOpen(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-white"
              >
                <UserCog className="w-4 h-4 text-night-300" />
                <span className="text-sm">Profil bearbeiten</span>
                {!hasName && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-acid-400 flex-shrink-0" />
                )}
              </button>

              <button
                onClick={() => {
                  setIsOpen(false);
                  setAccessOpen(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-white"
              >
                <Shield className="w-4 h-4 text-night-300" />
                <span className="text-sm">Zugriff verwalten</span>
              </button>

              <button
                onClick={() => {
                  setIsOpen(false);
                  logout();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors text-red-400"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm font-medium">Abmelden</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <RoleAccessSettings isOpen={accessOpen} onClose={() => setAccessOpen(false)} />
      <ProfileSheet isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
