import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import {
  deleteVariant,
  updateVariant,
  useAdminVariants,
  variantKeys,
  type AdminVariant,
} from '../entities/variant/api';
import { VariantCard } from '../entities/variant/VariantCard';
import { VariantImage } from '../entities/variant/VariantImage';
import { capabilityText } from '../entities/variant/spec';
import { VariantFormDialog } from '../features/manage-variants/VariantFormDialog';
import { ApiError } from '../shared/api/apiClient';
import { formatVnd } from '../shared/lib/format';
import {
  Badge,
  Button,
  CollectionView,
  ConfirmDialog,
  PageHeader,
  useToast,
  type CollectionAction,
  type CollectionField,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { messageOf } from '../shared/ui/errors';

const TITLE_ID = 'variants-title';
const SAVED = 'Saved.';

type Pending =
  | { kind: 'form'; variant?: AdminVariant }
  | { kind: 'active'; variant: AdminVariant }
  | { kind: 'delete'; variant: AdminVariant };

const unitsText = (count: number) => `${count} ${count === 1 ? 'unit' : 'units'}`;

const serviceText = (variant: AdminVariant) =>
  variant.serviceIntervalDays === null ? 'No periodic service' : `Every ${variant.serviceIntervalDays} days`;

const StatusOf: React.FC<{ variant: AdminVariant }> = ({ variant }) =>
  variant.isActive ? <Badge tone="done">Active</Badge> : <Badge tone="ended">Inactive</Badge>;

// The service checklist and the remaining value schedule, under the card in the details pane.
const PlanDetails: React.FC<{ variant: AdminVariant }> = ({ variant }) => (
  <div className="flex flex-col gap-4">
    <section aria-labelledby={`plan-${variant.id}`} className="flex flex-col gap-1">
      <h3 id={`plan-${variant.id}`} className="text-body-sm font-semibold text-ink">
        Service plan
      </h3>
      <p className="text-body text-ink">{serviceText(variant)}</p>
      {variant.serviceChecklist.length > 0 && (
        <ul className="list-disc pl-5 text-body text-ink">
          {variant.serviceChecklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
    <section aria-labelledby={`value-${variant.id}`} className="flex flex-col gap-1">
      <h3 id={`value-${variant.id}`} className="text-body-sm font-semibold text-ink">
        Remaining value schedule
      </h3>
      <ul className="flex flex-col gap-0.5 text-body text-ink">
        {variant.remainingValueSchedule.map((row) => (
          <li key={row.fromMonths}>
            From month {row.fromMonths}: {formatVnd(row.valueVnd)}
          </li>
        ))}
      </ul>
    </section>
  </div>
);

// `/t/admin/variants`, screen 4.1 (devices api-design 01 to 04, UC-13, FR-DEV-04, FR-DEV-17): the
// hardware variants with their service plans, firmware baseline, remaining value schedule, image and
// spec sheet. TrekLink Admin only. Create and edit open one form; deactivate, reactivate and delete ask
// first. The server judges VARIANT_IN_USE and STALE_VERSION; the page hides Delete while units exist.
export const VariantsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const variants = useAdminVariants();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = () => queryClient.invalidateQueries({ queryKey: variantKeys.all });
  const close = () => {
    setPending(null);
    setBusy(false);
    setError(undefined);
  };
  const done = () => {
    close();
    showToast(SAVED);
    void refresh();
  };

  const failure = variants.error;
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      done();
      after?.();
    } catch (problem) {
      setBusy(false);
      // The server's VARIANT_IN_USE messages already name the reason (registered devices or prices).
      setError(messageOf(problem));
      void refresh();
    }
  };

  const itemActions: CollectionAction<AdminVariant>[] = [
    { key: 'edit', label: 'Edit', icon: <Pencil />, onSelect: (variant) => setPending({ kind: 'form', variant }) },
    {
      key: 'deactivate',
      label: 'Deactivate',
      icon: <PowerOff />,
      allowed: (variant) => variant.isActive,
      onSelect: (variant) => setPending({ kind: 'active', variant }),
    },
    {
      key: 'reactivate',
      label: 'Reactivate',
      icon: <Power />,
      allowed: (variant) => !variant.isActive,
      onSelect: (variant) => setPending({ kind: 'active', variant }),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <Trash2 />,
      destructive: true,
      allowed: (variant) => variant.deviceCount === 0,
      onSelect: (variant) => setPending({ kind: 'delete', variant }),
    },
  ];

  const fields: CollectionField<AdminVariant>[] = [
    { key: 'units', label: 'Units', render: (row) => unitsText(row.deviceCount), text: (row) => String(row.deviceCount), sortValue: (row) => row.deviceCount, sortable: true, compact: true, align: 'end' },
    { key: 'status', label: 'Status', render: (row) => <StatusOf variant={row} />, text: (row) => (row.isActive ? 'Active' : 'Inactive'), compact: true },
    { key: 'capabilities', label: 'Capabilities', render: (row) => capabilityText(row), text: (row) => capabilityText(row) ?? '' },
    { key: 'firmwareBaseline', label: 'Firmware baseline', render: (row) => row.firmwareBaseline, text: (row) => row.firmwareBaseline, hideWithPane: true },
    { key: 'service', label: 'Service', render: serviceText, text: serviceText, hideWithPane: true },
  ];

  const titleOf = (variant: AdminVariant) => (
    <span className="flex items-center gap-3 py-1">
      <VariantImage variant={variant} render="icon" size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{variant.code}</span>
        <span className="text-body-sm text-ink-muted">{variant.name}</span>
      </span>
    </span>
  );

  const data = variants.data;

  return (
    <section aria-labelledby={TITLE_ID} className="flex flex-col gap-4">
      <PageHeader
        id={TITLE_ID}
        title="Hardware variants"
        meta={data ? `${data.length} ${data.length === 1 ? 'variant' : 'variants'}` : undefined}
        description="The device models: sensors, firmware baseline, service plan, remaining value and spec sheet."
        primaryAction={
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" className="h-4 w-4" />}
            onClick={() => setPending({ kind: 'form' })}
          >
            New variant
          </Button>
        }
      />

      <CollectionView<AdminVariant>
        label="Hardware variants"
        items={data}
        loading={variants.isPending}
        error={failure ? <ErrorState error={failure} onRetry={() => void variants.refetch()} /> : undefined}
        itemId={(row) => row.id}
        itemName={(row) => row.code}
        itemTitle={titleOf}
        fields={fields}
        noun={{ one: 'variant', other: 'variants' }}
        itemActions={itemActions}
        search={{ label: 'Search variants', placeholder: 'Code or name' }}
        filters={[
          { key: '', label: 'All variants' },
          { key: 'active', label: 'Active', test: (row) => row.isActive },
          { key: 'inactive', label: 'Inactive', test: (row) => !row.isActive },
        ]}
        details={{
          // The card above names the firmware baseline and the capabilities.
          fields: ['units', 'status'],
          image: (variant) => <VariantCard variant={variant} render="detail" headingLevel="h3" />,
          extra: (variant) => <PlanDetails variant={variant} />,
        }}
        emptyState={{
          title: 'No hardware variants yet.',
          description: 'Add the first variant before registering devices.',
          action: (
            <Button variant="primary" onClick={() => setPending({ kind: 'form' })}>
              New variant
            </Button>
          ),
        }}
      />

      {pending?.kind === 'form' && (
        <VariantFormDialog
          variant={pending.variant}
          // After a 409 STALE_VERSION the form says to close it to load the current values, and the list
          // does not refetch on window focus: closing refetches it, so Edit then opens on the new version.
          onClose={() => {
            close();
            void refresh();
          }}
          onSaved={() => done()}
        />
      )}
      {pending?.kind === 'active' && (
        <ConfirmDialog
          titleId="variant-active-title"
          title={`${pending.variant.isActive ? 'Deactivate' : 'Reactivate'} ${pending.variant.code}?`}
          description={
            pending.variant.isActive
              ? 'Deactivated variants cannot be requested by organizations. Units already registered keep working.'
              : 'Organizations can request this variant again.'
          }
          confirmLabel={pending.variant.isActive ? 'Deactivate' : 'Reactivate'}
          pending={busy}
          error={error}
          onCancel={close}
          onConfirm={() =>
            void run(() =>
              updateVariant(pending.variant.id, {
                isActive: !pending.variant.isActive,
                expectedVersion: pending.variant.version,
              }),
            )
          }
        />
      )}
      {pending?.kind === 'delete' && (
        <ConfirmDialog
          titleId="variant-delete-title"
          title={`Delete ${pending.variant.code}?`}
          description="The variant is removed from the catalog. This cannot be undone."
          confirmLabel="Delete variant"
          destructive
          irreversible
          pending={busy}
          error={error}
          onCancel={close}
          onConfirm={() =>
            void run(
              () => deleteVariant(pending.variant.id),
              // After a delete the row is gone, so focus moves to the page heading (screen 4.1).
              () => document.getElementById(TITLE_ID)?.focus(),
            )
          }
        />
      )}
    </section>
  );
};
