import { betterAuth, APIError } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization, anonymous } from 'better-auth/plugins';
import { getIP } from 'better-auth/api';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { EnvConfig, OAuthProvider } from '../config/env.schema.js';

export const AUTH = Symbol('AUTH');

/**
 * The one header Better Auth reads the client address from. The auth route overwrites it with
 * Express's `req.ip`, which already follows `TRUST_PROXY`, so a client cannot choose its own address.
 */
export const CLIENT_IP_HEADER = 'x-canvhq-client-ip';

export const ALLOWED_ORGANIZATION_PATHS = [
  '/organization/list',
  '/organization/set-active',
] as const;

export const DISABLED_ORGANIZATION_PATHS = [
  '/organization/create',
  '/organization/update',
  '/organization/delete',
  '/organization/get-organization',
  '/organization/get-full-organization',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
  '/organization/get-invitation',
  '/organization/reject-invitation',
  '/organization/list-invitations',
  '/organization/get-active-member',
  '/organization/check-slug',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/leave',
  '/organization/list-user-invitations',
  '/organization/list-members',
  '/organization/get-active-member-role',
  '/organization/has-permission',
] as const;

/**
 * Every Better Auth core endpoint the product does not use. The route-allowlist integration test
 * compares this list with the endpoints the installed library actually registers, so a library
 * upgrade that adds a route fails until someone decides about it.
 */
export const DISABLED_CORE_PATHS = [
  '/account-info',
  '/change-email',
  '/change-password',
  '/delete-user',
  '/delete-user/callback',
  '/get-access-token',
  '/list-accounts',
  '/list-sessions',
  '/refresh-token',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/revoke-other-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/send-verification-email',
  '/sign-in/email',
  '/sign-up/email',
  '/unlink-account',
  '/update-session',
  '/update-user',
  '/verify-email',
  '/verify-password',
] as const;

/** The core endpoints the frontend legitimately calls. */
export const ALLOWED_CORE_PATHS = [
  '/ok',
  '/error',
  '/get-session',
  '/sign-out',
  '/sign-in/social',
  '/callback/:id',
  '/link-social',
] as const;

export function createAuth(configService: ConfigService<EnvConfig, true>, prisma: PrismaService) {
  const config = <K extends keyof EnvConfig>(key: K): EnvConfig[K] =>
    configService.get(key, { infer: true });
  const isProd = config('NODE_ENV') === 'production';

  const providerCredentials: Record<
    OAuthProvider,
    { clientId: string | undefined; clientSecret: string | undefined }
  > = {
    google: { clientId: config('GOOGLE_CLIENT_ID'), clientSecret: config('GOOGLE_CLIENT_SECRET') },
    github: { clientId: config('GITHUB_CLIENT_ID'), clientSecret: config('GITHUB_CLIENT_SECRET') },
    microsoft: {
      clientId: config('MICROSOFT_CLIENT_ID'),
      clientSecret: config('MICROSOFT_CLIENT_SECRET'),
    },
  };

  const isDemo = config('DEMO_MODE');

  const socialProviders: Partial<
    Record<OAuthProvider, { clientId: string; clientSecret: string }>
  > = {};
  if (!isDemo) {
    for (const provider of config('oauthProviders')) {
      const creds = providerCredentials[provider];
      if (creds.clientId && creds.clientSecret) {
        socialProviders[provider] = {
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
        };
      }
    }
  }

  const ipAddress = { ipAddressHeaders: [CLIENT_IP_HEADER] };

  return betterAuth({
    secret: config('AUTH_SECRET'),
    baseURL: config('AUTH_URL'),
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // Enforce signup-per-IP limit
            const limitSignups = config('LIMIT_SIGNUPS_PER_IP');
            const windowSeconds = config('LIMIT_SIGNUPS_WINDOW_SECONDS');

            const rawHeaders = ctx?.headers ?? ctx?.request?.headers;
            const headers =
              rawHeaders instanceof Headers
                ? rawHeaders
                : rawHeaders
                  ? new Headers(rawHeaders)
                  : null;
            const ip =
              (headers ? getIP(headers, { advanced: { ipAddress } }) : null) || '127.0.0.1';

            if (limitSignups !== undefined) {
              const windowStart = new Date(Date.now() - windowSeconds * 1000);
              const recentSignups = await prisma.signupAttempt.count({
                where: {
                  ip,
                  createdAt: { gte: windowStart },
                },
              });
              if (recentSignups >= limitSignups) {
                throw new APIError('FORBIDDEN', {
                  code: 'LIMIT_REACHED',
                  limit: 'signups',
                  message: `This instance allows ${limitSignups} signups per IP every ${windowSeconds} seconds. Ask the instance operator to raise the limit.`,
                });
              }
              // Counts even when a later rule refuses the account.
              await prisma.signupAttempt.create({ data: { ip } });
            }

            if (!isDemo) {
              const userCount = await prisma.user.count();
              const firstAccountEmail = config('FIRST_ACCOUNT_EMAIL');

              // First-account gate: while instance has 0 users, only the configured verified email is permitted
              if (userCount === 0 && firstAccountEmail) {
                const emailMatches =
                  user.email.trim().toLowerCase() === firstAccountEmail.trim().toLowerCase();
                const isVerified =
                  'emailVerified' in user && typeof user.emailVerified === 'boolean'
                    ? user.emailVerified
                    : false;
                if (!emailMatches || !isVerified) {
                  throw new APIError('FORBIDDEN', {
                    message:
                      'This instance only accepts its first account from the address its operator set up.',
                  });
                }
                return;
              }

              if (!config('ALLOW_SIGNUPS')) {
                if (userCount === 0) {
                  // First user bootstrap (when FIRST_ACCOUNT_EMAIL is unset)
                  return;
                }
                const pendingInvite = await prisma.invitation.findFirst({
                  where: {
                    email: user.email.toLowerCase(),
                    status: 'pending',
                  },
                });
                if (!pendingInvite) {
                  throw new APIError('FORBIDDEN', {
                    message:
                      'Public registration is currently disabled on this instance. Please request an invite from a workspace administrator.',
                  });
                }
              }
            }
          },
        },
      },
    },
    socialProviders,
    user: {
      deleteUser: {
        enabled: false,
      },
    },
    disabledPaths: [...DISABLED_ORGANIZATION_PATHS, ...DISABLED_CORE_PATHS],
    account: {
      accountLinking: {
        enabled: true,
      },
    },
    advanced: {
      useSecureCookies: isProd,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
      },
      ipAddress,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day rolling window
    },
    // Better Auth keeps its own request limiter (3 sign-ins per 10 seconds per address) and turns
    // it on by itself in production. `RATE_LIMIT_ENABLED` is the one switch for every limit.
    rateLimit: { enabled: config('RATE_LIMIT_ENABLED') },
    trustedOrigins: config('trustedOrigins'),
    plugins: [organization(), ...(isDemo ? [anonymous({ disableDeleteAnonymousUser: true })] : [])],
  });
}

export type Auth = ReturnType<typeof createAuth>;
