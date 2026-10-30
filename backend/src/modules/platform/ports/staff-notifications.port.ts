import { Prisma } from '@prisma/client';

// Outbound operational email, supplied by auth so consumers never read its accounts or import it.
export const STAFF_NOTIFICATIONS = Symbol('STAFF_NOTIFICATIONS');

export interface StaffNotifications {
  // False means no active recipients or at least one transport failure. A scheduled caller may
  // retry; after a partial delivery, that retry can repeat email to a recipient who accepted it.
  send(subject: string, text: string, tx?: Prisma.TransactionClient): Promise<boolean>;
}
