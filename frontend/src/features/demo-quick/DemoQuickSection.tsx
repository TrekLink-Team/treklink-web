import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  demoMessageOf,
  quickResultOf,
  useDemoQuickOptions,
  useRunDemoQuick,
  type QuickAction,
  type QuickInput,
  type QuickResult,
} from '../../entities/demo/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Select,
  Skeleton,
} from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';

const TITLES: Record<QuickAction, string> = {
  organization: 'Quick organization registration',
  contract: 'Quick contract',
  walkers: 'Refresh simulated walkers',
  incident: 'Quick incident',
  loss: 'Quick loss case',
  fault: 'Quick fault report',
  profile: 'Escalation demo profile',
  'term-end': 'Advance contract to term end',
  'next-tier': 'Advance incident to next tier',
};
const TIME_ACTIONS: QuickAction[] = ['profile', 'term-end', 'next-tier'];

export const DemoQuickSection: React.FC = () => {
  const options = useDemoQuickOptions(true);
  const mutation = useRunDemoQuick();
  const [results, setResults] = useState<Partial<Record<QuickAction, QuickResult>>>({});
  const [errors, setErrors] = useState<Partial<Record<QuickAction, string>>>({});
  const [organization, setOrganization] = useState('');
  const [variant, setVariant] = useState('');
  const [quantity, setQuantity] = useState('');
  const [target, setTarget] = useState<NonNullable<QuickInput['target']>>('APPROVED');
  const [units, setUnits] = useState<Partial<Record<QuickAction, string>>>({});
  const [contract, setContract] = useState('');
  const [incident, setIncident] = useState('');
  const [confirm, setConfirm] = useState<{ action: QuickAction; input: QuickInput } | null>(null);

  if (options.isPending) return <Skeleton className="h-40 w-full" />;
  if (options.error)
    return (
      <Alert tone="error" title="Quick scenarios could not load">
        {demoMessageOf(options.error, messageOf)} Reload the panel to try again.
      </Alert>
    );
  const data = options.data;
  if (!data) return null;
  const busy = mutation.isPending;
  const orgId = organization || data.organizations[0]?.id || '';
  const variantId =
    variant ||
    data.variants.find((item) => item.code === 'treklink-v3')?.id ||
    data.variants[0]?.id ||
    '';

  const run = async (action: QuickAction, input: QuickInput) => {
    setConfirm(null);
    setErrors((current) => ({ ...current, [action]: undefined }));
    try {
      const result = await mutation.mutateAsync({ action, input });
      setResults((current) => ({ ...current, [action]: result }));
    } catch (failure) {
      setResults((current) => ({ ...current, [action]: quickResultOf(failure) ?? undefined }));
      setErrors((current) => ({ ...current, [action]: demoMessageOf(failure, messageOf) }));
    }
  };
  const submit = (action: QuickAction, input: QuickInput) => {
    if (TIME_ACTIONS.includes(action)) setConfirm({ action, input });
    else void run(action, input);
  };
  const feedback = (action: QuickAction) => {
    const result = results[action];
    const error = errors[action] || result?.error;
    return (
      <div className="mt-2 min-w-0 break-words text-body-sm" aria-live="polite" aria-atomic="true">
        {busy && mutation.variables?.action === action && (
          <p>Running {TITLES[action].toLowerCase()}.</p>
        )}
        {error && (
          <p className="text-status-critical-fg">
            {error}
            {result?.errorCode === 'STALE_VERSION'
              ? ' Reload the panel to use the latest version.'
              : ''}
          </p>
        )}
        {result && (
          <>
            <p className="text-ink-muted">
              {result.label}: {error ? 'inspect committed records before retrying.' : 'completed.'}
            </p>
            <ul className="flex flex-col gap-1">
              {result.records.map((record) => (
                <li key={`${record.label}-${record.path}`}>
                  {record.label}:{' '}
                  <Link
                    className="inline-flex min-h-6 items-center font-semibold text-brand underline"
                    to={record.path}
                  >
                    {record.code}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  };
  const button = (action: QuickAction, reason?: string) => (
    <>
      <Button
        type="submit"
        variant="primary"
        loading={busy && mutation.variables?.action === action}
        disabled={busy || Boolean(reason)}
      >
        {TITLES[action]}
      </Button>
      {reason && <p className="text-body-sm text-ink-muted">{reason}</p>}
      {feedback(action)}
    </>
  );
  const unitField = (action: 'incident' | 'loss' | 'fault') => (
    <Field id={`quick-${action}-unit`} label="Rented unit" required>
      <Select
        id={`quick-${action}-unit`}
        required
        value={units[action] || ''}
        onChange={(event) => setUnits((current) => ({ ...current, [action]: event.target.value }))}
      >
        <option value="">Choose a rented unit</option>
        {data.units
          .filter((unit) => action !== 'incident' || unit.nodeNum !== null)
          .map((unit) => (
            <option key={unit.deviceId} value={unit.deviceId}>
              {unit.assetTag}, {unit.contractCode}
            </option>
          ))}
      </Select>
    </Field>
  );
  const onSubmit = (action: QuickAction, input: QuickInput) => (event: React.FormEvent) => {
    event.preventDefault();
    submit(action, input);
  };

  return (
    <section aria-label="Quick scenarios" className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 min-[900px]:grid-cols-2">
        <Card as="section" aria-labelledby="quick-wf01" className="min-w-0">
          <h2 id="quick-wf01" className="text-title text-ink">
            WF-01 · Organization and contract
          </h2>
          <form
            className="mt-3 flex flex-col items-start gap-2"
            onSubmit={onSubmit('organization', {})}
          >
            <p className="text-body-sm text-ink-muted">
              Create a fresh pending application with a Demo name, tax code and contact.
            </p>
            {button('organization')}
          </form>
          <form
            className="mt-5 flex flex-col gap-3 border-t border-line pt-4"
            onSubmit={onSubmit('contract', {
              organizationId: orgId,
              hardwareVariantId: variantId,
              quantity: Number(quantity || data.minimumQuantity),
              target,
            })}
          >
            <Field id="quick-organization" label="Active organization" required>
              <Select
                id="quick-organization"
                required
                value={orgId}
                onChange={(e) => setOrganization(e.target.value)}
              >
                {!data.organizations.length && <option value="">No Active organizations</option>}
                {data.organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.code}, {org.legalName}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="quick-variant" label="Variant" required>
                <Select
                  id="quick-variant"
                  value={variantId}
                  required
                  onChange={(e) => setVariant(e.target.value)}
                >
                  {!data.variants.length && <option value="">No active variants</option>}
                  {data.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="quick-quantity" label="Quantity" required>
                <Input
                  id="quick-quantity"
                  type="number"
                  min={Math.max(
                    data.minimumQuantity,
                    ['ACTIVE', 'RETURN_DUE'].includes(target) ? 2 : 1,
                  )}
                  required
                  value={quantity || data.minimumQuantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field>
            </div>
            <Field id="quick-target" label="Target state" required>
              <Select
                id="quick-target"
                value={target}
                onChange={(e) => setTarget(e.target.value as typeof target)}
              >
                <option value="REQUESTED">Requested, approve live</option>
                <option value="APPROVED">Approved, handover next</option>
                <option value="ACTIVE">Active, release a unit or End now</option>
                <option value="RETURN_DUE">Return due, check-in next</option>
              </Select>
            </Field>
            <p className="text-body-sm text-ink-muted">
              Quick contracts record the signed-in Admin as requester. Uses real stock and invoices.
              Active and Return due record manual provisioning, demo checks and a synthetic
              signature. Demo custody starts before the attribution margin so SOS can run
              immediately.
            </p>
            {button(
              'contract',
              !orgId || !variantId
                ? 'An Active organization and an active variant are required.'
                : undefined,
            )}
          </form>
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <Card as="section" aria-labelledby="quick-wf02">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="quick-wf02" className="text-title text-ink">
                WF-02 · Walkers
              </h2>
              <Badge>Simulated</Badge>
            </div>
            <form className="mt-3 flex flex-col gap-3" onSubmit={onSubmit('walkers', {})}>
              <p className="text-body-sm text-ink-muted">
                Start or refresh rented nodes as walkers. Restore plausible simulator battery
                readings. No physical node is changed.
              </p>
              {button(
                'walkers',
                !data.units.some((unit) => unit.nodeNum !== null)
                  ? 'A rented unit with a node number is required.'
                  : undefined,
              )}
            </form>
          </Card>
          <Card as="section" aria-labelledby="quick-wf03">
            <h2 id="quick-wf03" className="text-title text-ink">
              WF-03 · Incident
            </h2>
            <form
              className="mt-3 flex flex-col gap-3"
              onSubmit={onSubmit('incident', { deviceId: units.incident })}
            >
              <p className="text-body-sm text-ink-muted">
                Send a Simulated SOS through real ingest, alerts and escalation. Choose a unit
                without an open incident.
              </p>
              {unitField('incident')}
              {button(
                'incident',
                !data.units.some((unit) => unit.nodeNum !== null)
                  ? 'A rented unit with a node number is required.'
                  : undefined,
              )}
            </form>
          </Card>
          <Card as="section" aria-labelledby="quick-wf04">
            <h2 id="quick-wf04" className="text-title text-ink">
              WF-04 · Invoices and balance
            </h2>
            <p className="mt-2 text-body-sm text-ink-muted">
              Create a contract in WF-01, then follow its Counter and invoices result link. Its
              invoices and receipts come from the real billing services.
            </p>
            <Link
              className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand underline"
              to="/t/contracts"
            >
              Open contracts
            </Link>
          </Card>
        </div>
      </div>
      <Card as="section" aria-labelledby="quick-wf05">
        <h2 id="quick-wf05" className="text-title text-ink">
          WF-05 · Loss and fault
        </h2>
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          {(['loss', 'fault'] as const).map((action) => (
            <form
              key={action}
              className="flex flex-col gap-3"
              onSubmit={onSubmit(action, { deviceId: units[action] })}
            >
              {unitField(action)}
              {action === 'fault' && (
                <p className="text-body-sm text-ink-muted">
                  Quick fault reports record the signed-in Admin as reporter.
                </p>
              )}
              {button(
                action,
                !data.units.length ? 'A currently rented unit is required.' : undefined,
              )}
            </form>
          ))}
        </div>
      </Card>
      <Card as="section" aria-labelledby="quick-time">
        <h2 id="quick-time" className="text-title text-ink">
          Demo time controls
        </h2>
        <p className="mt-1 text-body-sm text-ink-muted">
          These controls change demo time or shared escalation parameters. Every change records the
          requesting Admin.
        </p>
        <div className="mt-3 grid gap-5 lg:grid-cols-3">
          <form
            className="flex flex-col items-start gap-3"
            onSubmit={onSubmit('profile', {
              active: !data.profile.active,
              expectedVersion: data.profile.version,
            })}
          >
            <h3 className="font-bold text-ink">
              Escalation profile: {data.profile.active ? 'Demo active' : 'Normal'}
            </h3>
            <p className="text-body-sm text-ink-muted">
              30-second tiers, 5-minute reopen window. Disabling restores the saved prior values.
              Version {data.profile.version}.
            </p>
            <Button type="submit" role="switch" aria-checked={data.profile.active} disabled={busy}>
              {data.profile.active ? 'Restore normal escalation' : 'Enable demo escalation'}
            </Button>
            {feedback('profile')}
          </form>
          <form
            className="flex flex-col gap-3"
            onSubmit={onSubmit('term-end', {
              recordId: contract,
              expectedVersion: data.contracts.find((row) => row.id === contract)?.version,
            })}
          >
            <Field id="quick-term-contract" label="Contract to advance" required>
              <Select
                id="quick-term-contract"
                required
                value={contract}
                onChange={(e) => setContract(e.target.value)}
              >
                <option value="">Choose an Active or Ending contract</option>
                {data.contracts.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code}
                  </option>
                ))}
              </Select>
            </Field>
            {button(
              'term-end',
              !data.contracts.length ? 'No Active or Ending contract is available.' : undefined,
            )}
          </form>
          <form
            className="flex flex-col gap-3"
            onSubmit={onSubmit('next-tier', {
              recordId: incident,
              expectedVersion: data.incidents.find((row) => row.id === incident)?.version,
            })}
          >
            <Field id="quick-tier-incident" label="Simulated incident to advance" required>
              <Select
                id="quick-tier-incident"
                required
                value={incident}
                onChange={(e) => setIncident(e.target.value)}
              >
                <option value="">Choose an incident awaiting a tier</option>
                {data.incidents.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code}, {row.state}
                  </option>
                ))}
              </Select>
            </Field>
            {button(
              'next-tier',
              !data.incidents.length
                ? 'No simulated incident is awaiting an escalation tier.'
                : undefined,
            )}
          </form>
        </div>
      </Card>
      {confirm && (
        <Dialog
          titleId="demo-time-confirm"
          title={`${TITLES[confirm.action]}${confirm.action === 'term-end' ? `: ${data.contracts.find((row) => row.id === confirm.input.recordId)?.code ?? ''}` : confirm.action === 'next-tier' ? `: ${data.incidents.find((row) => row.id === confirm.input.recordId)?.code ?? ''}` : ''}?`}
          description={
            confirm.action === 'profile'
              ? 'This changes the four shared escalation parameters, or restores their saved prior values. Existing incident deadlines are kept.'
              : confirm.action === 'term-end'
                ? 'This gives notice and shifts this contract to its term end for the return flow. Other contracts keep their terms.'
                : 'This makes the selected simulated incident reach its next escalation tier now. Normal alerts will be sent.'
          }
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void run(confirm.action, confirm.input)}>
                {confirm.action === 'profile'
                  ? confirm.input.active
                    ? 'Enable demo escalation'
                    : 'Restore normal escalation'
                  : TITLES[confirm.action]}
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      )}
    </section>
  );
};
