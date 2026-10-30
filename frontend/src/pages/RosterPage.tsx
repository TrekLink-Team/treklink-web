import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../app/providers/useAuth';
import type { Member } from '../entities/organization/api';
import { isRosterEligible, useMemberList } from '../entities/organization/members';
import {
  addDays,
  createShift,
  deleteShift,
  fromLocalInput,
  hasStarted,
  rosterKeys,
  toLocalInput,
  updateShift,
  useRoster,
  weekStart,
  type Shift,
  type ShiftInput,
} from '../entities/organization/roster';
import { ApiError } from '../shared/api/apiClient';
import { viewerTimeZone } from '../shared/lib/format';
import { Alert, Button, ConfirmDialog, Dialog, Field, Input, PageHeader, Select, Skeleton, useToast } from '../shared/ui';
import { invalid, messageOf } from '../shared/ui/errors';
import { ErrorState } from '../shared/ui/bits';
import { RosterCalendar } from '../widgets/RosterCalendar/RosterCalendar';
import { dayLabel, isGap, windowLabel } from '../widgets/RosterCalendar/labels';

// Screen 3.3 shows the server's message for these codes.
const SERVER_TEXT = new Set(['NOT_FOUND', 'SHIFT_STARTED', 'SHIFT_OVERLAP', 'MEMBER_NOT_ELIGIBLE', 'INVALID_STATE_TRANSITION']);
const serverMessage = (error: unknown): string =>
  error instanceof ApiError && SERVER_TEXT.has(error.errorCode) ? error.message : messageOf(error);

// A shift that changed or went away under the form: the week refetches.
const isStale = (error: unknown) =>
  error instanceof ApiError && (error.errorCode === 'NOT_FOUND' || error.errorCode === 'SHIFT_STARTED');

type ShiftField = 'startsAt' | 'endsAt' | 'primaryMemberId' | 'backupMemberId';
const SHIFT_FIELDS: ShiftField[] = ['startsAt', 'endsAt', 'primaryMemberId', 'backupMemberId'];
const fieldOf = (message: string): ShiftField | undefined =>
  SHIFT_FIELDS.find((field) => message.startsWith(`${field} `));

const BAD_PAIR = 'Choose two different active members of your organization.';

