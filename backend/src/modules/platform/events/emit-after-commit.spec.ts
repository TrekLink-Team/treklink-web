import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TransactionalEvents } from './emit-after-commit';

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
});
