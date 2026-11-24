import { RequestMethod, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { IS_PUBLIC_KEY } from '../../common/decorators/access.decorator';
import { GlobalExceptionFilter } from '../../common/filters/http-exception.filter';
import { DemoPanelController } from './demo-panel.controller';
import { DemoPanelModule } from './demo-panel.module';
import { DemoPanelFailures } from './demo-panel-failures';
import { DemoPanelGuard } from './demo-panel.guard';
import { hashPanelPassword } from './demo-panel-password';

// Every route of every controller of DemoPanelModule, read from the module and controller metadata, so a
// new route or a new controller is enumerated here without an edit and fails the refusal tests if it is
// not guarded (AC-PNL-01, D-110 consequences; review of treklink-web#541).
type Controller = new (...args: never[]) => object;
const CONTROLLERS = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DemoPanelModule) ??
  []) as Controller[];

const ROUTES = CONTROLLERS.flatMap((controller) => {
  const prefix = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = (controller.prototype as Record<string, object>)[name];
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      return { name: `${controller.name}.${name}`, controller, handler, method, prefix, path };
    })
    .filter((route) => route.method !== undefined);
});

const verb = (method: RequestMethod) =>
  RequestMethod[method].toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
const urlOf = (prefix: string, path: string | undefined) =>
  `/api/${[prefix, path]
    .filter((part) => part && part !== '/')
    .join('/')
    .replace(/:\w+/g, 'sample')}`;

describe('DemoPanelModule routes are all guarded (REQ-PNL-02, AC-PNL-01)', () => {
  it('has controllers and routes to check', () => {
    expect(CONTROLLERS).toContain(DemoPanelController);
    expect(ROUTES.length).toBeGreaterThan(0);
  });

  it.each(CONTROLLERS.map((controller) => [controller.name, controller]))(
    '%s is public with the panel guard on the class, and no route relaxes it',
    (_name, controller) => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([DemoPanelGuard]);
      for (const route of ROUTES.filter((r) => r.controller === controller)) {
        expect(Reflect.getMetadata(GUARDS_METADATA, route.handler) ?? []).toEqual([]);
      }
    },
  );
});

describe('every panel route refuses without the password (AC-PNL-01)', () => {
  let app: INestApplication;
  // Any method a route may call; lifecycle and promise names stay undefined so Nest does not await it.
  const calls: Record<string, jest.Mock> = {};
  const service = new Proxy(calls, {
    get: (target, key) =>
      typeof key !== 'string' || key === 'then' || /^(on|before)[A-Z]/.test(key)
        ? undefined
        : (target[key] ??= jest.fn(() => ({}))),
  });
  const neverBlocked = {
    reserve: () => ({ ticket: { count: 0, firstAt: 0 } }),
    release: jest.fn(),
  };

  beforeAll(async () => {
    const hash = await hashPanelPassword('the right panel password');
    const module = await Test.createTestingModule({
      // Every controller of the module; every dependency except the guard's own is the call-recording stub.
      controllers: CONTROLLERS,
      providers: [
        DemoPanelGuard,
        { provide: DemoPanelFailures, useValue: neverBlocked },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'DEMO_PANEL_PASSWORD_HASH'
                ? hash
                : key === 'DISPLAY_TIMEZONE_DEFAULT'
                  ? 'UTC'
                  : undefined,
          },
        },
      ],
    })
      .useMocker(() => service)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  it.each(ROUTES.map((route) => [route.name, route]))(
    '%s answers 401 without the header and with a wrong password, and calls nothing',
    async (_name, route) => {
      for (const header of [undefined, 'wrong password']) {
        let call = request(server())[verb(route.method!)](urlOf(route.prefix, route.path));
        if (header !== undefined) call = call.set('X-Demo-Panel-Password', header);
        const response = await call.send({});
        expect(response.status).toBe(401);
        expect(response.body).toEqual({
          result: { errorCode: 'DEMO_PANEL_PASSWORD_INVALID' },
          isSuccess: false,
          statusCode: 401,
          message: 'Enter the panel password.',
        });
      }
      for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
    },
  );
});
