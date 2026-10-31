import { createMongoAbility } from '@casl/ability';
import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import {
  DecideLossDto,
  LossCaseQueryDto,
  RecoverLossDto,
  ReportLossDto,
  TriageLossDto,
} from './dto/loss-case.dto';
import { LossCasesController } from './loss-cases.controller';
import { LossCaseService } from './loss-cases.service';

// devices api-design 17 to 22 and 27 (task 2.7): each route's permission, status and message, and the
// request bodies.
const STAFF = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

const metadataOf = (key: string, method: string): unknown =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(LossCasesController.prototype, method)?.value as object,
  );

const allows = (method: string, ability: PolicyAbility): boolean =>
  (metadataOf(CHECK_POLICIES_KEY, method) as PolicyHandler[]).every((handler) => handler(ability));

describe('LossCasesController (devices api-design 17 to 22 and 27)', () => {
  let service: Record<
    'report' | 'list' | 'get' | 'triage' | 'recover' | 'confirm' | 'decide',
    jest.Mock
  >;
  let controller: LossCasesController;

  beforeEach(() => {
    service = {
      report: jest.fn().mockResolvedValue({ id: 'lc-1' }),
      list: jest.fn().mockResolvedValue({ items: [] }),
      get: jest.fn().mockResolvedValue({ id: 'lc-1' }),
      triage: jest.fn().mockResolvedValue({ id: 'lc-1' }),
      recover: jest.fn().mockResolvedValue({ id: 'lc-1' }),
      confirm: jest.fn().mockResolvedValue({ id: 'lc-1' }),
      decide: jest.fn().mockResolvedValue({ id: 'lc-1' }),
    };
    controller = new LossCasesController(service as unknown as LossCaseService);
  });

  it('passes each request to the service with the caller', async () => {
    await controller.report('d-1', { description: 'x' }, STAFF);
    expect(service.report).toHaveBeenCalledWith('d-1', { description: 'x' }, STAFF);
    await controller.list({ state: 'SEARCHING' }, STAFF);
    expect(service.list).toHaveBeenCalledWith({ state: 'SEARCHING' }, STAFF);
    await controller.get('lc-1', STAFF);
    expect(service.get).toHaveBeenCalledWith('lc-1', STAFF);
    await controller.triage('lc-1', { suspectedTheft: false, expectedVersion: 0 }, STAFF);
    expect(service.triage).toHaveBeenCalledWith(
      'lc-1',
      { suspectedTheft: false, expectedVersion: 0 },
      STAFF,
    );
    await controller.recover('lc-1', { note: 'x', expectedVersion: 1 }, STAFF);
    expect(service.recover).toHaveBeenCalledWith('lc-1', { note: 'x', expectedVersion: 1 }, STAFF);
    await controller.confirm('lc-1', { expectedVersion: 1 }, STAFF);
    expect(service.confirm).toHaveBeenCalledWith('lc-1', { expectedVersion: 1 }, STAFF);
    await controller.decide('lc-1', { decision: 'CHARGED', expectedVersion: 2 }, STAFF);
    expect(service.decide).toHaveBeenCalledWith(
      'lc-1',
      { decision: 'CHARGED', expectedVersion: 2 },
      STAFF,
    );
  });

  it.each([
    ['report', 'report', HttpStatus.CREATED, 'Loss reported. TrekLink will contact you.'],
    ['triage', 'operate', HttpStatus.OK, 'Loss case triaged'],
    ['recover', 'operate', HttpStatus.OK, 'Device recovered'],
    ['confirm', 'operate', HttpStatus.OK, 'Loss confirmed'],
    ['decide', 'decide', HttpStatus.OK, 'Loss case settled'],
  ])('checks %s against %s on LossCase, answering %d "%s"', (method, action, status, message) => {
    const can = jest.fn().mockReturnValue(true);
    expect(allows(method, { can })).toBe(true);
    expect(can).toHaveBeenCalledWith(action, 'LossCase');
    expect(metadataOf(HTTP_CODE_METADATA, method)).toBe(status);
    expect(metadataOf(RESPONSE_MESSAGE_KEY, method)).toBe(message);
  });

  it('reads with the read action on LossCase', () => {
    for (const method of ['list', 'get']) {
      const can = jest.fn().mockReturnValue(true);
      expect(allows(method, { can })).toBe(true);
      expect(can).toHaveBeenCalledWith('read', 'LossCase');
    }
  });

  it('follows the permission matrix: Staff operate, only an Admin decides, a Manager reports and reads', () => {
    const staff = createMongoAbility([
      { action: 'read', subject: 'LossCase' },
      { action: 'report', subject: 'LossCase' },
      { action: 'operate', subject: 'LossCase' },
    ]);
    const admin = createMongoAbility([
      { action: 'read', subject: 'LossCase' },
      { action: 'report', subject: 'LossCase' },
      { action: 'operate', subject: 'LossCase' },
      { action: 'decide', subject: 'LossCase' },
    ]);
    const manager = createMongoAbility([
      { action: 'read', subject: 'LossCase', conditions: { organizationId: 'org-1' } },
      { action: 'report', subject: 'LossCase', conditions: { organizationId: 'org-1' } },
    ]);
    const operator = createMongoAbility([{ action: 'read', subject: 'RentalContract' }]);

    expect(['report', 'triage', 'recover', 'confirm'].every((m) => allows(m, staff))).toBe(true);
    expect(allows('decide', staff)).toBe(false);
    expect(allows('decide', admin)).toBe(true);
    expect(allows('report', manager)).toBe(true);
    expect(allows('list', manager)).toBe(true);
    expect(['triage', 'recover', 'confirm', 'decide'].some((m) => allows(m, manager))).toBe(false);
    expect(['report', 'list', 'get'].some((m) => allows(m, operator))).toBe(false);
  });

  it('validates the bodies and the query', async () => {
    const errorsOf = async (cls: new () => object, body: object) =>
      (await validate(plainToInstance(cls, body))).map((error) => error.property);

    expect(await errorsOf(ReportLossDto, { description: ' Lost near camp ' })).toEqual([]);
    expect(await errorsOf(ReportLossDto, { description: '   ' })).toEqual(['description']);
    expect(await errorsOf(ReportLossDto, { description: 'x'.repeat(1001) })).toEqual([
      'description',
    ]);

    expect(await errorsOf(TriageLossDto, { suspectedTheft: false, expectedVersion: 0 })).toEqual(
      [],
    );
    expect(
      await errorsOf(TriageLossDto, { suspectedTheft: 'no', policeReference: 'x'.repeat(61) }),
    ).toEqual(['suspectedTheft', 'policeReference', 'expectedVersion']);

    expect(await errorsOf(RecoverLossDto, { note: '', expectedVersion: 1 })).toEqual(['note']);

    expect(
      await errorsOf(DecideLossDto, {
        decision: 'REDUCED',
        chargeVnd: 900000,
        reason: 'x',
        expectedVersion: 2,
      }),
    ).toEqual([]);
    expect(await errorsOf(DecideLossDto, { decision: 'FORGIVEN', chargeVnd: -1 })).toEqual([
      'decision',
      'chargeVnd',
      'expectedVersion',
    ]);

    expect(await errorsOf(LossCaseQueryDto, { state: 'SEARCHING', pageNumber: '2' })).toEqual([]);
    expect(await errorsOf(LossCaseQueryDto, { state: 'LOST' })).toEqual(['state']);
  });

  it('turns a blank police reference and a blank reason into null', () => {
    const triage = plainToInstance(TriageLossDto, {
      suspectedTheft: false,
      policeReference: '  ',
      expectedVersion: 0,
    });
    expect(triage.policeReference).toBeNull();
    const decide = plainToInstance(DecideLossDto, {
      decision: 'CHARGED',
      reason: ' ',
      expectedVersion: 0,
    });
    expect(decide.reason).toBeNull();
  });
});
