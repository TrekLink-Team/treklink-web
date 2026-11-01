import { HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DomainException, ErrorCode } from '../../common/errors';
import { FieldStationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import {
  ACC_READ,
  ACC_SUBSCRIBE,
  ACC_WRITE,
  BrokerAuthService,
  kindOf,
  topicAllowed,
} from './broker-hooks.service';

const HOOK_SECRET = 'unit-hook-secret-0123456789';
const STATION = 'fs-org-0007-1';
const STATION_SECRET = 'fs_station_secret';
const NODE = 'node-!a4b1c2d3';

const configOf = (env: Record<string, unknown>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService<ValidatedEnvironment, true>;

const BASE_ENV = {
  MQTT_AUTH_HOOK_SECRET: HOOK_SECRET,
  MQTT_USERNAME: 'treklink-backend',
  MQTT_PASSWORD: 'backend-password',
  MQTT_NODE_PASSWORD: 'shared-fleet-node-password',
  MQTT_ROOT: 'treklink',
};

const expectDomain = (run: () => unknown, status: HttpStatus, code: ErrorCode) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).getStatus()).toBe(status);
    expect((error as DomainException).getResponse()).toMatchObject({ errorCode: code });
    return;
  }
  throw new Error('expected a DomainException');
};

const expectRejection = async (promise: Promise<unknown>, status: HttpStatus, code: ErrorCode) => {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).getStatus()).toBe(status);
  expect((error as DomainException).getResponse()).toMatchObject({ errorCode: code });
};

