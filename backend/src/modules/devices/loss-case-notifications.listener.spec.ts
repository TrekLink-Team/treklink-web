import { LossCustody } from '@prisma/client';
import { LossCaseNotificationsListener } from './loss-case-notifications.listener';

// After-commit notices of a loss case (task 2.7).
describe('LossCaseNotificationsListener', () => {
  const reported = {
    lossCaseId: 'lc-1',
    code: 'LOSS-0001',
    assetTag: 'TL-0042',
    byOrganization: true,
  };
  const triaged = {
    lossCaseId: 'lc-1',
    code: 'LOSS-0001',
    assetTag: 'TL-0042',
    custody: LossCustody.RENTER,
    organizationId: 'org-1',
  };

  it('emails TrekLink Staff on a report', async () => {
    const staff = { send: jest.fn().mockResolvedValue({ accepted: 2, failed: 0 }) };
    const listener = new LossCaseNotificationsListener({} as never, staff);
    await listener.reported(reported);
    expect(staff.send).toHaveBeenCalledWith(
      'TrekLink loss case LOSS-0001: TL-0042 reported lost',
      expect.stringContaining('by its renting organization'),
    );
  });

  it('never throws when the email fails or no transport exists', async () => {
    const staff = { send: jest.fn().mockRejectedValue(new Error('smtp down')) };
    await expect(
      new LossCaseNotificationsListener({} as never, staff).reported(reported),
    ).resolves.toBeUndefined();
    await expect(
      new LossCaseNotificationsListener({} as never).reported(reported),
    ).resolves.toBeUndefined();
  });

  it('tells the organization its key is exposed for RENTER custody only', async () => {
    const organizations = { emailContact: jest.fn().mockResolvedValue(true) };
    const listener = new LossCaseNotificationsListener(organizations as never);
    await listener.triaged(triaged);
    expect(organizations.emailContact).toHaveBeenCalledWith(
      'org-1',
      'TrekLink loss case LOSS-0001: channel key exposed',
      expect.stringContaining('must be rotated'),
    );
    organizations.emailContact.mockClear();
    await listener.triaged({ ...triaged, custody: LossCustody.TREKLINK, organizationId: null });
    expect(organizations.emailContact).not.toHaveBeenCalled();
  });
});