// Add and edit shift, organizations api-design 17 and 18: one step, four fields. On a started shift
// every field but Ends is locked, and Ends may not be before now (ruling 2026-10-30).
const ShiftDialog: React.FC<{
  organizationId: string;
  shift: Shift | null;
  members: Member[];
  onSaved: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  onStale: () => void;
  onClose: () => void;
}> = ({ organizationId, shift, members, onSaved, onDelete, onStale, onClose }) => {
  const started = shift !== null && hasStarted(shift);
  const [startsAt, setStartsAt] = useState(shift ? toLocalInput(shift.startsAt) : '');
  const [endsAt, setEndsAt] = useState(shift ? toLocalInput(shift.endsAt) : '');
  const [primary, setPrimary] = useState(shift?.primary?.memberId ?? '');
  const [backup, setBackup] = useState(shift?.backup?.memberId ?? '');
  const [errors, setErrors] = useState<Partial<Record<ShiftField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nowInput = toLocalInput(new Date().toISOString());

  // The current holders stay selectable even if they are no longer eligible, so the form shows them.
  const options = useMemo(() => {
    const list = members.filter(isRosterEligible).map((member) => ({ id: member.id, name: member.fullName ?? member.email ?? member.id }));
    for (const held of [shift?.primary, shift?.backup])
      if (held && !list.some((option) => option.id === held.memberId)) list.push({ id: held.memberId, name: held.fullName });
    return list;
  }, [members, shift]);

  const check = (): Partial<Record<ShiftField, string>> => {
    const found: Partial<Record<ShiftField, string>> = {};
    if (startsAt === '') found.startsAt = 'Starts is required.';
    if (endsAt === '') found.endsAt = 'Ends is required.';
    else if (startsAt !== '' && new Date(endsAt) <= new Date(startsAt)) found.endsAt = 'Choose an end after the start.';
    else if (started && new Date(endsAt) < new Date()) found.endsAt = 'endsAt must not be in the past.';
    if (!started && backup !== '' && backup === primary) found.backupMemberId = BAD_PAIR;
    return found;
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const found = check();
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    const input: ShiftInput = {
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      primaryMemberId: primary || null,
      backupMemberId: backup || null,
    };
    setPending(true);
    try {
      const saved = shift
        ? await updateShift(organizationId, shift.id, started ? { endsAt: input.endsAt } : input)
        : await createShift(organizationId, input);
      onSaved(saved.shift);
    } catch (caught) {
      setPending(false);
      if (!(caught instanceof ApiError)) return setFailure(messageOf(caught));
      if (caught.errorCode === 'SHIFT_OVERLAP') setErrors({ startsAt: caught.message });
      else if (caught.errorCode === 'MEMBER_NOT_ELIGIBLE') setErrors({ backupMemberId: caught.message });
      else if (caught.errorCode === 'VALIDATION_FAILED' && fieldOf(caught.message))
        setErrors({ [fieldOf(caught.message) as ShiftField]: caught.message });
      else setFailure(serverMessage(caught));
      if (isStale(caught)) onStale();
    }
  };

  const memberSelect = (id: string, value: string, onChange: (value: string) => void) => (
    <Select id={id} value={value} disabled={started} onChange={(event) => onChange(event.target.value)}>
      <option value="">None</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </Select>
  );

  return (
    <Dialog
      titleId="shift-title"
      title={shift ? 'Edit shift' : 'Add shift'}
      description={started ? 'This shift has started: only its end can change.' : `Times are in ${viewerTimeZone()}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {shift && (
            <Button
              variant="danger"
              disabled={pending || started}
              aria-describedby={started ? 'shift-delete-hint' : undefined}
              onClick={() => onDelete(shift)}
            >
              Delete
            </Button>
          )}
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            Save shift
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        {failure && <Alert tone="error">{failure}</Alert>}
        <Field id="shift-starts" label="Starts" error={errors.startsAt} required>
          <Input
            id="shift-starts"
            type="datetime-local"
            value={startsAt}
            disabled={started}
            onChange={(event) => setStartsAt(event.target.value)}
            {...invalid('shift-starts', errors.startsAt)}
          />
        </Field>
        <Field id="shift-ends" label="Ends" error={errors.endsAt} required>
          <Input
            id="shift-ends"
            type="datetime-local"
            value={endsAt}
            min={started ? nowInput : startsAt || undefined}
            onChange={(event) => setEndsAt(event.target.value)}
            {...invalid('shift-ends', errors.endsAt)}
          />
        </Field>
        <Field id="shift-primary" label="Primary" hint="An empty primary raises the no-primary warning." error={errors.primaryMemberId}>
          {memberSelect('shift-primary', primary, setPrimary)}
        </Field>
        <Field id="shift-backup" label="Backup" error={errors.backupMemberId}>
          {memberSelect('shift-backup', backup, setBackup)}
        </Field>
        {started && (
          <p id="shift-delete-hint" className="text-body-sm text-ink-muted">
            A started shift is shortened by editing its end.
          </p>
        )}
      </form>
    </Dialog>
  );
};

// /o/roster, screen 3.3 (organizations api-design 16 to 19; UC-05, FR-ORG-05): the week's shifts with a
// MSG22 warning for every window without a primary. The Org Manager adds, edits and deletes shifts;
// the Org Operator reads the week only.
export const RosterPage: React.FC = () => {
  const { user } = useAuth();
  const organizationId = user?.organization?.id;
  const isManager = user?.organization?.memberRole === 'MANAGER';
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [monday, setMonday] = useState(() => weekStart(new Date()));
  const from = monday.toISOString();
  const to = addDays(monday, 7).toISOString();
  const roster = useRoster(organizationId, from, to);
  const members = useMemberList(organizationId, false, isManager);
  const [editing, setEditing] = useState<Shift | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Shift | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const focusTarget = useRef<string | null>(null);

  // After an add or edit focus moves to that shift, after a delete to Add shift (screen 3.3).
  // The target waits in a ref until the dialog has closed and the refetched week shows it.
  useEffect(() => {
    if (!focusTarget.current || editing !== undefined || deleting) return;
    const element = document.getElementById(focusTarget.current);
    if (element) {
      element.focus();
      focusTarget.current = null;
    }
  });

  const refresh = () =>
    organizationId ? queryClient.invalidateQueries({ queryKey: rosterKeys.all(organizationId) }) : Promise.resolve();

  const remove = async () => {
    if (!organizationId || !deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteShift(organizationId, deleting.id);
      setDeleting(null);
      setEditing(undefined);
      showToast('Shift deleted');
      focusTarget.current = 'roster-add';
      void refresh();
    } catch (caught) {
      setDeleteError(serverMessage(caught));
      if (isStale(caught)) void refresh();
    } finally {
      setDeletePending(false);
    }
  };

  const gaps = (roster.data?.warnings ?? []).filter(isGap);
  const weekLabel = `${dayLabel(monday)} to ${dayLabel(addDays(monday, 6))} ${addDays(monday, 6).getFullYear()} (${viewerTimeZone()})`;

  return (
    <section aria-labelledby="roster-title">
      <PageHeader
        id="roster-title"
        title="Roster"
        description="Who is primary and backup on duty. An alert goes to the primary first, then the backup."
        primaryAction={
          isManager ? (
            <Button
              id="roster-add"
              variant="primary"
              icon={<CalendarPlus aria-hidden="true" className="h-4 w-4" />}
              onClick={() => setEditing(null)}
            >
              Add shift
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<ChevronLeft aria-hidden="true" className="h-4 w-4" />} onClick={() => setMonday(addDays(monday, -7))}>
          Previous
        </Button>
        <span className="text-body font-semibold text-ink" aria-live="polite">
          {weekLabel}
        </span>
        <Button variant="ghost" icon={<ChevronRight aria-hidden="true" className="h-4 w-4" />} onClick={() => setMonday(addDays(monday, 7))}>
          Next
        </Button>
      </div>

      {gaps.length > 0 && (
        <div role="status" className="mb-3 rounded-control border border-status-attention-line bg-status-attention-tint px-3 py-2 text-body-sm text-status-attention-fg">
          {gaps.map((gap) => (
            <p key={`${gap.from}-${gap.to}`}>Nobody is primary on duty {windowLabel(gap.from, gap.to)}.</p>
          ))}
          <p>Alerts in that window start with the backup.</p>
        </div>
      )}

      {roster.isLoading ? (
        <Skeleton className="h-64 w-full" rounded="panel" />
      ) : roster.error ? (
        <ErrorState error={roster.error} onRetry={() => void roster.refetch()} />
      ) : (
        <RosterCalendar
          weekStart={monday}
          shifts={roster.data?.shifts ?? []}
          warnings={roster.data?.warnings ?? []}
          onSelect={isManager ? (shift) => setEditing(shift) : undefined}
        />
      )}

      {editing !== undefined && organizationId && !deleting && (
        <ShiftDialog
          organizationId={organizationId}
          shift={editing}
          members={members.data ?? []}
          onClose={() => setEditing(undefined)}
          onStale={() => void refresh()}
          onDelete={(shift) => {
            setDeleteError(null);
            setDeleting(shift);
          }}
          onSaved={(saved) => {
            setEditing(undefined);
            showToast('Saved.');
            focusTarget.current = `shift-${saved.id}`;
            void refresh();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          titleId="delete-shift-title"
          title={`Delete the shift ${windowLabel(deleting.startsAt, deleting.endsAt)}?`}
          description="Nobody is then on duty in this window unless another shift covers it. This cannot be undone."
          confirmLabel="Delete shift"
          destructive
          pending={deletePending}
          error={deleteError ?? undefined}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
};
