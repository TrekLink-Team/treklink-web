import { describe, expect, it } from 'vitest';
import { ACCOUNT_PAGE_SIZE, accountKeys } from './api';

describe('accountKeys', () => {
  it('keeps reads of the same filters apart by page size, under the shared accounts prefix', () => {
    const table = accountKeys.list({ isActive: true }, 1);
    const guard = accountKeys.list({ isActive: true }, 1, 100);
    expect(table).toEqual(['accounts', { isActive: true }, 1, ACCOUNT_PAGE_SIZE]);
    expect(guard).toEqual(['accounts', { isActive: true }, 1, 100]);
    expect(table).not.toEqual(guard);
    expect(guard.slice(0, 1)).toEqual(accountKeys.all);
  });
});
