import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type NewAlertDelivery = Pick<
  Prisma.AlertDeliveryUncheckedCreateInput,
  'incidentId' | 'transitionId' | 'tier' | 'recipientId' | 'channel'
>;

@Injectable()
export class AlertDeliveriesRepository {
  // Status, attempts and due time use the schema defaults. No delivery happens before commit.
  async enqueue(rows: NewAlertDelivery[], tx: Prisma.TransactionClient): Promise<void> {
    if (rows.length === 0) return;
    await tx.alertDelivery.createMany({ data: rows });
  }
}
