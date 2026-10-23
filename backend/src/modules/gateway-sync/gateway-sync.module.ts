import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices';
import { PlatformModule } from '../platform/platform.module';
import { NodeJsonAdapter } from './adapters/node-json.adapter';
import { GatewaySyncPortsModule } from './gateway-sync-ports.module';
import { IngestionRepository } from './ingestion.repository';
import { IngestionService } from './ingestion.service';
import { MqttSubscriber } from './mqtt/mqtt-subscriber';
import { Normalizer } from './normalizer/normalizer';

// Field event ingestion over MQTT (specs/gateway-sync/design.md). Iteration 1: the node JSON path into
// field_events and the device projection, with post-commit field.position and field.telemetry.
@Module({
  imports: [PlatformModule, DevicesModule, GatewaySyncPortsModule],
  providers: [NodeJsonAdapter, Normalizer, IngestionRepository, IngestionService, MqttSubscriber],
})
export class GatewaySyncModule {}
