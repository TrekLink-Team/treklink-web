import { Injectable } from '@nestjs/common';
import { GroupExit, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

const GROUP_SELECT = {
  id: true,
  parentId: true,
  name: true,
  label: true,
  startsOn: true,
  endsOn: true,
  areaNote: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assignments: { where: { endedAt: null } } } },
} satisfies Prisma.GroupSelect;

export type GroupRow = Prisma.GroupGetPayload<{ select: typeof GROUP_SELECT }>;

@Injectable()
export class GroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.group.findMany({
      where: { organizationId, removedAt: null },
      select: GROUP_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  topology(organizationId: string, tx: Prisma.TransactionClient) {
    return tx.group.findMany({
      where: { organizationId, removedAt: null },
      select: { id: true, parentId: true },
    });
  }

  // Serialize edits to the topology before reading it. Assignment and custody writers use
  // the group and device locks below, in the order specified in rentals design §11.4.
  async lockTree(organizationId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rentals:group-tree:${organizationId}`}))`;
  }

  async lockGroups(organizationId: string, ids: string[], tx: Prisma.TransactionClient) {
    if (ids.length === 0) return;
    await tx.$queryRaw`
      SELECT "id" FROM "groups"
      WHERE "organizationId" = ${organizationId} AND "removedAt" IS NULL
        AND "id" IN (${Prisma.join(ids)})
      ORDER BY "id" FOR UPDATE
    `;
  }

  find(organizationId: string, id: string, tx: Prisma.TransactionClient) {
    return tx.group.findFirst({
      where: { organizationId, id, removedAt: null },
      select: GROUP_SELECT,
    });
  }

  create(data: Prisma.GroupUncheckedCreateInput, tx: Prisma.TransactionClient) {
    return tx.group.create({ data, select: GROUP_SELECT });
  }

  update(
    organizationId: string,
    id: string,
    data: Prisma.GroupUncheckedUpdateInput,
    tx: Prisma.TransactionClient,
  ) {
    return tx.group.update({ where: { organizationId, id }, data, select: GROUP_SELECT });
  }

  async remove(organizationId: string, ids: string[], at: Date, tx: Prisma.TransactionClient) {
    const where = { groupId: { in: ids }, endedAt: null };
    const assignments = await tx.groupAssignment.findMany({
      where,
      select: { deviceId: true },
      orderBy: { deviceId: 'asc' },
    });
    await this.lockDevices(
      assignments.map(({ deviceId }) => deviceId),
      tx,
    );
    const ended = await tx.groupAssignment.updateManyAndReturn({
      where,
      data: { endedAt: at, endedReason: GroupExit.GROUP_REMOVED },
      select: { deviceId: true },
    });
    await tx.group.updateMany({
      where: { organizationId, id: { in: ids }, removedAt: null },
      data: { removedAt: at },
    });
    return ended.map(({ deviceId }) => deviceId);
  }

  async lockDevices(deviceIds: readonly string[], tx: Prisma.TransactionClient) {
    for (const id of [...new Set(deviceIds)].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rentals:group-device:${id}`}))`;
    }
  }

  openAssignments(deviceIds: readonly string[], tx: Prisma.TransactionClient) {
    return tx.groupAssignment.findMany({
      where: { deviceId: { in: [...deviceIds] }, endedAt: null },
      select: { id: true, groupId: true, deviceId: true, contractDeviceId: true },
    });
  }

  endAssignments(ids: string[], reason: GroupExit, at: Date, tx: Prisma.TransactionClient) {
    return tx.groupAssignment.updateMany({
      where: { id: { in: ids }, endedAt: null },
      data: { endedAt: at, endedReason: reason },
    });
  }

  openAssignment(
    data: Pick<
      Prisma.GroupAssignmentUncheckedCreateInput,
      'groupId' | 'deviceId' | 'contractDeviceId' | 'assignedById'
    >,
    assignedAt: Date,
    tx: Prisma.TransactionClient,
  ) {
    return tx.groupAssignment.create({ data: { ...data, assignedAt } });
  }
}
