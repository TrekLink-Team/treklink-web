import dotenv from 'dotenv';
import pino from 'pino';
import { SQLitePriorityQueue } from './queue/priority-queue';
import { GatewayMqttClient } from './mqtt/mqtt-client';
import { SerialFrameReader } from './serial/serial-reader';

// Load env before importing config, which reads process.env at module scope.
dotenv.config({ path: ['.env', '../.env'] });

// eslint-disable-next-line import/first
import { gatewayConfig } from './config';

const logger = pino({ name: 'GatewayMain' });

async function main() {
  logger.info('Initializing TrekLink Gateway Bridge...');

  const queue = new SQLitePriorityQueue(gatewayConfig.queue.dbPath);
  const mqttClient = new GatewayMqttClient(gatewayConfig.mqtt.brokerUrl, queue);
  const serialReader = new SerialFrameReader(
    {
      port: gatewayConfig.serial.port,
      baudRate: gatewayConfig.serial.baudRate,
      simulationMode: gatewayConfig.serial.simulationMode,
    },
    queue,
  );

  mqttClient.connect();
  serialReader.start();

  logger.info('TrekLink Gateway Bridge running.');
}

main().catch((err) => {
  logger.error(`Fatal gateway error: ${err.message}`);
  process.exit(1);
});
