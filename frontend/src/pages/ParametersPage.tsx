import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  parameterKeys,
  updateParameter,
  useParameters,
  type Parameter,
} from '../entities/parameter/api';
import {
  TYPE_LABEL,
  boundsText,
  groupByModule,
  inputText,
  parseValue,
  sameValue,
  valueText,
} from '../entities/parameter/model';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  Toolbar,
  useToast,
  type Column,
} from '../shared/ui';
import { messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';
import { ParameterHistoryDrawer } from '../widgets/ParameterHistory/ParameterHistoryDrawer';

interface Editing {
  key: string;
  text: string;
  reason: string;
  error: string | null;
  saving: boolean;
}

const idOf = (key: string) => key.replace(/[^a-zA-Z0-9]/g, '-');

const MSG36 = 'Someone else changed this. Reload to see the latest.';
const UPDATED = 'Parameter updated. Readers see it within the cache lifetime.';

// `/t/admin/parameters`, screen 7.4 (platform api-design 02 to 04, UC-57, FR-CFG-01, FR-CFG-02): the
// business parameters grouped by module, each edited in place within its bounds, with a change history
// drawer. TrekLink Admin only. `expectedVersion` is the version the row loaded with and is never typed.
export const ParametersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const parameters = useParameters();
  const [searchParams, setSearchParams] = useSearchParams();
  const moduleFilter = searchParams.get('module') ?? '';
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [stale, setStale] = useState(false);
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const items = parameters.data?.items;
  const modules = useMemo(() => groupByModule(items ?? []).map(([module]) => module), [items]);
  const groups = useMemo(
    () => groupByModule((items ?? []).filter((item) => !moduleFilter || item.ownerModule === moduleFilter)),
    [items, moduleFilter],
  );
  const current = editing ? items?.find((item) => item.key === editing.key) : undefined;

  const reload = () => queryClient.invalidateQueries({ queryKey: parameterKeys.all });

  const save = async (parameter: Parameter) => {
    if (!editing) return;
    const parsed = parseValue(parameter, editing.text);
    if ('error' in parsed) {
      setEditing({ ...editing, error: parsed.error });
      return;
    }
    if (sameValue(parsed.value, parameter.value)) {
      setEditing({ ...editing, error: 'The value is unchanged.' });
      return;
    }
    setEditing({ ...editing, error: null, saving: true });
    try {
      await updateParameter(parameter.key, {
        value: parsed.value,
        expectedVersion: parameter.version,
        reason: editing.reason.trim() || undefined,
      });
      setEditing(null);
      showToast(UPDATED);
      void queryClient.invalidateQueries({ queryKey: parameterKeys.historyOf(parameter.key) });
      await reload();
      // The list has the new value and version; focus returns to the Edit button of the edited row.
      setTimeout(() => document.getElementById(`edit-${idOf(parameter.key)}`)?.focus(), 0);
    } catch (failure) {
      if (failure instanceof ApiError && failure.statusCode === 409) {
        // The typed value and reason are kept; Reload shows the new value beside them.
        setStale(true);
        setEditing((now) => (now ? { ...now, saving: false } : now));
      } else if (failure instanceof ApiError && failure.statusCode === 404) {
        setEditing(null);
        showToast('Parameter not found.');
        await reload();
      } else {
        // PARAMETER_OUT_OF_RANGE and the like: under the input, with what was typed kept.
        setEditing((now) =>
          now ? { ...now, saving: false, error: messageOf(failure) } : now,
        );
      }
    }
  };

  const valueCell = (parameter: Parameter): React.ReactNode => {
    if (editing?.key !== parameter.key) {
      const text = valueText(parameter.value);
      return (
        <span title={text} className="font-mono">
          {text.length > 60 ? `${text.slice(0, 60)}...` : text}
          {parameter.unit ? <span className="font-sans text-ink-muted"> {parameter.unit}</span> : null}
        </span>
      );
    }
    const id = `edit-value-${idOf(parameter.key)}`;
    const parsed = parseValue(parameter, editing.text);
    const range = boundsText(parameter);
    const changed = 'value' in parsed && !sameValue(parsed.value, parameter.value);
    return (
      <div
        className="flex flex-col gap-2 py-2"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setEditing(null);
            document.getElementById(`edit-${idOf(parameter.key)}`)?.focus();
          }
        }}
      >
        <Field id={id} label={`Value of ${parameter.key}`} hideLabel error={editing.error ?? undefined}>
          {parameter.valueType === 'JSON' ? (
            <Textarea
              id={id}
              rows={8}
              value={editing.text}
              onChange={(event) => setEditing({ ...editing, text: event.target.value, error: null })}
              invalid={editing.error !== null}
              className="font-mono"
              aria-describedby={editing.error ? `${id}-error` : undefined}
            />
          ) : (
            <Input
              id={id}
              inputMode={parameter.valueType === 'INT' || parameter.valueType === 'DURATION_SECONDS' ? 'numeric' : 'decimal'}
              value={editing.text}
              onChange={(event) => setEditing({ ...editing, text: event.target.value, error: null })}
              invalid={editing.error !== null}
              aria-describedby={editing.error ? `${id}-error` : undefined}
            />
          )}
        </Field>
        {range && (
          <p className="text-body-sm text-ink-muted">
            Allowed: {range}
            {parameter.unit ? ` ${parameter.unit}` : ''}
          </p>
        )}
        <p className="text-body-sm text-ink-muted">Current value: {valueText(parameter.value)}</p>
        {changed && 'value' in parsed && (
          <p className="text-body-sm font-semibold text-ink">
            Change {parameter.key} from {valueText(parameter.value)} to {valueText(parsed.value)}?
          </p>
        )}
        <Input
          aria-label={`Reason for changing ${parameter.key} (optional)`}
          placeholder="Reason (optional)"
          maxLength={500}
          value={editing.reason}
          onChange={(event) => setEditing({ ...editing, reason: event.target.value })}
        />
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={editing.saving}
            loadingLabel="Saving"
            onClick={() => void save(parameter)}
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  const actions = (parameter: Parameter): React.ReactNode => (
    <div className="flex flex-wrap items-center gap-3 text-body-sm">
      <button
        type="button"
        id={`edit-${idOf(parameter.key)}`}
        className={LINK}
        disabled={editing !== null && editing.key !== parameter.key}
        onClick={() =>
          setEditing({
            key: parameter.key,
            text: inputText(parameter),
            reason: '',
            error: null,
            saving: false,
          })
        }
        aria-label={`Edit ${parameter.key}`}
      >
        Edit
      </button>
      <button
        type="button"
        className={LINK}
        onClick={() => setHistoryKey(parameter.key)}
        aria-label={`History of ${parameter.key}`}
      >
        History
      </button>
      <Link
        to={`/t/admin/audit/changes?action=parameter.&subjectId=${encodeURIComponent(parameter.key)}`}
        className={LINK}
        aria-label={`Changes of ${parameter.key}`}
      >
        Changes
      </Link>
    </div>
  );

  const columns: Column<Parameter>[] = [
    {
      key: 'key',
      header: 'Parameter',
      cell: (parameter) => (
        <div className="py-2">
          <span className="font-mono text-body">{parameter.key}</span>
          <span className="block text-body-sm text-ink-muted">{parameter.description}</span>
        </div>
      ),
    },
    { key: 'value', header: 'Value', cell: valueCell },
    { key: 'range', header: 'Allowed', cell: (parameter) => boundsText(parameter) ?? '–', hideOnMobile: true },
    { key: 'type', header: 'Type', cell: (parameter) => TYPE_LABEL[parameter.valueType], hideOnMobile: true },
    {
      key: 'updated',
      header: 'Last changed',
      cell: (parameter) => formatDateTime(parameter.updatedAt),
      hideOnMobile: true,
    },
  ];

  const failure = parameters.error;
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="parameters-title" className="flex flex-col gap-4">
      <PageHeader
        id="parameters-title"
        title="Parameters"
        description="Business parameters by module. A change applies within the cache lifetime."
      />
      <Toolbar
        label="Parameter filters"
        start={
          <label className="flex items-center gap-2 text-body-sm font-semibold text-ink">
            Module
            <Select
              aria-label="Module"
              value={moduleFilter}
              onChange={(event) => {
                const next = new URLSearchParams(searchParams);
                if (event.target.value) next.set('module', event.target.value);
                else next.delete('module');
                setSearchParams(next, { replace: true });
              }}
              className="min-w-48"
            >
              <option value="">All modules</option>
              {modules.map((module) => (
                <option key={module} value={module}>
                  {module}
                </option>
              ))}
            </Select>
          </label>
        }
      />

      {failure && (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" size="sm" onClick={() => void parameters.refetch()}>
              Retry
            </Button>
          }
        >
          {messageOf(failure)}
        </Alert>
      )}

      {parameters.isPending && (
        <div role="status" aria-label="Loading parameters" className="flex flex-col gap-4">
          <Skeleton rounded="panel" className="h-32" />
          <Skeleton rounded="panel" className="h-32" />
        </div>
      )}

      {items && groups.length === 0 && (
        <p className="text-body text-ink-muted">No results match your filters.</p>
      )}

      {groups.map(([module, rows]) => {
        const open = !collapsed.has(module);
        return (
          <Card key={module} padding="none" aria-labelledby={`group-${module}`}>
            <h2 id={`group-${module}`} className="text-title-sm text-ink">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                  const next = new Set(collapsed);
                  if (open) next.add(module);
                  else next.delete(module);
                  setCollapsed(next);
                }}
                className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span>{module}</span>
                <span className="text-body-sm font-normal text-ink-muted">
                  {rows.length} {rows.length === 1 ? 'parameter' : 'parameters'}
                </span>
              </button>
            </h2>
            {open && (
              <DataTable
                caption={`Parameters of ${module}`}
                columns={columns}
                rows={rows}
                rowId={(row) => row.key}
                empty={{ title: 'No results match your filters.' }}
                rowActions={actions}
              />
            )}
          </Card>
        );
      })}

      {historyKey && (
        <ParameterHistoryDrawer parameterKey={historyKey} onClose={() => setHistoryKey(null)} />
      )}

      {stale && (
        <Dialog
          titleId="parameter-stale-title"
          title="Reload to see the latest"
          description={MSG36}
          onClose={() => setStale(false)}
          footer={
            <Button
              variant="primary"
              onClick={() => {
                setStale(false);
                void reload();
              }}
            >
              Reload
            </Button>
          }
        >
          <p className="text-body text-ink-muted">
            {current
              ? `What you typed for ${current.key} is kept, and the latest value, ${valueText(current.value)}, shows beside it.`
              : 'What you typed is kept.'}
          </p>
        </Dialog>
      )}
    </section>
  );
};
