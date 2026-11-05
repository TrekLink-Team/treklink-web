import React, { useState } from 'react';
import { PageScrollBody } from '../shared/ui/PageChrome';
import { useMediaQuery } from '../shared/lib/useMediaQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import { useBalance, useInvoice, useInvoices, useVariantName } from '../entities/billing/api';
import {
  cancelContract,
  contractKeys,
  rejectContract,
  useCloseCheck,
  useContract,
  useTransitions,
  type ContractDetail,
  type ContractDevice,
} from '../entities/contract/api';
import { CloseContractDialog } from '../features/close-contract/CloseContractDialog';
import { ReportLossDialog } from '../features/report-loss/ReportLossDialog';
import { RequestServiceCreditDialog } from '../features/service-credits/RequestServiceCreditDialog';
import { ApiError } from '../shared/api/apiClient';
import { formatVnd } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { ErrorState, Field, Loading } from '../shared/ui/bits';
import { Dialog } from '../shared/ui/Dialog';
import { invalid } from '../shared/ui/errors';
import { StateChangeDialog, type StateTransition } from '../shared/ui/StateChange';
import { ALERT, DANGER_BUTTON, SECONDARY_BUTTON } from '../shared/ui/styles';
import { TabPanel, type TabItem } from '../shared/ui/Tabs';
import { useToast } from '../shared/ui/toastStore';
import { useConfirmStep } from '../shared/ui/useConfirmStep';
import { HolderDialog } from '../widgets/ContractActions/HolderDialog';
import { NoticeDialog } from '../widgets/ContractActions/NoticeDialog';
import { ContractActionBar, type HomeTab } from '../widgets/ContractHome/ContractActionBar';
import { ContractHeader, LifecycleCard } from '../widgets/ContractHome/ContractHeader';
import { DepositCard } from '../widgets/ContractHome/DepositCard';
import { DevicesTab } from '../widgets/ContractHome/DevicesTab';
import { DocumentsTab } from '../widgets/ContractHome/DocumentsTab';
import { HistoryTab } from '../widgets/ContractHome/HistoryTab';
import { MoneyTab } from '../widgets/ContractHome/MoneyTab';
import { OverviewTab } from '../widgets/ContractHome/OverviewTab';
import {
  homeActions,
  openInvoiceOf,
  type ActionKey,
  type HomeMode,
  type Viewer,
} from '../widgets/ContractHome/policy';
import { REVIEW_FORM_ID, ReviewMode } from '../widgets/ContractHome/ReviewMode';

// The cancel dialog of screen 5.2: the reason is required and sent with the version the page saw;
// a holding fee already paid is retained (MSG15).
const CancelDialog: React.FC<{ contract: ContractDetail; onClose: () => void }> = ({
  contract,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const discard = useConfirmStep();
  const noun = contract.status === 'REQUESTED' ? 'request' : 'contract';

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.all }),
      queryClient.invalidateQueries({ queryKey: contractKeys.balance(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.transitions(contract.id) }),
    ]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim() === '') {
      setError('Reason is required.');
      return;
    }
    setPending(true);
    try {
      const cancelled = await cancelContract(contract.id, reason.trim(), contract.version);
      await refresh();
      showToast(`Contract cancelled. Retained: ${formatVnd(cancelled.retainedVnd)}.`);
      onClose();
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'STALE_VERSION') setStale(true);
      else setError(failure instanceof ApiError ? failure.message : 'Something went wrong.');
      if (failure instanceof ApiError && failure.errorCode === 'INVALID_STATE_TRANSITION') {
        void refresh();
      }
    }
  };

  const close = () => {
    if (reason === '') onClose();
    else
      discard.ask(
        {
          title: 'Discard the cancellation?',
          description: `The reason you typed is lost; the ${noun} stays as it is.`,
          confirmLabel: 'Discard',
        },
        onClose,
      );
  };

  return (
    <>
      <Dialog
        titleId="cancel-title"
        title={`Cancel ${noun} ${contract.code}?`}
        role="alertdialog"
        description="The held or reserved devices go back to stock. A holding fee already paid is retained. This cannot be undone."
        onClose={close}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {stale && (
            <div role="alert" className={`${ALERT} flex items-center justify-between gap-3`}>
              <span>Someone else changed this. Reload to see the latest.</span>
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  void refresh();
                  onClose();
                }}
              >
                Reload
              </button>
            </div>
          )}
          <Field id="cancel-reason" label="Reason" error={error ?? undefined}>
            <textarea
              id="cancel-reason"
              rows={3}
              className="rounded-lg border border-line-strong p-3"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              {...invalid('cancel-reason', error ?? undefined)}
            />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button type="submit" disabled={pending} className={`${DANGER_BUTTON} flex-1`}>
              {pending ? 'Cancelling…' : `Cancel ${noun}`}
            </button>
            <button type="button" onClick={close} className={`${SECONDARY_BUTTON} flex-1`}>
              Keep {noun}
            </button>
          </div>
        </form>
      </Dialog>
      {discard.dialog}
    </>
  );
};

