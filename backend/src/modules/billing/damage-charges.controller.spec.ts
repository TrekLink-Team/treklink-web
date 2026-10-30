import { DamageChargeStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DamageChargeService } from './damage-charge.service';
import { DamageChargesController } from './damage-charges.controller';
import { DamageDecisionDto } from './dto/damage-charges.dto';

const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
const CHARGE = {
  id: 'dc-1',
  inspectionId: 'insp-1',
  deviceId: 'dev-1',
  contractId: 'c-1',
  inspectorId: 'u-staff',
  damageCodes: ['CASING_CRACKED'],
  amountVnd: 700_000n,
  finalVnd: null,
  status: DamageChargeStatus.PENDING_APPROVAL,
  decidedById: null,
  decisionNote: null,
  decidedAt: null,
  createdAt: new Date('2026-10-29T03:00:00.000Z'),
};

// billing api-design 16 and 17 (UC-48).
describe('DamageChargesController', () => {
  it('lists the charges with numbers for the amounts (api-design 16)', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({
        items: [
          { ...CHARGE, assetTag: 'TL-0001', inspector: { id: 'u-staff', fullName: 'Demo Staff' } },
        ],
        pageNumber: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
      }),
    };
    const controller = new DamageChargesController(service as unknown as DamageChargeService);
    const page = await controller.list({ status: DamageChargeStatus.PENDING_APPROVAL });
    expect(service.list).toHaveBeenCalledWith(
      { status: DamageChargeStatus.PENDING_APPROVAL, contractId: undefined },
      { status: DamageChargeStatus.PENDING_APPROVAL },
    );
    expect(page.items[0]).toMatchObject({
      id: 'dc-1',
      assetTag: 'TL-0001',
      damageCodes: ['CASING_CRACKED'],
      amountVnd: 700_000,
      finalVnd: null,
      inspector: { id: 'u-staff', fullName: 'Demo Staff' },
    });
  });

  it('answers a decision with the api-design 17 result', async () => {
    const decidedAt = new Date('2026-10-30T04:00:00.000Z');
    const service = {
      decide: jest.fn().mockResolvedValue({
        ...CHARGE,
        status: DamageChargeStatus.REDUCED,
        finalVnd: 400_000n,
        decidedAt,
      }),
    };
    const controller = new DamageChargesController(service as unknown as DamageChargeService);
    await expect(
      controller.decide(
        'dc-1',
        { decision: 'REDUCED', finalVnd: 400_000, note: 'Old crack' },
        ADMIN,
      ),
    ).resolves.toEqual({
      id: 'dc-1',
      status: DamageChargeStatus.REDUCED,
      amountVnd: 700_000,
      finalVnd: 400_000,
      decidedAt,
    });
    expect(service.decide).toHaveBeenCalledWith(
      'dc-1',
      { decision: 'REDUCED', finalVnd: 400_000, note: 'Old crack' },
      ADMIN,
    );
  });

  const metadataOf = (key: string, method: string): unknown =>
    Reflect.getMetadata(
      key,
      Object.getOwnPropertyDescriptor(DamageChargesController.prototype, method)?.value as object,
    );

  it.each([
    ['list', 'read'],
    ['decide', 'decide'],
  ])('checks %s against %s on DamageCharge', (method, action) => {
    const can = jest.fn().mockReturnValue(true);
    const ability: PolicyAbility = { can };
    const handlers = metadataOf(CHECK_POLICIES_KEY, method) as PolicyHandler[];
    expect(handlers.every((handler) => handler(ability))).toBe(true);
    expect(can).toHaveBeenCalledWith(action, 'DamageCharge');
  });

  it('answers the decision with "Decision recorded" (api-design 17)', () => {
    expect(metadataOf(RESPONSE_MESSAGE_KEY, 'decide')).toBe('Decision recorded');
  });

  it('requires finalVnd for REDUCED only, and a note that is not blank', async () => {
    const errorsOf = async (body: object) =>
      (await validate(plainToInstance(DamageDecisionDto, body))).map((error) => error.property);
    expect(await errorsOf({ decision: 'REDUCED', note: 'x' })).toContain('finalVnd');
    expect(await errorsOf({ decision: 'APPROVED', note: 'x' })).toEqual([]);
    expect(await errorsOf({ decision: 'WAIVED', note: '   ' })).toContain('note');
    expect(await errorsOf({ decision: 'CANCELLED', note: 'x' })).toContain('decision');
  });
});
