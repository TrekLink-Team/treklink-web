import { DomainException } from '../../common/errors';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';
import { rolloverTermEnd } from './rental-daily-cutoff';

// The demo module's reads and the MF-05 time shift (D-088, specs/demo/design.md §5).
describe('ContractsService demo commands', () => {
  const tx = { tx: true };
  const build = (term: object | null) => {
    const contracts = {
      findByCode: jest.fn().mockResolvedValue({ id: 'c-2', code: 'RC-2026-0002' }),
      openTerm: jest.fn().mockResolvedValue(term),
      setTermDates: jest.fn(),
    };
    const events = { transaction: jest.fn((work: (t: object) => Promise<unknown>) => work(tx)) };
    const service = new ContractsService(
      contracts as unknown as ContractsRepository,
      {} as never,
      {} as never,
      {} as never,
      events as never,
      {} as never,
      {} as never,
    );
    return { service, contracts };
  };

  it('reads a contract by its code', async () => {
    const { service, contracts } = build(null);
    await expect(service.byCode('RC-2026-0002')).resolves.toEqual({
      id: 'c-2',
      code: 'RC-2026-0002',
    });
    expect(contracts.findByCode).toHaveBeenCalledWith('RC-2026-0002');
  });

  it('moves the open term end, and its start a day back when it would start after the end', async () => {
    const startsAt = new Date('2026-11-01T01:00:00.000Z');
    const { service, contracts } = build({ id: 't-1', seq: 1, startsAt });
    const endsAt = new Date('2026-10-31T01:59:00.000Z');
    await expect(service.endOpenTermAt('c-2', endsAt)).resolves.toEqual({ seq: 1, endsAt });
    expect(contracts.setTermDates).toHaveBeenCalledWith(
      't-1',
      { startsAt: new Date('2026-10-30T01:59:00.000Z'), endsAt },
      tx,
    );
  });

  it('keeps an earlier start', async () => {
    const startsAt = new Date('2026-10-01T01:00:00.000Z');
    const { service, contracts } = build({ id: 't-1', seq: 2, startsAt });
    const endsAt = new Date('2026-10-31T01:59:00.000Z');
    await service.endOpenTermAt('c-2', endsAt);
    expect(contracts.setTermDates).toHaveBeenCalledWith('t-1', { startsAt, endsAt }, tx);
  });

  it('refuses a contract with no open term with 409', async () => {
    const { service, contracts } = build(null);
    const error = (await service
      .endOpenTermAt('c-2', new Date())
      .catch((e: unknown) => e)) as DomainException;
    expect(error.getStatus()).toBe(409);
    expect(contracts.setTermDates).not.toHaveBeenCalled();
  });

  it('ends a term one minute before the latest rollover cutoff', () => {
    expect(rolloverTermEnd(new Date('2026-11-01T03:30:00.000Z'), 9).toISOString()).toBe(
      '2026-11-01T01:59:00.000Z',
    );
  });
});
