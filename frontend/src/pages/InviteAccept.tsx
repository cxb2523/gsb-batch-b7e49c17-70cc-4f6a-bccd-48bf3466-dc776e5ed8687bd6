import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession, signOut, authClient } from '@/lib/auth-client';
import { clearLocalKeyMaterial } from '@/lib/key-store';
import { useAuthConfig } from '@/lib/auth-config';
import { useKeyContext } from '@/context/KeyContext';
import { ArrowRight, Building2, AlertCircle, ShieldCheck, UserCheck } from 'lucide-react';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { errorMessage } from '@/lib/errors';
import { acceptPublicInvitation } from '@/features/members/api';
import { useInvitationRecipient, usePublicInvitation } from '@/features/members/queries';
import { WrongAccountNotice } from '@/features/members/components/WrongAccountNotice';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { devLogin } from '@/features/user/api';
import { ApiError } from '@/lib/http';

export function InviteAccept() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const { data: session, isPending: isSessionPending } = useSession();
  const { isInitialized } = useKeyContext();
  const navigate = useNavigate();
  const isDevLoginEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_LOGIN === 'true';

  const {
    data: invitation,
    isPending: loading,
    error: loadError,
    refetch: refetchInvitation,
  } = usePublicInvitation(inviteId);
  const [error, setError] = useState('');
  const [isAccepting, setIsAccepting] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const { config } = useAuthConfig();

  const providers = config?.providers || [];
  const isDevLogin = config ? config.devLoginEnabled : isDevLoginEnabled;

  const invite = invitation && {
    organizationName: invitation.organization?.name ?? invitation.organizationName ?? 'Workspace',
    role: invitation.role,
    inviterName: invitation.inviterName ?? invitation.inviterEmail ?? 'A team member',
    status: invitation.status,
  };
  const loadErrorMessage = loadError
    ? loadError instanceof ApiError
      ? loadError.message || 'This invitation link is not valid or has expired.'
      : 'Failed to load invitation. Please check your network connection.'
    : '';

  // Who is signed in is checked first: the wrong account is stopped before it sets up a passphrase.
  const recipient = useInvitationRecipient(inviteId, session?.user.id);
  const isRecipient = recipient.data === true;

  // Passphrase next: a signed-in invitee without an identity key goes to setup and comes back.
  useEffect(() => {
    if (!isSessionPending && session && isRecipient && isInitialized === false) {
      void navigate(`/setup-passphrase?next=${encodeURIComponent(`/invite/${inviteId ?? ''}`)}`, {
        replace: true,
      });
    }
  }, [isSessionPending, session, isRecipient, isInitialized, navigate, inviteId]);

  // Accept Invitation (when logged in and encryption initialized)
  const handleAcceptInvite = useCallback(async () => {
    if (!inviteId || !session) return;
    setIsAccepting(true);
    setError('');

    try {
      const data = await acceptPublicInvitation(inviteId);
      const targetSlug = data.workspaceSlug ?? data.organizationId ?? 'workspace';
      void navigate(`/w/${targetSlug}`);
      if (typeof window !== 'undefined') {
        window.location.href = `/w/${targetSlug}`;
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to accept invitation.');
      } else {
        setError('Network error while accepting invitation.');
      }
      setIsAccepting(false);
    }
  }, [inviteId, session, navigate]);

  // Accepting waits for the passphrase to be set up: while that is still unknown (`null`) or
  // needed (`false`), the invitee is not accepted, so the setup page is never torn down by the
  // reload that follows an acceptance.
  useEffect(() => {
    if (
      !isSessionPending &&
      session &&
      isRecipient &&
      invitation &&
      invitation.status !== 'expired' &&
      invitation.status !== 'revoked' &&
      isInitialized === true
    ) {
      void handleAcceptInvite();
    }
  }, [isSessionPending, session, isRecipient, invitation, isInitialized, handleAcceptInvite]);

  const handleSocialLogin = async (provider: 'google' | 'github' | 'microsoft') => {
    try {
      setLoadingProvider(provider);
      setError('');
      await authClient.signIn.social({
        provider,
        callbackURL: `${window.location.origin}/invite/${inviteId}`,
      });
    } catch (err) {
      setError(errorMessage(err) ?? `Failed to sign in with ${provider}.`);
      setLoadingProvider(null);
    }
  };

  const handleDevLogin = async (email = 'colleague@local.com', name = 'Colleague') => {
    try {
      setLoadingProvider('dev');
      setError('');
      await devLogin({ email, name });

      // Re-trigger acceptance
      window.location.reload();
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to log in with test account.');
      setLoadingProvider(null);
    }
  };

  const switchAccount = async () => {
    await clearLocalKeyMaterial();
    await signOut();
    // A full load, so nothing the other account fetched stays in memory.
    window.location.href = `/invite/${inviteId ?? ''}`;
  };

  /** What a signed-in visitor sees: nothing proceeds until the server confirms the invitation is theirs. */
  const renderSignedIn = (user: { name: string; email: string }) => {
    if (recipient.isError) {
      return (
        <ErrorState
          title="Could not check this invitation"
          message="We could not confirm that this invitation is for your account. Check your connection and try again."
          onRetry={() => void recipient.refetch()}
        />
      );
    }
    if (recipient.data === undefined) {
      return <LoadingState message="Checking this invitation..." />;
    }
    if (!recipient.data) {
      return (
        <WrongAccountNotice
          invitedAs={invitation?.emailHint}
          signedInAs={user.email}
          onSwitchAccount={() => void switchAccount()}
        />
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-ink-muted text-center">
          Signed in as <strong className="text-ink font-semibold">{user.name}</strong> ({user.email}
          ).
        </p>
        <button
          onClick={handleAcceptInvite}
          disabled={isAccepting}
          className="w-full h-11 bg-ink hover:bg-ink-hover text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-2xs transition-all cursor-pointer disabled:opacity-50"
        >
          <span>{isAccepting ? 'Joining workspace...' : 'Accept & Enter Workspace'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  };

  if (inviteId && loading) {
    return (
      <div className="bg-paper min-h-screen flex items-center justify-center">
        <LoadingState message="Loading invitation details..." />
      </div>
    );
  }

  return (
    <div className="bg-paper font-sans text-ink antialiased min-h-screen flex flex-col justify-between selection:bg-ink selection:text-white">
      {/* Unified Public Header */}
      <PublicHeader fixed={true} hideAuthActions={true} />

      {/* Main Viewport */}
      <main className="flex-1 flex items-center justify-center pt-24 sm:pt-28 pb-16 px-4 sm:px-6 relative">
        <div className="w-full max-w-[480px] mx-auto">
          {/* Eyebrow */}
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-3 px-1">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span>Collaborate securely</span>
          </div>

          {/* Invitation Editorial Card */}
          <div className="bg-white border border-border rounded-2xl p-6 sm:p-9 shadow-[0_10px_30px_rgba(29,44,59,0.045)] relative">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-1.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-success" />
              <span>Workspace Invitation</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink mb-1.5">
              Join your team on CanvHQ
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted leading-relaxed mb-6">
              You have been invited to collaborate on canvases and technical architecture.
            </p>

            {error && (
              <div className="mb-5 p-3.5 bg-danger-soft border border-danger-soft-border text-danger-muted text-xs rounded-xl font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {invite ? (
              <div className="flex flex-col gap-5">
                {/* Workspace Invitation Badge */}
                <div className="p-4 bg-surface rounded-xl border border-border flex flex-col gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-brand-subtle border border-brand-border text-brand-strong flex items-center justify-center shrink-0">
                      <Building2 className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-sm font-bold text-ink">{invite.organizationName}</span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] text-ink-muted pt-1 border-t border-surface-2">
                    <span>
                      Role:{' '}
                      <strong className="uppercase text-ink bg-surface-2 px-1.5 py-0.5 rounded text-[10px]">
                        {invite.role}
                      </strong>
                    </span>
                    <span>Invited by {invite.inviterName}</span>
                  </div>
                </div>

                {invite.status === 'expired' || invite.status === 'revoked' ? (
                  <div className="p-3.5 bg-warning-subtle border border-warning-border text-warning text-xs rounded-xl text-center font-medium">
                    {invite.status === 'expired'
                      ? 'This invitation link has expired. Please request a new invite from your workspace admin.'
                      : 'This invitation link is no longer valid. Please request a new invite from your workspace admin.'}
                  </div>
                ) : session ? (
                  renderSignedIn(session.user)
                ) : (
                  /* Unauthenticated User -> Social Login options */
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-ink-muted text-center">
                      Sign in with your work account to accept this invitation:
                    </p>

                    <div className="flex flex-col gap-2.5">
                      {providers.includes('google') && (
                        <button
                          type="button"
                          onClick={() => handleSocialLogin('google')}
                          disabled={!!loadingProvider}
                          className="w-full h-10 px-4 bg-white hover:bg-paper text-ink border border-border-strong hover:border-ink-subtle rounded-xl text-xs font-semibold flex items-center justify-center gap-2.5 shadow-2xs transition-all cursor-pointer"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24">
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
                          <span>Continue with Google</span>
                        </button>
                      )}

                      {providers.includes('github') && (
                        <button
                          type="button"
                          onClick={() => handleSocialLogin('github')}
                          disabled={!!loadingProvider}
                          className="w-full h-10 px-4 bg-github hover:bg-black text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2.5 shadow-2xs transition-all cursor-pointer"
                        >
                          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                            <path
                              fillRule="evenodd"
                              clipRule="evenodd"
                              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                            />
                          </svg>
                          <span>Continue with GitHub</span>
                        </button>
                      )}

                      {providers.includes('microsoft') && (
                        <button
                          type="button"
                          onClick={() => handleSocialLogin('microsoft')}
                          disabled={!!loadingProvider}
                          className="w-full h-10 px-4 bg-white hover:bg-paper text-ink border border-border-strong hover:border-ink-subtle rounded-xl text-xs font-semibold flex items-center justify-center gap-2.5 shadow-2xs transition-all cursor-pointer"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 23 23">
                            <path fill="#f35325" d="M1 1h10v10H1z" />
                            <path fill="#81bc06" d="M12 1h10v10H12z" />
                            <path fill="#05a6f0" d="M1 12h10v10H1z" />
                            <path fill="#ffba08" d="M12 12h10v10H12z" />
                          </svg>
                          <span>Continue with Microsoft</span>
                        </button>
                      )}
                    </div>

                    {/* Dev Test Login Bypass */}
                    {isDevLogin && (
                      <div className="mt-3 pt-3 border-t border-surface-2 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => handleDevLogin('colleague@local.com', 'Colleague (Test)')}
                          disabled={!!loadingProvider}
                          className="w-full h-9 px-3 bg-brand-subtle hover:bg-brand-subtle-hover text-brand-strong border border-brand-border rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-2xs"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-brand-strong" />
                          <span>Accept with Test Account (colleague@local.com)</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : loadError ? (
              <ErrorState
                title="Could not load the invitation"
                message={loadErrorMessage}
                onRetry={() => void refetchInvitation()}
              />
            ) : (
              <div className="py-6 text-center text-xs text-ink-subtle">Invitation not found.</div>
            )}
          </div>
        </div>
      </main>

      {/* Shared Footer */}
      <PublicFooter />
    </div>
  );
}
