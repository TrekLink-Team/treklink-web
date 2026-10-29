import { AccountsService } from '../auth';
import { MembersRepository } from './members.repository';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

// The name read the MF-03 PR adds for incidents (owner, status authors, MSG27).
describe('OrganizationsService.memberNames', () => {
  it('reads each account once through contactCard, and nothing for no ids', async () => {
    const contactCard = jest.fn().mockResolvedValue([{ id: 'u-1', fullName: 'Pham Van D' }]);
    const service = new OrganizationsService(
      {} as OrganizationsRepository,
      {} as MembersRepository,
      { contactCard } as unknown as AccountsService,
    );
    await expect(service.memberNames([])).resolves.toEqual(new Map());
    expect(contactCard).not.toHaveBeenCalled();
    await expect(service.memberNames(['u-1', 'u-1'])).resolves.toEqual(
      new Map([['u-1', 'Pham Van D']]),
    );
    expect(contactCard).toHaveBeenCalledWith(['u-1']);
  });
});

// The two other reads the incident and rentals paths call on this service.
describe('OrganizationsService reads for other modules', () => {
  const service = (organizations: Partial<Record<keyof OrganizationsRepository, jest.Mock>>) =>
    new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      {} as MembersRepository,
      {} as AccountsService,
    );

  it('answers 404 for the members or summary of an unknown organization', async () => {
    const organizations = service({
      findStatus: jest.fn().mockResolvedValue(null),
      findSummary: jest.fn().mockResolvedValue(null),
    });
    const staff = { id: 's-1', roles: ['STAFF'], organizationId: null };
    await expect(organizations.membersOf('org-9', false, staff)).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
    });
    await expect(organizations.summary('org-9', staff)).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
    });
  });

  it('lists a member whose account card is missing with empty contact fields', async () => {
    const row = { id: 'm-1', userId: 'u-gone', role: 'OPERATOR', deactivatedAt: null };
    const organizations = new OrganizationsService(
      { findStatus: jest.fn().mockResolvedValue('ACTIVE') } as unknown as OrganizationsRepository,
      { membersOf: jest.fn().mockResolvedValue([row]) } as unknown as MembersRepository,
      { contactCard: jest.fn().mockResolvedValue([]) } as unknown as AccountsService,
    );
    await expect(
      organizations.membersOf('org-1', false, {
        id: 's-1',
        roles: ['STAFF'],
        organizationId: null,
      }),
    ).resolves.toEqual([
      {
        id: 'm-1',
        userId: 'u-gone',
        email: null,
        fullName: null,
        role: 'OPERATOR',
        invitationPending: false,
        deactivatedAt: null,
      },
    ]);
  });

  it('returns the channel key version, and 404 for an unknown organization', async () => {
    const channelKeyVersion = jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(null);
    const organizations = service({ channelKeyVersion });
    await expect(organizations.channelKeyVersion('org-1')).resolves.toBe(3);
    await expect(organizations.channelKeyVersion('org-9')).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
    });
  });

  it('labels each organization once by id, and reads nothing for no ids', async () => {
    const row = { id: 'org-1', code: 'ORG-0001', legalName: 'ACME' };
    const labels = jest.fn().mockResolvedValue([row]);
    const organizations = service({ labels });
    await expect(organizations.labelsOf([])).resolves.toEqual(new Map());
    expect(labels).not.toHaveBeenCalled();
    await expect(organizations.labelsOf(['org-1', 'org-1'])).resolves.toEqual(
      new Map([['org-1', row]]),
    );
    expect(labels).toHaveBeenCalledWith(['org-1'], undefined);
  });
});
