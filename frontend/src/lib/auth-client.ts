import { createAuthClient } from 'better-auth/react';
import { organizationClient, anonymousClient } from 'better-auth/client/plugins';
import { getApiBaseUrl } from './api-url';

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
  plugins: [organizationClient(), anonymousClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
