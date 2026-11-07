import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DemoQuickRepository {
  constructor(private readonly prisma: PrismaService) {}

  createRun(actorId: string, action: string) {
    return this.prisma.demoScenarioRun.create({ data: { actorId, action } });
  }

  saveRun(
    id: number,
    records: Prisma.InputJsonValue,
    error: string | null,
    tx: Prisma.TransactionClient,
  ) {
    return tx.demoScenarioRun.update({ where: { id }, data: { records, error } });
  }

  profile(tx: Prisma.TransactionClient) {
    return tx.demoControlState.findUnique({ where: { id: 'escalation' } });
  }

  async lockProfile(tx: Prisma.TransactionClient) {
    await tx.demoControlState.upsert({
      where: { id: 'escalation' },
      create: { id: 'escalation' },
      update: {},
    });
    await tx.$queryRaw`SELECT 1 FROM "demo_control_states" WHERE "id" = 'escalation' FOR UPDATE`;
    return tx.demoControlState.findUniqueOrThrow({ where: { id: 'escalation' } });
  }

  saveProfile(
    version: number,
    snapshot: Prisma.InputJsonValue | null,
    tx: Prisma.TransactionClient,
  ) {
    return tx.demoControlState.update({
      where: { id: 'escalation', version },
      data: { snapshot: snapshot ?? Prisma.DbNull, version: { increment: 1 } },
    });
  }
}
