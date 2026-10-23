import { MqttHealthProbe } from '../../platform/ports';

// Whether the backend subscriber holds a broker connection; the MQTT_HEALTH_PROBE for `platform` health
// (D-032). MqttSubscriber updates it.
export class MqttConnectionState implements MqttHealthProbe {
  private connected = false;

  set(connected: boolean): void {
    this.connected = connected;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
