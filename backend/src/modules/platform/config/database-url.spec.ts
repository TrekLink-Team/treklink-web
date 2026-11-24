import { isDemoDatabaseUrls } from './database-url';

// The dedicated demo branch check of the demo panel reseed (specs/demo REQ-PNL-12, D-110 rule 4).
describe('isDemoDatabaseUrls', () => {
  const HOST = 'ep-demo-123-pooler.ap-southeast-1.aws.neon.tech';
  const live = `postgresql://u:p@${HOST}/treklink_prod?sslmode=require`;
  const direct =
    'postgresql://u:p@ep-demo-123.ap-southeast-1.aws.neon.tech/treklink_prod?sslmode=require';

  it('accepts the pooled host exactly and its direct endpoint', () => {
    expect(isDemoDatabaseUrls(HOST, live, direct)).toBe(true);
    expect(isDemoDatabaseUrls(HOST, live, live)).toBe(true);
    expect(isDemoDatabaseUrls(` ${HOST.toUpperCase()} `, live, direct)).toBe(true);
  });

  it.each([
    ['an empty expected host', '', live, direct],
    ['an unset expected host', undefined, live, direct],
    ['another branch', 'ep-staging-9-pooler.ap-southeast-1.aws.neon.tech', live, direct],
    ['a host that only starts with it', HOST, live.replace(HOST, `${HOST}.evil.example`), direct],
    ['a direct URL on another endpoint', HOST, live, direct.replace('ep-demo-123', 'ep-prod-1')],
    ['a host override in the query', HOST, `${live}&host=ep-prod-1.neon.tech`, direct],
    ['an encoded override', HOST, `${live}&%68ost=ep-prod-1.neon.tech`, direct],
    ['a database override', HOST, live, `${direct}&dbname=neondb`],
    ['a URL that does not parse', HOST, 'not a url', direct],
  ])('refuses %s', (_name, expected, liveUrl, directUrl) => {
    expect(isDemoDatabaseUrls(expected, liveUrl, directUrl)).toBe(false);
  });
});
