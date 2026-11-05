import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageScrollBody } from '../shared/ui/PageChrome';
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
import { useMediaQuery } from '../shared/lib/useMediaQuery';
import {
  Alert,
  Button,
  Card,
  CollectionView,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  Toolbar,
  useToast,
  type CollectionAction,
  type CollectionField,
} from '../shared/ui';
import { History, Pencil, SlidersHorizontal } from 'lucide-react';
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
// The Edit button of a parameter, to take focus back after a save or a cancel; at phone width Edit sits
// in the card's Actions menu, so focus goes to that menu's button.
const focusEdit = (key: string) =>
  (
    document.querySelector<HTMLElement>(`button[aria-label="Edit ${CSS.escape(key)}"]`) ??
    document.querySelector<HTMLElement>(`button[aria-label="Actions for ${CSS.escape(key)}"]`)
  )?.focus();

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
  // Below 768 px each parameter is a card (key, value, allowed range, Edit and History), as the other
  // lists of chapter 06 §10.5; the table needs the width for its four columns and the inline editor.
  const roomy = useMediaQuery('(min-width: 768px)', true);

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
      setTimeout(() => focusEdit(parameter.key), 0);
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
            focusEdit(parameter.key);
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
        {/* Toolbar size in the table; the 44 px touch size below 640 px, where the editor is in a card
            (0-ui-standard §1, 2.5.8; W21). */}
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            className="max-sm:h-11 max-sm:px-4"
            loading={editing.saving}
            loadingLabel="Saving"
            onClick={() => void save(parameter)}
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" className="max-sm:h-11 max-sm:px-4" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  // Edit and History are item actions (chapter 06 §9.5); Edit waits while another change is open.
  const actions: CollectionAction<Parameter>[] = [
    {
      key: 'edit',
      label: 'Edit',
      icon: <Pencil />,
      unavailableReason: (parameter) =>
        editing !== null && editing.key !== parameter.key ? 'Save or cancel the open change first' : undefined,
      onSelect: (parameter) =>
        setEditing({
          key: parameter.key,
          text: inputText(parameter),
          reason: '',
          error: null,
          saving: false,
        }),
    },
    {
      key: 'history',
      label: 'History',
      icon: <History />,
      accessibleName: (parameter) => `History of ${parameter.key}`,
      onSelect: (parameter) => setHistoryKey(parameter.key),
    },
  ];

  const fields: CollectionField<Parameter>[] = [
    { key: 'value', label: 'Value', render: valueCell, compact: true },
    // Compact, so a card shows the range beside the value (screen 7.4, 360 px layout).
    {
      key: 'range',
      label: 'Allowed',
      render: (parameter) => boundsText(parameter) ?? '–',
      hideWithPane: true,
      compact: true,
    },
    { key: 'type', label: 'Type', render: (parameter) => TYPE_LABEL[parameter.valueType], hideWithPane: true },
    {
      key: 'updated',
      label: 'Last changed',
      render: (parameter) => formatDateTime(parameter.updatedAt),
      hideWithPane: true,
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
    <section aria-labelledby="parameters-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-4">
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

      <PageScrollBody label="Parameters" className="flex flex-col gap-4">
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
                <CollectionView<Parameter>
                  icon={<SlidersHorizontal />}
                  label={`Parameters of ${module}`}
                  items={rows}
                  itemId={(row) => row.key}
                  itemName={(row) => row.key}
                  itemTitle={(parameter) => (
                    <div className="py-1">
                      <span className="font-mono text-body">{parameter.key}</span>
                      <span className="block text-body-sm font-normal text-ink-muted">{parameter.description}</span>
                      <Link
                        to={`/t/admin/audit/changes?action=parameter.&subjectId=${encodeURIComponent(parameter.key)}`}
                        className={`${LINK} inline-flex min-h-6 items-center text-body-sm`}
                        aria-label={`Changes of ${parameter.key}`}
                      >
                        Changes
                      </Link>
                    </div>
                  )}
                  fields={fields}
                  noun={{ one: 'parameter', other: 'parameters' }}
                  itemActions={actions}
                  defaultView={roomy ? 'details' : 'largeCards'}
                  search={{ label: `Search the parameters of ${module}` }}
                  details={false}
                  emptyState={{ title: 'No results match your filters.' }}
                  className="p-2"
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
      </PageScrollBody>
    </section>
  );
};
