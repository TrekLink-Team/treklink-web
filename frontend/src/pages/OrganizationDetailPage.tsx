import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOrganizationDetail } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import { Card, PageHeader, Skeleton, StatusBadge } from '../shared/ui';
import { ErrorState, Fact } from '../shared/ui/bits';
import { messageOf } from '../shared/ui/errors';
import { ORGANIZATION_STATUS } from '../shared/ui/status';
import { FOCUS, LINK } from '../shared/ui/styles';
import { OrganizationRolesReadOnly } from '../widgets/OrganizationRoles/OrganizationRolesReadOnly';
import { OrganizationStatusHistory } from '../widgets/OrganizationStatusHistory/OrganizationStatusHistory';

const METHOD = { IN_PERSON: 'In person', PHONE: 'By phone' } as const;

// `/t/organizations/:id`, screen 3.2 and 3.7 (organizations api-design 03, 11 and 33): the record of one
// organization for TrekLink Staff and Admin, its status history and, read only, the permissions of its
// two roles. Changes to the organization stay on the queue (`/t/organizations`).
export const OrganizationDetailPage: React.FC = () => {
  const { id } = useParams();
  const organization = useOrganizationDetail(id);

  const failure = organization.error;
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <section aria-labelledby="org-detail-title" className="flex flex-col gap-4">
        <PageHeader id="org-detail-title" title="Organization" />
        <div role="alert" className="flex flex-col items-center gap-3 py-16">
          <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
          <Link to="/t/organizations" className={`${LINK} inline-flex min-h-6 items-center`}>
            Back to organizations
          </Link>
        </div>
      </section>
    );
  }
  if (organization.isPending) {
    return (
      <section aria-labelledby="org-detail-title" className="flex flex-col gap-4">
        <PageHeader id="org-detail-title" title="Organization" />
        <Skeleton className="h-40 w-full" />
      </section>
    );
  }
  const data = organization.data;
  if (failure || !data) {
    return (
      <section aria-labelledby="org-detail-title" className="flex flex-col gap-4">
        <PageHeader id="org-detail-title" title="Organization" />
        <ErrorState error={failure} onRetry={() => void organization.refetch()} />
      </section>
    );
  }

  return (
    // A fit page (chapter 06 §11.1, ui standard §7): the header stays and only the body scrolls, so `#main`
    // does not. Below 480 px of height the body releases its scroll and the page scrolls (zoom).
    <section
      aria-labelledby="org-detail-title"
      data-fit-page=""
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <PageHeader
        id="org-detail-title"
        title={data.legalName}
        description={`${data.code}. Changes to the organization are made from the queue.`}
        actions={
          <Link to="/t/organizations" className={`${LINK} inline-flex min-h-6 items-center`}>
            Back to organizations
          </Link>
        }
      />

      <div
        role="region"
        aria-label="Organization details"
        tabIndex={0}
        // `relative` makes this region the containing block of the grid's `sr-only` caption (absolute).
        // Without it the caption's block is `#main`, escapes both scroll boxes and stretches `#main`.
        className={`relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto rounded-sm [@media(max-height:479.98px)]:overflow-visible ${FOCUS}`}
      >
        <Card aria-labelledby="org-detail-record">
          <h2 id="org-detail-record" className="mb-3 text-title text-ink">
            Record
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Status">
              <StatusBadge
                entry={ORGANIZATION_STATUS[data.status as keyof typeof ORGANIZATION_STATUS]}
              />
            </Fact>
            <Fact label="Status changed">{formatDateTime(data.statusChangedAt)}</Fact>
            <Fact label="Tax code">{data.taxCode}</Fact>
            <Fact label="Address">{data.address}</Fact>
            <Fact label="Contact email">{data.contactEmail}</Fact>
            <Fact label="Contact phone">{data.contactPhone}</Fact>
            <Fact label="Members">{data.counts.members}</Fact>
            <Fact label="Running contracts">{data.counts.runningContracts}</Fact>
            <Fact label="Open incidents">{data.counts.openIncidents}</Fact>
            <Fact label="Channel key version">{data.channelKeyVersion}</Fact>
          </dl>
        </Card>

        <Card aria-labelledby="org-detail-verification">
          <h2 id="org-detail-verification" className="mb-3 text-title text-ink">
            Counter verification
          </h2>
          {data.verification && data.verifiedAt ? (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Verified">{formatDateTime(data.verifiedAt)}</Fact>
              <Fact label="Verified by">{data.verification.verifiedBy ?? 'Unknown'}</Fact>
              <Fact label="Method">{METHOD[data.verification.method]}</Fact>
              <Fact label="Master contract">{data.verification.masterContractRef ?? 'None'}</Fact>
              <Fact label="Documents seen">
                {data.verification.documentsSeen.length > 0
                  ? data.verification.documentsSeen.join(', ')
                  : 'None'}
              </Fact>
            </dl>
          ) : (
            <p className="text-body-sm text-ink-muted">Not verified at the counter yet.</p>
          )}
        </Card>

        <Card aria-labelledby="org-detail-history">
          <h2 id="org-detail-history" className="mb-3 text-title text-ink">
            Status history
          </h2>
          <OrganizationStatusHistory organizationId={data.id} />
        </Card>

        <Card aria-labelledby="org-detail-roles">
          <h2 id="org-detail-roles" className="text-title text-ink">
            Roles and permissions
          </h2>
          <p className="mb-3 text-body-sm text-ink-muted">
            What the roles of this organization may do. Read only: its Manager changes them on the
            Roles page.
          </p>
          <OrganizationRolesReadOnly organizationId={data.id} />
        </Card>
      </div>
    </section>
  );
};
