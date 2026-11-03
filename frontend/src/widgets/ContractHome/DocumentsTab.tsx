import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { downloadPdf, fetchHandoverNote, type ContractDetail } from '../../entities/contract/api';
import { Button } from '../../shared/ui/Button';
import { Card, CardHeader } from '../../shared/ui/Card';
import { messageOf } from '../../shared/ui/errors';
import { LINK } from '../../shared/ui/styles';

// The signed handover note (rentals api-design 11) as a download, with its integrity check: a note
// whose hash no longer matches the one recorded at signing still downloads, with a warning.
const HandoverNoteButton: React.FC<{ contract: ContractDetail }> = ({ contract }) => {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const download = async () => {
    setPending(true);
    setNote(null);
    try {
      const stored = await fetchHandoverNote(contract.id);
      if (stored.pdfBase64) downloadPdf(stored.pdfBase64, `${contract.code}-handover-note.pdf`);
      if (stored.integrity === 'MISMATCH') {
        setNote('This note does not match the one signed at the counter. Tell TrekLink Staff.');
      } else if (stored.integrity === 'MISSING') {
        setNote('The stored note cannot be found. Tell TrekLink Staff.');
      }
    } catch (failure) {
      setNote(messageOf(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        icon={<Download className="h-4 w-4" />}
        loading={pending}
        loadingLabel="Preparing…"
        onClick={() => void download()}
      >
        Download handover note
      </Button>
      {note && (
        <p role="alert" className="text-body-sm text-status-critical-fg">
          {note}
        </p>
      )}
    </div>
  );
};

/** The Documents tab: the signed handover note after the handover, and where the invoices are. */
export const DocumentsTab: React.FC<{ contract: ContractDetail; scope: 'o' | 't' }> = ({
  contract,
  scope,
}) => (
  <div className="grid gap-3 md:grid-cols-2">
    <Card padding="sm">
      <CardHeader
        title="Handover note"
        description="Signed at the counter, stored with its hash."
      />
      {contract.handedOverAt ? (
        <HandoverNoteButton contract={contract} />
      ) : (
        <p className="text-body-sm text-ink-muted">The note is signed at the handover.</p>
      )}
    </Card>
    <Card padding="sm">
      <CardHeader title="Invoices" description="Each invoice opens as its own page." />
      <Link
        to={
          scope === 'o'
            ? `/o/invoices?contractId=${contract.id}`
            : `/t/billing?contractId=${contract.id}`
        }
        className={`${LINK} inline-flex min-h-6 items-center text-body-sm`}
      >
        Invoices of {contract.code}
      </Link>
    </Card>
  </div>
);
