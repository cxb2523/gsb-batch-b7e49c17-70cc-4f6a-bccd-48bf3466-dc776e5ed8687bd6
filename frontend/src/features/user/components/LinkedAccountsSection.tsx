import { Key } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '@/lib/auth-client';
import { useAuthConfig } from '@/lib/auth-config';
import { errorMessage } from '@/lib/errors';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { unlinkAccount } from '../api';
import { useFeedback } from '../hooks/useFeedback';
import { userKeys } from '../keys';
import { useLinkedAccounts } from '../queries';
import { FeedbackBanner } from './FeedbackBanner';
import { ProfileSectionCard } from './ProfileSectionCard';

const KNOWN_PROVIDERS: Record<string, { label: string; icon: string }> = {
  google: { label: 'Google', icon: 'G' },
  github: { label: 'GitHub', icon: 'GH' },
  microsoft: { label: 'Microsoft', icon: 'MS' },
};

function describeProvider(id: string) {
  return {
    id,
    label: KNOWN_PROVIDERS[id]?.label || id.charAt(0).toUpperCase() + id.slice(1),
    icon: KNOWN_PROVIDERS[id]?.icon || id.charAt(0).toUpperCase(),
  };
}

interface DisconnectButtonProps {
  label: string;
  locked: boolean;
  onClick: () => void;
}

function DisconnectButton({ label, locked, onClick }: DisconnectButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      title={locked ? 'At least one login provider is required' : label}
      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
        locked
          ? 'bg-surface-2 text-ink-subtle cursor-not-allowed border border-border'
          : 'bg-danger-subtle text-danger hover:bg-danger-light border border-danger-border cursor-pointer'
      }`}
    >
      Disconnect
    </button>
  );
}

export function LinkedAccountsSection() {
  const queryClient = useQueryClient();
  const { config: authConfig } = useAuthConfig();
  const { data: accounts = [], isPending, isError, error, refetch } = useLinkedAccounts();
  const { feedback, showError, showSuccess, clear } = useFeedback();

  const devLoginEnabled = Boolean(authConfig?.devLoginEnabled);
  // The last login method can only be removed on dev servers, where the test account is a fallback.
  const isLastLoginMethod = accounts.length <= 1 && !devLoginEnabled;

  const connectedProviderIds = accounts
    .map((a) => a.providerId.toLowerCase())
    .filter((id) => id !== 'credential');
  const supportedProviders = Array.from(
    new Set([...(authConfig?.providers ?? []), ...connectedProviderIds]),
  ).map(describeProvider);
  const credentialAccount = accounts.find((a) => a.providerId.toLowerCase() === 'credential');

  const handleConnect = async (providerId: string) => {
    clear();
    try {
      await authClient.linkSocial({
        provider: providerId,
        callbackURL: window.location.origin + '/profile',
      });
    } catch (err) {
      showError(errorMessage(err) ?? `Failed to initiate connection to ${providerId}`);
    }
  };

  const handleUnlink = async (providerId: string) => {
    if (isLastLoginMethod) {
      showError('At least one login provider must remain connected.');
      return;
    }

    clear();
    try {
      await unlinkAccount(providerId);
      await queryClient.invalidateQueries({ queryKey: userKeys.linkedAccounts() });
      showSuccess(`Disconnected ${providerId} successfully.`);
    } catch (err) {
      showError(errorMessage(err) ?? `Failed to disconnect ${providerId}`);
    }
  };

  return (
    <ProfileSectionCard
      id="providers"
      title="Connected Accounts"
      icon={<Key className="w-4 h-4" />}
      badge={<span className="font-mono text-[11px] text-ink-muted">{accounts.length} linked</span>}
    >
      <p className="text-xs text-ink-muted -mt-2">
        Social identity providers linked to your CanvHQ account. At least one login provider must
        remain connected.
      </p>

      <FeedbackBanner feedback={feedback} />

      {isPending ? (
        <LoadingState message="Loading connected accounts..." />
      ) : isError ? (
        <ErrorState
          message={errorMessage(error) ?? 'Could not load your connected accounts.'}
          onRetry={() => void refetch()}
        />
      ) : (
        <div className="flex flex-col divide-y divide-border-subtle">
          {credentialAccount && (
            <div className="py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-ink text-white flex items-center justify-center font-bold text-xs font-mono">
                  {devLoginEnabled ? 'DEV' : 'PWD'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-ink">
                      {devLoginEnabled ? 'Development Test Account' : 'Password Authentication'}
                    </h3>
                    <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 bg-surface-2 text-ink-muted rounded-md border border-border-subtle">
                      {devLoginEnabled ? 'LOCAL DEV ONLY' : 'CREDENTIAL'}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-subtle">Connected</p>
                </div>
              </div>
              <DisconnectButton
                label="Disconnect credential login"
                locked={isLastLoginMethod}
                onClick={() => void handleUnlink('credential')}
              />
            </div>
          )}

          {supportedProviders.map((p) => {
            const connected = accounts.some((a) => a.providerId.toLowerCase() === p.id);
            return (
              <div key={p.id} className="py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-paper border border-border flex items-center justify-center font-bold text-xs text-ink font-mono">
                    {p.icon}
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-ink">{p.label}</h3>
                    <p className="text-[11px] text-ink-subtle">
                      {connected ? 'Connected' : 'Not connected'}
                    </p>
                  </div>
                </div>

                {connected ? (
                  <DisconnectButton
                    label={`Disconnect ${p.label}`}
                    locked={isLastLoginMethod}
                    onClick={() => void handleUnlink(p.id)}
                  />
                ) : (
                  <Button size="sm" onClick={() => void handleConnect(p.id)}>
                    Connect
                  </Button>
                )}
              </div>
            );
          })}

          {supportedProviders.length === 0 && !credentialAccount && (
            <div className="py-3 text-xs text-ink-subtle italic font-mono">
              No login providers are configured on this server instance.
            </div>
          )}
        </div>
      )}
    </ProfileSectionCard>
  );
}
