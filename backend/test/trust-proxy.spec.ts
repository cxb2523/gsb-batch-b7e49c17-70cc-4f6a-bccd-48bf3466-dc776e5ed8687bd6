import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { setupApp } from '../src/app.setup.js';

function isNestApp(val: unknown): val is INestApplication {
  return typeof val === 'object' && val !== null;
}

const OFF_WARNING =
  "TRUST_PROXY is off: every request appears to come from the proxy's address. Behind a reverse proxy set it to the number of proxies.";

/**
 * Runs `setupApp` against a stub application and reports what it told Express and the logger.
 * Which address a request ends up with is covered end to end in
 * test/integration/instance-limits.int-spec.ts (signup limit with and without TRUST_PROXY).
 */
function runSetup(trustProxy: false | number | string, nodeEnv: 'production' | 'development') {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  vi.spyOn(SwaggerModule, 'createDocument').mockReturnValue({
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    paths: {},
    components: { schemas: {} },
  });
  const publishDocs = vi.spyOn(SwaggerModule, 'setup').mockImplementation(() => {});

  const expressSet = vi.fn();
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'TRUST_PROXY') return trustProxy;
      if (key === 'NODE_ENV') return nodeEnv;
      if (key === 'trustedOrigins') return ['http://localhost:3000'];
      if (key === 'FRONTEND_URL') return 'http://localhost:3000';
      return undefined;
    }),
  };
  const app: unknown = {
    enableShutdownHooks: vi.fn(),
    getHttpAdapter: () => ({
      getInstance: () => ({ set: expressSet }),
      getType: () => 'express',
    }),
    use: vi.fn(),
    useGlobalPipes: vi.fn(),
    useGlobalFilters: vi.fn(),
    enableCors: vi.fn(),
    get: vi.fn((token: unknown) => (token === ConfigService ? config : undefined)),
  };

  if (!isNestApp(app)) throw new Error('invalid nest app stub');
  setupApp(app);
  return { expressSet, warn, publishDocs };
}

describe('TRUST_PROXY (H4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns Express proxy trust off and warns in production when the setting is off', () => {
    const { expressSet, warn } = runSetup(false, 'production');

    expect(expressSet).toHaveBeenCalledWith('trust proxy', false);
    expect(warn).toHaveBeenCalledWith(OFF_WARNING);
  });

  it('publishes the API document outside production only', () => {
    expect(runSetup(false, 'production').publishDocs).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(runSetup(false, 'development').publishDocs).toHaveBeenCalled();
  });

  it('does not warn outside production when the setting is off', () => {
    const { expressSet, warn } = runSetup(false, 'development');

    expect(expressSet).toHaveBeenCalledWith('trust proxy', false);
    expect(warn).not.toHaveBeenCalledWith(OFF_WARNING);
  });

  it.each([[1], ['10.0.0.0/8, 172.16.0.0/12']])('hands %s to Express unchanged', (setting) => {
    const { expressSet, warn } = runSetup(setting, 'production');

    expect(expressSet).toHaveBeenCalledWith('trust proxy', setting);
    expect(warn).not.toHaveBeenCalledWith(OFF_WARNING);
  });
});
