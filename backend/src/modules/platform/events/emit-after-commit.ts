import { AsyncLocalStorage } from 'async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface PendingEvent {
  name: string;
  payload: unknown;
}

interface TransactionScope {
  pending: PendingEvent[];
}

export type TransactionOptions = Parameters<PrismaService['$transaction']>[1];

// The AWS staging host runs in Sydney, the only region the AWS organisation allows, and Neon in Singapore,
// so a long interactive transaction can pass Prisma's default 5 s limit and be closed under it
// (treklink-web#487). The business operations that write a contract or the closing invoice in one transaction
// pass this longer limit (handover, return, damage decision, payments, SePay). It stays per call, because a
// client-wide limit let slow transactions starve the pool.
export const SLOW_LINK_TRANSACTION = { timeout: 20_000 } as const;

// Domain events are emitted after commit, never inside a transaction that may still roll back
// (specs/platform/design.md §2.3). The module that starts a business operation opens it with
// `transaction()`; any `emitAfterCommit()` inside, from any callee, is queued and emitted once the
// transaction resolves. A rolled-back transaction emits nothing. Outside a transaction an event is
// emitted at once.
@Injectable()
export class TransactionalEvents {
  private readonly logger = new Logger(TransactionalEvents.name);
  private readonly scope = new AsyncLocalStorage<TransactionScope>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const scope: TransactionScope = { pending: [] };
    const result = await this.scope.run(scope, () => this.prisma.$transaction(work, options));
    for (const event of scope.pending) this.emitSafely(event);
    return result;
  }

  emitAfterCommit(name: string, payload: unknown): void {
    const scope = this.scope.getStore();
    if (scope) scope.pending.push({ name, payload });
    else this.emitSafely({ name, payload });
  }

  // Delivery never gates the business write: a listener that throws is logged, and the remaining
  // events of the transaction are still emitted.
  private emitSafely({ name, payload }: PendingEvent): void {
    try {
      this.emitter.emit(name, payload);
    } catch (error) {
      this.logger.error(
        `Listener of ${name} failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
    }
  }
}
