import { Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import {
  PANEL_FAILURE_CAPACITY,
  PANEL_FAILURE_WINDOW_MS,
  PANEL_MAX_FAILURES,
} from './demo-panel.constants';

export interface FailureWindow {
  count: number;
  firstAt: number;
}

// The failure count of REQ-PNL-11: per client address, a fixed window of ten minutes from the first wrong
// or missing password. In process memory, because the AWS host runs one backend (design §11).
@Injectable()
export class DemoPanelFailures {
  private readonly windows = new Map<string, FailureWindow>();

  // The time the address may try again, or null when it is not over the limit.
  blockedUntil(address: string, now: number): number | null {
    const window = this.live(failureKeyOf(address), now);
    return window && window.count >= PANEL_MAX_FAILURES
      ? window.firstAt + PANEL_FAILURE_WINDOW_MS
      : null;
  }

  // Counts an attempt before its password is compared (review of treklink-web#541): synchronous, so of
  // many parallel requests from one address at most PANEL_MAX_FAILURES reach a comparison. Returns the
  // ticket to release on a right password, or the time the address may try again when it is over the
  // limit, in which case nothing is counted.
  reserve(address: string, now: number): { ticket: FailureWindow } | { blockedUntil: number } {
    const key = failureKeyOf(address);
    const live = this.live(key, now);
    if (live && live.count >= PANEL_MAX_FAILURES)
      return { blockedUntil: live.firstAt + PANEL_FAILURE_WINDOW_MS };
    if (live) {
      live.count += 1;
      return { ticket: live };
    }
    if (this.windows.size >= PANEL_FAILURE_CAPACITY) this.evict(now);
    const window = { count: 1, firstAt: now };
    this.windows.set(key, window);
    return { ticket: window };
  }

  // A right password gives back its own reserved attempt; earlier failures keep counting (REQ-PNL-11).
  release(ticket: FailureWindow): void {
    ticket.count = Math.max(0, ticket.count - 1);
  }

  record(address: string, now: number): void {
    this.reserve(address, now);
  }

  private live(address: string, now: number): FailureWindow | null {
    const window = this.windows.get(address);
    if (!window) return null;
    if (now - window.firstAt >= PANEL_FAILURE_WINDOW_MS) {
      this.windows.delete(address);
      return null;
    }
    return window;
  }

  // Expired windows first; when every window is live, the oldest goes (Map keeps insertion order).
  private evict(now: number): void {
    for (const [address, window] of this.windows) {
      if (now - window.firstAt >= PANEL_FAILURE_WINDOW_MS) this.windows.delete(address);
    }
    if (this.windows.size >= PANEL_FAILURE_CAPACITY) {
      const oldest = this.windows.keys().next();
      if (!oldest.done) this.windows.delete(oldest.value);
    }
  }
}

const unmap = (address: string): string => address.trim().replace(/^::ffff:(?=\d+\.)/i, '');

// Loopback, private and link-local peers: the reverse proxy of the host (Caddy on the AWS host, design §2.5).
export const isProxyPeer = (address: string): boolean => {
  const ip = unmap(address).toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(ip) === 6) return ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  return false;
};

interface PeerRequest {
  socket?: { remoteAddress?: string | null };
  headers: Record<string, string | string[] | undefined>;
}

// The client address the failure count keys on (design §11). Behind a private proxy it is the right-most
// X-Forwarded-For entry, the address the proxy itself appended; a direct client cannot pick its own key,
// because its X-Forwarded-For is ignored.
export const clientAddressOf = (request: PeerRequest): string => {
  const peer = unmap(request.socket?.remoteAddress ?? '');
  if (peer && isProxyPeer(peer)) {
    const header = request.headers['x-forwarded-for'];
    const entries = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((entry) => unmap(entry))
      .filter((entry) => entry !== '');
    const last = entries[entries.length - 1];
    if (last && isIP(last)) return last;
  }
  return peer || 'unknown';
};

// The key of the failure count: an IPv4 address as it is, an IPv6 address by its /64, because one host
// usually holds a whole /64 and could otherwise rotate through it (review of treklink-web#541).
export const failureKeyOf = (address: string): string => {
  const ip = unmap(address).toLowerCase();
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') && tail ? tail.split(':') : [];
  // An embedded IPv4 tail (a.b.c.d) takes two groups; the /64 never reaches it, so it counts as two.
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(8 - width(left) - width(right)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
};
