import { quickOrganizationNames } from './demo-quick-names';

describe('quickOrganizationNames', () => {
  it('names run 1 and run 2 differently, with a plus address of the team inbox each', () => {
    expect(quickOrganizationNames(1)).toEqual({
      legalName: 'May Ngan Trekking Co., Ltd.',
      managerFullName: 'Nguyen Van An',
      managerEmail: 'treklink.dev+quick-1@gmail.com',
    });
    expect(quickOrganizationNames(2)).toEqual({
      legalName: 'Thong Xanh Trekking Co., Ltd.',
      managerFullName: 'Tran Van An',
      managerEmail: 'treklink.dev+quick-2@gmail.com',
    });
  });

  it('gives 24 distinct company names and 64 distinct manager names before cycling', () => {
    const runs = Array.from({ length: 64 }, (_, i) => quickOrganizationNames(i + 1));
    expect(new Set(runs.slice(0, 24).map((r) => r.legalName)).size).toBe(24);
    expect(new Set(runs.map((r) => r.managerFullName)).size).toBe(64);
    expect(quickOrganizationNames(25).legalName).toBe(quickOrganizationNames(1).legalName);
  });

  it('keeps every email unique and free of placeholder words', () => {
    const runs = Array.from({ length: 200 }, (_, i) => quickOrganizationNames(i + 1));
    expect(new Set(runs.map((r) => r.managerEmail)).size).toBe(200);
    for (const r of runs) {
      expect(`${r.legalName} ${r.managerFullName}`).not.toMatch(/demo|test|treklink/i);
    }
  });
});
