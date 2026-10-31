import { OnboardingNotifier } from './onboarding.notifier';
import { OrganizationsService } from './organizations.service';

const REGISTERED = { organizationId: 'org-1', code: 'ORG-0007', legalName: 'ACME Trek' };

describe('OnboardingNotifier (REQ-EVT-01 to REQ-EVT-03, MSG05, MSG16)', () => {
  let staff: { send: jest.Mock };
  let organizations: { emailContact: jest.Mock };
  let notifier: OnboardingNotifier;

  const build = (withStaff = true) =>
    new OnboardingNotifier(
      organizations as unknown as OrganizationsService,
      withStaff ? staff : undefined,
    );

  beforeEach(() => {
    staff = { send: jest.fn().mockResolvedValue({ accepted: 3, failed: 0 }) };
    organizations = { emailContact: jest.fn().mockResolvedValue(true) };
    notifier = build();
  });

  describe('Staff and Admin', () => {
    it('tells Staff of a registration, with the code and the legal name', async () => {
      await notifier.onRegistered(REGISTERED);

      expect(staff.send).toHaveBeenCalledWith(
        'TrekLink organization ORG-0007: new registration',
        expect.stringContaining('ACME Trek registered as ORG-0007'),
      );
    });

    it('tells Staff and Admin that a verified organization awaits approval', async () => {
      await notifier.onVerified(REGISTERED);

      expect(staff.send).toHaveBeenCalledWith(
        'TrekLink organization ORG-0007: awaiting approval',
        expect.stringContaining('awaits approval'),
      );
    });

    it('logs and carries on when nobody is reached, there is no port, or the send fails', async () => {
      staff.send.mockResolvedValueOnce({ accepted: 0, failed: 0 });
      await expect(notifier.onRegistered(REGISTERED)).resolves.toBeUndefined();

      await expect(build(false).onRegistered(REGISTERED)).resolves.toBeUndefined();

      staff.send.mockRejectedValueOnce(new Error('smtp down'));
      await expect(notifier.onVerified(REGISTERED)).resolves.toBeUndefined();
      expect(staff.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('the Manager', () => {
    it('emails MSG05 when a PENDING organization becomes ACTIVE', async () => {
      await notifier.onStatusChanged({ organizationId: 'org-1', from: 'PENDING', to: 'ACTIVE' });

      expect(organizations.emailContact).toHaveBeenCalledWith(
        'org-1',
        'TrekLink organization approved',
        'Your organization is approved. You can now invite members and request devices.',
      );
    });

    it('emails MSG16 with the reason when a PENDING organization is rejected', async () => {
      await notifier.onStatusChanged({
        organizationId: 'org-1',
        from: 'PENDING',
        to: 'REJECTED',
        reason: 'Licence not valid',
      });

      expect(organizations.emailContact).toHaveBeenCalledWith(
        'org-1',
        'TrekLink organization request not accepted',
        'Your request was not accepted: Licence not valid.',
      );
    });

    it('says so when a rejection carries no reason', async () => {
      await notifier.onStatusChanged({ organizationId: 'org-1', from: 'PENDING', to: 'REJECTED' });

      expect(organizations.emailContact).toHaveBeenCalledWith(
        'org-1',
        expect.any(String),
        'Your request was not accepted: no reason was given.',
      );
    });

    it('leaves every other change alone: suspension and reactivation have their own emails', async () => {
      await notifier.onStatusChanged({ organizationId: 'org-1', from: 'ACTIVE', to: 'SUSPENDED' });
      await notifier.onStatusChanged({ organizationId: 'org-1', from: 'SUSPENDED', to: 'ACTIVE' });
      await notifier.onStatusChanged({ organizationId: 'org-1', from: 'PENDING', to: 'PENDING' });

      expect(organizations.emailContact).not.toHaveBeenCalled();
    });

    it('logs and never throws when the email is not sent or the address cannot be read', async () => {
      organizations.emailContact.mockResolvedValueOnce(false);
      await expect(
        notifier.onStatusChanged({ organizationId: 'org-1', from: 'PENDING', to: 'ACTIVE' }),
      ).resolves.toBeUndefined();

      organizations.emailContact.mockRejectedValueOnce(new Error('db down'));
      await expect(
        notifier.onStatusChanged({ organizationId: 'org-1', from: 'PENDING', to: 'ACTIVE' }),
      ).resolves.toBeUndefined();
      expect(organizations.emailContact).toHaveBeenCalledTimes(2);
    });
  });
});
