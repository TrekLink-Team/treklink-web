import dotenv from 'dotenv';
import pino from 'pino';
import { SQLitePriorityQueue } from './queue/priority-queue';
import { GatewayMqttClient } from './mqtt/mqtt-client';
import { SerialFrameReader } from './serial/serial-reader';

dotenv.config({ path: ['.env', '../.env'] });

const logger = pino({ name: 'GatewayMain' });

async function main() {
  logger.info('Initializing TrekLink Gateway Bridge...');

  const dbPath = process.env.GATEWAY_SQLITE_DB_PATH || './gateway_queue.db';
  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  const simulationMode = process.env.GATEWAY_SERIAL_SIMULATION !== 'false';

  const queue = new SQLitePriorityQueue(dbPath);
  const mqttClient = new GatewayMqttClient(brokerUrl, queue);
  const serialReader = new SerialFrameReader(
    {
      port: process.env.GATEWAY_SERIAL_PORT || '/dev/ttyUSB0',
      baudRate: parseInt(process.env.GATEWAY_SERIAL_BAUD || '115200', 10),
      simulationMode,
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
