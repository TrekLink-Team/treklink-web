import { HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { FieldEventQueryService } from '../gateway-sync';
import { IncidentsQueryService } from '../incidents';
import { OrganizationsService } from '../organizations';
import { ContractsService } from '../rentals';
import { DemoPanelLock } from './demo-panel-lock';
import type { StagedRecord } from './demo-scenarios.service';
import { DemoPanelService, PanelCommand, PanelContext, PanelInput } from './demo-panel.service';

export const PLAYBACK_FLOWS = [
  'MF-01a',
  'MF-01b',
  'MF-01c',
  'MF-02',
  'MF-03',
  'MF-04',
  'MF-05',
] as const;
export type PlaybackFlow = (typeof PLAYBACK_FLOWS)[number];
export const PLAYBACK_COMMAND_NAMES = ['START', 'PAUSE', 'RESUME', 'STEP', 'STOP'] as const;
export type PlaybackCommandName = (typeof PLAYBACK_COMMAND_NAMES)[number];
export type PlaybackStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'DONE' | 'FAILED' | 'STOPPED';
// SKIPPED: a waiting step the operator moved past (Resume or Next step) before its record was ready;
// DONE is kept for a step whose record was really done (reviews of treklink-web#541 and #542).
type StepStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'DONE' | 'SKIPPED' | 'FAILED';

// The interval bounds and default of REQ-PNL-08 (demo tool constants, design §11).
export const PLAYBACK_MIN_SECONDS = 3;
export const PLAYBACK_MAX_SECONDS = 60;
export const PLAYBACK_DEFAULT_SECONDS = 10;
// How often a waiting step reads the state it waits for (D-110 rule 8, demo tool constant).
export const PLAYBACK_WAIT_POLL_MS = 3000;
// MF-05 never ends a contract holding a unit heard from a real node (simulated false) within this many
// days, such as a real-unit rehearsal contract (D-110 rule 6, demo tool constant).
export const REAL_NODE_LOOKBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Resolved {
  command: PanelCommand;
  input: PanelInput;
}

// One step of a flow, from docs/demo/2026-11-22-scenario-playbook.md: the window and screen the site
// clicker shows, the line the presenter says, the click, and the panel command, if any, that performs it.
interface StepSpec {
  title: string;
  window: string;
  screen: string;
  line: string;
  click: string;
  run?: (ctx: PanelContext) => Promise<Resolved>;
  // A step a person does on a real screen the panel never acts on (the Admin approval, D-110
  // clarification): the playback pauses with the prompt and resumes by itself once `done` reads true,
  // or when the operator presses Resume or Next step.
  waitFor?: {
    prompt: (ctx: PanelContext) => string;
    done: (ctx: PanelContext) => Promise<boolean>;
  };
}

export interface PlaybackStepView {
  title: string;
  window: string;
  screen: string;
  line: string;
  click: string;
  status: StepStatus;
  prompt: string | null;
  error: string | null;
  records: StagedRecord[];
}

export interface PlaybackState {
  flow: PlaybackFlow | null;
  status: PlaybackStatus;
  index: number;
  intervalSeconds: number;
  nextAt: Date | null;
  steps: PlaybackStepView[];
  error: string | null;
}

export interface PlaybackCommandInput {
  command: PlaybackCommandName;
  flow?: PlaybackFlow;
  intervalSeconds?: number;
}

const busy = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.DEMO_BUSY,
    'A demo action is already running. Try again in a moment.',
  );
