import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { VARIANT_SELECT, VariantRow } from './devices.repository';

type Client = Prisma.TransactionClient | PrismaService;

const WITH_COUNT = {
  ...VARIANT_SELECT,
  _count: { select: { devices: true } },
} satisfies Prisma.HardwareVariantSelect;

export type VariantWithCount = VariantRow & { deviceCount: number };

const flatten = ({
  _count,
  ...variant
}: Prisma.HardwareVariantGetPayload<{ select: typeof WITH_COUNT }>): VariantWithCount => ({
  ...variant,
  deviceCount: _count.devices,
});

export type VariantWrite = Omit<
  Prisma.HardwareVariantUncheckedCreateInput,
  'id' | 'version' | 'createdAt' | 'updatedAt'
>;

// The `hardware_variants` rows of the Admin catalog (devices task 2.1, design section 11). The list
// read stays on DevicesRepository.variantCatalog, which other modules' reads already go through.
@Injectable()
export class VariantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(id: string, client: Client = this.prisma): Promise<VariantWithCount | null> {
    const row = await client.hardwareVariant.findUnique({ where: { id }, select: WITH_COUNT });
    return row ? flatten(row) : null;
  }

  findCode(code: string, client: Client = this.prisma) {
    return client.hardwareVariant.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
      select: { id: true },
    });
  }

  async insert(data: VariantWrite, tx: Prisma.TransactionClient): Promise<VariantWithCount> {
    return flatten(await tx.hardwareVariant.create({ data, select: WITH_COUNT }));
  }

  // Compare-and-set on `version` (REQ-ERR-19): false when another edit won.
  async compareAndSet(
    id: string,
    expectedVersion: number,
    data: Prisma.HardwareVariantUncheckedUpdateManyInput,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await tx.hardwareVariant.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    return count === 1;
  }

  async delete(id: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.hardwareVariant.delete({ where: { id } });
  }
}
