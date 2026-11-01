import { timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DomainException, ErrorCode } from '../../common/errors';
import { FieldStationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';

// mosquitto ACL access bits as go-auth forwards them (`acc`): 1 read (a message delivered to the
// client), 2 write (a publish), 4 subscribe (the filter of a SUBSCRIBE). 3 is go-auth's label for
// read and write together, which no credential of design §4 holds.
export const ACC_READ = 1;
export const ACC_WRITE = 2;
export const ACC_SUBSCRIBE = 4;

export type BrokerCredentialKind = 'BACKEND' | 'FLEET_NODE' | 'FIELD_STATION';

export interface UserCheck {
  username: string;
  password: string;
  clientid: string;
}

export interface AclCheck {
  username: string;
  clientid: string;
  topic: string;
  acc: number;
}

// `fs-<organization code in lower case>-<n>` (organizations `FieldStationsService.create`).
const FIELD_STATION_USERNAME = /^fs-[a-z0-9-]+-\d+$/;
// `node-<nodeId>`, the node id as the stock firmware writes it in its topics: `!` and 8 hex digits.
const FLEET_NODE_USERNAME = /^node-(![0-9a-f]{8})$/;
// One topic level a client may name in a publish: no separator and no wildcard.
const LEVEL = '[^/+#]+';

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sameSecret = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const credentialRejected = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.CREDENTIAL_REJECTED, 'Denied.');

const topicDenied = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.TOPIC_DENIED, 'Denied.');

// The broker's credential kind behind a username, for the ACL check (design §4). The backend
// subscriber is matched first, so `MQTT_USERNAME` is never read as a node or a station.
export const kindOf = (
  username: string,
  backendUsername: string | undefined,
): BrokerCredentialKind | null => {
  if (backendUsername && username === backendUsername) return 'BACKEND';
  if (FLEET_NODE_USERNAME.test(username)) return 'FLEET_NODE';
  if (FIELD_STATION_USERNAME.test(username)) return 'FIELD_STATION';
  return null;
};

// The topic rules of design §4 for one access, `root` being MQTT_ROOT (`treklink`):
// - backend subscriber: subscribe to and read anything under `<root>/`, publish nothing;
// - fleet node: publish `<root>/2/json/+/<nodeId>` and `<root>/2/e/+/<nodeId>`, subscribe nothing;
// - Field Station: publish under `<root>/fs/<its username>/#`, subscribe nothing.
export const topicAllowed = (
  kind: BrokerCredentialKind,
  username: string,
  topic: string,
  acc: number,
  root: string,
): boolean => {
  const base = escape(root);
  if (kind === 'BACKEND') {
    if (acc !== ACC_READ && acc !== ACC_SUBSCRIBE) return false;
    return topic === root || topic.startsWith(`${root}/`);
  }
  if (acc !== ACC_WRITE) return false;
  if (kind === 'FLEET_NODE') {
    const nodeId = escape(FLEET_NODE_USERNAME.exec(username)?.[1] ?? '');
    return new RegExp(`^${base}/2/(json|e)/${LEVEL}/${nodeId}$`).test(topic);
  }
  return new RegExp(`^${base}/fs/${escape(username)}(/${LEVEL})*$`).test(topic);
};

// The mosquitto-go-auth HTTP hooks (task 3.1, api-design 01 and 02, design §4, REQ-EVT-07). go-auth
// runs in status mode, so 200 allows and the 401 and 403 envelopes deny. A Field Station is checked
// against its stored bcrypt hash through `organizations` (D-037); a fleet node against the shared
// MQTT_NODE_PASSWORD (design §4, refused while it is unset); a revoked station or one of a
// `CLOSED` organization is refused at its next connection (organizations AC-06), bounded by the
// plugin's cache of at most 60 s. No password, secret or hash is ever logged; a refusal logs the
// username and the reason only.
@Injectable()
export class BrokerAuthService {
  private readonly logger = new Logger(BrokerAuthService.name);
  private readonly hookSecret: string | undefined;
  private readonly backendUsername: string | undefined;
  private readonly backendPassword: string | undefined;
  private readonly nodePassword: string | undefined;
  private readonly root: string;

  constructor(
    private readonly stations: FieldStationsService,
    config: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.hookSecret = config.get('MQTT_AUTH_HOOK_SECRET', { infer: true }) || undefined;
    this.backendUsername = config.get('MQTT_USERNAME', { infer: true }) || undefined;
    this.backendPassword = config.get('MQTT_PASSWORD', { infer: true }) || undefined;
    this.nodePassword = config.get('MQTT_NODE_PASSWORD', { infer: true }) || undefined;
    this.root = config.get('MQTT_ROOT', { infer: true });
  }

  // Unset MQTT_AUTH_HOOK_SECRET: the hooks do not exist (404), and the default open broker of
  // docker-compose.yml never calls them. Set: `X-Broker-Secret` must equal it, compared in constant
  // time (401 BROKER_SECRET otherwise).
  assertSecret(given: string | string[] | undefined): void {
    if (!this.hookSecret) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Not found.');
    }
    if (typeof given !== 'string' || !sameSecret(given, this.hookSecret)) {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.BROKER_SECRET,
        'Authentication required.',
      );
    }
  }

  async checkUser(check: UserCheck): Promise<{ allowed: true; kind: BrokerCredentialKind }> {
    const kind = kindOf(check.username, this.backendUsername);
    if (kind === 'BACKEND') {
      if (this.backendPassword && sameSecret(check.password, this.backendPassword)) {
        return { allowed: true, kind };
      }
      return this.reject(check.username, 'wrong backend password');
    }
    if (kind === 'FIELD_STATION') {
      const station = await this.stations.byUsername(check.username);
      if (!station) return this.reject(check.username, 'unknown Field Station');
      if (station.revokedAt) return this.reject(check.username, 'revoked Field Station');
      if (station.organizationStatus === OrganizationStatus.CLOSED) {
        return this.reject(check.username, 'organization closed');
      }
      if (!(await bcrypt.compare(check.password, station.secretHash))) {
        return this.reject(check.username, 'wrong Field Station secret');
      }
      return { allowed: true, kind };
    }
    if (kind === 'FLEET_NODE') {
      // One secret shared by every fleet node (design §4, leader decision of 2026-11-01): any holder
      // may log in under any node username; the ACL still limits each username to its own topics.
      if (!this.nodePassword) return this.reject(check.username, 'MQTT_NODE_PASSWORD unset');
      if (!sameSecret(check.password, this.nodePassword)) {
        return this.reject(check.username, 'wrong fleet node password');
      }
      return { allowed: true, kind };
    }
    return this.reject(check.username, 'unknown username');
  }

  checkAcl(check: AclCheck): { allowed: true } {
    const kind = kindOf(check.username, this.backendUsername);
    if (kind && topicAllowed(kind, check.username, check.topic, check.acc, this.root)) {
      return { allowed: true };
    }
    this.logger.warn(
      `Broker topic denied: username ${JSON.stringify(check.username)}, acc ${check.acc}, topic ${JSON.stringify(check.topic)}`,
    );
    throw topicDenied();
  }

  private reject(username: string, reason: string): never {
    this.logger.warn(`Broker credential refused: username ${JSON.stringify(username)} (${reason})`);
    throw credentialRejected();
  }
}
