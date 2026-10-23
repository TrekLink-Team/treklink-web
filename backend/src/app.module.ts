import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './common/prisma/prisma.module';
import { validate } from './modules/platform/config/environment-variables';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      validate,
    }),
    // Domain events of specs/platform/design.md §2.3, emitted after commit by TransactionalEvents.
    EventEmitterModule.forRoot(),
    PrismaModule,
    PlatformModule,
  ],
})
export class AppModule {}
