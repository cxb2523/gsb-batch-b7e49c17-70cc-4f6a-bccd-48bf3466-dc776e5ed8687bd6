import {
  Controller,
  All,
  Post,
  Get,
  Body,
  Req,
  Res,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AUTH, CLIENT_IP_HEADER, type Auth } from './auth.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../config/env.schema.js';
import { webcrypto, randomUUID } from 'node:crypto';
import { DevLoginDto } from './dto/auth.dto.js';
import { Public } from '../access/decorators.js';

async function signSessionToken(value: string, secret: string): Promise<string> {
  const secretBuf = new TextEncoder().encode(secret);
  const key = await webcrypto.subtle.importKey(
    'raw',
    secretBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const signature = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const b64 = Buffer.from(signature).toString('base64');
  return `${value}.${b64}`;
}

@Public()
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH) private readonly auth: Auth,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  @Get('config')
  async getConfig() {
    const isDev =
      this.configService.get('NODE_ENV', { infer: true }) !== 'production' &&
      this.configService.get('ENABLE_DEV_LOGIN', { infer: true });
    const allowSignups = this.configService.get('ALLOW_SIGNUPS', { infer: true });
    const demoMode = this.configService.get('DEMO_MODE', { infer: true });
    const userCount = await this.prisma.user.count();
    // A demo instance is empty after every wipe, but nobody there is setting up an administrator.
    const isFirstAccountSetup = !demoMode && userCount === 0;

    const providers = demoMode ? [] : this.configService.get('oauthProviders', { infer: true });
    const umamiWebsiteId = this.configService.get('UMAMI_WEBSITE_ID', { infer: true });
    const umamiHostUrl = this.configService.get('UMAMI_HOST_URL', { infer: true });
    const operatorName = this.configService.get('OPERATOR_NAME', { infer: true });
    const operatorContact = this.configService.get('OPERATOR_CONTACT', { infer: true });

    return {
      devLoginEnabled: isDev,
      allowSignups,
      isFirstAccountSetup,
      demoMode,
      providers,
      operator: {
        name: operatorName ?? null,
        contact: operatorContact ?? null,
      },
      analytics: {
        umami: umamiWebsiteId
          ? {
              websiteId: umamiWebsiteId,
              hostUrl: umamiHostUrl || 'https://cloud.umami.is',
            }
          : null,
      },
    };
  }

  @Post('dev-login')
  async devLogin(@Body() body: DevLoginDto, @Res() res: Response) {
    const isDev =
      this.configService.get('NODE_ENV', { infer: true }) !== 'production' &&
      this.configService.get('ENABLE_DEV_LOGIN', { infer: true });
    if (!isDev) {
      throw new ForbiddenException('Dev login is disabled');
    }

    const email = (body?.email || 'q@local.com').trim().toLowerCase();
    const name = (body?.name || 'Qarib').trim();

    if (
      !email.endsWith('@local.com') &&
      !email.endsWith('@test.internal') &&
      !email.endsWith('@canvhq.internal')
    ) {
      throw new ForbiddenException(
        'Dev login is restricted to local development test domains (*@local.com, *@canvhq.internal)',
      );
    }

    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          id: `usr_${randomUUID()}`,
          email,
          name,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    // Clean up any legacy artificial mock accounts created during earlier dev iterations
    if (this.prisma.account?.deleteMany) {
      await this.prisma.account.deleteMany({
        where: {
          userId: user.id,
          id: { startsWith: 'acc_' },
        },
      });
    }

    const token = `dev_tok_${randomUUID()}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const session = await this.prisma.session.create({
      data: {
        id: `ses_${randomUUID()}`,
        token,
        userId: user.id,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const secret = this.configService.get('AUTH_SECRET', { infer: true });
    const signedToken = await signSessionToken(token, secret);

    // Set Better Auth session cookie
    res.cookie('better-auth.session_token', signedToken, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.configService.get('NODE_ENV', { infer: true }) === 'production',
      expires: expiresAt,
    });

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
      session: {
        id: session.id,
        token: session.token,
        signedToken,
        expiresAt: session.expiresAt,
      },
    });
  }

  @All('{*path}')
  async handler(@Req() req: Request, @Res() res: Response) {
    req.headers[CLIENT_IP_HEADER] = req.ip;
    const handler = toNodeHandler(this.auth);
    return handler(req, res);
  }
}
