import React from 'react';
import { Copy } from 'lucide-react';
import { useDemoAccounts, type DemoTestAccount } from '../../entities/demo/api';
import { Button, Card, CardHeader, IconButton, cn, useToast } from '../../shared/ui';

const NOTE = 'Fictitious demo data. Anyone with this page can sign in as any role.';
const COPIED = 'Copied.';
const BLOCKED = 'The browser blocked the clipboard. Select the text and copy it yourself.';

const CopyableValue: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const show = useToast((state) => state.show);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      show(COPIED);
    } catch {
      show(BLOCKED);
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-1">
      <code className="min-w-0 flex-1 break-words rounded-control bg-sunken px-2 py-1 font-mono text-body-sm text-ink">
        {value}
      </code>
      <IconButton
        size="sm"
        label={label}
        icon={<Copy aria-hidden="true" className="h-4 w-4" />}
        onClick={() => void copy()}
      />
    </div>
  );
};

// The sandbox test accounts box (screen 7.5 §"Sandbox test accounts box", specs/demo api-design 05,
// D-088 amendment of 2026-11-01, D-089). Renders nothing while loading, on any error and on a 404, so a
// deployment without DEMO_TEST_ACCOUNTS_ENABLED shows nothing. `onUse` receives the chosen account.
export const TestAccountsBox: React.FC<{
  onUse: (account: DemoTestAccount) => void;
  className?: string;
}> = ({ onUse, className }) => {
  const accounts = useDemoAccounts();
  if (!accounts.data || accounts.data.length === 0) return null;
  return (
    <Card aria-labelledby="test-accounts-title" className={cn('min-w-0', className)}>
      <CardHeader id="test-accounts-title" title="Sandbox test accounts" description={NOTE} />
      <ul className="flex flex-col divide-y divide-line">
        {accounts.data.map((account) => (
          <li key={account.email} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-semibold text-ink">{account.roleLabel}</p>
                <p className="text-body-sm text-ink-muted">
                  {account.fullName}, {account.organization ?? 'TrekLink'}
                </p>
              </div>
              <Button size="sm" onClick={() => onUse(account)} aria-label={`Use ${account.roleLabel}`}>
                Use
              </Button>
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              <CopyableValue label={`Copy email for ${account.roleLabel}`} value={account.email} />
              <CopyableValue
                label={`Copy password for ${account.roleLabel}`}
                value={account.password}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};
