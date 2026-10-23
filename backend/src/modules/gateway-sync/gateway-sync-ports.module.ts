import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { MQTT_HEALTH_PROBE } from '../platform/ports';
import { MqttConnectionState } from './mqtt/mqtt-connection-state';

// The ports `gateway-sync` provides to lower modules (platform design §2.1): MQTT_HEALTH_PROBE for
// `platform` health. Null while ingestion is disabled, so health reports `mqtt: "unknown"` then.
@Global()
@Module({
  providers: [
    {
      provide: MQTT_HEALTH_PROBE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ValidatedEnvironment, true>) =>
        config.get('MQTT_INGESTION_ENABLED', { infer: true }) ? new MqttConnectionState() : null,
    },
  ],
  exports: [MQTT_HEALTH_PROBE],
})
export class GatewaySyncPortsModule {}
