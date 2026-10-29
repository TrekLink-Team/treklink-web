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
