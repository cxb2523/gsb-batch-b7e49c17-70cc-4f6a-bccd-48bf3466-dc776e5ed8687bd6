import { http, httpRequest, validateResponse } from '@/lib/http';
import {
  EncryptionParamsSchema,
  EncryptionSetupInputSchema,
  EncryptionPassphraseInputSchema,
  UserPublicKeySchema,
  UserProfileSchema,
  UpdateUserProfileInputSchema,
  LinkedAccountsListSchema,
  OwnedWorkspacesListSchema,
  UserMetricsSchema,
  AuthConfigSchema,
  DevLoginInputSchema,
  SuccessResultSchema,
  type EncryptionParams,
  type EncryptionSetupInput,
  type EncryptionPassphraseInput,
  type UserPublicKey,
  type UserProfile,
  type UpdateUserProfileInput,
  type LinkedAccount,
  type OwnedWorkspace,
  type UserMetrics,
  type AuthConfig,
  type DevLoginInput,
  type SuccessResult,
} from './schemas';

export async function getEncryptionParams(): Promise<EncryptionParams> {
  const data = await http.get('/api/user/encryption-params');
  return validateResponse(EncryptionParamsSchema, data, 'GET /api/user/encryption-params');
}

export async function setupEncryption(input: EncryptionSetupInput): Promise<SuccessResult> {
  EncryptionSetupInputSchema.parse(input);
  const data = await http.post('/api/user/encryption-setup', input);
  return validateResponse(SuccessResultSchema, data, 'POST /api/user/encryption-setup');
}

export async function updateEncryptionPassphrase(
  input: EncryptionPassphraseInput,
): Promise<SuccessResult> {
  EncryptionPassphraseInputSchema.parse(input);
  const data = await http.put('/api/user/encryption-passphrase', input);
  return validateResponse(SuccessResultSchema, data, 'PUT /api/user/encryption-passphrase');
}

export async function getUserPublicKey(userId: string): Promise<UserPublicKey> {
  const data = await http.get(`/api/user/public-key/${userId}`);
  return validateResponse(UserPublicKeySchema, data, `GET /api/user/public-key/${userId}`);
}

export async function updateUserProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
  UpdateUserProfileInputSchema.parse(input);
  const data = await http.patch('/api/user/profile', input);
  return validateResponse(UserProfileSchema, data, 'PATCH /api/user/profile');
}

export async function listLinkedAccounts(): Promise<LinkedAccount[]> {
  const data = await http.get('/api/user/accounts');
  return validateResponse(LinkedAccountsListSchema, data, 'GET /api/user/accounts');
}

export async function unlinkAccount(providerId: string): Promise<void> {
  await http.delete(`/api/user/accounts/${providerId}`);
}

export async function listOwnedWorkspaces(): Promise<OwnedWorkspace[]> {
  const data = await http.get('/api/user/owned-workspaces');
  return validateResponse(OwnedWorkspacesListSchema, data, 'GET /api/user/owned-workspaces');
}

export async function getUserMetrics(): Promise<UserMetrics> {
  const data = await http.get('/api/user/metrics');
  return validateResponse(UserMetricsSchema, data, 'GET /api/user/metrics');
}

export async function exportUserData(): Promise<Blob> {
  return await httpRequest<Blob>('/api/user/export-data', {
    responseType: 'blob',
  });
}

export async function deleteUserAccount(data?: {
  transfers?: Record<string, string>;
  confirmSoleDeletion?: boolean;
}): Promise<void> {
  await http.post('/api/user/delete-account', data ?? {});
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const data = await http.get('/api/auth/config');
  return validateResponse(AuthConfigSchema, data, 'GET /api/auth/config');
}

export async function devLogin(input: DevLoginInput): Promise<SuccessResult> {
  DevLoginInputSchema.parse(input);
  const data = await http.post('/api/auth/dev-login', input);
  return validateResponse(SuccessResultSchema, data, 'POST /api/auth/dev-login');
}
