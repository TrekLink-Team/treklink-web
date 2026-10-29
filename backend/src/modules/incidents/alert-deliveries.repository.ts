import { Injectable } from '@nestjs/common';
import { AlertChannel, Prisma } from '@prisma/client';

export type NewAlertDelivery = Pick<
  Prisma.AlertDeliveryUncheckedCreateInput,
  'incidentId' | 'transitionId' | 'tier' | 'recipientId' | 'channel'
>;

// A claimed outbox row with what the senders need from its incident.
export interface DueAlert {
  id: string;
  incidentId: string;
  recipientId: string | null;
  channel: AlertChannel;
  tier: string;
  attempts: number;
  code: string;
  deviceId: string;
  contractId: string | null;
  createdAt: Date;
}

@Injectable()
export class AlertDeliveriesRepository {
  // Status, attempts and due time use the schema defaults. No delivery happens before commit.
  async enqueue(rows: NewAlertDelivery[], tx: Prisma.TransactionClient): Promise<void> {
    if (rows.length === 0) return;
    await tx.alertDelivery.createMany({ data: rows });
  }

  // PENDING rows due now on these channels, oldest first, locked so a second replica skips them
  // (design §3). Rows of channels without a sender are never claimed and stay PENDING.
  claimDue(
    channels: readonly AlertChannel[],
    now: Date,
    limit: number,
    tx: Prisma.TransactionClient,
  ): Promise<DueAlert[]> {
    return tx.$queryRaw<DueAlert[]>`
      SELECT a."id", a."incidentId", a."recipientId", a."channel", a."tier", a."attempts",
             i."code", i."deviceId", i."contractId", a."createdAt"
      FROM "alert_deliveries" a
      JOIN "incidents" i ON i."id" = a."incidentId"
      WHERE a."status" = 'PENDING' AND a."nextAttemptAt" <= ${now}
        AND a."channel"::text IN (${Prisma.join(channels.map(String))})
      ORDER BY a."nextAttemptAt", a."createdAt"
      LIMIT ${limit}
      FOR UPDATE OF a SKIP LOCKED
    `;
  }

  async markSent(ids: readonly string[], at: Date, tx: Prisma.TransactionClient): Promise<void> {
    if (ids.length === 0) return;
    await tx.alertDelivery.updateMany({
      where: { id: { in: [...ids] } },
      data: { status: 'SENT', sentAt: at, attempts: { increment: 1 } },
    });
  }

  // A failed send: retried at `nextAttemptAt`, or FAILED when `nextAttemptAt` is null.
  async markFailedAttempt(
    id: string,
    error: string,
    nextAttemptAt: Date | null,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.alertDelivery.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: error,
        ...(nextAttemptAt ? { nextAttemptAt } : { status: 'FAILED' }),
      },
    });
  }
}
