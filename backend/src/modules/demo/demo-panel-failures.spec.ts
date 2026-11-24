import {
  clientAddressOf,
  DemoPanelFailures,
  failureKeyOf,
  isProxyPeer,
} from './demo-panel-failures';
import {
  PANEL_FAILURE_CAPACITY,
  PANEL_FAILURE_WINDOW_MS,
  PANEL_MAX_FAILURES,
} from './demo-panel.constants';

describe('DemoPanelFailures (REQ-PNL-11)', () => {
  it('blocks an address after five failures until ten minutes from the first', () => {
    const failures = new DemoPanelFailures();
    for (let i = 0; i < PANEL_MAX_FAILURES - 1; i += 1) failures.record('203.0.113.9', 1000 + i);
    expect(failures.blockedUntil('203.0.113.9', 2000)).toBeNull();
    failures.record('203.0.113.9', 2000);
    expect(failures.blockedUntil('203.0.113.9', 2001)).toBe(1000 + PANEL_FAILURE_WINDOW_MS);
    expect(failures.blockedUntil('198.51.100.1', 2001)).toBeNull();
    expect(failures.blockedUntil('203.0.113.9', 1000 + PANEL_FAILURE_WINDOW_MS)).toBeNull();
  });

  it('starts a new window once the old one ends', () => {
    const failures = new DemoPanelFailures();
    for (let i = 0; i < PANEL_MAX_FAILURES; i += 1) failures.record('a', 0);
    failures.record('a', PANEL_FAILURE_WINDOW_MS + 1);
    expect(failures.blockedUntil('a', PANEL_FAILURE_WINDOW_MS + 2)).toBeNull();
  });

  it('holds at most the capacity, dropping the oldest when every window is live', () => {
    const failures = new DemoPanelFailures();
    for (let i = 0; i < PANEL_MAX_FAILURES; i += 1) failures.record('first', 0);
    for (let i = 0; i < PANEL_FAILURE_CAPACITY; i += 1) failures.record(`10.0.${i}`, 1);
    expect(failures.blockedUntil('first', 2)).toBeNull();
  });
});

describe('clientAddressOf (design §11)', () => {
  const req = (remoteAddress: string, xff?: string) => ({
    socket: { remoteAddress },
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
  });

  it('takes the right-most X-Forwarded-For entry behind a private proxy', () => {
    expect(clientAddressOf(req('::ffff:172.18.0.4', '1.2.3.4, 203.0.113.7'))).toBe('203.0.113.7');
    expect(clientAddressOf(req('127.0.0.1', '198.51.100.2'))).toBe('198.51.100.2');
  });

  it('ignores X-Forwarded-For from a public peer, so a client cannot choose its key', () => {
    expect(clientAddressOf(req('203.0.113.50', '10.0.0.1'))).toBe('203.0.113.50');
  });

  it('falls back to the peer when the header is missing or not an address', () => {
    expect(clientAddressOf(req('10.1.2.3'))).toBe('10.1.2.3');
    expect(clientAddressOf(req('10.1.2.3', 'not-an-ip'))).toBe('10.1.2.3');
    expect(clientAddressOf({ headers: {} })).toBe('unknown');
  });

  it.each([
    ['10.0.0.1', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.1.1', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['8.8.8.8', false],
    ['2001:db8::1', false],
  ])('treats %s as a proxy peer: %s', (address, expected) => {
    expect(isProxyPeer(address)).toBe(expected);
  });
});

describe('failure keys and reservations (review of treklink-web#541)', () => {
  it.each([
    ['203.0.113.9', '203.0.113.9'],
    ['::ffff:203.0.113.9', '203.0.113.9'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('keys %s as %s', (address, key) => {
    expect(failureKeyOf(address)).toBe(key);
  });

  it('counts every address of one IPv6 /64 together', () => {
    const failures = new DemoPanelFailures();
    for (let i = 1; i <= PANEL_MAX_FAILURES; i += 1) failures.record(`2001:db8:1:2::${i}`, 0);
    expect(failures.blockedUntil('2001:db8:1:2:ffff::9', 1)).toBe(PANEL_FAILURE_WINDOW_MS);
    expect(failures.blockedUntil('2001:db8:1:3::1', 1)).toBeNull();
  });

  it('reserves synchronously and releases a right attempt', () => {
    const failures = new DemoPanelFailures();
    const tickets = Array.from({ length: PANEL_MAX_FAILURES }, () => failures.reserve('a', 0));
    expect(failures.reserve('a', 0)).toEqual({ blockedUntil: PANEL_FAILURE_WINDOW_MS });
    const first = tickets[0];
    if ('ticket' in first) failures.release(first.ticket);
    expect(failures.reserve('a', 0)).toHaveProperty('ticket');
  });
});
