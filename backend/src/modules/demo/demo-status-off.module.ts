import { Module } from '@nestjs/common';
import { DemoStatusOffController } from './demo-status-off.controller';

// AppModule imports it exactly when DemoModule is not loaded (D-113), so GET /api/demo/status always
// has one route: DemoController's while the controls are on, this one while they are off. It imports
// no other module, reads no configuration and touches no database.
@Module({
  controllers: [DemoStatusOffController],
})
export class DemoStatusOffModule {}
