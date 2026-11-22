import { HttpStatus, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import {
  PRISMA_CLIENT_OPTIONS,
  PrismaService,
  TRANSACTION_MAX_WAIT_MS,
} from '../../../common/prisma/prisma.service';
import { SLOW_LINK_TRANSACTION, TransactionalEvents } from './emit-after-commit';

// `$transaction` runs the callback with a stand-in client and resolves or rejects with it, which
// is all the event queue depends on.
const prismaStub = () =>
  ({
    $transaction: jest.fn((work: (tx: object) => Promise<unknown>) => work({})),
  }) as unknown as PrismaService;

describe('TransactionalEvents', () => {
  let emitter: EventEmitter2;
  let events: TransactionalEvents;
  let received: string[];

  beforeEach(() => {
    emitter = new EventEmitter2();
    events = new TransactionalEvents(prismaStub(), emitter);
    received = [];
  });

  it('emits at once outside a transaction', () => {
    const emitted = jest.spyOn(emitter, 'emit');

    events.emitAfterCommit('sample.changed', { id: 'a' });

    expect(emitted).toHaveBeenCalledWith('sample.changed', { id: 'a' });
  });

  it('emits a committed transaction event once, after the work resolves', async () => {
    const emitted = jest.spyOn(emitter, 'emit');

    const result = await events.transaction(() => {
      events.emitAfterCommit('sample.changed', { id: 'b' });
      expect(emitted).not.toHaveBeenCalled();
      return Promise.resolve('done');
    });

    expect(result).toBe('done');
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveBeenCalledWith('sample.changed', { id: 'b' });
  });

  it('queues events from nested async callees of the transaction', async () => {
    const emitted = jest.spyOn(emitter, 'emit');
    const callee = async () => {
      await Promise.resolve();
      events.emitAfterCommit('sample.first', {});
      await new Promise((resolve) => setImmediate(resolve));
      events.emitAfterCommit('sample.second', {});
    };

    await events.transaction(async () => {
      await callee();
      expect(emitted).not.toHaveBeenCalled();
    });

    expect(emitted.mock.calls.map(([name]) => name)).toEqual(['sample.first', 'sample.second']);
  });

  it('emits nothing when the transaction rolls back', async () => {
    const emitted = jest.spyOn(emitter, 'emit');

    await expect(
      events.transaction(() => {
        events.emitAfterCommit('sample.changed', { id: 'c' });
        return Promise.reject(new Error('rolled back'));
      }),
    ).rejects.toThrow('rolled back');

    expect(emitted).not.toHaveBeenCalled();
  });

  it('keeps emitting the remaining events when a listener throws', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    emitter.on('sample.broken', () => {
      received.push('sample.broken');
      throw new Error('listener failed');
    });
    emitter.on('sample.after', () => received.push('sample.after'));

    await events.transaction(() => {
      events.emitAfterCommit('sample.broken', {});
      events.emitAfterCommit('sample.after', {});
      return Promise.resolve();
    });

    expect(received).toEqual(['sample.broken', 'sample.after']);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('listener failed'));
    errorLog.mockRestore();
  });

  // treklink-web#533: the first transaction after an idle period met a Neon compute waking from
  // suspend, failed to start, and answered 500.
  describe('a transaction that does not start', () => {
    const prismaError = (code: string, message = 'failed') =>
      new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
    let transaction: jest.Mock;
    let warned: jest.SpyInstance;
    let failed: jest.SpyInstance;

    // Fails the first starts with the given errors, then runs the work like Prisma does.
    const startFailing = (...errors: Error[]) => {
      transaction = jest.fn((work: (tx: object) => Promise<unknown>) => {
        const error = errors.shift();
        return error ? Promise.reject(error) : work({});
      });
      events = new TransactionalEvents(
        { $transaction: transaction } as unknown as PrismaService,
        emitter,
      );
    };

    beforeEach(() => {
      warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      failed = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warned.mockRestore();
      failed.mockRestore();
    });

    it('starts once more after a dropped connection and emits the events once', async () => {
      startFailing(prismaError('P1017', 'Server has closed the connection.'));
      const emitted = jest.spyOn(emitter, 'emit');
      const work = jest.fn(() => {
        events.emitAfterCommit('sample.changed', {});
        return Promise.resolve('done');
      });

      await expect(events.transaction(work, SLOW_LINK_TRANSACTION)).resolves.toBe('done');

      expect(transaction).toHaveBeenCalledTimes(2);
      expect(transaction).toHaveBeenLastCalledWith(expect.any(Function), SLOW_LINK_TRANSACTION);
      expect(work).toHaveBeenCalledTimes(1);
      expect(emitted).toHaveBeenCalledTimes(1);
    });

    it('answers 503 SERVICE_UNAVAILABLE, not a 500, when the start times out (P2028)', async () => {
      startFailing(prismaError('P2028', 'Unable to start a transaction in the given time.'));
      const work = jest.fn(() => Promise.resolve('done'));

      const error: unknown = await events.transaction(work).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect((error as DomainException).errorCode).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      // A wait already lasted the whole maxWait, so it is not started again.
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(work).not.toHaveBeenCalled();
    });

    it('answers 503 when the connection is still unreachable on the second start', async () => {
      startFailing(prismaError('P1001'), prismaError('P1001'), prismaError('P1001'));

      const error: unknown = await events
        .transaction(() => Promise.resolve('done'))
        .catch((e: unknown) => e);

      expect((error as DomainException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(transaction).toHaveBeenCalledTimes(2);
    });

    it('never runs the work again once it was entered, even on a connection error', async () => {
      startFailing();
      const dropped = prismaError('P1017');
      const work = jest.fn(() => Promise.reject(dropped));

      await expect(events.transaction(work)).rejects.toBe(dropped);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(work).toHaveBeenCalledTimes(1);
    });

    it('rethrows an error that is not transient as it is', async () => {
      const unique = prismaError('P2002');
      startFailing(unique);

      await expect(events.transaction(() => Promise.resolve('done'))).rejects.toBe(unique);
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  it('gives every interactive transaction a maxWait that survives a cold start', () => {
    expect(TRANSACTION_MAX_WAIT_MS).toBeGreaterThanOrEqual(10_000);
    expect(PRISMA_CLIENT_OPTIONS.transactionOptions.maxWait).toBe(TRANSACTION_MAX_WAIT_MS);
  });
});