describe('BrokerAuthService (gateway-sync task 3.1, api-design 01 and 02, design §4)', () => {
  let secretHash: string;
  let stations: { byUsername: jest.Mock };
  let warn: jest.SpyInstance;

  const service = (env: Record<string, unknown> = BASE_ENV) =>
    new BrokerAuthService(stations as unknown as FieldStationsService, configOf(env));

  const credential = (overrides: Record<string, unknown> = {}) => ({
    id: 'fs-1',
    organizationId: 'org-1',
    organizationStatus: OrganizationStatus.ACTIVE,
    mqttUsername: STATION,
    secretHash,
    revokedAt: null,
    ...overrides,
  });

  beforeAll(async () => {
    secretHash = await bcrypt.hash(STATION_SECRET, 4);
  });

  beforeEach(() => {
    stations = { byUsername: jest.fn().mockResolvedValue(credential()) };
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const logged = () => (warn.mock.calls as unknown[][]).map((call) => String(call[0])).join('\n');

  describe('the hook secret', () => {
    it('accepts the configured secret', () => {
      expect(() => service().assertSecret(HOOK_SECRET)).not.toThrow();
    });

    it.each([
      ['missing', undefined],
      ['wrong', 'unit-hook-secret-WRONG-789'],
      ['a prefix', HOOK_SECRET.slice(0, 10)],
      ['repeated', [HOOK_SECRET, HOOK_SECRET]],
    ])('answers 401 BROKER_SECRET when it is %s', (_label, given) => {
      expectDomain(
        () => service().assertSecret(given),
        HttpStatus.UNAUTHORIZED,
        ErrorCode.BROKER_SECRET,
      );
    });

    it.each([undefined, ''])('answers 404 for every call while the variable is %p', (unset) => {
      const open = service({ ...BASE_ENV, MQTT_AUTH_HOOK_SECRET: unset });
      expectDomain(() => open.assertSecret(HOOK_SECRET), HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
      expectDomain(() => open.assertSecret(undefined), HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    });
  });

  describe('user check (api-design 01)', () => {
    it('allows the backend subscriber with MQTT_PASSWORD', async () => {
      await expect(
        service().checkUser({
          username: 'treklink-backend',
          password: 'backend-password',
          clientid: 'treklink-backend-service',
        }),
      ).resolves.toEqual({ allowed: true, kind: 'BACKEND' });
      expect(stations.byUsername).not.toHaveBeenCalled();
    });

    it('refuses the backend subscriber with a wrong password, or when MQTT_PASSWORD is unset', async () => {
      await expectRejection(
        service().checkUser({ username: 'treklink-backend', password: 'nope', clientid: 'c' }),
        HttpStatus.FORBIDDEN,
        ErrorCode.CREDENTIAL_REJECTED,
      );
      await expectRejection(
        service({ ...BASE_ENV, MQTT_PASSWORD: undefined }).checkUser({
          username: 'treklink-backend',
          password: '',
          clientid: 'c',
        }),
        HttpStatus.FORBIDDEN,
        ErrorCode.CREDENTIAL_REJECTED,
      );
    });

    it('allows an active Field Station with its secret, through organizations', async () => {
      await expect(
        service().checkUser({ username: STATION, password: STATION_SECRET, clientid: 'fs' }),
      ).resolves.toEqual({ allowed: true, kind: 'FIELD_STATION' });
      expect(stations.byUsername).toHaveBeenCalledWith(STATION);
    });

    it('allows a station of a SUSPENDED organization, whose devices stay monitored (BR-32)', async () => {
      stations.byUsername.mockResolvedValue(
        credential({ organizationStatus: OrganizationStatus.SUSPENDED }),
      );
      await expect(
        service().checkUser({ username: STATION, password: STATION_SECRET, clientid: 'fs' }),
      ).resolves.toEqual({ allowed: true, kind: 'FIELD_STATION' });
    });

    it.each([
      ['a wrong secret', () => credential(), 'wrong-secret'],
      [
        'a revoked credential (organizations AC-06)',
        () => credential({ revokedAt: new Date() }),
        STATION_SECRET,
      ],
      [
        'a CLOSED organization',
        () => credential({ organizationStatus: OrganizationStatus.CLOSED }),
        STATION_SECRET,
      ],
      ['an unknown username', () => null, STATION_SECRET],
    ])('answers 403 CREDENTIAL_REJECTED for a station with %s', async (_label, row, password) => {
      stations.byUsername.mockResolvedValue(row());
      await expectRejection(
        service().checkUser({ username: STATION, password, clientid: 'fs' }),
        HttpStatus.FORBIDDEN,
        ErrorCode.CREDENTIAL_REJECTED,
      );
    });

    it('allows a fleet node with the shared MQTT_NODE_PASSWORD, without reading organizations', async () => {
      await expect(
        service().checkUser({
          username: NODE,
          password: 'shared-fleet-node-password',
          clientid: 'node',
        }),
      ).resolves.toEqual({ allowed: true, kind: 'FLEET_NODE' });
      expect(stations.byUsername).not.toHaveBeenCalled();
    });

    it('refuses a fleet node with a wrong password', async () => {
      await expectRejection(
        service().checkUser({
          username: NODE,
          password: 'shared-fleet-node-passwor',
          clientid: 'n',
        }),
        HttpStatus.FORBIDDEN,
        ErrorCode.CREDENTIAL_REJECTED,
      );
    });

    it.each([undefined, ''])(
      'refuses every fleet node while MQTT_NODE_PASSWORD is %p, even with an empty password',
      async (unset) => {
        const env = { ...BASE_ENV, MQTT_NODE_PASSWORD: unset };
        for (const password of ['', 'shared-fleet-node-password']) {
          await expectRejection(
            service(env).checkUser({ username: NODE, password, clientid: 'node' }),
            HttpStatus.FORBIDDEN,
            ErrorCode.CREDENTIAL_REJECTED,
          );
        }
      },
    );

    it('refuses a username of no credential kind without reading organizations', async () => {
      await expectRejection(
        service().checkUser({ username: 'mallory', password: 'x', clientid: 'm' }),
        HttpStatus.FORBIDDEN,
        ErrorCode.CREDENTIAL_REJECTED,
      );
      expect(stations.byUsername).not.toHaveBeenCalled();
    });

    it('never logs a password, the station secret or its hash', async () => {
      await expectRejection(
        service().checkUser({ username: STATION, password: 'typed-secret-xyz', clientid: 'fs' }),
        HttpStatus.FORBIDDEN,
        ErrorCode.CREDENTIAL_REJECTED,
      );
      await expectRejection(
        service().checkUser({
          username: 'treklink-backend',
          password: 'other-pass-xyz',
          clientid: 'b',
        }),
        HttpStatus.FORBIDDEN,
        ErrorCode.CREDENTIAL_REJECTED,
      );
      await expectRejection(
        service().checkUser({ username: NODE, password: 'node-typed-xyz', clientid: 'n' }),
        HttpStatus.FORBIDDEN,
        ErrorCode.CREDENTIAL_REJECTED,
      );
      const text = logged();
      expect(text).toContain(STATION);
      for (const secret of [
        'typed-secret-xyz',
        'other-pass-xyz',
        secretHash,
        STATION_SECRET,
        'backend-password',
        'node-typed-xyz',
        'shared-fleet-node-password',
        HOOK_SECRET,
      ]) {
        expect(text).not.toContain(secret);
      }
    });
  });

  describe('ACL check (api-design 02, the table of design §4)', () => {
    const acl = (username: string, topic: string, acc: number, env = BASE_ENV) =>
      service(env).checkAcl({ username, clientid: 'c', topic, acc });
    const denied = (username: string, topic: string, acc: number, env = BASE_ENV) =>
      expectDomain(
        () => acl(username, topic, acc, env),
        HttpStatus.FORBIDDEN,
        ErrorCode.TOPIC_DENIED,
      );

    it('backend subscriber: subscribes to and reads treklink/#', () => {
      expect(acl('treklink-backend', 'treklink/#', ACC_SUBSCRIBE)).toEqual({ allowed: true });
      expect(acl('treklink-backend', 'treklink/2/json/+/+', ACC_SUBSCRIBE)).toEqual({
        allowed: true,
      });
      expect(acl('treklink-backend', 'treklink/fs/+/health', ACC_SUBSCRIBE)).toEqual({
        allowed: true,
      });
      expect(acl('treklink-backend', 'treklink/2/json/LongFast/!a4b1c2d3', ACC_READ)).toEqual({
        allowed: true,
      });
    });

    it('backend subscriber: publishes nothing and reads nothing outside treklink/', () => {
      denied('treklink-backend', 'treklink/2/json/LongFast/!a4b1c2d3', ACC_WRITE);
      denied('treklink-backend', 'treklink/2/json/LongFast/!a4b1c2d3', ACC_READ | ACC_WRITE);
      denied('treklink-backend', '#', ACC_SUBSCRIBE);
      denied('treklink-backend', '$SYS/broker/uptime', ACC_READ);
      denied('treklink-backend', 'treklinkX/2/json/a/b', ACC_READ);
    });

    it('fleet node: publishes its own json and e topics', () => {
      expect(acl(NODE, 'treklink/2/json/LongFast/!a4b1c2d3', ACC_WRITE)).toEqual({ allowed: true });
      expect(acl(NODE, 'treklink/2/e/LongFast/!a4b1c2d3', ACC_WRITE)).toEqual({ allowed: true });
    });

    it('fleet node: no other node, topic shape or access, and no subscribe', () => {
      denied(NODE, 'treklink/2/json/LongFast/!deadbeef', ACC_WRITE);
      denied(NODE, 'treklink/2/json/LongFast/!a4b1c2d3/extra', ACC_WRITE);
      denied(NODE, 'treklink/2/json/a/b/!a4b1c2d3', ACC_WRITE);
      denied(NODE, 'treklink/2/map/LongFast/!a4b1c2d3', ACC_WRITE);
      denied(NODE, 'treklink/fs/fs-org-0007-1/2/json/LongFast/!a4b1c2d3', ACC_WRITE);
      denied(NODE, 'treklink/2/json/LongFast/!a4b1c2d3', ACC_READ);
      denied(NODE, 'treklink/2/json/LongFast/!a4b1c2d3', ACC_SUBSCRIBE);
      denied(NODE, 'treklink/#', ACC_SUBSCRIBE);
    });

    it('Field Station: publishes under treklink/fs/<its username>/#', () => {
      expect(acl(STATION, `treklink/fs/${STATION}/2/json/LongFast/!a4b1c2d3`, ACC_WRITE)).toEqual({
        allowed: true,
      });
      expect(acl(STATION, `treklink/fs/${STATION}/health`, ACC_WRITE)).toEqual({ allowed: true });
    });

    it('Field Station: never another station, a node topic, or a subscribe', () => {
      denied(STATION, 'treklink/fs/fs-org-0007-2/health', ACC_WRITE);
      denied(STATION, `treklink/fs/${STATION}0/health`, ACC_WRITE);
      denied(STATION, 'treklink/2/json/LongFast/!a4b1c2d3', ACC_WRITE);
      denied(STATION, `treklink/fs/${STATION}/health`, ACC_READ);
      denied(STATION, `treklink/fs/${STATION}/#`, ACC_SUBSCRIBE);
      denied(STATION, 'treklink/#', ACC_SUBSCRIBE);
    });

    it('denies a username of no credential kind', () => {
      denied('mallory', 'treklink/fs/mallory/health', ACC_WRITE);
      denied('fs-org/../x-1', 'treklink/fs/fs-org/../x-1/health', ACC_WRITE);
    });

    it('follows MQTT_ROOT', () => {
      const env = { ...BASE_ENV, MQTT_ROOT: 'trial' };
      expect(acl(STATION, `trial/fs/${STATION}/health`, ACC_WRITE, env)).toEqual({ allowed: true });
      denied(STATION, `treklink/fs/${STATION}/health`, ACC_WRITE, env);
    });
  });

  describe('kindOf and topicAllowed', () => {
    it('matches the backend username before the node and station patterns', () => {
      expect(kindOf(NODE, NODE)).toBe('BACKEND');
      expect(kindOf(NODE, undefined)).toBe('FLEET_NODE');
      expect(kindOf(STATION, 'treklink-backend')).toBe('FIELD_STATION');
      expect(kindOf('node-a4b1c2d3', undefined)).toBeNull();
      expect(kindOf('fs-org', undefined)).toBeNull();
      expect(kindOf('fs-org-0007-1/x', undefined)).toBeNull();
    });

    it('treats a root with regular expression characters literally', () => {
      expect(
        topicAllowed('FIELD_STATION', STATION, `t.k/fs/${STATION}/health`, ACC_WRITE, 't.k'),
      ).toBe(true);
      expect(
        topicAllowed('FIELD_STATION', STATION, `tXk/fs/${STATION}/health`, ACC_WRITE, 't.k'),
      ).toBe(false);
    });
  });
});
