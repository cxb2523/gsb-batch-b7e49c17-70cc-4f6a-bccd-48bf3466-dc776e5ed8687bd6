import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { createIntegrationHarness, type IntegrationHarness } from './harness.js';
import { ACCESS_KEY, IS_PUBLIC_KEY } from '../../src/access/decorators.js';
import { MATRIX_ROWS } from './access-matrix.rows.js';

interface RegisteredRoute {
  key: string;
  isPublic: boolean;
  hasAccess: boolean;
}

function metadataPaths(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function joinPath(controllerPath: string, methodPath: string): string {
  const joined = `/${controllerPath}/${methodPath}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/**
 * Enumerates what Nest actually registered, from controller and handler metadata, rather than
 * from a list a human keeps in sync.
 */
function listRoutes(app: INestApplication): RegisteredRoute[] {
  const discovery = app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const routes: RegisteredRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;

    const controllerPaths = metadataPaths(Reflect.getMetadata(PATH_METADATA, metatype));
    const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, metatype) === true;
    const classAccess = Reflect.getMetadata(ACCESS_KEY, metatype) !== undefined;

    for (const methodName of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
      const handler = Object.getPrototypeOf(instance)[methodName] as unknown;
      if (typeof handler !== 'function') continue;

      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (requestMethod === undefined) continue;

      const methodPaths = metadataPaths(Reflect.getMetadata(PATH_METADATA, handler));
      const isPublic = classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;
      const hasAccess = classAccess || Reflect.getMetadata(ACCESS_KEY, handler) !== undefined;
      const verb = RequestMethod[requestMethod];

      for (const controllerPath of controllerPaths.length > 0 ? controllerPaths : ['']) {
        for (const methodPath of methodPaths.length > 0 ? methodPaths : ['']) {
          routes.push({
            key: `${verb} ${joinPath(controllerPath, methodPath)}`,
            isPublic,
            hasAccess,
          });
        }
      }
    }
  }

  return routes;
}

describe('Route access inventory (Integration)', () => {
  let harness: IntegrationHarness;
  let routes: RegisteredRoute[];

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    routes = listRoutes(harness.app);
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('registers the routes this batch expects', () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.map((route) => route.key)).toContain('GET /api/boards/:id');
  });

  it('refuses to leave a route undecided: every route is either public or declares @Access', () => {
    const undecided = routes.filter((route) => !route.isPublic && !route.hasAccess);
    expect(undecided.map((route) => route.key)).toEqual([]);
  });

  it('marks only the intended routes public', () => {
    const publicRoutes = routes.filter((route) => route.isPublic).map((route) => route.key);

    const allowed = (key: string): boolean =>
      key.includes(' /api/auth/') ||
      key === 'GET /api/invitations/:id' ||
      key.includes(' /api/public/boards/') ||
      key === 'GET /api/health' ||
      key === 'GET /healthz';

    expect(publicRoutes.filter((key) => !allowed(key))).toEqual([]);
    expect(publicRoutes).toContain('POST /api/auth/dev-login');
    expect(publicRoutes).toContain('ALL /api/auth/{*path}');
  });

  it('has a matrix row for every protected route, and no row for a route that does not exist', () => {
    const protectedRoutes = routes.filter((route) => !route.isPublic).map((route) => route.key);
    const matrixKeys = MATRIX_ROWS.map((row) => row.key);

    expect(protectedRoutes.filter((key) => !matrixKeys.includes(key))).toEqual([]);
    expect(matrixKeys.filter((key) => !protectedRoutes.includes(key))).toEqual([]);
  });
});
