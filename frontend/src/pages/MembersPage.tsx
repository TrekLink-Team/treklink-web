import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, UserCog, UserPlus, UserX, Users } from 'lucide-react';
import { useAuth } from '../app/providers/useAuth';
import type { Member } from '../entities/organization/api';
import {
  changeMemberRole,
  deactivateMember,
  inviteMember,
  memberKeys,
  memberStatus,
  resendInvitation,
  useMemberList,
  type MemberRole,
} from '../entities/organization/members';
import { rosterKeys } from '../entities/organization/roster';
import { ApiError } from '../shared/api/apiClient';
import { formatDate } from '../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  CollectionView,
  Dialog,
  Field,
  Input,
  PageHeader,
  RadioGroup,
  Select,
  useToast,
  type CollectionAction,
  type CollectionField,
} from '../shared/ui';
import { invalid, messageOf } from '../shared/ui/errors';
import { ErrorState } from '../shared/ui/bits';

// Screen 3.3 shows the server's message for these codes; LAST_MANAGER has no fitting SRS code (open
// point 1), and a member that is gone answers "Member not found.".
const SERVER_TEXT = new Set(['LAST_MANAGER', 'NOT_FOUND', 'INVALID_STATE_TRANSITION', 'CONFLICT_UNIQUE']);
const serverMessage = (error: unknown): string =>
  error instanceof ApiError && SERVER_TEXT.has(error.errorCode) ? error.message : messageOf(error);

const isNotFound = (error: unknown) => error instanceof ApiError && error.errorCode === 'NOT_FOUND';

const ROLE_OPTIONS = [
  { value: 'OPERATOR' as const, label: 'Operator', description: 'Watches the map and answers incidents.' },
  { value: 'MANAGER' as const, label: 'Manager', description: 'Also manages members, the roster, contracts and API keys.' },
];

const ROLE_LABEL: Record<MemberRole, string> = Object.fromEntries(
  ROLE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<MemberRole, string>;

const StatusOf: React.FC<{ member: Member }> = ({ member }) => {
  const status = memberStatus(member);
  if (status === 'Deactivated')
    return <Badge tone="ended" after={member.deactivatedAt ? formatDate(member.deactivatedAt) : undefined}>Deactivated</Badge>;
  return status === 'Invitation pending' ? (
    <Badge tone="waiting">Invitation pending</Badge>
  ) : (
    <Badge tone="done">Active</Badge>
  );
};

const nameOf = (member: Member) => member.fullName ?? member.email ?? 'this member';

type InviteField = 'email' | 'fullName' | 'phoneNumber' | 'role';
const INVITE_FIELDS: InviteField[] = ['email', 'fullName', 'phoneNumber', 'role'];

// The field a VALIDATION_FAILED message starts with ("email must be an email"), if it is one of ours.
const fieldOf = (message: string): InviteField | undefined =>
  INVITE_FIELDS.find((field) => message.startsWith(`${field} `));

// Invite member, organizations api-design 13: one step, four fields.
const InviteDialog: React.FC<{
  organizationId: string;
  onInvited: (member: Member) => void;
  onClose: () => void;
}> = ({ organizationId, onInvited, onClose }) => {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<MemberRole>('OPERATOR');
  const [errors, setErrors] = useState<Partial<Record<InviteField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const found: Partial<Record<InviteField, string>> = {};
    if (email.trim() === '') found.email = 'Email is required.';
    if (fullName.trim() === '') found.fullName = 'Full name is required.';
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      onInvited(
        await inviteMember(organizationId, {
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          ...(phone.trim() ? { phoneNumber: phone.trim() } : {}),
          role,
        }),
      );
    } catch (caught) {
      setPending(false);
      const field =
        caught instanceof ApiError && caught.errorCode === 'VALIDATION_FAILED' ? fieldOf(caught.message) : undefined;
      if (caught instanceof ApiError && caught.errorCode === 'CONFLICT_UNIQUE') setErrors({ email: caught.message });
      else if (field && caught instanceof ApiError) setErrors({ [field]: caught.message });
      else setFailure(serverMessage(caught));
    }
  };

  return (
    <Dialog
      titleId="invite-member-title"
      title="Invite member"
      description="They receive an email with a code to set their password."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            Send invitation
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        {failure && <Alert tone="error">{failure}</Alert>}
        <Field id="invite-email" label="Email" error={errors.email} required>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            {...invalid('invite-email', errors.email)}
          />
        </Field>
        <Field id="invite-name" label="Full name" error={errors.fullName} required>
          <Input
            id="invite-name"
            autoComplete="off"
            value={fullName}
            maxLength={120}
            onChange={(event) => setFullName(event.target.value)}
            {...invalid('invite-name', errors.fullName)}
          />
        </Field>
        <Field id="invite-phone" label="Phone" hint="Shown on alert contact cards." error={errors.phoneNumber}>
          <Input
            id="invite-phone"
            type="tel"
            autoComplete="off"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            {...invalid('invite-phone', errors.phoneNumber)}
          />
        </Field>
        <Field id="invite-role" label="Role" error={errors.role} required>
          <Select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
            <option value="OPERATOR">Operator</option>
            <option value="MANAGER">Manager</option>
          </Select>
        </Field>
      </form>
    </Dialog>
  );
};

