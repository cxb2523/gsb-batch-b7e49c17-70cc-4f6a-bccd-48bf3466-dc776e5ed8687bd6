import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getApiBaseUrl } from './api-url';

describe('getApiBaseUrl', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses explicit VITE_API_URL when set', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.custom-canv.com');
    expect(getApiBaseUrl()).toBe('https://api.custom-canv.com');
  });

  it('falls back to http://localhost:3000 when running on Vite dev port 5173', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        origin: 'http://localhost:5173',
        port: '5173',
      },
    });

    expect(getApiBaseUrl()).toBe('http://localhost:3000');
  });

  it('uses window.location.origin in production unified container (same-origin, 0 CORS overhead)', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        origin: 'https://canv.company.internal',
        port: '',
      },
    });

    expect(getApiBaseUrl()).toBe('https://canv.company.internal');
  });
});
