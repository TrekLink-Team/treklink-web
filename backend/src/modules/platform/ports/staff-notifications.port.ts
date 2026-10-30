import { Prisma } from '@prisma/client';

// Outbound operational email, supplied by auth so consumers never read its accounts or import it.
export const STAFF_NOTIFICATIONS = Symbol('STAFF_NOTIFICATIONS');

// How many active Staff and Admin recipients the transport accepted, and how many it refused. No
// recipient at all is `{ accepted: 0, failed: 0 }`.
export interface StaffDelivery {
  accepted: number;
  failed: number;
}

export interface StaffNotifications {
  // A scheduled caller that retries should treat `accepted > 0` as sent: retrying a partial delivery
  // would repeat the email to every recipient who already accepted it.
  send(subject: string, text: string, tx?: Prisma.TransactionClient): Promise<StaffDelivery>;
}
