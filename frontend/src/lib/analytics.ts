import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getAuthConfig } from './auth-config';

export const UMAMI_TRACKER_ATTR = 'data-umami-tracker';
export const UMAMI_TRACKER_VAL = 'canvhq';

export function isAnalyticsAllowed(pathname: string): boolean {
  if (pathname.startsWith('/share/')) {
    return false;
  }
  if (/\/canvas(\/|$)/.test(pathname)) {
    return false;
  }
  return true;
}

export function syncAnalyticsScript(
  pathname: string,
  umami?: { websiteId: string; hostUrl: string } | null,
): void {
  const existing = document.querySelector<HTMLScriptElement>(
    `script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`,
  );

  if (!isAnalyticsAllowed(pathname) || !umami?.websiteId || !umami?.hostUrl) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  if (!existing) {
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = `${umami.hostUrl.replace(/\/$/, '')}/script.js`;
    script.setAttribute('data-website-id', umami.websiteId);
    script.setAttribute(UMAMI_TRACKER_ATTR, UMAMI_TRACKER_VAL);
    script.setAttribute('data-exclude-hash', 'true');
    script.setAttribute('data-do-not-track', 'true');
    document.head.appendChild(script);
  }
}

export function useAnalytics(): void {
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    void getAuthConfig().then((config) => {
      if (cancelled) return;
      syncAnalyticsScript(location.pathname, config.analytics?.umami);
    });

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);
}