// Reject of screen 5.3 (rentals api-design 05): a reason the Manager sees.
const REJECT: StateTransition<'REJECTED'> = {
  target: 'REJECTED',
  label: 'Reject request',
  destructive: true,
  needsReason: true,
  reasonHint: 'The Manager sees this reason.',
  description:
    'The request closes as Rejected and the devices it holds go back to stock. This cannot be undone.',
  cancelLabel: 'Keep request',
  successMessage: 'Request rejected.',
};

const TAB_KEYS: HomeTab[] = ['overview', 'devices', 'money', 'history', 'documents'];

type Open =
  | { kind: 'cancel' }
  | { kind: 'reject' }
  | { kind: 'notice' }
  | { kind: 'close' }
  | { kind: 'label'; device: ContractDevice }
  | { kind: 'lost'; deviceId: string; assetTag: string; scope: 'o' | 't' }
  | { kind: 'credit'; device: ContractDevice };

/**
 * /o/contracts/:id and /t/contracts/:id, the contract home (chapter 06 §10.4, D-096; screen 5.2):
 * the compact header, the lifecycle card with the Next step, one sticky row of tabs and actions,
 * and the tab body, or Review mode (`?mode=review`) and Handover mode (`?mode=handover`) in its
 * place. The tab is in the address (`?tab=devices`). The Org Operator reads it without money,
 * history or documents and may label holders (rentals api-design 13).
 *
 * `handover` renders the counter's four handover steps for a contract id, and calls `onDone` once
 * the handover is signed; the app composes it with the counter page, so this page never imports
 * another page.
 */
