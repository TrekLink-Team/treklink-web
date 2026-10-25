import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  BalanceService,
  BillingModule,
  ceilVnd,
  ChargesService,
  dayPlanFeeVnd,
  holdingFeeVnd,
  InvoicesService,
  termFeeVnd,
} from './index';

// The module wires its repository and exports its services through the public surface.
describe('BillingModule', () => {
  it('compiles and exports the invoice, charge and balance services', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, BillingModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(InvoicesService)).toBeInstanceOf(InvoicesService);
    expect(moduleRef.get(ChargesService)).toBeInstanceOf(ChargesService);
    expect(moduleRef.get(BalanceService)).toBeInstanceOf(BalanceService);
    await moduleRef.close();
  });

  it('exposes the money helpers', () => {
    expect(ceilVnd('0.5')).toBe(1n);
    expect(termFeeVnd(1n, 2)).toBe(2n);
    expect(holdingFeeVnd(2n, 1, '0.5')).toBe(1n);
    expect(dayPlanFeeVnd(30n, '1', 1, 1)).toBe(1n);
  });
});
