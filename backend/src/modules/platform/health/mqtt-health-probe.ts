// Optional MQTT health probe (D-032). `platform` depends on no other module, so it only defines the
// port; `gateway-sync` registers MqttJsonIngressAdapter under MQTT_HEALTH_PROBE once it is built.
// Until then the health endpoint reports `components.mqtt: "unknown"`.
export const MQTT_HEALTH_PROBE = Symbol('MQTT_HEALTH_PROBE');

export interface MqttHealthProbe {
  isConnected(): boolean;
}
