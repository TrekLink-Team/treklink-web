import { Logger } from '@nestjs/common';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { ContractReadsService } from './contract-reads.service';
import { ReplacementService } from './replacement.service';
import { ReturnController } from './return.controller';
import { ReturnService } from './return.service';

// rentals api-design 20 (REQ-EVT-18, D-092 rule 3): the close check is a Staff read of the counter.
describe('ReturnController close check', () => {
  const handlerOf = (method: string) =>
    Object.getOwnPropertyDescriptor(ReturnController.prototype, method)?.value as object;

  it('answers the service close check for the contract', async () => {
    const answer = { contractId: 'c-1', canClose: true, blockers: [] };
    const closeCheck = jest.fn().mockResolvedValue(answer);
    const controller = new ReturnController(
      { closeCheck } as unknown as ReturnService,
      {} as ContractReadsService,
      {} as ReplacementService,
    );
    await expect(controller.closeCheck('c-1')).resolves.toBe(answer);
    expect(closeCheck).toHaveBeenCalledWith('c-1');
  });

  it('needs operate on RentalContract and answers OK', () => {
    const can = jest.fn().mockReturnValue(true);
    const ability: PolicyAbility = { can };
    const policies = Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      handlerOf('closeCheck'),
    ) as PolicyHandler[];
    expect(policies.every((handler) => handler(ability))).toBe(true);
    expect(can).toHaveBeenCalledWith('operate', 'RentalContract');
    expect(Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handlerOf('closeCheck'))).toBe('OK');
  });
});

const STAFF_CALLER = { id: 'u-staff', roles: ['STAFF'], organizationId: null };

// treklink-web#535: Close is the last demo step of MF-05; a failed label read after the commit must not
// answer 500 for a contract that closed.
describe('ReturnController close', () => {
  it('answers success when the labels read after the commit fails', async () => {
    const closedAt = new Date('2026-11-22T09:00:00Z');
    const closed = {
      id: 'c-2',
      code: 'RC-2026-0002',
      organizationId: 'org-1',
      planType: 'MONTHLY',
      dayPlanDays: null,
      hardwareVariantId: 'v-3',
      quantity: 2,
      requestedStartDate: new Date('2026-10-01T00:00:00Z'),
      monthlyUnitPriceVnd: 450_000n,
      dayPremium: null,
      holdingFeeRatio: { toNumber: () => 0.5 },
      status: 'CLOSED',
      statusChangedAt: closedAt,
      handedOverAt: new Date('2026-10-01T02:00:00Z'),
      endsAt: closedAt,
      noticeGivenAt: null,
      returnDueAt: closedAt,
      version: 9,
    };
    const close = jest.fn().mockResolvedValue(closed);
    const reads = new ContractReadsService(
      {} as never,
      {
        labelsOf: jest.fn().mockRejectedValue(new Error('Server has closed the connection.')),
      } as unknown as OrganizationsService,
      { variants: jest.fn().mockResolvedValue([]) } as unknown as DevicesService,
      {} as never,
      {} as never,
    );
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const controller = new ReturnController(
      { close } as unknown as ReturnService,
      reads,
      {} as ReplacementService,
    );

    const answer = await controller.close('c-2', { expectedVersion: 8 }, STAFF_CALLER);

    expect(close).toHaveBeenCalledWith('c-2', 8, STAFF_CALLER);
    expect(answer).toMatchObject({ status: 'CLOSED', organization: null, closedAt });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
