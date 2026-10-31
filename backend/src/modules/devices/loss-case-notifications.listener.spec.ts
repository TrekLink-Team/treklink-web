import { LossCaseNotificationsListener } from './loss-case-notifications.listener';

// After-commit notice of a loss case (task 2.7): Staff hear of a report.
describe('LossCaseNotificationsListener', () => {
  const reported = {
    lossCaseId: 'lc-1',
    code: 'LOSS-0001',
    assetTag: 'TL-0042',
    byOrganization: true,
  };

  it('emails TrekLink Staff on a report', async () => {
    const staff = { send: jest.fn().mockResolvedValue({ accepted: 2, failed: 0 }) };
    const listener = new LossCaseNotificationsListener(staff);
    await listener.reported(reported);
    expect(staff.send).toHaveBeenCalledWith(
      'TrekLink loss case LOSS-0001: TL-0042 reported lost',
      expect.stringContaining('by its renting organization'),
    );
  });

  it('never throws when the email fails or no transport exists', async () => {
    const staff = { send: jest.fn().mockRejectedValue(new Error('smtp down')) };
    await expect(
      new LossCaseNotificationsListener(staff).reported(reported),
    ).resolves.toBeUndefined();
    await expect(new LossCaseNotificationsListener().reported(reported)).resolves.toBeUndefined();
  });
});
