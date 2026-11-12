import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { ShieldCheck, UserCheck, Sparkles } from 'lucide-react';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { CanvLogo } from '@/components/CanvLogo';
import { useAuthConfig } from '@/lib/auth-config';
import { errorMessage } from '@/lib/errors';
import { devLogin } from '@/features/user/api';

export function Login() {
  const [searchParams] = useSearchParams();
  const urlError =
    searchParams.get('error_description') ||
    searchParams.get('message') ||
    searchParams.get('error') ||
    '';
  const [error, setError] = useState(urlError);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const { config, isLoading: isConfigLoading } = useAuthConfig();
  const navigate = useNavigate();

  const providers = config?.providers || [];
  const isDemo = Boolean(config?.demoMode);
  const isDevLogin = config
    ? config.devLoginEnabled
    : import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_LOGIN === 'true';
  const allowSignups = config?.allowSignups ?? true;
  // Nobody sets up an administrator on a demo, even though its database is empty after each wipe.
  const isFirstAccountSetup = !isDemo && (config?.isFirstAccountSetup ?? false);

  const handleDemoLogin = async () => {
    try {
      setLoadingProvider('demo');
      setError('');
      const res = await authClient.signIn.anonymous();
      if (res?.error) {
        throw new Error(res.error.message || 'Failed to start demo session');
      }
      const targetUrl = '/workspace';
      void navigate(targetUrl);
      if (typeof window !== 'undefined') {
        window.location.href = targetUrl;
      }
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to start demo session.');
      setLoadingProvider(null);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'github' | 'microsoft') => {
    try {
      setLoadingProvider(provider);
      setError('');

      await authClient.signIn.social({
        provider,
        callbackURL: `${window.location.origin}/workspace`,
      });
    } catch (err) {
      setError(errorMessage(err) ?? `Failed to sign in with ${provider}. Please try again.`);
      setLoadingProvider(null);
    }
  };

  const handleDevLogin = async (email = 'q@local.com', name = 'Qarib') => {
    try {
      setLoadingProvider('dev');
      setError('');
      await devLogin({ email, name });

      const targetUrl = '/workspace';

      void navigate(targetUrl);
      if (typeof window !== 'undefined') {
        window.location.href = targetUrl;
      }
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to log in with test account.');
      setLoadingProvider(null);
    }
  };

  return (
    <div className="bg-paper min-h-screen font-sans text-ink antialiased flex flex-col justify-between selection:bg-ink selection:text-white">
      {/* Unified Public Header */}
      <PublicHeader fixed={true} />

      {/* Main Viewport */}
      <main className="flex-1 flex items-center justify-center pt-24 sm:pt-28 pb-16 px-4 sm:px-8 relative">
        <div className="w-full max-w-[1100px] mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] gap-10 lg:gap-16 items-center">
          {/* Left Hero Copy */}
          <div className="max-w-[520px]">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-4">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span>Your space, ready when you are</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-ink leading-[1.12] mb-5">
              Good ideas find
              <br />
              <span className="font-serif italic font-normal text-brand">their way back.</span>
            </h1>
            <p className="text-sm sm:text-base text-ink-prose leading-[1.8] max-w-lg mb-8">
              Sign in to pick up where you left off. Your boards, diagrams, and shared thinking are
              right where you left them.
            </p>

            <div className="grid gap-4 pt-2">
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg border border-border bg-white flex items-center justify-center text-brand text-base shrink-0 shadow-2xs">
                  ◇
                </div>
                <div>
                  <strong className="block text-xs font-semibold text-ink mb-0.5">
                    Private by design
                  </strong>
                  <span className="text-xs text-ink-muted leading-relaxed">
                    Your workspace stays yours, with clear security and client encryption at every
                    step.
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg border border-border bg-white flex items-center justify-center text-brand text-base shrink-0 shadow-2xs">
                  ↗
                </div>
                <div>
                  <strong className="block text-xs font-semibold text-ink mb-0.5">
                    Open by nature
                  </strong>
                  <span className="text-xs text-ink-muted leading-relaxed">
                    Open-source foundations, with zero vendor lock-in.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Auth Card */}
          <div className="w-full bg-white border border-border rounded-2xl p-6 sm:p-8 shadow-[0_10px_30px_rgba(29,44,59,0.045)] relative">
            {/* Mobile Logo Header */}
            <div className="flex items-center gap-2.5 mb-5 lg:hidden">
              <Link to="/" className="flex items-center gap-2.5 group" aria-label="CanvHQ home">
                <CanvLogo className="w-7 h-7 shrink-0 transition-transform group-hover:scale-105" />
                <span className="text-lg font-bold tracking-tight text-ink">CanvHQ</span>
              </Link>
            </div>

            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-1">
              Welcome back
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-ink mb-1">Welcome to CanvHQ</h2>
            <p className="text-xs text-ink-muted mb-6">
              Sign in or create an account with your work provider
            </p>

            {error && (
              <div className="mb-4 p-3 bg-danger-soft border border-danger-soft-border text-danger-muted text-xs font-medium rounded-lg">
                {error}
              </div>
            )}

            {isFirstAccountSetup && (
              <div className="mb-4 p-3.5 bg-avatar-blue-bg border border-border-strong text-ink-tertiary text-xs rounded-lg">
                <div className="font-semibold mb-0.5 flex items-center gap-1.5">
                  <span>First Account Setup</span>
                </div>
                <p className="text-ink-tertiary leading-relaxed">
                  Welcome to your new CanvHQ instance. Sign in below to set up the initial
                  administrator account.
                </p>
              </div>
            )}

            {isDemo ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  disabled={!!loadingProvider}
                  className="w-full h-11 px-4 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer disabled:opacity-50 shadow-2xs hover:-translate-y-0.5"
                >
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>{loadingProvider === 'demo' ? 'Starting demo...' : 'Try the demo'}</span>
                </button>
                <p className="text-xs text-ink-muted text-center leading-relaxed">
                  Explore CanvHQ with a temporary throwaway account. All data is wiped nightly.
                </p>
              </div>
            ) : (
              <>
                {!isFirstAccountSetup && !allowSignups && (
                  <div className="mb-4 p-3.5 bg-warning-subtle border border-warning-callout-border text-warning-callout-text text-xs rounded-lg">
                    <div className="font-semibold mb-0.5 flex items-center gap-1.5">
                      <span>Invite-Only Instance</span>
                    </div>
                    <p className="text-warning leading-relaxed">
                      Public signups are disabled. Existing users can sign in below. New members
                      must receive an invitation link.
                    </p>
                  </div>
                )}

                {/* Social Auth Buttons */}
                <div className="flex flex-col gap-2.5">
                  {providers.includes('google') && (
                    <button
                      type="button"
                      onClick={() => handleSocialLogin('google')}
                      disabled={!!loadingProvider}
                      className="w-full h-10 px-3.5 bg-white hover:bg-surface-warm text-ink border border-border hover:border-border-strong text-xs font-semibold rounded-lg flex items-center justify-between transition-all duration-150 cursor-pointer disabled:opacity-50 group shadow-2xs hover:-translate-y-0.5"
                    >
                      <div className="flex items-center gap-3">
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                          />
                        </svg>
                        <span>
                          {loadingProvider === 'google'
                            ? 'Connecting to Google...'
                            : 'Continue with Google'}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-ink-subtle group-hover:text-ink-muted">
                        OAUTH
                      </span>
                    </button>
                  )}

                  {providers.includes('github') && (
                    <button
                      type="button"
                      onClick={() => handleSocialLogin('github')}
                      disabled={!!loadingProvider}
                      className="w-full h-10 px-3.5 bg-white hover:bg-surface-warm text-ink border border-border hover:border-border-strong text-xs font-semibold rounded-lg flex items-center justify-between transition-all duration-150 cursor-pointer disabled:opacity-50 group shadow-2xs hover:-translate-y-0.5"
                    >
                      <div className="flex items-center gap-3">
                        <svg className="w-4 h-4 shrink-0 fill-ink" viewBox="0 0 24 24">
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                          />
                        </svg>
                        <span>
                          {loadingProvider === 'github'
                            ? 'Connecting to GitHub...'
                            : 'Continue with GitHub'}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-ink-subtle group-hover:text-ink-muted">
                        OAUTH
                      </span>
                    </button>
                  )}

                  {providers.includes('microsoft') && (
                    <button
                      type="button"
                      onClick={() => handleSocialLogin('microsoft')}
                      disabled={!!loadingProvider}
                      className="w-full h-10 px-3.5 bg-white hover:bg-surface-warm text-ink border border-border hover:border-border-strong text-xs font-semibold rounded-lg flex items-center justify-between transition-all duration-150 cursor-pointer disabled:opacity-50 group shadow-2xs hover:-translate-y-0.5"
                    >
                      <div className="flex items-center gap-3">
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 23 23">
                          <path fill="#f35325" d="M1 1h10v10H1z" />
                          <path fill="#81bc06" d="M12 1h10v10H12z" />
                          <path fill="#05a6f0" d="M1 12h10v10H1z" />
                          <path fill="#ffba08" d="M12 12h10v10H12z" />
                        </svg>
                        <span>
                          {loadingProvider === 'microsoft'
                            ? 'Connecting to Microsoft...'
                            : 'Continue with Microsoft'}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-ink-subtle group-hover:text-ink-muted">
                        OAUTH
                      </span>
                    </button>
                  )}

                  {!isConfigLoading && providers.length === 0 && !isDevLogin && (
                    <div className="p-3 bg-warning-subtle border border-warning-callout-border text-warning-callout-text text-xs font-mono rounded-lg">
                      No OAuth providers configured on this instance. Please contact the
                      administrator.
                    </div>
                  )}
                </div>

                {/* Dev Test Account Login */}
                {isDevLogin && (
                  <div className="mt-6 pt-5 border-t border-border flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase text-ink-muted font-semibold tracking-wider flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-success" />
                        Local Development Bypass
                      </span>
                      <span className="font-mono text-[9px] text-brand-strong bg-brand-subtle border border-brand-tile px-1.5 py-0.5 rounded font-medium">
                        DEV MODE
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDevLogin('q@local.com', 'Qarib')}
                      disabled={!!loadingProvider}
                      className="w-full h-10 px-3.5 bg-ink hover:bg-ink-hover text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer disabled:opacity-50 shadow-2xs hover:-translate-y-0.5"
                    >
                      <UserCheck className="w-4 h-4 text-white" />
                      <span>
                        {loadingProvider === 'dev'
                          ? 'Logging in...'
                          : 'Login with Test Account (q@local.com)'}
                      </span>
                    </button>
                    <p className="text-[11px] text-ink-muted leading-relaxed mt-1 text-center">
                      Quick access for local testing and demonstration environments.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Legal & Terms Footer */}
            <div className="w-full text-center mt-6 pt-4 border-t border-border">
              <p className="text-xs text-ink-muted leading-relaxed">
                By continuing, you agree to the{' '}
                <Link
                  to="/terms"
                  className="underline hover:text-ink transition-colors font-medium"
                >
                  Terms and Conditions
                </Link>{' '}
                and{' '}
                <Link
                  to="/privacy"
                  className="underline hover:text-ink transition-colors font-medium"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Persistent Bottom Public Footer */}
      <PublicFooter />
    </div>
  );
}
