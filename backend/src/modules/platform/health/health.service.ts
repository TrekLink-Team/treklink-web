import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { isConnectionError } from '../../../common/prisma/transient-error';
import { ValidatedEnvironment } from '../config/environment-variables';
import { BACKEND_VERSION } from './backend-version';
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

// GET /api/health (specs/platform/api-design/01-get-health.md, REQ-EVT-04, D-032).
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

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
      version: BACKEND_VERSION,
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
      await Promise.race([this.probe(), timeout]);
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

  // A pooled connection that a suspended Neon compute dropped fails the first query at once
  // (treklink-web#533); the probe asks once more on a fresh connection, still inside
  // HEALTH_DB_TIMEOUT_MS, so an idle database reads as up and a real outage still answers 503.
  private async probe(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      await this.prisma.$queryRaw`SELECT 1`;
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
