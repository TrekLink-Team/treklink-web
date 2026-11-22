import { AsyncLocalStorage } from 'async_hooks';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  isConnectionError,
  isTransientDatabaseError,
} from '../../../common/prisma/transient-error';

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
// pass this longer limit (handover, return, damage decision, payments, SePay, End now). It stays per
// call, because a client-wide limit let slow transactions starve the pool. The wait to start is
// client-wide (`TRANSACTION_MAX_WAIT_MS` in prisma.service.ts).
export const SLOW_LINK_TRANSACTION = { timeout: 20_000 } as const;

// A transaction that failed to start on a dropped or unreachable connection is started once more
// (treklink-web#533). Only a start is retried: once the work has run, a failure may follow a commit,
// so it is never repeated.
const START_ATTEMPTS = 2;

const databaseUnavailable = (): DomainException =>
  new DomainException(
    HttpStatus.SERVICE_UNAVAILABLE,
    ErrorCode.SERVICE_UNAVAILABLE,
    'The database did not answer, so nothing was changed. Try again in a moment.',
  );

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
    const result = await this.scope.run(scope, () => this.start(work, options));
    for (const event of scope.pending) this.emitSafely(event);
    return result;
  }

  // Runs the work in a transaction. A failure before the work was entered changed nothing: a dropped
  // connection is started once more, and a start that still fails answers 503 instead of a 500. A
  // failure after the work was entered is rethrown as it is.
  private async start<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      let entered = false;
      try {
        return await this.prisma.$transaction((tx) => {
          entered = true;
          return work(tx);
        }, options);
      } catch (error) {
        if (entered || !isTransientDatabaseError(error)) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        if (attempt < START_ATTEMPTS && isConnectionError(error)) {
          this.logger.warn(`Transaction did not start, starting it again: ${detail}`);
          continue;
        }
        this.logger.error(`Transaction did not start: ${detail}`);
        throw databaseUnavailable();
      }
    }
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
