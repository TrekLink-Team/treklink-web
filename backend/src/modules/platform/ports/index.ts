// Ports that `platform` declares and a higher module provides (specs/platform/design.md §2.1,
// D-032). A provider imports the token from here, never from the consuming service's folder. Each
// other port lives in the module that declares it: ACCOUNT_CONTEXT_PROVIDER and API_KEY_RESOLVER in
// `auth`, ORGANIZATION_EXIT_CHECKS in `organizations`, CONTRACT_CLOSE_CHECKS in `rentals`. A
// multi-provider port is injected `@Optional()` as an array, so an unprovided port is empty.
export { MQTT_HEALTH_PROBE, type MqttHealthProbe } from '../health/mqtt-health-probe';
export { ACCOUNT_DIRECTORY, type AccountDirectory } from './account-directory.port';
export { STAFF_NOTIFICATIONS, type StaffNotifications } from './staff-notifications.port';
