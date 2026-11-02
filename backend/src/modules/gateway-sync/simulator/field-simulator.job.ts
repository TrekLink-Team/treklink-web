import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { UplinkIngress } from '../uplink-ingress';
import { FieldSimulationService } from './field-simulation.service';
import { simulatedBatch } from './simulated-batch';

// Design §2, field data simulator (D-090 rule 2): ingests the simulated batch through the node uplink path, the adapter and
// IngestionService the MQTT subscriber uses, so attribution, the device projection, the stream and the
// SOS hand-off behave as for a real node. Loaded only with FIELD_SIMULATOR_ENABLED or DEMO_SIMULATION_ENABLED.
// The cron only asks; the batch's interval comes from gatewaySync.simulatorIntervalSeconds, and a run
// inside an interval already ingested stores nothing new. With DEMO_SIMULATION_ENABLED the nodes are the
// simulated nodes of the demo panel instead (FieldSimulationService, specs/demo/design.md §9).
@Injectable()
export class FieldSimulatorJob {
  private readonly logger = new Logger(FieldSimulatorJob.name);
  private readonly root: string;
  private readonly simulationTable: boolean;

  constructor(
    private readonly uplinks: UplinkIngress,
    private readonly parameters: ParameterService,
    config: ConfigService<ValidatedEnvironment, true>,
    private readonly simulation: FieldSimulationService,
  ) {
    this.root = config.get('MQTT_ROOT', { infer: true });
    this.simulationTable = config.get('DEMO_SIMULATION_ENABLED', { infer: true }) === true;
  }

  @ScheduledJob('gatewaySync.fieldSimulator', '*/10 * * * * *')
  async run(now: Date = new Date()): Promise<number> {
    if (this.simulationTable) return this.simulation.run(now);
    const interval = await this.parameters.get('gatewaySync.simulatorIntervalSeconds');
    const sos = await this.parameters.get('gatewaySync.simulatorSosIntervalMinutes');
    const packets = simulatedBatch(now, Number(interval), Number(sos));
    let ingested = 0;
    for (const packet of packets) {
      const topic = `${this.root}/2/json/LongFast/${packet.sender}`;
      const outcome = await this.uplinks.ingest(topic, Buffer.from(JSON.stringify(packet)), now);
      if (outcome === 'ingested') ingested += 1;
      else this.logger.warn(`Simulated ${packet.type} for ${packet.sender} was ${outcome}`);
    }
    return ingested;
  }
}
