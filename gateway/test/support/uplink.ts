import { createServer, Server, Socket, connect } from 'node:net';

// The Field Station's uplink for the outage harness: a TCP relay between the station and the broker.
// `cut()` resets every open connection and every new one, the way a dropped cellular link or a
// pulled cable looks to the station once the kernel reports it; `restore()` relays again. The backend
// stand-in connects to the broker directly, so only the station loses its link.
export class UplinkProxy {
  private server: Server | null = null;
  private readonly pairs = new Set<[Socket, Socket]>();
  private up = true;
  public port = 0;

  constructor(
    private readonly brokerHost: string,
    private readonly brokerPort: number,
  ) {}

  get url(): string {
    return `mqtt://127.0.0.1:${this.port}`;
  }

  get isUp(): boolean {
    return this.up;
  }

  async start(): Promise<void> {
    const server = createServer((station) => {
      if (!this.up) {
        station.destroy();
        return;
      }
      const broker = connect(this.brokerPort, this.brokerHost);
      const pair: [Socket, Socket] = [station, broker];
      this.pairs.add(pair);
      const close = () => {
        this.pairs.delete(pair);
        station.destroy();
        broker.destroy();
      };
      station.on('error', close).on('close', close);
      broker.on('error', close).on('close', close);
      station.pipe(broker);
      broker.pipe(station);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address && typeof address === 'object') this.port = address.port;
    this.server = server;
  }

  cut(): void {
    this.up = false;
    for (const [station, broker] of this.pairs) {
      station.destroy();
      broker.destroy();
    }
    this.pairs.clear();
  }

  restore(): void {
    this.up = true;
  }

  async stop(): Promise<void> {
    this.cut();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
