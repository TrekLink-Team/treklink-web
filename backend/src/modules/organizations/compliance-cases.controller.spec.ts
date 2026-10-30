import { ComplianceActionKind, ComplianceCaseType } from '@prisma/client';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../../common/decorators/access.decorator';
import { ComplianceCasesController } from './compliance-cases.controller';
import { ComplianceCasesService } from './compliance-cases.service';

const ORG = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const CASE_ID = 'c4d3e2f1-a0b9-4c8d-9e7f-6a5b4c3d2e1f';
const STAFF = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const ADMIN = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };

const policyOf = (
  method: 'page' | 'detail' | 'open' | 'act' | 'close',
): PolicyHandler => {
  const handler = Object.getOwnPropertyDescriptor(ComplianceCasesController.prototype, method)!
    .value as object;
  return (Reflect.getMetadata(CHECK_POLICIES_KEY, handler) as PolicyHandler[])[0];
};

describe('ComplianceCasesController (api-design 28 to 32)', () => {
  const cases = {
    page: jest.fn().mockResolvedValue({ items: [] }),
    get: jest.fn().mockResolvedValue({ id: CASE_ID }),
    open: jest.fn().mockResolvedValue({ id: CASE_ID }),
    act: jest.fn().mockResolvedValue({ id: CASE_ID }),
    close: jest.fn().mockResolvedValue({ id: CASE_ID }),
  };
  const controller = new ComplianceCasesController(cases as unknown as ComplianceCasesService);

  it('hands the list and detail routes to the service', async () => {
    await controller.page({ status: undefined });
    expect(cases.page).toHaveBeenCalledWith({ status: undefined });
    await controller.detail(CASE_ID);
    expect(cases.get).toHaveBeenCalledWith(CASE_ID);
  });

  it('opens a case with trimmed evidence and defaulted link arrays', async () => {
    await controller.open(ORG, { type: ComplianceCaseType.OTHER_BREACH, evidence: ' Evidence ' }, STAFF);
    expect(cases.open).toHaveBeenCalledWith(
      ORG,
      {
        type: ComplianceCaseType.OTHER_BREACH,
        evidence: 'Evidence',
        linkedContractIds: [],
        linkedLossCaseIds: [],
      },
      STAFF,
    );
  });

  it('records an action with the caller ability as maySuspend', async () => {
    const ability = { can: () => true };
    await controller.act(
      CASE_ID,
      { kind: ComplianceActionKind.SUSPEND_ORGANIZATION, note: 'Default' },
      ADMIN,
      ability,
    );
    expect(cases.act).toHaveBeenCalledWith(
      CASE_ID,
      { kind: ComplianceActionKind.SUSPEND_ORGANIZATION, targetId: null, note: 'Default' },
      ADMIN,
      true,
    );
  });

  it('closes a case with a trimmed outcome', async () => {
    await controller.close(CASE_ID, { outcome: ' Resolved ' }, STAFF);
    expect(cases.close).toHaveBeenCalledWith(CASE_ID, 'Resolved', null, STAFF);
  });

  it('checks complianceCase.manage on every route', () => {
    const asked: [string, string][] = [];
    const ability = {
      can: (action: string, subject: string | object) => {
        asked.push([action, typeof subject === 'string' ? subject : 'object']);
        return true;
      },
    };
    policyOf('page')(ability);
    policyOf('detail')(ability);
    policyOf('open')(ability);
    policyOf('act')(ability);
    policyOf('close')(ability);
    expect(asked).toEqual([
      ['manage', 'ComplianceCase'],
      ['manage', 'ComplianceCase'],
      ['manage', 'ComplianceCase'],
      ['manage', 'ComplianceCase'],
      ['manage', 'ComplianceCase'],
    ]);
  });
});
