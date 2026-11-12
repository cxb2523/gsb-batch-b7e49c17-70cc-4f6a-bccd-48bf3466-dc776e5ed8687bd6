import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAnalyticsAllowed,
  syncAnalyticsScript,
  UMAMI_TRACKER_ATTR,
  UMAMI_TRACKER_VAL,
} from './analytics';

describe('analytics module (H2: route safety and attributes)', () => {
  const umamiConfig = {
    websiteId: 'test-website-id-123',
    hostUrl: 'https://umami.example.com',
  };

  beforeEach(() => {
    document.head.innerHTML = '';
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('allows analytics only on non-canvas and non-share routes', () => {
    expect(isAnalyticsAllowed('/')).toBe(true);
    expect(isAnalyticsAllowed('/login')).toBe(true);
    expect(isAnalyticsAllowed('/security')).toBe(true);
    expect(isAnalyticsAllowed('/privacy')).toBe(true);
    expect(isAnalyticsAllowed('/terms')).toBe(true);
    expect(isAnalyticsAllowed('/docs/architecture')).toBe(true);

    // Forbidden routes where keys/decrypted content could be exposed
    expect(isAnalyticsAllowed('/share/token123')).toBe(false);
    expect(isAnalyticsAllowed('/share/abc-xyz#key=secret')).toBe(false);
    expect(isAnalyticsAllowed('/w/team/canvas/board-456')).toBe(false);
    expect(isAnalyticsAllowed('/canvas/board-789')).toBe(false);
  });

  it('injects script with required privacy attributes on allowed routes', () => {
    syncAnalyticsScript('/security', umamiConfig);

    const script = document.querySelector<HTMLScriptElement>(
      `script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`,
    );
    expect(script).not.toBeNull();
    expect(script?.src).toBe('https://umami.example.com/script.js');
    expect(script?.getAttribute('data-website-id')).toBe('test-website-id-123');
    expect(script?.getAttribute('data-exclude-hash')).toBe('true');
    expect(script?.getAttribute('data-do-not-track')).toBe('true');
  });

  it('refuses to inject script on public share view or canvas editor routes even when configured', () => {
    syncAnalyticsScript('/share/token-xyz', umamiConfig);
    expect(
      document.querySelector(`script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`),
    ).toBeNull();

    syncAnalyticsScript('/w/my-org/canvas/board-123', umamiConfig);
    expect(
      document.querySelector(`script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`),
    ).toBeNull();
  });

  it('removes existing analytics script if user navigates onto a forbidden canvas or share route', () => {
    // 1. User loads landing page -> script is injected
    syncAnalyticsScript('/', umamiConfig);
    expect(
      document.querySelector(`script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`),
    ).not.toBeNull();

    // 2. User navigates to share link -> script is removed
    syncAnalyticsScript('/share/token-999', umamiConfig);
    expect(
      document.querySelector(`script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`),
    ).toBeNull();

    // 3. User navigates back to /privacy -> script is injected
    syncAnalyticsScript('/privacy', umamiConfig);
    expect(
      document.querySelector(`script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`),
    ).not.toBeNull();

    // 4. User navigates into canvas editor -> script is removed
    syncAnalyticsScript('/w/acme/canvas/board-001', umamiConfig);
    expect(
      document.querySelector(`script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`),
    ).toBeNull();
  });

  it('does nothing when analytics is not configured', () => {
    syncAnalyticsScript('/', null);
    expect(
      document.querySelector(`script[${UMAMI_TRACKER_ATTR}="${UMAMI_TRACKER_VAL}"]`),
    ).toBeNull();
  });
});
