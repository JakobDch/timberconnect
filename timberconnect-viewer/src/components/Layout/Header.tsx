import { Shield, Menu, X, Info, ExternalLink, LogIn, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../auth/AuthContext';
import { LoginModal } from '../Auth/LoginModal';
import { UserMenu } from '../Auth/UserMenu';

interface HeaderProps {
  onLogoClick?: () => void;
}

export function Header({ onLogoClick }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const { isLoggedIn, isLoading } = useAuth();

  return (
    <>
      <header className="bg-white/95 backdrop-blur-md border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 lg:h-18">
            {/* Logo */}
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={onLogoClick}
            >
              <img
                src="/timberconnect/TimberConnect Logo2.png"
                alt="TimberConnect"
                className="h-14 w-auto transition-transform group-hover:scale-[1.02]"
              />
            </div>

            {/* Right side: Auth + Menu Button */}
            <div className="flex items-center gap-3">
              {/* Auth Status / Login - always visible */}
              {isLoading ? (
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-full">
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                  <span className="text-sm text-gray-500">Laden...</span>
                </div>
              ) : isLoggedIn ? (
                <div className="flex items-center gap-3">
                  {/* Connected Badge */}
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-forest-50 border border-forest-200 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-forest-500" />
                    <Shield className="w-3.5 h-3.5 text-forest-600" />
                    <span className="text-xs font-medium text-forest-700">
                      Verbunden
                    </span>
                  </div>
                  {/* User Menu */}
                  <UserMenu />
                </div>
              ) : (
                <button
                  onClick={() => setLoginModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-forest-600 hover:bg-forest-700 text-white rounded-xl font-medium transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Anmelden</span>
                </button>
              )}

              {/* Menu button - always visible */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="btn btn-ghost btn-sm p-2"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6 text-timber-dark" />
                ) : (
                  <Menu className="w-6 h-6 text-timber-dark" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border-t border-gray-100 bg-white"
            >
              <div className="px-4 py-4 space-y-3">
                {/* Auth Status - only show on mobile since it's already in header on desktop */}
                <div className="sm:hidden">
                  {isLoggedIn ? (
                    <div className="flex items-center justify-between px-4 py-3 bg-forest-50 border border-forest-200 rounded-xl">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-forest-500" />
                        <Shield className="w-4 h-4 text-forest-600" />
                        <span className="text-sm font-medium text-forest-700">
                          Solid Pod verbunden
                        </span>
                      </div>
                      <UserMenu />
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setLoginModalOpen(true);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-forest-600 hover:bg-forest-700 text-white rounded-xl font-medium transition-colors"
                    >
                      <LogIn className="w-5 h-5" />
                      <span>Mit Solid Pod anmelden</span>
                    </button>
                  )}
                </div>

                {/* Links */}
                <a
                  href="https://timberconnect.2e94cc17.nip.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <Info className="w-5 h-5 text-timber-gray" />
                  <span className="font-medium text-timber-dark">Ueber TimberConnect</span>
                  <ExternalLink className="w-4 h-4 text-timber-gray ml-auto" />
                </a>

                <a
                  href="https://timberconnect.2e94cc17.nip.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <ExternalLink className="w-5 h-5 text-timber-gray" />
                  <span className="font-medium text-timber-dark">Dokumentation</span>
                  <ExternalLink className="w-4 h-4 text-timber-gray ml-auto" />
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Login Modal */}
      <LoginModal
        isOpen={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
      />
    </>
  );
}
