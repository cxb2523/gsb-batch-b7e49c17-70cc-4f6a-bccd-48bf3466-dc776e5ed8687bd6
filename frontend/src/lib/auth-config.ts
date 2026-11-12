import { useState, useEffect } from 'react';
import { getAuthConfig as fetchAuthConfigFromApi } from '@/features/user/api';
import type { AuthConfig } from '@/features/user/schemas';

export type { AuthConfig };

let cachedConfig: AuthConfig | null = null;
let fetchPromise: Promise<AuthConfig> | null = null;

export function clearAuthConfigCache() {
  cachedConfig = null;
  fetchPromise = null;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = fetchAuthConfigFromApi()
    .then((data) => {
      const resolved: AuthConfig = {
        devLoginEnabled: typeof data.devLoginEnabled === 'boolean' ? data.devLoginEnabled : false,
        demoMode: typeof data.demoMode === 'boolean' ? data.demoMode : false,
        allowSignups: typeof data.allowSignups === 'boolean' ? data.allowSignups : true,
        isFirstAccountSetup:
          typeof data.isFirstAccountSetup === 'boolean' ? data.isFirstAccountSetup : false,
        providers: Array.isArray(data.providers) ? data.providers : [],
        analytics: data.analytics,
        operator: data.operator,
      };
      cachedConfig = resolved;
      return resolved;
    })
    .catch(() => {
      // Not a user action: when the config cannot be read the login page degrades to sign-in
      // defaults rather than blocking, so there is nothing to report.
      const fallback: AuthConfig = {
        devLoginEnabled: false,
        demoMode: false,
        allowSignups: true,
        isFirstAccountSetup: false,
        providers: [],
      };
      cachedConfig = fallback;
      return fallback;
    })
    .finally(() => {
      fetchPromise = null;
    });

  return fetchPromise;
}

export function useAuthConfig() {
  const [config, setConfig] = useState<AuthConfig | null>(cachedConfig);
  const [isLoading, setIsLoading] = useState(!cachedConfig);

  useEffect(() => {
    let mounted = true;
    void getAuthConfig().then((cfg) => {
      if (mounted) {
        setConfig(cfg);
        setIsLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return { config, isLoading };
}
