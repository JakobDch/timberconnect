/**
 * Login Modal
 *
 * OIDC provider selection modal for Solid authentication.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Server, Globe, ArrowRight } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { getLastIssuer } from "../../auth/solidSession";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Predefined OIDC providers
const PROVIDERS = [
  {
    id: "tmdt",
    name: "TMDT Solid Server",
    url: "https://tmdt-solid-community-server.de",
    description: "TimberConnect Demonstrator Server",
    icon: Server,
  },
  {
    id: "solidcommunity",
    name: "Solid Community",
    url: "https://solidcommunity.net",
    description: "Oeffentlicher Solid Community Server",
    icon: Globe,
  },
];

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { login } = useAuth();
  const [customIssuer, setCustomIssuer] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const lastIssuer = getLastIssuer();

  const handleProviderSelect = (url: string) => {
    login(url);
    onClose();
  };

  const handleCustomLogin = () => {
    if (customIssuer.trim()) {
      login(customIssuer.trim());
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          {/* Header */}
          <div className="bg-forest-600 text-white px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Mit Solid Pod anmelden</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-forest-500 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <p className="text-timber-gray text-sm">
              Waehlen Sie Ihren Solid Identity Provider, um sich anzumelden und
              Daten in Ihrem Pod zu speichern.
            </p>

            {/* Provider List */}
            <div className="space-y-3">
              {PROVIDERS.map((provider) => {
                const Icon = provider.icon;
                const isLastUsed = lastIssuer === provider.url;

                return (
                  <button
                    key={provider.id}
                    onClick={() => handleProviderSelect(provider.url)}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all hover:border-forest-500 hover:bg-forest-50 ${
                      isLastUsed
                        ? "border-forest-500 bg-forest-50"
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-forest-100 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-forest-600" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-timber-dark flex items-center gap-2">
                          {provider.name}
                          {isLastUsed && (
                            <span className="text-xs bg-forest-500 text-white px-2 py-0.5 rounded-full">
                              Zuletzt verwendet
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-timber-gray">
                          {provider.description}
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-timber-gray" />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom Provider */}
            <div className="border-t border-gray-200 pt-4">
              {showCustomInput ? (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-timber-dark">
                    Eigener OIDC Provider
                  </label>
                  <input
                    type="url"
                    value={customIssuer}
                    onChange={(e) => setCustomIssuer(e.target.value)}
                    placeholder="https://your-solid-server.example"
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-forest-500 focus:border-forest-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowCustomInput(false)}
                      className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={handleCustomLogin}
                      disabled={!customIssuer.trim()}
                      className="flex-1 px-4 py-2 bg-forest-600 text-white rounded-lg hover:bg-forest-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Anmelden
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCustomInput(true)}
                  className="w-full text-center text-sm text-forest-600 hover:text-forest-700 font-medium"
                >
                  Anderen Provider verwenden...
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
