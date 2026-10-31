import { createMongoAbility } from '@casl/ability';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { ContractReadsService } from './contract-reads.service';
import { UndoProvisioningDto } from './dto/contract-decision.dto';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';

const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };

const handlerOf = (name: keyof HandoverController) =>
  Object.getOwnPropertyDescriptor(HandoverController.prototype, name)?.value as object;

const allows = (name: keyof HandoverController, rules: { action: string; subject: string }[]) =>
  (Reflect.getMetadata(CHECK_POLICIES_KEY, handlerOf(name)) as PolicyHandler[]).every((handler) =>
    handler(createMongoAbility(rules) as PolicyAbility),
  );

describe('HandoverController undo of provisioning (rentals api-design 19)', () => {
  it('needs the permission of api-design 09 and answers "Provisioning undone"', () => {
    const operate = [{ action: 'operate', subject: 'RentalContract' }];
    expect(allows('undoProvisioning', operate)).toBe(true);
    expect(allows('provision', operate)).toBe(true);
    expect(allows('undoProvisioning', [{ action: 'read', subject: 'RentalContract' }])).toBe(false);
    expect(allows('undoProvisioning', [])).toBe(false);
    expect(Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handlerOf('undoProvisioning'))).toBe(
      'Provisioning undone',
    );
  });

  it('takes the contract version the caller saw, a whole number from 0', async () => {
    const errorsOf = async (plain: Record<string, unknown>) =>
      validate(plainToInstance(UndoProvisioningDto, plain));
    expect(await errorsOf({ expectedVersion: 0 })).toHaveLength(0);
    expect(await errorsOf({})).not.toHaveLength(0);
    expect(await errorsOf({ expectedVersion: -1 })).not.toHaveLength(0);
    expect(await errorsOf({ expectedVersion: 1.5 })).not.toHaveLength(0);
  });

  it('undoes through the service and answers the cleared unit with the next contract version', async () => {
    const handover = {
      undoProvisioning: jest.fn().mockResolvedValue({
        device: {
          id: 'd-1',
          assetTag: 'TL-0001',
          status: 'RESERVED',
          keyVersion: null,
          keyOrganizationId: null,
          provisionedAt: null,
          batteryPct: 80,
        },
        contractVersion: 4,
      }),
    };
    const controller = new HandoverController(
      handover as unknown as HandoverService,
      {} as ContractReadsService,
    );

    await expect(
      controller.undoProvisioning('c-1', 'd-1', { expectedVersion: 3 }, STAFF),
    ).resolves.toEqual({
      deviceId: 'd-1',
      assetTag: 'TL-0001',
      status: 'RESERVED',
      keyVersion: null,
      keyOrganizationId: null,
      provisionedAt: null,
      contractVersion: 4,
    });
    expect(handover.undoProvisioning).toHaveBeenCalledWith('c-1', 'd-1', 3, STAFF);
  });
});