export const ContractDetailPage: React.FC<{
  scope: 'o' | 't';
  handover?: (contractId: string, onDone: () => void) => React.ReactNode;
}> = ({ scope, handover }) => {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // On a phone the lifecycle card moves into the scrolling body, so the pinned rows leave the record
  // room at 320 by 568 (ui standard §7).
  const phone = !useMediaQuery('(min-width: 600px)', true);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const isStaff = hasAnyRole(roles, ['STAFF']);
  const isManager = hasAnyRole(roles, ['ORG_MANAGER']);
  const viewer: Viewer = scope === 't' && isStaff ? 'staff' : isManager ? 'manager' : 'operator';
  const canSeeMoney = viewer !== 'operator';
  const contract = useContract(id);
  const variantName = useVariantName();
  const history = useTransitions(id, canSeeMoney && contract.isSuccess);
  const closeCheck = useCloseCheck(
    id,
    viewer === 'staff' &&
      Boolean(contract.data?.handedOverAt) &&
      contract.data?.status !== 'CLOSED',
  );
  // The Org Manager's open invoice, the target of Pay invoice and Pay deposit (billing api-design 08).
  const invoices = useInvoices('o', { contractId: id }, viewer === 'manager' && contract.isSuccess);
  // What is due now (billing api-design 10): Pay is the primary action only while it is above 0.
  const managerBalance = useBalance(id, viewer === 'manager' && contract.isSuccess);
  // A request's deposit is the first line of its first invoice (billing api-design 09); the same
  // query as the Deposit card, so it is read once.
  const firstInvoiceId =
    viewer === 'manager' && contract.data?.status === 'REQUESTED'
      ? (invoices.data?.items
          .slice()
          .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
          .at(0)?.id ?? null)
      : null;
  const firstInvoice = useInvoice(firstInvoiceId);
  const deposit = firstInvoice.data?.lines.slice().sort((a, b) => a.seq - b.seq)[0];
  const [open, setOpen] = useState<Open | null>(null);
  const [approving, setApproving] = useState(false);

  if (contract.isLoading) return <Loading label="Loading contract" />;
  if (contract.error || !contract.data) {
    return <ErrorState error={contract.error} onRetry={() => void contract.refetch()} />;
  }
  const data = contract.data;
  const variant = variantName(data.hardwareVariant);
  const base = `/${scope}/contracts/${data.id}`;

  const asked = params.get('mode');
  const mode: HomeMode =
    asked === 'review' && viewer === 'staff' && data.status === 'REQUESTED'
      ? 'review'
      : asked === 'handover' && viewer === 'staff' && data.status === 'APPROVED' && handover
        ? 'handover'
        : null;

  const tabs: TabItem<HomeTab>[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'devices', label: 'Devices', count: data.devices.length },
    ...(canSeeMoney
      ? ([
          { key: 'money', label: 'Money' },
          { key: 'history', label: 'History' },
          { key: 'documents', label: 'Documents' },
        ] as TabItem<HomeTab>[])
      : []),
  ];
  const askedTab = params.get('tab') as HomeTab | null;
  const tab: HomeTab =
    askedTab && TAB_KEYS.includes(askedTab) && tabs.some((item) => item.key === askedTab)
      ? askedTab
      : 'overview';

  const setQuery = (next: { tab?: HomeTab; mode?: HomeMode }) => {
    const query = new URLSearchParams();
    if (next.mode) query.set('mode', next.mode);
    else if (next.tab && next.tab !== 'overview') query.set('tab', next.tab);
    setParams(query, { replace: !next.mode });
  };

  const openInvoice = openInvoiceOf(invoices.data?.items);
  const actions = homeActions({
    contract: data,
    viewer,
    mode,
    closeCheck: closeCheck.data,
    openInvoiceId: openInvoice?.id ?? null,
    dueNowVnd: managerBalance.data?.dueNowVnd,
    depositUnpaidVnd: deposit ? Math.max(deposit.amountVnd - deposit.paidVnd, 0) : undefined,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: contractKeys.detail(data.id) });
    void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    void queryClient.invalidateQueries({ queryKey: contractKeys.transitions(data.id) });
  };

  const onAction = (key: ActionKey) => {
    switch (key) {
      case 'review':
        setQuery({ mode: 'review' });
        return;
      case 'handover':
        setQuery({ mode: 'handover' });
        return;
      case 'leave':
        setQuery({});
        return;
      case 'counter':
        navigate(`/t/counter/${data.id}`);
        return;
      case 'pay':
        if (openInvoice) navigate(`/o/invoices/${openInvoice.id}`);
        return;
      case 'cancel':
      case 'reject':
      case 'notice':
      case 'close':
        setOpen({ kind: key });
        return;
      default:
    }
  };

  const modeTitle =
    mode === 'review' ? 'Review request' : mode === 'handover' ? 'Handover' : undefined;

  const body = (() => {
    if (mode === 'review')
      return (
        <ReviewMode
          contract={data}
          variantName={variant}
          onPending={setApproving}
          onReload={refresh}
          onDecided={() => {
            refresh();
            setQuery({});
          }}
        />
      );
    if (mode === 'handover' && handover)
      return (
        <div className="flex flex-1 flex-col">
          {handover(data.id, () => {
            refresh();
            setQuery({});
          })}
        </div>
      );
    return (
      <TabPanel idPrefix="contract" tabKey={tab} className="flex flex-col gap-3">
        {tab === 'overview' && (
          <OverviewTab
            lead={
              data.status === 'REQUESTED' && viewer !== 'operator' ? (
                <DepositCard contract={data} scope={scope} viewer={viewer} />
              ) : undefined
            }
            contract={data}
            scope={scope}
            variantName={variant}
            close={
              viewer === 'staff' && data.handedOverAt && data.status !== 'CLOSED'
                ? {
                    check: closeCheck.data,
                    loading: closeCheck.isLoading,
                    error: closeCheck.error,
                    retry: () => void closeCheck.refetch(),
                    onClose: () => setOpen({ kind: 'close' }),
                    onReportLost: (blocker) =>
                      setOpen({
                        kind: 'lost',
                        deviceId: blocker.deviceId,
                        assetTag: blocker.assetTag,
                        scope: 't',
                      }),
                  }
                : undefined
            }
          />
        )}
        {tab === 'devices' && (
          <DevicesTab
            contract={data}
            scope={scope}
            viewer={viewer}
            canLabel={
              scope === 'o' && hasAnyRole(roles, ['ORG_OPERATOR']) && data.status !== 'CLOSED'
            }
            onLabel={(device) => setOpen({ kind: 'label', device })}
            onReportLost={(device) =>
              setOpen({
                kind: 'lost',
                deviceId: device.deviceId,
                assetTag: device.assetTag ?? device.deviceId,
                scope: 'o',
              })
            }
            onRequestCredit={(device) => setOpen({ kind: 'credit', device })}
          />
        )}
        {tab === 'money' && canSeeMoney && (
          <MoneyTab contract={data} scope={scope} canPay={viewer === 'manager'} />
        )}
        {tab === 'history' && canSeeMoney && (
          <HistoryTab
            code={data.code}
            history={history.data}
            loading={history.isLoading}
            error={history.error}
            onRetry={() => void history.refetch()}
          />
        )}
        {tab === 'documents' && canSeeMoney && <DocumentsTab contract={data} scope={scope} />}
      </TabPanel>
    );
  })();

  return (
    <section aria-labelledby="contract-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-3">
      <ContractHeader contract={data} scope={scope} variantName={variant} />
      {!phone && <LifecycleCard contract={data} history={history.data} viewer={viewer} />}
      <ContractActionBar
        tabs={tabs}
        tab={tab}
        onTab={(next) => setQuery({ tab: next })}
        modeTitle={modeTitle}
        overviewHref={base}
        actions={actions}
        onAction={onAction}
        primaryForm={mode === 'review' ? REVIEW_FORM_ID : undefined}
        primaryPending={mode === 'review' && approving}
      />
      {/* The record body is the one scroll region; the header, the sections row and the actions stay (ui standard §7). */}
      <PageScrollBody label="Contract details" className="flex flex-col gap-3">
        {phone && <LifecycleCard contract={data} history={history.data} viewer={viewer} />}
        {body}
      </PageScrollBody>

      {open?.kind === 'cancel' && <CancelDialog contract={data} onClose={() => setOpen(null)} />}
      {open?.kind === 'reject' && (
        <StateChangeDialog<'REJECTED'>
          subject={data.code}
          transition={REJECT}
          version={data.version}
          onSubmit={({ reason, expectedVersion }) =>
            rejectContract(data.id, reason ?? '', expectedVersion)
          }
          onReload={refresh}
          onDone={() => {
            refresh();
            setQuery({});
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'notice' && <NoticeDialog contract={data} onClose={() => setOpen(null)} />}
      {open?.kind === 'label' && (
        <HolderDialog contract={data} device={open.device} onClose={() => setOpen(null)} />
      )}
      {open?.kind === 'close' && closeCheck.data && (
        <CloseContractDialog
          contractId={data.id}
          code={data.code}
          version={closeCheck.data.version}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'lost' && (
        <ReportLossDialog
          deviceId={open.deviceId}
          assetTag={open.assetTag}
          scope={open.scope}
          onClose={() => setOpen(null)}
          // Staff close the dialog; the Org Manager keeps the report's confirmation in view (screen 4.4).
          onReported={() => (open.scope === 't' ? setOpen(null) : undefined)}
        />
      )}
      {open?.kind === 'credit' && (
        <RequestServiceCreditDialog
          contractId={data.id}
          device={open.device}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
};
