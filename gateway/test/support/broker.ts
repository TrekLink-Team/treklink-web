import Aedes from 'aedes';
import type { AuthorizePublishHandler } from 'aedes';
import { createServer, Server, Socket } from 'node:net';
import * as mqtt from 'mqtt';

// An in-process MQTT broker (aedes) for the Field Station outage tests and harness: it listens on a
// local TCP port, can be stopped and started again on the same port, and lets a test hold back the
// PUBACK of a publish through `authorizePublish`.
export class TestBroker {
  private aedes: Aedes | null = null;
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  constructor(
    public port = 0,
    private readonly authorizePublish?: AuthorizePublishHandler,
  ) {}

  get url(): string {
    return `mqtt://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    const aedes = new Aedes();
    if (this.authorizePublish) aedes.authorizePublish = this.authorizePublish;
    const server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      aedes.handle(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address && typeof address === 'object') this.port = address.port;
    this.aedes = aedes;
    this.server = server;
  }

  /** Drops every connection and stops listening: the uplink is down until `start()` again. */
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const { server, aedes } = this;
    this.server = null;
    this.aedes = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (aedes) await new Promise<void>((resolve) => aedes.close(() => resolve()));
  }
}

/** A message as a subscriber saw it, in arrival order. */
export interface Received {
  topic: string;
  payload: string;
  at: number;
}

/** Subscribes, the way the backend does, and records every message in arrival order. */
export const subscribe = async (url: string, topic: string): Promise<{ client: mqtt.MqttClient; received: Received[] }> => {
  const client = await mqtt.connectAsync(url, { reconnectPeriod: 100 });
  const received: Received[] = [];
  client.on('message', (topicName, payload) => {
    received.push({ topic: topicName, payload: payload.toString(), at: Date.now() });
  });
  await client.subscribeAsync(topic, { qos: 1 });
  return { client, received };
};

/** Resolves once `check()` is true, polling every 20 ms; rejects after `timeoutMs`. */
export const waitFor = async (check: () => boolean, timeoutMs: number, what: string): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
