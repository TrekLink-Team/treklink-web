import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ValidatedEnvironment } from '../config/environment-variables';
import { MQTT_HEALTH_PROBE, MqttHealthProbe } from './mqtt-health-probe';

export type ComponentState = 'up' | 'down' | 'unknown';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  components: {
    database: 'up';
    mqtt: ComponentState;
  };
  version: string;
}

// backend/package.json, from src/modules/platform/health (ts-jest) or dist/modules/platform/health.
const readBackendVersion = (): string => {
  const raw = readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
};

// GET /api/health (specs/platform/api-design/01-get-health.md, REQ-EVT-04, D-032).
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly version = readBackendVersion();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(MQTT_HEALTH_PROBE) private readonly mqttProbe?: MqttHealthProbe,
  ) {}

  async check(): Promise<HealthReport> {
    await this.assertDatabaseReachable();
    const mqtt = this.mqttState();
    return {
      status: mqtt === 'down' ? 'degraded' : 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      components: { database: 'up', mqtt },
      version: this.version,
    };
  }

  private async assertDatabaseReachable(): Promise<void> {
    const timeoutMs = this.config.get('HEALTH_DB_TIMEOUT_MS', { infer: true });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`database probe exceeded ${timeoutMs} ms`)),
        timeoutMs,
      );
    });

    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
    } catch (error) {
      this.logger.warn(
        `Database unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new DomainException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Database unreachable.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private mqttState(): ComponentState {
    if (!this.mqttProbe) return 'unknown';
    try {
      return this.mqttProbe.isConnected() ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
