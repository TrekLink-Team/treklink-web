import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// One PrismaService (one connection pool) for the whole application
// (07-clarification-answers.md §7 question 8). Global availability does not relax module
// isolation: a module queries only the tables it owns (04-architecture-conventions.md), which
// `npm run lint:boundaries` enforces.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
