import { Controller, Get, Global, Module, Param, Post, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  AUTHENTICATED_ONLY_KEY,
  CHECK_POLICIES_KEY,
  CheckPolicies,
  IS_PUBLIC_KEY,
  PolicyHandler,
} from '../src/common/decorators/access.decorator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { API_KEY_RESOLVER, AuthOneOf, hashApiKey } from '../src/modules/auth';
import { AUTH_ONE_OF_KEY } from '../src/modules/auth/decorators/auth-one-of.decorator';

// Route guards across the whole application (auth tasks 4.3 and 4.4, REQ-UBI-04, D-061).

const MUTATING = new Set([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

// The routes that need no access token: sign-in, refresh, the password code flows and health. The
// organization registration, the SePay webhook and the broker hooks join when their modules land.
const PUBLIC_ROUTES = new Set([
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',
  'POST /auth/password/set',
  'GET /health',
]);

// The routes that need a token and no permission (D-061 rule 2): sign-out, the caller's own
// account and the caller's own password.
const AUTHENTICATED_ROUTES = new Set([
  'POST /auth/logout',
  'GET /auth/me',
  'POST /auth/password/change',
]);

interface RouteInfo {
  route: string;
  mutating: boolean;
  isPublic: boolean;
  authenticatedOnly: boolean;
  policies: number;
  acceptsApiKey: boolean;
}

const joinPath = (...parts: (string | undefined)[]) =>
  `/${parts
    .flatMap((part) => (part ?? '').split('/'))
    .filter(Boolean)
    .join('/')}`;

// Walks every controller method that Nest maps to a route.
const collectRoutes = (
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
): RouteInfo[] =>
  discovery.getControllers().flatMap(({ metatype, instance }) => {
    if (!metatype || !instance) return [];
    const base = reflector.get<string | undefined>(PATH_METADATA, metatype);
    const prototype = Object.getPrototypeOf(instance) as object;
    return scanner.getAllMethodNames(prototype).flatMap((name) => {
      const handler = (prototype as Record<string, (...args: unknown[]) => unknown>)[name];
      const path = reflector.get<string | undefined>(PATH_METADATA, handler);
      const method = reflector.get<RequestMethod | undefined>(METHOD_METADATA, handler);
      if (path === undefined || method === undefined) return [];
      const read = <T>(key: string) => reflector.getAllAndOverride<T>(key, [handler, metatype]);
      return [
        {
          route: `${RequestMethod[method]} ${joinPath(base, path)}`,
          mutating: MUTATING.has(method),
          isPublic: read<boolean | undefined>(IS_PUBLIC_KEY) === true,
          authenticatedOnly: read<boolean | undefined>(AUTHENTICATED_ONLY_KEY) === true,
          policies: read<PolicyHandler[] | undefined>(CHECK_POLICIES_KEY)?.length ?? 0,
          acceptsApiKey: read<string[] | undefined>(AUTH_ONE_OF_KEY)?.includes('apiKey') ?? false,
        },
      ];
    });
  });

describe('route guards, every route of the application (auth task 4.4, REQ-UBI-04)', () => {
  let routes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    routes = collectRoutes(
      moduleRef.get(DiscoveryService),
      moduleRef.get(MetadataScanner),
      moduleRef.get(Reflector),
    );
    await moduleRef.close();
  });

  it('finds the routes of the application', () => {
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.map((route) => route.route)).toContain('POST /auth/login');
  });

  it('declares a policy on every mutating route, except the listed public and token-only ones', () => {
    const unguarded = routes
      .filter((route) => route.mutating && route.policies === 0)
      .filter((route) => !PUBLIC_ROUTES.has(route.route) && !AUTHENTICATED_ROUTES.has(route.route))
      .map((route) => route.route);
    expect(unguarded).toEqual([]);
  });

  it('opens no route that is not on the public list', () => {
    const opened = routes.filter((route) => route.isPublic).map((route) => route.route);
    expect(opened.filter((route) => !PUBLIC_ROUTES.has(route))).toEqual([]);
    expect([...PUBLIC_ROUTES].filter((route) => !opened.includes(route))).toEqual([]);
  });

  it('allows token-only access only on the listed routes', () => {
    const tokenOnly = routes.filter((route) => route.authenticatedOnly).map((route) => route.route);
    expect(tokenOnly.filter((route) => !AUTHENTICATED_ROUTES.has(route))).toEqual([]);
  });

  it('gives every route a guard marking, so none relies on the fail-closed default', () => {
    const unmarked = routes
      .filter((route) => !route.isPublic && !route.authenticatedOnly && route.policies === 0)
      .map((route) => route.route);
    expect(unmarked).toEqual([]);
  });

  it('marks no mutating route for API keys (BR-20)', () => {
    expect(routes.filter((route) => route.mutating && route.acceptsApiKey)).toEqual([]);
  });
});

