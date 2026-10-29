import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices';
import { IncidentsModule } from '../incidents';
import { PlatformModule } from '../platform/platform.module';
import { RentalsModule } from '../rentals';
import { NodeJsonAdapter } from './adapters/node-json.adapter';
import { GatewaySyncPortsModule } from './gateway-sync-ports.module';
import { IngestionRepository } from './ingestion.repository';
import { IngestionService } from './ingestion.service';
import { MqttSubscriber } from './mqtt/mqtt-subscriber';
import { Normalizer } from './normalizer/normalizer';

// Field event ingestion over MQTT (specs/gateway-sync/design.md): the node JSON path into field_events,
// attributed to the custody interval of `rentals`, the device projection, and post-commit
// field.position and field.telemetry, and the SOS hand-off to incidents.
@Module({
  imports: [PlatformModule, DevicesModule, RentalsModule, IncidentsModule, GatewaySyncPortsModule],
  providers: [NodeJsonAdapter, Normalizer, IngestionRepository, IngestionService, MqttSubscriber],
})
export class GatewaySyncModule {}
