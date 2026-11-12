import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import type { EnvConfig } from './config/env.schema.js';
import { indexHtmlWithSiteUrl } from './static/index-html.js';
import { resolveStaticDirectory } from './static/static-assets.module.js';

export interface CspConfigInput {
  UMAMI_WEBSITE_ID?: string | undefined;
  UMAMI_HOST_URL?: string | undefined;
  AUTH_URL?: string | undefined;
}

export function buildCspDirectives(config: CspConfigInput): Record<string, string[]> {
  // Sets, so an origin that appears twice (the analytics host can equal the app's own) is listed once.
  const scriptSrc = new Set(["'self'"]);
  const connectSrc = new Set(["'self'"]);

  if (config.UMAMI_WEBSITE_ID) {
    const umamiOrigin = config.UMAMI_HOST_URL
      ? new URL(config.UMAMI_HOST_URL).origin
      : 'https://cloud.umami.is';
    scriptSrc.add(umamiOrigin);
    connectSrc.add(umamiOrigin);
  }

  if (config.AUTH_URL) {
    // AUTH_URL is validated as a URL at boot.
    connectSrc.add(new URL(config.AUTH_URL).origin);
  }

  return {
    defaultSrc: ["'self'"],
    scriptSrc: [...scriptSrc],
    // Excalidraw runtime styling and inline theme style injection require 'unsafe-inline'
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc: [...connectSrc],
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
}

export function setupApp(app: INestApplication): void {
  const configService = app.get<ConfigService<EnvConfig, true>>(ConfigService);

  app.enableShutdownHooks();
  const expressInstance: { set?: (setting: string, val: unknown) => void } = app
    .getHttpAdapter()
    .getInstance();
  const trustProxy = configService.get('TRUST_PROXY', { infer: true });
  const isProd = configService.get('NODE_ENV', { infer: true }) === 'production';
  if (trustProxy === false) {
    expressInstance.set?.('trust proxy', false);
    if (isProd) {
      new Logger('AppSetup').warn(
        "TRUST_PROXY is off: every request appears to come from the proxy's address. Behind a reverse proxy set it to the number of proxies.",
      );
    }
  } else {
    expressInstance.set?.('trust proxy', trustProxy);
  }

  const umamiWebsiteId = configService.get('UMAMI_WEBSITE_ID', { infer: true });
  const umamiHostUrl = configService.get('UMAMI_HOST_URL', { infer: true });
  const authUrl = configService.get('AUTH_URL', { infer: true });

  const cspDirectives = buildCspDirectives({
    UMAMI_WEBSITE_ID: umamiWebsiteId,
    UMAMI_HOST_URL: umamiHostUrl,
    AUTH_URL: authUrl,
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: cspDirectives,
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: false,
    }),
  );

  app.use(compression());

  // Registered before the static files are, so the page shell is the one with this instance's address.
  const staticDir = resolveStaticDirectory(configService.get('STATIC_DIR', { infer: true }));
  const pageShell = staticDir
    ? indexHtmlWithSiteUrl(staticDir, configService.get('FRONTEND_URL', { infer: true }))
    : null;
  if (pageShell) {
    app.use(pageShell);
  }

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  const allowedOrigins = configService.get('trustedOrigins', { infer: true });

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  });

  // The API document lists every route; a production instance does not publish it.
  if (configService.get('NODE_ENV', { infer: true }) === 'production') {
    return;
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CanvHQ API')
    .setDescription('End-to-end encrypted spatial whiteboard API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  cleanupOpenApiDoc(document);
  SwaggerModule.setup('api/docs', app, document);
}
