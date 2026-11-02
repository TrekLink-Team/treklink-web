import { Injectable } from '@nestjs/common';
import { Prisma, SimulatedNode, SimulatedNodeStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

// The stopped nodes the panel lists after the running ones (demo api-design 06).
export const STOPPED_LISTED = 20;

// The writer and reader of `simulated_nodes` (gateway-sync, specs/demo/design.md §9).
@Injectable()
export class SimulatedNodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(
    data: Prisma.SimulatedNodeUncheckedCreateInput,
    client: Client = this.prisma,
  ): Promise<SimulatedNode> {
    return client.simulatedNode.create({ data });
  }

  byId(id: string, client: Client = this.prisma): Promise<SimulatedNode | null> {
    return client.simulatedNode.findUnique({ where: { id } });
  }

  runningForDevice(deviceId: string, client: Client = this.prisma): Promise<SimulatedNode | null> {
    return client.simulatedNode.findFirst({
      where: { deviceId, status: SimulatedNodeStatus.RUNNING },
    });
  }

  running(client: Client = this.prisma): Promise<SimulatedNode[]> {
    return client.simulatedNode.findMany({
      where: { status: SimulatedNodeStatus.RUNNING },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Running nodes first, then the most recently stopped ones.
  async listed(client: Client = this.prisma): Promise<SimulatedNode[]> {
    const [running, stopped] = await Promise.all([
      this.running(client),
      client.simulatedNode.findMany({
        where: { status: SimulatedNodeStatus.STOPPED },
        orderBy: { updatedAt: 'desc' },
        take: STOPPED_LISTED,
      }),
    ]);
    return [...running, ...stopped];
  }

  // Compare-and-set on `version` (D-034 rule 1): null when another write came first or the node is not
  // RUNNING any more.
  async updateRunning(
    id: string,
    expectedVersion: number,
    data: Prisma.SimulatedNodeUncheckedUpdateManyInput,
    client: Client = this.prisma,
  ): Promise<SimulatedNode | null> {
    const { count } = await client.simulatedNode.updateMany({
      where: { id, version: expectedVersion, status: SimulatedNodeStatus.RUNNING },
      data: { ...data, version: { increment: 1 } },
    });
    return count === 1 ? client.simulatedNode.findUnique({ where: { id } }) : null;
  }

  // The simulator's progress through the beacons of an active SOS. Not an Admin change, so the version
  // stays; it only moves forward, so two instances in one run cannot move it back.
  async markBeaconed(id: string, sosSince: Date, until: Date): Promise<void> {
    await this.prisma.simulatedNode.updateMany({
      where: {
        id,
        status: SimulatedNodeStatus.RUNNING,
        sosSince,
        OR: [{ beaconedUntil: null }, { beaconedUntil: { lt: until } }],
      },
      data: { beaconedUntil: until },
    });
  }
}
