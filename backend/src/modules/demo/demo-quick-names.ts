// Realistic, fictitious names for the organization the quick panel registers (demo-quick.service,
// action `organization`), so a defence walk shows clean data instead of "Demo N" placeholders
// (D-110 rule 7). Picked by the run number N: the company combines a name and a suffix (24 distinct
// names), the Manager a family name and a given name (64 distinct names); both cycle after that,
// which is allowed because only the tax code and the email must be unique, and those carry N.
// None of the names repeats ORG-0001 (Suong Ngan Trekking), the MF-01a registration (Phan Dung
// Trekking, Tran Van Binh) or a seeded account.

const COMPANY_NAMES = [
  'May Ngan',
  'Thong Xanh',
  'Suoi Bac',
  'Doi Che',
  'Sao Khue',
  'Gio Nui',
  'Rung Thong',
  'Da Quy',
] as const;
const COMPANY_SUFFIXES = [
  'Trekking Co., Ltd.',
  'Adventure Travel Co., Ltd.',
  'Highland Tours Co., Ltd.',
] as const;

const FAMILY_NAMES = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui'] as const;
const GIVEN_NAMES = [
  'Van An',
  'Thi Lan',
  'Minh Khoa',
  'Thu Trang',
  'Quoc Viet',
  'Ngoc Anh',
  'Duc Long',
  'Hai Yen',
] as const;

export interface QuickOrganizationNames {
  legalName: string;
  managerFullName: string;
  managerEmail: string;
}

// The names of quick run N (N >= 1). The email is a plus address of the team inbox, unique per run.
export const quickOrganizationNames = (runId: number): QuickOrganizationNames => {
  const i = Math.max(runId - 1, 0);
  const company = COMPANY_NAMES[i % COMPANY_NAMES.length];
  const suffix = COMPANY_SUFFIXES[Math.floor(i / COMPANY_NAMES.length) % COMPANY_SUFFIXES.length];
  const family = FAMILY_NAMES[i % FAMILY_NAMES.length];
  const given = GIVEN_NAMES[Math.floor(i / FAMILY_NAMES.length) % GIVEN_NAMES.length];
  return {
    legalName: `${company} ${suffix}`,
    managerFullName: `${family} ${given}`,
    managerEmail: `treklink.dev+quick-${runId}@gmail.com`,
  };
};
