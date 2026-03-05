/**
 * User Menu Component
 *
 * Displays logged-in user info with logout option.
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, LogOut, ChevronDown, ExternalLink } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

export function UserMenu() {
  const { userName, webId, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
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

  const displayName = userName || "Solid User";
  const shortWebId = webId
    ? webId.replace("https://", "").replace("/profile/card#me", "")
    : "";

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-forest-500/20 hover:bg-forest-500/30 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-forest-600 flex items-center justify-center">
          <User className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-medium text-forest-800 max-w-[120px] truncate">
          {displayName}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-forest-600 transition-transform ${
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
            className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50"
          >
            {/* User Info */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-forest-100 flex items-center justify-center">
                  <User className="w-6 h-6 text-forest-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-timber-dark truncate">
                    {displayName}
                  </div>
                  <div className="text-xs text-timber-gray truncate">
                    {shortWebId}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-2">
              {webId && (
                <a
                  href={webId}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-timber-dark"
                >
                  <ExternalLink className="w-4 h-4 text-timber-gray" />
                  <span className="text-sm">Profil ansehen</span>
                </a>
              )}

              <button
                onClick={() => {
                  setIsOpen(false);
                  logout();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors text-red-600"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm font-medium">Abmelden</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
