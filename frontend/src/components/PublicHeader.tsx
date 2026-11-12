import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { CanvLogo } from '@/components/CanvLogo';

interface PublicHeaderProps {
  breadcrumb?: ReactNode;
  rightSlot?: ReactNode;
  fixed?: boolean;
  hideAuthActions?: boolean;
}

export function PublicHeader({
  breadcrumb,
  rightSlot,
  fixed = false,
  hideAuthActions = false,
}: PublicHeaderProps) {
  const { pathname } = useLocation();

  const shouldHideAuth =
    hideAuthActions || pathname === '/create-workspace' || pathname === '/setup-passphrase';

  return (
    <header
      className={`${fixed ? 'fixed top-0 left-0 right-0 z-40' : 'w-full'} bg-white/90 backdrop-blur-md border-b border-border`}
    >
      <div className="h-14 sm:h-16 w-full max-w-[94rem] mx-auto px-4 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link to="/" className="flex items-center gap-2.5 group" aria-label="CanvHQ home">
            <CanvLogo className="w-6 h-6 shrink-0 transition-transform group-hover:scale-105" />
            <span className="text-[17px] font-bold tracking-[-0.035em] text-ink">CanvHQ</span>
          </Link>

          {breadcrumb && (
            <>
              <span className="text-border-strong">/</span>
              {breadcrumb}
            </>
          )}

          {!rightSlot && (
            <nav className="hidden md:flex items-center gap-1.5" aria-label="Main navigation">
              <Link
                to="/"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  pathname === '/'
                    ? 'bg-ink text-white font-semibold active'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-2'
                }`}
              >
                Overview
              </Link>
              <Link
                to="/docs"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  pathname.startsWith('/docs')
                    ? 'bg-ink text-white font-semibold active'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-2'
                }`}
              >
                Documentation
              </Link>
              <Link
                to="/security"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  pathname === '/security'
                    ? 'bg-ink text-white font-semibold active'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-2'
                }`}
              >
                Security
              </Link>
            </nav>
          )}
        </div>

        {rightSlot ? (
          <div className="flex items-center gap-2 sm:gap-3">{rightSlot}</div>
        ) : shouldHideAuth ? null : (
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="px-3 py-1.5 text-xs font-semibold text-ink hover:text-ink-prose transition-colors"
            >
              Log in
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-ink hover:bg-ink-hover rounded-lg shadow-xs transition-all hover:-translate-y-0.5 active:translate-y-0"
            >
              <span>Get Started</span>
              <span className="text-xs">↗</span>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
