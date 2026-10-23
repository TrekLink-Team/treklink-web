import { runWithRequestContext } from '../context/request-context';
import { RequestIdLogger } from './request-id.logger';

describe('RequestIdLogger', () => {
  let stdout: jest.SpyInstance;
  const logger = new RequestIdLogger('Sample', { colors: false, timestamp: false });

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => stdout.mockRestore());

  const written = (): string => stdout.mock.calls.map(([chunk]) => String(chunk)).join('');

  it('prefixes a line written during a request with its id', () => {
    runWithRequestContext({ requestId: 'demo-req-0003' }, () => logger.log('handled'));

    expect(written()).toContain('[Sample] [req demo-req-0003] handled');
  });

  it('writes a line outside a request without a prefix', () => {
    logger.log('booted');

    expect(written()).toContain('[Sample] booted');
    expect(written()).not.toContain('[req ');
  });
});
