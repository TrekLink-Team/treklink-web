import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  demoMessageOf,
  stageScenario,
  useDemoScenarios,
  useDemoStatus,
  type DemoScenario,
  type StageResult,
} from '../entities/demo/api';
import { RoleSwitcher } from '../features/demo-role-switch/RoleSwitcher';
import { useAdoptDemoSession } from '../features/demo-role-switch/useDemoSession';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  PageHeader,
  Skeleton,
  useToast,
} from '../shared/ui';
import { messageOf } from '../shared/ui/errors';
import { NoAccessPage } from './NoAccessPage';

const NOT_LOCAL = 'Demo controls run only against a local database.';

// Screen 7.5 (specs/frontend/ui-design/7-5-demo-control-panel.md, D-088): stage a main flow's starting
// state on the local database from one button, and switch the signed-in role. TrekLink Admin only; the
// page is a 404 notice while demo mode is off.
export const DemoControlPage: React.FC = () => {
  const status = useDemoStatus();
  const demoOn = status.data?.enabled === true;
  const local = status.data?.databaseLocal === true;
  const scenarios = useDemoScenarios(demoOn);
  const adopt = useAdoptDemoSession();
  const showToast = useToast((state) => state.show);

  const [confirming, setConfirming] = useState<DemoScenario | null>(null);
  const [staging, setStaging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StageResult | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  if (status.isPending) return <Skeleton className="h-40 w-full" />;
  if (status.error) {
    return (
      <Alert tone="error" title="The demo status could not be read.">
        {messageOf(status.error)}
      </Alert>
    );
  }
  if (!demoOn) return <NoAccessPage />;

  const busy = staging !== null;
  const disabled = busy || !local;

  const stage = async (scenario: DemoScenario) => {
    setConfirming(null);
    setStaging(scenario.id);
    setError(null);
    setResult(null);
    try {
      const staged = await stageScenario(scenario.id);
      // The seeded users were recreated: this window takes the new Admin session and stays here.
      adopt(staged.session, { stay: true });
      setResult(staged);
      showToast(`${scenario.title} staged.`);
    } catch (failure) {
      setError(demoMessageOf(failure, messageOf));
    } finally {
      setStaging(null);
    }
  };

  const titleOf = (id: string) => scenarios.data?.find((s) => s.id === id)?.title ?? id;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Demo control"
        description="Stage the starting state of a main flow on the local database, then switch roles."
        meta={
          status.data?.lastStaged
            ? `Last staged: ${titleOf(status.data.lastStaged.scenarioId)}, ${new Date(
                status.data.lastStaged.at,
              ).toLocaleString()}`
            : undefined
        }
      />

      {!local && (
        <Alert tone="error" title={NOT_LOCAL}>
          Point DATABASE_URL at a local Postgres and restart the backend. Every action is disabled.
        </Alert>
      )}
      {error && (
        <Alert tone="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card aria-labelledby="demo-roles">
        <CardHeader
          title="Switch role"
          id="demo-roles"
          description="Signs this window in as the seeded account of the role."
        />
        <RoleSwitcher disabled={disabled} onError={setError} className="mt-3" />
      </Card>

      <section aria-labelledby="demo-scenarios" className="flex flex-col gap-3">
        <h2 id="demo-scenarios" className="text-title text-ink">
          Scenarios
        </h2>
        {scenarios.isPending && <Skeleton className="h-32 w-full" />}
        {scenarios.error && <Alert tone="error">{messageOf(scenarios.error)}</Alert>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scenarios.data?.map((scenario) => (
            <Card key={scenario.id} as="article" aria-labelledby={`scenario-${scenario.id}`}>
              <div className="flex items-start justify-between gap-3">
                <h3 id={`scenario-${scenario.id}`} className="text-body font-bold text-ink">
                  {scenario.title}
                </h3>
                <Badge>{scenario.flow}</Badge>
              </div>
              <p className="mt-2 text-body-sm text-ink-muted">{scenario.summary}</p>
              {!scenario.available && scenario.unavailableReason && (
                <p className="mt-2 text-body-sm text-status-attention-fg">
                  {scenario.unavailableReason}
                </p>
              )}
              {staging === scenario.id && (
                <p role="status" className="mt-2 text-body-sm text-ink">
                  Staging. This takes up to a minute.
                </p>
              )}
              <div className="mt-4 flex justify-end">
                <Button
                  id={`stage-${scenario.id}`}
                  variant="primary"
                  size="sm"
                  disabled={disabled || !scenario.available}
                  loading={staging === scenario.id}
                  onClick={() => setConfirming(scenario)}
                >
                  Stage
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {result && (
        <Card aria-labelledby="demo-result">
          <h2
            id="demo-result"
            ref={resultHeading}
            tabIndex={-1}
            className="text-title text-ink focus:outline-none"
          >
            Staged: {titleOf(result.scenarioId)}
          </h2>
          <p className="mt-1 text-body-sm text-ink-muted">
            Every other window must sign in again.
          </p>
          {result.records.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {result.records.map((record) => (
                <li key={`${record.label}-${record.path}`} className="text-body">
                  {record.label}:{' '}
                  <Link to={record.path} className="font-semibold text-brand underline">
                    {record.code}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {result.firstSteps.length > 0 && (
            <>
              <h3 className="mt-4 text-body font-bold text-ink">First steps</h3>
              <ol className="mt-1 list-decimal pl-6 text-body text-ink">
                {result.firstSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          )}
        </Card>
      )}

      {confirming && (
        <Dialog
          titleId="demo-stage-confirm"
          title={`Stage ${confirming.title}?`}
          description={`This deletes every row in the local database and stages ${confirming.title}. Every window must sign in again.`}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button onClick={() => setConfirming(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void stage(confirming)}>
                Stage
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      )}
    </div>
  );
};
