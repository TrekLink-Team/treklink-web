import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
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
