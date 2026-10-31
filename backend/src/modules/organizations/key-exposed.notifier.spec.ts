import { Logger } from '@nestjs/common';
import { AccountsService } from '../auth';
import { KeyExposedNotifier } from './key-exposed.notifier';
import { MembersRepository } from './members.repository';
import { OrganizationsService } from './organizations.service';

const EVENT = { organizationId: 'org-1', at: new Date('2026-10-31T03:00:00.000Z') };

const card = (id: string, email: string | null, isActive = true) => ({
  id,
  email,
  isActive,
  fullName: id,
  phoneNumber: null,
  passwordSet: true,
});

describe('KeyExposedNotifier (REQ-EVT-13, AC-11)', () => {
  let members: { liveManagerUserIds: jest.Mock };
  let accounts: { contactCard: jest.Mock };
  let organizations: { emailContact: jest.Mock };
  let mail: { send: jest.Mock };
  let notifier: KeyExposedNotifier;

  const build = (withMail = true) =>
    new KeyExposedNotifier(
      members as unknown as MembersRepository,
      accounts as unknown as AccountsService,
      organizations as unknown as OrganizationsService,
      withMail ? mail : undefined,
    );

  beforeEach(() => {
    members = { liveManagerUserIds: jest.fn().mockResolvedValue(['u-1', 'u-2', 'u-3']) };
    accounts = {
      contactCard: jest
        .fn()
        .mockResolvedValue([
          card('u-1', 'a@acme.vn'),
          card('u-2', 'b@acme.vn'),
          card('u-3', 'c@acme.vn', false),
        ]),
    };
    organizations = { emailContact: jest.fn().mockResolvedValue(true) };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    notifier = build();
  });

  it('emails every live Manager with an active account, and nobody else', async () => {
    await notifier.onKeyExposed(EVENT);

    expect(members.liveManagerUserIds).toHaveBeenCalledWith('org-1');
    expect(accounts.contactCard).toHaveBeenCalledWith(['u-1', 'u-2', 'u-3']);
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@acme.vn',
        subject: 'Your organization channel key is exposed',
      }),
    );
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@acme.vn' }));
    expect(organizations.emailContact).not.toHaveBeenCalled();
  });

  it('falls back to the contact address when no Manager can be reached', async () => {
    accounts.contactCard.mockResolvedValue([card('u-1', null), card('u-3', 'c@acme.vn', false)]);

    await notifier.onKeyExposed(EVENT);

    expect(organizations.emailContact).toHaveBeenCalledWith(
      'org-1',
      'Your organization channel key is exposed',
      expect.stringContaining('channel key'),
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sends nothing without a mail transport, and logs that nobody was told', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(build(false).onKeyExposed(EVENT)).resolves.toBeUndefined();

    expect(mail.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No mail transport'));
    warn.mockRestore();
  });

  it('logs when the contact address fallback sends nothing', async () => {
    accounts.contactCard.mockResolvedValue([]);
    organizations.emailContact.mockResolvedValue(false);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await notifier.onKeyExposed(EVENT);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Nobody was emailed'));
    warn.mockRestore();
  });

  it('carries on with the next Manager when one send fails, and never throws', async () => {
    mail.send.mockRejectedValueOnce(new Error('smtp down'));

    await expect(notifier.onKeyExposed(EVENT)).resolves.toBeUndefined();

    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it('logs and does not throw when the Managers cannot be read', async () => {
    members.liveManagerUserIds.mockRejectedValue(new Error('db down'));

    await expect(notifier.onKeyExposed(EVENT)).resolves.toBeUndefined();

    expect(mail.send).not.toHaveBeenCalled();
  });
});
