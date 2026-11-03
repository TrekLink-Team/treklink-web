import { useMemo } from 'react';
import { Breadcrumb, PageChromeProvider, PageHeader, StickyPageHeader } from '@treklink/ui';

// The app shell lends its breadcrumb to the sticky header, which renders it next to the title.
export const ShellBreadcrumb = () => {
  const chrome = useMemo(
    () => ({
      breadcrumb: <Breadcrumb items={[{ label: 'Contracts', to: '/contracts' }, { label: 'CT-2026-0142' }]} />,
      claim: () => () => undefined,
    }),
    [],
  );
  return (
    <div className="rounded-panel bg-ground" style={{ height: 220, overflowY: 'auto' }}>
      <PageChromeProvider value={chrome}>
        <StickyPageHeader>
          <PageHeader title="CT-2026-0142" meta="Active since 2 November" />
        </StickyPageHeader>
        <p className="px-4 text-body text-ink-muted">Contract details follow here.</p>
      </PageChromeProvider>
    </div>
  );
};
