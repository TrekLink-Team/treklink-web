import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContractStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrganizationsService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { CONTRACT_REQUESTED, ContractRequestedEvent } from './contract-notification.events';
import { ContractNotificationsListener } from './contract-notifications.listener';
import { ContractsRepository } from './contracts.repository';

const event = { contractId: 'c-1', organizationId: 'org-1' };
const build = () => {
  const contracts = { detail: jest.fn().mockResolvedValue({ code: 'RC-2026-0001' }) };
  const organizations = { emailContact: jest.fn().mockResolvedValue(true) };
  const staff = { send: jest.fn().mockResolvedValue({ accepted: 1, failed: 0 }) };
  const listener = new ContractNotificationsListener(
    contracts as unknown as ContractsRepository,
    organizations as unknown as OrganizationsService,
    staff,
  );
  return { listener, contracts, organizations, staff };
};

describe('ContractNotificationsListener', () => {
  it('notifies Staff only after a request commits, and never after rollback', async () => {
    const { listener, staff } = build();
    const emitter = new EventEmitter2();
    emitter.on(CONTRACT_REQUESTED, (payload: ContractRequestedEvent) => {
      void listener.requested(payload);
    });
    const prisma = {
      $transaction: (work: (tx: object) => unknown) => work({}),
    } as unknown as PrismaService;
    const events = new TransactionalEvents(prisma, emitter);
    await expect(
      events.transaction(() => {
        events.emitAfterCommit(CONTRACT_REQUESTED, event);
        expect(staff.send).not.toHaveBeenCalled();
        return Promise.reject(new Error('rollback'));
      }),
    ).rejects.toThrow('rollback');
    expect(staff.send).not.toHaveBeenCalled();
    await events.transaction(() => {
      events.emitAfterCommit(CONTRACT_REQUESTED, event);
      expect(staff.send).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    await new Promise(setImmediate);
    expect(staff.send).toHaveBeenCalledWith(
      expect.stringContaining('RC-2026-0001'),
      expect.any(String),
    );
  });

  it.each([
    ContractStatus.APPROVED,
    ContractStatus.REJECTED,
    ContractStatus.OVERDUE,
    ContractStatus.DEFAULTED,
  ])('emails the owning organization about %s', async (to) => {
    const { listener, organizations } = build();
    await listener.changed({ ...event, from: ContractStatus.REQUESTED, to, at: new Date() });
    expect(organizations.emailContact).toHaveBeenCalledWith(
      'org-1',
      expect.stringContaining('RC-2026-0001'),
      expect.stringContaining(to),
    );
  });

  it('does not send unrelated states, and logs a failed send without failing the business operation', async () => {
    const { listener, organizations, staff } = build();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await listener.changed({
        ...event,
        from: ContractStatus.APPROVED,
        to: ContractStatus.ACTIVE,
        at: new Date(),
      });
      expect(organizations.emailContact).not.toHaveBeenCalled();
      staff.send.mockRejectedValue(new Error('offline'));
      await expect(listener.requested(event)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no automatic retry'));
    } finally {
      warn.mockRestore();
    }
  });
});
