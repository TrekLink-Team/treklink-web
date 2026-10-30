import { Prisma } from '@prisma/client';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { STAFF_NOTIFICATIONS } from '../../platform/ports';
import { AccountsRepository } from '../accounts.repository';
import { AuthPortsModule } from '../auth-ports.module';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { AuthStaffNotifications } from './staff-notifications.provider';

describe('AuthStaffNotifications', () => {
  it('resolves the global notifier with the same configured mail instance', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              MAIL_TRANSPORT: 'console',
              MAIL_FROM: 'test@example.invalid',
            }),
          ],
        }),
        AuthPortsModule,
      ],
    })
      .overrideProvider(AccountsRepository)
      .useValue({
        staffEmailRecipients: jest
          .fn()
          .mockResolvedValue([{ id: 's-1', email: 'staff@example.invalid' }]),
      })
      .compile();
    try {
      const mail = module.get<MailPort>(MAIL_PORT);
      const send = jest.spyOn(mail, 'send').mockResolvedValue(undefined);
      await expect(
        module.get<AuthStaffNotifications>(STAFF_NOTIFICATIONS).send('Test', 'Review'),
      ).resolves.toEqual({ accepted: 1, failed: 0 });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await module.close();
    }
  });

  it('emails every active Staff/Admin recipient and continues after a transport failure', async () => {
    const accounts = {
      staffEmailRecipients: jest.fn().mockResolvedValue([
        { id: 'staff-1', email: 'staff@example.invalid' },
        { id: 'admin-1', email: 'admin@example.invalid' },
      ]),
    };
    const send = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const provider = new AuthStaffNotifications(accounts as unknown as AccountsRepository, {
      send,
    });
    await expect(provider.send('Request', 'Review it')).resolves.toEqual({
      accepted: 1,
      failed: 1,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports nothing accepted with no active recipients, rather than flagging a delivered reminder', async () => {
    const accounts = { staffEmailRecipients: jest.fn().mockResolvedValue([]) };
    const send = jest.fn();
    await expect(
      new AuthStaffNotifications(accounts as unknown as AccountsRepository, { send }).send(
        'Request',
        'Review it',
      ),
    ).resolves.toEqual({ accepted: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('reads only eligible TrekLink recipients through the caller transaction', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'staff-1', email: 'staff@example.invalid' }]);
    const outside = jest.fn();
    const tx = { user: { findMany } } as unknown as Prisma.TransactionClient;
    const accounts = new AccountsRepository({
      user: { findMany: outside },
    } as unknown as PrismaService);
    const send = jest.fn().mockResolvedValue(undefined);
    await expect(
      new AuthStaffNotifications(accounts, { send }).send('Request', 'Review it', tx),
    ).resolves.toEqual({ accepted: 1, failed: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountType: 'TREKLINK',
          isActive: true,
          deletedAt: null,
          roles: { some: { role: { key: { in: ['STAFF', 'ADMIN'] } } } },
        },
      }),
    );
    expect(outside).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      to: 'staff@example.invalid',
      subject: 'Request',
      text: 'Review it',
    });
  });
});
