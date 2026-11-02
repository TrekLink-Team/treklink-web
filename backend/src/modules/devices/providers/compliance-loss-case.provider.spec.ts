import { Prisma } from '@prisma/client';
import { ComplianceLossCaseProvider } from '../../organizations';
import { LossCasesRepository } from '../loss-cases.repository';
import { DevicesComplianceLossCases } from './compliance-loss-case.provider';

const TX = { tx: true } as unknown as Prisma.TransactionClient;

describe('DevicesComplianceLossCases', () => {
  let repository: {
    codesOfComplianceCases: jest.Mock;
    findManyForLink: jest.Mock;
    linkToComplianceCase: jest.Mock;
  };
  let provider: DevicesComplianceLossCases;

  beforeEach(() => {
    repository = {
      codesOfComplianceCases: jest.fn().mockResolvedValue([]),
      findManyForLink: jest.fn().mockResolvedValue([]),
      linkToComplianceCase: jest.fn().mockResolvedValue(undefined),
    };
    provider = new DevicesComplianceLossCases(repository as unknown as LossCasesRepository);
  });

  it('adds itself to the array of the port', () => {
    const providers: ComplianceLossCaseProvider[] = [];
    const registered = new DevicesComplianceLossCases(
      repository as unknown as LossCasesRepository,
      providers,
    );
    expect(providers).toEqual([registered]);
  });

  it('groups the loss case codes by compliance case', async () => {
    repository.codesOfComplianceCases.mockResolvedValue([
      { code: 'LOSS-0001', complianceCaseId: 'case-1' },
      { code: 'LOSS-0002', complianceCaseId: 'case-2' },
      { code: 'LOSS-0003', complianceCaseId: 'case-1' },
    ]);
    const codes = await provider.codesOf(['case-1', 'case-2', 'case-3']);
    expect(codes.get('case-1')).toEqual(['LOSS-0001', 'LOSS-0003']);
    expect(codes.get('case-2')).toEqual(['LOSS-0002']);
    expect(codes.has('case-3')).toBe(false);
  });

  it('links loss cases of the organization in the given transaction', async () => {
    repository.findManyForLink.mockResolvedValue([
      { id: 'loss-1', organizationId: 'org-1', complianceCaseId: null },
      { id: 'loss-2', organizationId: 'org-1', complianceCaseId: 'case-1' },
    ]);
    await provider.link('case-1', 'org-1', ['loss-1', 'loss-2'], TX);
    expect(repository.linkToComplianceCase).toHaveBeenCalledWith(
      ['loss-1', 'loss-2'],
      'case-1',
      TX,
    );
  });

  it.each([
    ['is unknown', []],
    [
      'belongs to another organization',
      [{ id: 'loss-1', organizationId: 'org-2', complianceCaseId: null }],
    ],
    [
      'is linked to another case',
      [{ id: 'loss-1', organizationId: 'org-1', complianceCaseId: 'case-9' }],
    ],
  ])('refuses with 400 a loss case that %s, linking nothing', async (_name, rows) => {
    repository.findManyForLink.mockResolvedValue(rows);
    await expect(provider.link('case-1', 'org-1', ['loss-1'], TX)).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED',
    });
    expect(repository.linkToComplianceCase).not.toHaveBeenCalled();
  });
});
