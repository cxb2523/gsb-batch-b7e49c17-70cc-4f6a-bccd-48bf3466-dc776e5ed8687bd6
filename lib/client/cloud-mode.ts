"use client";

/**
 * Cloud storage mode detection + user-facing override.
 *
 * Cloud is available when the app was built/deployed with Supabase env vars.
 * The build step exposes `NEXT_PUBLIC_CLOUD_STORAGE_ENABLED` so the client
 * knows to render the toggle and hit /api/state.
 *
 * Users can still force local-only via a per-browser preference stored in
 * localStorage (key: "sovereign-cloud-sync"). This preserves the
 * local-first / BYOK spirit of the project.
 */

const CLOUD_PREF_KEY = "sovereign-cloud-sync";
const SYNC_SECRET_KEY = "sovereign-sync-secret";

/**
 * The shared secret used to authenticate against /api/state. The deployer sets
 * STATE_SYNC_SECRET in the environment and the user enters the same value once
 * in the Cloud Sync card; it is stored per-browser and never ships in the
 * bundle. Returns "" when unset so callers can send an (invalid) empty header.
 */
export function getSyncSecret(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SYNC_SECRET_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setSyncSecret(secret: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = secret.trim();
    if (trimmed) window.localStorage.setItem(SYNC_SECRET_KEY, trimmed);
    else window.localStorage.removeItem(SYNC_SECRET_KEY);
  } catch {
    /* ignore quota errors */
  }
}

export function isCloudAvailable(): boolean {
  // NEXT_PUBLIC_ vars are inlined at build time
  return process.env.NEXT_PUBLIC_CLOUD_STORAGE_ENABLED === "true";
}

export function isCloudEnabledByUser(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(CLOUD_PREF_KEY);
    // Default to "on" when cloud is available and no preference set yet.
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function setCloudEnabledByUser(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLOUD_PREF_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore quota errors */
  }
}

/** True when cloud is configured AND the user hasn't disabled it. */
export function isCloudActive(): boolean {
  return isCloudAvailable() && isCloudEnabledByUser();
}
