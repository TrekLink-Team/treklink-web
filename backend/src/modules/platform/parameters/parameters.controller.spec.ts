import { HttpStatus, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { createMongoAbility } from '@casl/ability';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../../common/decorators/response-message.decorator';
import { DomainException, ErrorCode } from '../../../common/errors';
import { AppAbility } from '../../auth/casl/ability.factory';
import { ParameterReadsService } from './parameter-reads.service';
import { ParameterService } from './parameter.service';
import { ParametersController } from './parameters.controller';

// Business parameters (platform task 4.2, api-design 02 to 04, UC-57). TrekLink Admin only.
describe('ParametersController', () => {
  const admin = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };
  const page = { items: [], pageNumber: 1, pageSize: 20, totalItems: 0 };
  const savedRow = { key: 'incident.ack-timeout-seconds', value: 120, version: 3 };

  let reads: { list: jest.Mock; history: jest.Mock };
  let parameters: { update: jest.Mock };
  let controller: ParametersController;

  beforeEach(() => {
    reads = { list: jest.fn().mockResolvedValue(page), history: jest.fn().mockResolvedValue(page) };
    parameters = { update: jest.fn().mockResolvedValue(savedRow) };
    controller = new ParametersController(
      reads as unknown as ParameterReadsService,
      parameters as unknown as ParameterService,
    );
  });

  describe('list (api-design 02)', () => {
    it('passes the paging and the owner module filter to the reads service', async () => {
      const query = { pageNumber: 2, pageSize: 10, ownerModule: 'incidents' };
      await expect(controller.list(query)).resolves.toBe(page);
      expect(reads.list).toHaveBeenCalledWith(query);
      expect(parameters.update).not.toHaveBeenCalled();
    });
  });

  describe('update (api-design 03)', () => {
    it('sends the value, the expected version and the reason, with the caller as actor', async () => {
      await expect(
        controller.update(
          'incident.ack-timeout-seconds',
          { value: 120, expectedVersion: 2, reason: 'Field test feedback' },
          admin,
        ),
      ).resolves.toBe(savedRow);
      expect(parameters.update).toHaveBeenCalledWith(
        'incident.ack-timeout-seconds',
        { value: 120, expectedVersion: 2, reason: 'Field test feedback' },
        { id: 'admin-1', roles: ['ADMIN'] },
      );
    });

    it('records a missing reason as null and keeps the organization out of the actor', async () => {
      await controller.update(
        'incident.ack-timeout-seconds',
        { value: 90, expectedVersion: 1 },
        {
          ...admin,
          organizationId: 'org-1',
        },
      );
      const [, change, actor] = parameters.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(change).toEqual({ value: 90, expectedVersion: 1, reason: null });
      expect(actor).toEqual({ id: 'admin-1', roles: ['ADMIN'] });
    });

    it.each([
      [
        '400 PARAMETER_OUT_OF_RANGE',
        HttpStatus.BAD_REQUEST,
        ErrorCode.PARAMETER_OUT_OF_RANGE,
        'Value is out of range.',
      ],
      [
        '409 STALE_VERSION',
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
        'The parameter was changed by someone else.',
      ],
      ['404 NOT_FOUND', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Parameter not found.'],
    ])('lets the %s from the service reach the exception filter', async (_l, status, code, msg) => {
      parameters.update.mockRejectedValueOnce(new DomainException(status, code, msg));
      await expect(
        controller.update('incident.ack-timeout-seconds', { value: 0, expectedVersion: 1 }, admin),
      ).rejects.toMatchObject({ httpStatus: status, errorCode: code });
    });
  });

  describe('history (api-design 04)', () => {
    it('reads the history of one key with the paging', async () => {
      await expect(
        controller.history('incident.ack-timeout-seconds', { pageNumber: 1, pageSize: 5 }),
      ).resolves.toBe(page);
      expect(reads.history).toHaveBeenCalledWith('incident.ack-timeout-seconds', {
        pageNumber: 1,
        pageSize: 5,
      });
    });

    it('lets the 404 for an unknown key reach the exception filter', async () => {
      reads.history.mockRejectedValueOnce(
        new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Parameter not found.'),
      );
      await expect(controller.history('no.such-key', {})).rejects.toMatchObject({
        httpStatus: HttpStatus.NOT_FOUND,
        errorCode: 'NOT_FOUND',
      });
    });
  });

  describe('access', () => {
    const [policy] = new Reflector().get<PolicyHandler[]>(CHECK_POLICIES_KEY, ParametersController);

    it('needs manage on Parameter, which only the TrekLink Admin holds', () => {
      expect(
        policy(createMongoAbility<AppAbility>([{ action: 'manage', subject: 'Parameter' }])),
      ).toBe(true);
    });

    it.each([
      ['read on Parameter', [{ action: 'read', subject: 'Parameter' }]],
      ['manage on Role', [{ action: 'manage', subject: 'Role' }]],
      ['no permission at all', []],
    ])('refuses a caller with %s', (_label, rules) => {
      expect(policy(createMongoAbility<AppAbility>(rules as never))).toBe(false);
    });
  });

  describe('routes', () => {
    const handler = (name: string) =>
      (ParametersController.prototype as unknown as Record<string, object>)[name];

    it('is mounted on parameters', () => {
      expect(Reflect.getMetadata(PATH_METADATA, ParametersController)).toBe('parameters');
    });

    it.each([
      { name: 'list', verb: 'GET', method: RequestMethod.GET, path: '/', message: 'OK' },
      {
        name: 'update',
        verb: 'PATCH',
        method: RequestMethod.PATCH,
        path: ':key',
        message: 'Parameter updated',
      },
      {
        name: 'history',
        verb: 'GET',
        method: RequestMethod.GET,
        path: ':key/history',
        message: 'OK',
      },
    ])('$name is $verb $path with the message "$message"', ({ name, method, path, message }) => {
      expect(Reflect.getMetadata(METHOD_METADATA, handler(name))).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler(name))).toBe(path);
      expect(Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handler(name))).toBe(message);
    });
  });
});