// AC-05 through the real HTTP pipeline. The organization API routes are not built yet, so a
// test-only controller stands in for `GET /api/telemetry/devices` and
// `POST /api/incidents/:id/acknowledge`, and a stub stands in for the `organizations` resolver.

const KEY = 'tlk_e2e_0123456789abcdef';
const canReadLiveMap: PolicyHandler = (ability) => ability.can('read', 'LiveMap');
const canAcknowledge: PolicyHandler = (ability) => ability.can('acknowledge', 'Incident');

@Controller('e2e-probe')
class OrganizationApiProbe {
  @Get('telemetry/devices')
  @AuthOneOf('jwt', 'apiKey')
  @CheckPolicies(canReadLiveMap)
  devices() {
    return [];
  }

  @Get('unmarked')
  @CheckPolicies(canReadLiveMap)
  unmarked() {
    return [];
  }

  @Post('incidents/:id/acknowledge')
  @AuthOneOf('jwt', 'apiKey')
  @CheckPolicies(canAcknowledge)
  acknowledge(@Param('id') id: string) {
    return { id };
  }
}

@Global()
@Module({
  providers: [
    {
      provide: API_KEY_RESOLVER,
      useValue: {
        resolve: (keyHash: string) =>
          Promise.resolve(
            keyHash === hashApiKey(KEY) ? { apiKeyId: 'key-1', organizationId: 'org-1' } : null,
          ),
      },
    },
  ],
  exports: [API_KEY_RESOLVER],
})
class ResolverStubModule {}

const ownRule = (key: string, action: string, subject: string) => ({
  key,
  action,
  subject,
  conditions: { organizationId: '${user.organizationId}' },
  fields: [],
  inverted: false,
  reason: null,
});

describe('an organization API key through the HTTP pipeline (auth task 4.3, AC-05)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const prisma = {
      $queryRaw: () => Promise.resolve([]),
      permission: {
        findMany: () =>
          Promise.resolve([
            ownRule('incident.read.own', 'read', 'Incident'),
            ownRule('liveMap.read.own', 'read', 'LiveMap'),
            ownRule('telemetryHistory.read.own', 'read', 'TelemetryHistory'),
          ]),
      },
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ResolverStubModule],
      controllers: [OrganizationApiProbe],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads a route marked for keys with 200', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/e2e-probe/telemetry/devices')
      .set('X-Api-Key', KEY)
      .expect(200);
    expect(response.body).toMatchObject({ isSuccess: true, statusCode: 200, result: [] });
  });

  it('answers 403 on a mutating route, even one marked for keys', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/e2e-probe/incidents/inc-1/acknowledge')
      .set('X-Api-Key', KEY)
      .expect(403);
    expect(response.body).toMatchObject({ isSuccess: false, result: { errorCode: 'FORBIDDEN' } });
  });

  it.each([
    ['an unmarked route', '/api/e2e-probe/unmarked'],
    ['a token-only route', '/api/auth/me'],
    ['an Admin route', '/api/parameters'],
  ])('answers 403 on %s', async (_label, path) => {
    const response = await request(app.getHttpServer()).get(path).set('X-Api-Key', KEY).expect(403);
    expect(response.body).toMatchObject({ result: { errorCode: 'FORBIDDEN' } });
  });

  it('answers 401 for an unknown key, and for no credential at all', async () => {
    for (const headers of [{ 'X-Api-Key': 'tlk_unknown' }, {}]) {
      const response = await request(app.getHttpServer())
        .get('/api/e2e-probe/telemetry/devices')
        .set(headers)
        .expect(401);
      expect(response.body).toMatchObject({ result: { errorCode: 'UNAUTHENTICATED' } });
    }
  });

  it('keeps the bearer token path when a token and a key are both sent', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/e2e-probe/telemetry/devices')
      .set('Authorization', 'Bearer not-a-token')
      .set('X-Api-Key', KEY)
      .expect(401);
    expect(response.body).toMatchObject({ result: { errorCode: 'UNAUTHENTICATED' } });
  });
});
