import pino from 'pino';
// config loads dotenv on import, so it must be imported before anything that reads config values.
import { gatewayConfig } from './config';
import { SQLitePriorityQueue } from './queue/priority-queue';
import { GatewayMqttClient } from './mqtt/mqtt-client';
import { SerialFrameReader } from './serial/serial-reader';
import { StationState } from './local/station-state';
import { LocalServer, LOCAL_HOST } from './local/local-server';

const logger = pino({ name: 'GatewayMain' });

async function main() {
  logger.info('Initializing TrekLink Gateway Bridge...');

  const queue = new SQLitePriorityQueue(gatewayConfig.queue.dbPath);
  const mqttClient = new GatewayMqttClient(gatewayConfig.mqtt.brokerUrl, queue);
  const stationState = new StationState(gatewayConfig.local);
  const serialReader = new SerialFrameReader(
    {
      port: gatewayConfig.serial.port,
      baudRate: gatewayConfig.serial.baudRate,
      simulationMode: gatewayConfig.serial.simulationMode,
    },
    queue,
    () => mqttClient.flushQueue(),
    (frame) => stationState.record(frame),
  );

  mqttClient.connect();
  serialReader.start();

  // The local page (REQ-STA-02) is a view: a failure to start it is logged and the station keeps
  // reading, queuing and flushing.
  try {
    const localServer = new LocalServer({ state: stationState, queue, uplink: mqttClient, serial: serialReader });
    const port = await localServer.listen(gatewayConfig.local.port);
    logger.info(`Field Station local page on http://localhost:${port} (bound to ${LOCAL_HOST} only).`);
  } catch (err) {
    logger.error(`Local page not started on ${LOCAL_HOST}:${gatewayConfig.local.port}: ${(err as Error).message}`);
  }

  logger.info('TrekLink Gateway Bridge running.');
}

main().catch((err) => {
  logger.error(`Fatal gateway error: ${err.message}`);
  process.exit(1);
});