// Change role, organizations api-design 14: one radio group.
const RoleDialog: React.FC<{
  organizationId: string;
  member: Member;
  onSaved: () => void;
  onNotFound: () => void;
  onClose: () => void;
}> = ({ organizationId, member, onSaved, onNotFound, onClose }) => {
  const [role, setRole] = useState<MemberRole>(member.role);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async () => {
    setPending(true);
    setFailure(null);
    try {
      await changeMemberRole(organizationId, member.id, role);
      onSaved();
    } catch (caught) {
      setPending(false);
      setFailure(serverMessage(caught));
      if (isNotFound(caught)) onNotFound();
    }
  };

  return (
    <Dialog
      titleId="member-role-title"
      title={`Change the role of ${nameOf(member)}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={role === member.role} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure && <Alert tone="error">{failure}</Alert>}
        <RadioGroup<MemberRole> name="member-role" legend="Role" options={ROLE_OPTIONS} value={role} onChange={setRole} required />
      </div>
    </Dialog>
  );
};

// Deactivate, organizations api-design 15: names the member and the effects, with an optional reason.
const DeactivateDialog: React.FC<{
  organizationId: string;
  member: Member;
  onDone: () => void;
  onNotFound: () => void;
  onClose: () => void;
}> = ({ organizationId, member, onDone, onNotFound, onClose }) => {
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    setFailure(null);
    try {
      await deactivateMember(organizationId, member.id, reason.trim() || undefined);
      onDone();
    } catch (caught) {
      setPending(false);
      setFailure(serverMessage(caught));
      if (isNotFound(caught)) onNotFound();
    }
  };

  return (
    <Dialog
      titleId="deactivate-member-title"
      title={`Deactivate ${nameOf(member)}?`}
      description="Their sign-in sessions end, their roster slots from now on are cleared, and incidents they own go back to the backup tier."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={() => void confirm()}>
            Deactivate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure && <Alert tone="error">{failure}</Alert>}
        <Field id="deactivate-reason" label="Reason">
          <Input id="deactivate-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

// /o/members, screen 3.3 (organizations api-design 12 to 15; UC-04, FR-ORG-04): the Org Manager lists
// the members, invites one, changes a role, deactivates one and resends a pending invitation.
export const MembersPage: React.FC = () => {
  const { user } = useAuth();
  const organizationId = user?.organization?.id;
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [includeDeactivated, setIncludeDeactivated] = useState(true);
  const members = useMemberList(organizationId, includeDeactivated);
  const [inviting, setInviting] = useState(false);
  const [changing, setChanging] = useState<Member | null>(null);
  const [deactivating, setDeactivating] = useState<Member | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [deactivatedOne, setDeactivatedOne] = useState(0);

  // After a deactivation the row loses its buttons, so focus moves to the page heading (screen 3.3).
  useEffect(() => {
    if (deactivatedOne > 0) document.getElementById('members-title')?.focus();
  }, [deactivatedOne]);

  const refresh = () =>
    organizationId ? queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) }) : Promise.resolve();

  const resend = async (member: Member) => {
    if (!member.email) return;
    setResending(member.id);
    try {
      await resendInvitation(member.email);
      // Auth api-design 05 answers alike whether or not a code went out (no account enumeration).
      showToast(`If an invitation is due, a new code was sent to ${member.email}.`);
    } catch (caught) {
      showToast(messageOf(caught));
    } finally {
      setResending(null);
    }
  };

  // Item actions of an active member (chapter 06 §9.5); a deactivated member has none.
  const itemActions: CollectionAction<Member>[] = [
    {
      key: 'resend',
      label: 'Resend invitation',
      icon: <Mail />,
      allowed: (member) => !member.deactivatedAt && member.invitationPending,
      accessibleName: (member) => `Resend invitation to ${nameOf(member)}`,
      unavailableReason: (member) => (resending === member.id ? 'Sending the invitation' : undefined),
      onSelect: (member) => void resend(member),
    },
    {
      key: 'role',
      label: 'Change role',
      icon: <UserCog />,
      allowed: (member) => !member.deactivatedAt,
      accessibleName: (member) => `Change role of ${nameOf(member)}`,
      onSelect: setChanging,
    },
    {
      key: 'deactivate',
      label: 'Deactivate',
      icon: <UserX />,
      destructive: true,
      allowed: (member) => !member.deactivatedAt,
      onSelect: setDeactivating,
    },
  ];

  const nameCell = (member: Member) => (
    <span className="flex flex-col">
      <span className="font-semibold">
        {member.fullName ?? '(no name)'}
        {member.userId === user?.id && <span className="font-normal text-ink-muted"> (you)</span>}
      </span>
      <span className="text-body-sm text-ink-muted">{member.email}</span>
    </span>
  );

  const fields: CollectionField<Member>[] = [
    { key: 'role', label: 'Role', render: (row) => <Badge>{ROLE_LABEL[row.role]}</Badge>, compact: true },
    { key: 'status', label: 'Status', render: (row) => <StatusOf member={row} />, compact: true },
  ];

  const count = members.data?.length;

  return (
    <section aria-labelledby="members-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        id="members-title"
        title="Members"
        meta={count === undefined ? undefined : `${count} ${count === 1 ? 'member' : 'members'}`}
        description="The people of your organization who sign in to TrekLink."
        primaryAction={
          <Button variant="primary" icon={<UserPlus aria-hidden="true" className="h-4 w-4" />} onClick={() => setInviting(true)}>
            Invite member
          </Button>
        }
      />

      <CollectionView<Member>
        icon={<Users />}
        label="Members"
        items={members.data}
        loading={members.isLoading}
        error={members.error ? <ErrorState error={members.error} onRetry={() => void members.refetch()} /> : undefined}
        itemId={(row) => row.id}
        itemName={nameOf}
        itemTitle={nameCell}
        fields={fields}
        noun={{ one: 'member', other: 'members' }}
        itemActions={itemActions}
        // All includes deactivated members from the server (organizations api-design 12).
        filters={[
          { key: 'all', label: 'All members' },
          { key: 'active', label: 'Active members' },
        ]}
        query={{ search: '', filter: includeDeactivated ? 'all' : 'active', sort: null }}
        onQueryChange={(next) => setIncludeDeactivated(next.filter === 'all')}
        hideCommandBar={false}
        emptyState={{ title: 'No members', description: 'Invite a member to get started.' }}
      />

      {inviting && organizationId && (
        <InviteDialog
          organizationId={organizationId}
          onClose={() => setInviting(false)}
          onInvited={() => {
            setInviting(false);
            showToast('Invitation sent');
            void refresh();
          }}
        />
      )}
      {changing && organizationId && (
        <RoleDialog
          organizationId={organizationId}
          member={changing}
          onClose={() => setChanging(null)}
          onNotFound={() => void refresh()}
          onSaved={() => {
            setChanging(null);
            showToast('Saved.');
            void refresh();
          }}
        />
      )}
      {deactivating && organizationId && (
        <DeactivateDialog
          organizationId={organizationId}
          member={deactivating}
          onClose={() => setDeactivating(null)}
          onNotFound={() => void refresh()}
          onDone={() => {
            setDeactivating(null);
            setDeactivatedOne((value) => value + 1);
            showToast('Member deactivated');
            void refresh();
            // The deactivation clears the member from the shifts that have not ended (REQ-EVT-08).
            void queryClient.invalidateQueries({ queryKey: rosterKeys.all(organizationId) });
          }}
        />
      )}
    </section>
  );
};
