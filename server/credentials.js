import fs from 'fs';
import os from 'os';
import path from 'path';

// Credentials live outside the repo and are never committed. The default
// location mirrors Claude Code's own OAuth credential file.
const DEFAULT_CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

export function readCredentials(filePath = DEFAULT_CREDENTIALS_PATH) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.claudeAiOauth || null;
  } catch {
    // Missing file or malformed JSON: treat as not logged in.
    return null;
  }
}

export function getAccessToken(filePath = DEFAULT_CREDENTIALS_PATH) {
  const creds = readCredentials(filePath);
  if (!creds?.accessToken) return null;
  if (creds.expiresAt && creds.expiresAt <= Date.now()) return null;
  return creds.accessToken;
}

function planFromCredentials(creds) {
  const tier = creds?.rateLimitTier || '';
  if (tier.includes('max_20x')) return 'max20x';
  if (tier.includes('max_5x')) return 'max5x';
  if (creds?.subscriptionType === 'pro') return 'pro';
  return null;
}

export function getSubscriptionInfo(filePath = DEFAULT_CREDENTIALS_PATH) {
  const creds = readCredentials(filePath);
  if (!creds) return null;
  return {
    plan: planFromCredentials(creds),
    subscriptionType: creds.subscriptionType || null,
    rateLimitTier: creds.rateLimitTier || null,
  };
}