const wrongState = (status: PlaybackStatus) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${status}.`,
  );
const invalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
const unavailable = (message: string) =>
  new DomainException(HttpStatus.CONFLICT, ErrorCode.DEMO_SCENARIO_UNAVAILABLE, message);

// The scripted playback of the main flows (specs/demo/requirements.md REQ-PNL-08, design §11, D-110 rule
// 3). One run at a time, in process memory (the AWS host runs one backend). A timer runs the next step
// `intervalSeconds` after the last one finished; pause clears it; resume and STEP run the next step at
// once. A failed step stops the run with its error and its committed links. Every executed step is one
// panel command, so it is audited and registered like an action of route 14.
@Injectable()
export class DemoPanelPlayback implements OnModuleDestroy {
  private readonly logger = new Logger(DemoPanelPlayback.name);
  private state: PlaybackState = {
    flow: null,
    status: 'IDLE',
    index: 0,
    intervalSeconds: PLAYBACK_DEFAULT_SECONDS,
    nextAt: null,
    steps: [],
    error: null,
  };
  private specs: StepSpec[] = [];
  private context: PanelContext = {};
  private client = 'unknown';
  private timer: NodeJS.Timeout | null = null;
  // Counts the runs started, so a read that outlives its run (Stop, then START) is dropped.
  private runId = 0;
  private executing: Promise<void> | null = null;
  // The contract the last MF-01c run handed over, kept across runs so MF-05 ends that one first.
  private lastHandedOver: string | null = null;

  constructor(
    private readonly panel: DemoPanelService,
    private readonly contracts: ContractsService,
    private readonly devices: DevicesService,
    private readonly incidents: IncidentsQueryService,
    private readonly organizations: OrganizationsService,
    private readonly lock: DemoPanelLock,
    private readonly fieldEvents: FieldEventQueryService,
  ) {}

  onModuleDestroy() {
    this.clearTimer();
  }

  view(): PlaybackState {
    return { ...this.state, steps: this.state.steps.map((step) => ({ ...step })) };
  }

  // A run that has not ended: the reseed refuses while one is RUNNING or PAUSED.
  active(): boolean {
    return (
      this.state.status === 'RUNNING' || this.state.status === 'PAUSED' || this.executing !== null
    );
  }

  async command(input: PlaybackCommandInput, client: string): Promise<PlaybackState> {
    switch (input.command) {
      case 'START':
        this.start(input, client);
        break;
      case 'PAUSE':
        if (this.state.status !== 'RUNNING') throw wrongState(this.state.status);
        if (this.executing) throw busy();
        this.clearTimer();
        this.state.status = 'PAUSED';
        break;
      case 'RESUME':
        if (this.state.status !== 'PAUSED') throw wrongState(this.state.status);
        if (this.executing) throw busy();
        this.state.status = 'RUNNING';
        if (this.waiting()) {
          if (await this.confirmWait()) this.afterStep();
        } else {
          this.schedule(0);
        }
        break;
      case 'STEP':
        if (this.state.status !== 'PAUSED' && this.state.status !== 'RUNNING')
          throw wrongState(this.state.status);
        if (this.executing) throw busy();
        this.clearTimer();
        // At a waiting step, Next step is the operator saying the person on the real screen is done; the
        // playback stays paused on the step after it.
        if (this.waiting()) {
          if (await this.confirmWait()) {
            this.state.index += 1;
            if (this.state.index >= this.specs.length) this.state.status = 'DONE';
          }
        } else {
          await this.step();
        }
        break;
      case 'STOP':
        if (this.state.status !== 'PAUSED' && this.state.status !== 'RUNNING')
          throw wrongState(this.state.status);
        this.clearTimer();
        this.state.status = 'STOPPED';
        break;
    }
    return this.view();
  }

  private start(input: PlaybackCommandInput, client: string) {
    if (this.lock.resetting || this.active()) throw busy();
    if (!input.flow || !PLAYBACK_FLOWS.includes(input.flow))
      throw invalid('Choose a main flow to play.');
    const seconds = input.intervalSeconds ?? PLAYBACK_DEFAULT_SECONDS;
    if (
      !Number.isInteger(seconds) ||
      seconds < PLAYBACK_MIN_SECONDS ||
      seconds > PLAYBACK_MAX_SECONDS
    )
      throw invalid(
        `intervalSeconds must be a whole number from ${PLAYBACK_MIN_SECONDS} to ${PLAYBACK_MAX_SECONDS}.`,
      );
    this.runId += 1;
    this.specs = this.flowSteps(input.flow);
    this.context = {};
    this.client = client;
    this.state = {
      flow: input.flow,
      status: 'RUNNING',
      index: 0,
      intervalSeconds: seconds,
      nextAt: null,
      error: null,
      steps: this.specs.map(({ title, window, screen, line, click }) => ({
        title,
        window,
        screen,
        line,
        click,
        status: 'PENDING',
        prompt: null,
        error: null,
        records: [],
      })),
    };
    this.schedule(0);
  }

  private schedule(delayMs: number) {
    this.clearTimer();
    this.state.nextAt = new Date(Date.now() + delayMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.step();
    }, delayMs);
    this.timer.unref?.();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state.nextAt = null;
  }

  // Runs the step at `index` once; the caller has checked that no step is executing.
  private step(): Promise<void> {
    const work = this.execute().finally(() => {
      this.executing = null;
    });
    this.executing = work;
    return work;
  }

  private async execute() {
    const index = this.state.index;
    const spec = this.specs[index];
    const view = this.state.steps[index];
    if (!spec || !view) return;
    view.status = 'RUNNING';
    if (spec.waitFor) {
      const run = this.runId;
      const ready = await this.waitDone(spec);
      // Stop (or Stop and START) while reading: the result belongs to a run that is over.
      if (!this.isCurrent(run, view) || this.state.status === 'STOPPED') return;
      if (ready) {
        view.status = 'DONE';
        view.prompt = null;
        this.afterStep();
        return;
      }
      view.status = 'WAITING';
      view.prompt = spec.waitFor.prompt(this.context);
      this.state.status = 'PAUSED';
      this.pollWait(spec);
      return;
    }
    try {
      if (spec.run) {
        const { command, input } = await spec.run(this.context);
        const result = await this.panel.run(command, input, this.client);
        view.records = result.records;
        this.context = { ...this.context, ...result.context };
        if (command === 'contract-handover' && result.context.contractId)
          this.lastHandedOver = result.context.contractId;
      }
      view.status = 'DONE';
    } catch (error) {
      view.status = 'FAILED';
      view.error = error instanceof Error ? error.message : 'The step failed.';
      const details = error instanceof DomainException ? error.resultDetails : undefined;
      view.records = (details as { records?: StagedRecord[] } | undefined)?.records ?? [];
      this.state.status = 'FAILED';
      this.state.error = `${spec.title}: ${view.error}`;
      this.clearTimer();
      this.logger.warn(`Demo playback ${this.state.flow} failed at step ${index + 1}.`);
      return;
    }
    this.state.index = index + 1;
    this.advance();
  }

  // After a waiting step is confirmed: move past it.
  private afterStep() {
    this.state.index += 1;
    this.advance();
  }

  private advance() {
    if (this.state.index >= this.specs.length) {
      this.state.status = 'DONE';
      this.clearTimer();
    } else if (this.state.status === 'RUNNING') {
      this.schedule(this.state.intervalSeconds * 1000);
    }
  }

  private waiting(): boolean {
    return this.state.steps[this.state.index]?.status === 'WAITING';
  }

  // The operator moves past the waiting step (Resume or Next step). The awaited state is read once more
  // first (REQ-PNL-03, review of treklink-web#542): an approval made since the last poll is recorded DONE,
  // a record still not ready SKIPPED, never DONE. While it reads, the step is no longer WAITING, so a poll
  // read in flight drops its result, and `executing` makes another command answer busy. Returns true when
  // the caller moves past the step, false when Stop ended the run during the read.
  private async confirmWait(): Promise<boolean> {
    const index = this.state.index;
    const spec = this.specs[index];
    const view = this.state.steps[index];
    if (!spec || view?.status !== 'WAITING') return false;
    this.clearTimer();
    view.status = 'RUNNING';
    const read = this.waitDone(spec);
    this.executing = read.then(() => undefined);
    let ready: boolean;
    try {
      ready = await read;
    } finally {
      this.executing = null;
    }
    view.status = ready ? 'DONE' : 'SKIPPED';
    view.prompt = null;
    return this.state.status !== 'STOPPED';
  }

  // The view is still the current step of the run that started the read (review of treklink-web#541).
  private isCurrent(run: number, view: PlaybackStepView): boolean {
    return run === this.runId && this.state.steps[this.state.index] === view;
  }

  private async waitDone(spec: StepSpec): Promise<boolean> {
    try {
      return (await spec.waitFor?.done(this.context)) === true;
    } catch {
      return false;
    }
  }

  // Reads the awaited state every PLAYBACK_WAIT_POLL_MS while the step waits; Stop, Resume and Next
  // step clear the timer. Once it reads true the playback runs on at its interval.
  private pollWait(spec: StepSpec) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void (async () => {
        const run = this.runId;
        const view = this.state.steps[this.state.index];
        if (view?.status !== 'WAITING' || this.state.status !== 'PAUSED') return;
        const ready = await this.waitDone(spec);
        // A read that outlived its step (Stop, Resume, Next step, or a new run) is dropped.
        if (
          !this.isCurrent(run, view) ||
          view.status !== 'WAITING' ||
          this.state.status !== 'PAUSED'
        )
          return;
        if (ready) {
          view.status = 'DONE';
          view.prompt = null;
          this.state.status = 'RUNNING';
          this.afterStep();
        } else {
          this.pollWait(spec);
        }
      })();
    }, PLAYBACK_WAIT_POLL_MS);
    this.timer.unref?.();
  }

  // --- record lookups the steps need, each through an exported read ------------------------------------

  private async organizationId(code = 'ORG-0001'): Promise<string> {
    const organization = (await this.organizations.activeDemoOptions()).find(
      (row) => row.code === code,
    );
    if (!organization) throw unavailable(`${code} is not Active. Reseed the demo data.`);
    return organization.id;
  }

  private async contractVersion(id: string): Promise<number> {
    const contract = await this.contracts.demoDetail(id);
    if (!contract)
      throw unavailable('The contract of the earlier step is gone. Start the flow again.');
    return contract.version;
  }

  // The contract MF-05 ends (D-110 rule 6): the one the last MF-01c run handed over while it is still
  // ACTIVE, else the newest ACTIVE contract of ORG-0001. A contract holding a unit heard from a real node
  // in the last REAL_NODE_LOOKBACK_DAYS days is never taken, so a real-unit rehearsal stays untouched.
  private async runningContract(now: Date = new Date()): Promise<{ id: string; version: number }> {
    const organizationId = await this.organizationId();
    const active = (await this.contracts.panelOptions()).filter((row) => row.status === 'ACTIVE');
    const candidates = [
      ...active.filter((row) => row.id === this.lastHandedOver),
      ...active.filter(
        (row) => row.id !== this.lastHandedOver && row.organizationId === organizationId,
      ),
    ];
    const ids = new Set(candidates.map((row) => row.id));
    const custody = (await this.contracts.visibleDevices({ organizationId: null })).filter((unit) =>
      ids.has(unit.contractId),
    );
    const real = await this.fieldEvents.realNodeDevices(
      custody.map((unit) => unit.deviceId),
      new Date(now.getTime() - REAL_NODE_LOOKBACK_DAYS * DAY_MS),
    );
    const held = new Set(
      custody.filter((unit) => real.has(unit.deviceId)).map((unit) => unit.contractId),
    );
    const contract = candidates.find((row) => !held.has(row.id));
    if (!contract) throw unavailable('No running contract to end; run MF-01b and MF-01c first.');
    return { id: contract.id, version: contract.version };
  }

  private async approvedContract(ctx: PanelContext): Promise<{ id: string; version: number }> {
    if (ctx.contractId)
      return { id: ctx.contractId, version: await this.contractVersion(ctx.contractId) };
    const organizationId = await this.organizationId();
    const contract = (await this.contracts.panelOptions()).find(
      (row) => row.status === 'APPROVED' && row.organizationId === organizationId,
    );
    if (!contract) throw unavailable('No approved ORG-0001 contract. Play MF-01b first.');
    return contract;
  }

  private async sosDevice(): Promise<string> {
    const preferred = await this.devices.byAssetTag('TL-0010');
    if (preferred && preferred.status === 'RENTED') return preferred.id;
    const organizationId = await this.organizationId();
    const custody = await this.contracts.visibleDevices({ organizationId });
    const units = await this.devices.projections(custody.map((unit) => unit.deviceId));
    const unit = units.find((device) => device.status === 'RENTED' && device.nodeNum !== null);
    if (!unit) throw unavailable('ORG-0001 has no rented unit with a node number.');
    return unit.id;
  }

  private async incidentVersion(ctx: PanelContext): Promise<Resolved['input']> {
    if (!ctx.incidentId) throw unavailable('The SOS step opened no incident.');
    const incident = await this.incidents.panelRecord(ctx.incidentId);
    if (!incident) throw unavailable('The incident of the SOS step is gone.');
    return { recordId: incident.id, expectedVersion: incident.version };
  }

  private narration(
    title: string,
    window: string,
    screen: string,
    line: string,
    click: string,
  ): StepSpec {
    return { title, window, screen, line, click };
  }

  // The steps of each main flow (playbook §4 to §10). Windows: A Manager, B Staff, C Operator, D Admin,
  // E the new organization's Manager.
  private flowSteps(flow: PlaybackFlow): StepSpec[] {
    switch (flow) {
      case 'MF-01a':
        return [
          {
            title: 'Organization registers',
            window: 'E, not signed in',
            screen: '/register',
            line: 'A trekking company registers itself; it gets its organization code at once.',
            click: 'Register your organization, fill the seven fields, Register.',
            run: () => Promise.resolve({ command: 'organization-register', input: {} }),
          },
          {
            title: 'Staff record counter verification',
            window: 'B, Staff',
            screen: '/t/organizations',
            line: 'Staff check the papers in person before anyone can approve.',
            click: 'Tab Pending, the new organization, Counter verification, Record verification.',
            run: (ctx) =>
              Promise.resolve({
                command: 'organization-verify',
                input: { recordId: ctx.organizationId, expectedVersion: ctx.version },
              }),
          },
          {
            title: 'Admin approves the organization on the real screen',
            window: 'D, Admin',
            screen: '/t/organizations',
            line: 'Only an Admin approves; the Manager then receives the invitation mail. The panel never acts as the Admin.',
            click: 'Tab Pending, the new organization, Approve.',
            waitFor: {
              prompt: (ctx) =>
                `Approve ${ctx.organizationCode ?? 'the new organization'} on the Admin screen (Organizations, tab Pending, Approve). The playback resumes by itself once it is Active, or press Resume.`,
              done: async (ctx) =>
                Boolean(ctx.organizationId) &&
                (await this.organizations.activeDemoOptions()).some(
                  (row) => row.id === ctx.organizationId,
                ),
            },
          },
        ];
      case 'MF-01b':
        return [
          {
            title: 'Manager requests a contract',
            window: 'A, Manager',
            screen: '/o/contracts/new',
            line: 'The Manager asks for TrekLink v3 units from today; the units are held for 24 hours.',
            click: 'Request a contract, Monthly, TrekLink v3, quantity, start today, Send request.',
            run: () => Promise.resolve({ command: 'contract-create', input: {} }),
          },
          {
            title: 'Staff approve the request',
            window: 'B, Staff',
            screen: '/t/contracts',
            line: 'Staff approve with a handover appointment; the units are reserved.',
            click: 'Show Requested, the new contract, Show details, Approve.',
            run: async (ctx) => ({
              command: 'contract-approve',
              input: {
                recordId: ctx.contractId,
                expectedVersion: ctx.contractId
                  ? await this.contractVersion(ctx.contractId)
                  : undefined,
              },
            }),
          },
        ];
      case 'MF-01c':
        return [
          {
            title: 'Counter payment and handover',
            window: 'B, Staff with A',
            screen: '/t/counter',
            line: 'The holding fee is paid at the counter, every unit is provisioned and the Manager signs.',
            click:
              'Open the contract, Start handover, readings, provisioning, payment, Sign, Complete handover.',
            run: async (ctx) => {
              const contract = await this.approvedContract(ctx);
              return {
                command: 'contract-handover',
                input: { recordId: contract.id, expectedVersion: contract.version },
              };
            },
          },
        ];
      case 'MF-02':
        return [
          this.narration(
            'The field data path',
            'Talk',
            'Slide',
            'Node, LoRa, laptop over USB, SQLite queue with SOS first, MQTT QoS 1, ingestion with eventId dedup.',
            'None.',
          ),
          {
            title: 'Units report their positions (simulated)',
            window: 'C, Operator',
            screen: '/o/map',
            line: 'Each rented unit reports a position; say aloud that these packets are simulated.',
            click: 'Live map.',
            run: () => Promise.resolve({ command: 'field-positions', input: {} }),
          },
          this.narration(
            'Sync status',
            'B, Staff',
            '/t/admin/sync',
            'Staff see the subscriber up and the recent field events, attributed.',
            'Sidebar Field data sync.',
          ),
        ];
      case 'MF-03':
        return [
          {
            title: 'SOS from TL-0010 (simulated)',
            window: 'Physical unit',
            screen: 'Gateway log',
            line: 'The hiker holds the SOS button; the alert reaches the on-duty Operator.',
            click: 'None; watch window C for the red banner.',
            run: async () => ({
              command: 'incident-sos',
              input: { deviceId: await this.sosDevice() },
            }),
          },
          {
            title: 'Operator acknowledges',
            window: 'C, Operator',
            screen: '/o/incidents',
            line: 'The Operator takes ownership; escalation stops.',
            click: 'Acknowledge on the banner or the incident.',
            run: async (ctx) => ({
              command: 'incident-acknowledge',
              input: await this.incidentVersion(ctx),
            }),
          },
          {
            title: 'Response under way',
            window: 'C, Operator',
            screen: '/o/incidents',
            line: 'The response is recorded: a ranger team is dispatched.',
            click: 'Response under way, Save response.',
            run: async (ctx) => ({
              command: 'incident-respond',
              input: await this.incidentVersion(ctx),
            }),
          },
          {
            title: 'Incident resolved',
            window: 'C, Operator',
            screen: '/o/incidents',
            line: 'The outcome is recorded; the history lists every step.',
            click: 'Report outcome, Resolve incident.',
            run: async (ctx) => ({
              command: 'incident-resolve',
              input: await this.incidentVersion(ctx),
            }),
          },
        ];
      case 'MF-04':
        return [
          this.narration(
            'Live map',
            'C, Operator',
            '/o/map',
            'Every unit of the organization with battery and last seen.',
            'Live map.',
          ),
          this.narration(
            'Search a unit',
            'C, Operator',
            '/o/map',
            'Find a hiker by asset tag, holder or contract.',
            'Search TL-0010.',
          ),
          this.narration(
            'Sovereignty overlay',
            'C, Operator',
            '/o/map',
            'Hoang Sa and Truong Sa are drawn as Vietnamese territory on every map.',
            'Zoom out to 6 or 7, drag left.',
          ),
          this.narration(
            'Fleet map',
            'B, Staff',
            '/t/map',
            'Staff see every organization, then filter one.',
            'Fleet map, filter ORG-0001.',
          ),
          this.narration(
            'Organization API',
            'A, Manager',
            '/o/api-keys',
            'An API key gives the organization its own dashboard feed.',
            'Create API key, then the curl call.',
          ),
        ];
      case 'MF-05':
        return [
          {
            title: 'Term ends and units come back',
            window: 'A, Manager, then B, Staff',
            screen: '/t/counter',
            line: 'Notice, End contract now, then check-in, reset and inspection of every unit.',
            click: 'Give notice, End contract now; Record return, check in, Record reset, Inspect.',
            run: async () => {
              const contract = await this.runningContract();
              return {
                command: 'contract-return',
                input: { recordId: contract.id, expectedVersion: contract.version },
              };
            },
          },
          {
            title: 'Closing invoice paid and contract closed',
            window: 'B, Staff',
            screen: '/t/counter',
            line: 'Open balances are paid at the counter; the contract closes.',
            click: 'Open the invoices, Record counter payment; tab Close, Close contract.',
            run: async (ctx) => {
              // The contract the return step ended: it is no longer ACTIVE, so it is not looked up again.
              const id = ctx.contractId;
              if (!id)
                throw unavailable('The return step recorded no contract. Start the flow again.');
              return {
                command: 'contract-close',
                input: { recordId: id, expectedVersion: await this.contractVersion(id) },
              };
            },
          },
        ];
    }
  }
}
