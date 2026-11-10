import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../shared/api/apiClient';
import {
  lossCaseKeys,
  lossErrorText,
  reportLoss,
  type LossCase,
} from '../../entities/loss-case/api';
import { Alert, Button, Dialog, Field, Textarea } from '../../shared/ui';
import { invalid } from '../../shared/ui/errors';
import { LINK } from '../../shared/ui/styles';

const MAX = 1000;

// The Report lost dialog of screen 4.4 (devices api-design 17, UC-49): from a device row of
// /o/contracts/:id for the Org Manager and from /t/devices/:id for TrekLink Staff. The Manager gets the
// confirmation panel in the dialog; Staff get the case back through `onReported`.
export const ReportLossDialog: React.FC<{
  deviceId: string;
  assetTag: string;
  scope: 'o' | 't';
  onReported: (reported: LossCase) => void;
  onClose: () => void;
}> = ({ deviceId, assetTag, scope, onReported, onClose }) => {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [openCase, setOpenCase] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  const submit = async () => {
    const text = description.trim();
    if (text === '') {
      setFieldError('Description is required.');
      return;
    }
    if (text.length > MAX) {
      setFieldError(`Description is at most ${MAX} characters.`);
      return;
    }
    setFieldError(undefined);
    setError(null);
    setOpenCase(false);
    setPending(true);
    try {
      const reported = await reportLoss(deviceId, text);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: lossCaseKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['device', deviceId] }),
        queryClient.invalidateQueries({ queryKey: ['contract'] }),
      ]);
      setPending(false);
      if (scope === 'o') setDone(true);
      onReported(reported);
    } catch (failure) {
      setPending(false);
      setOpenCase(failure instanceof ApiError && failure.errorCode === 'LOSS_CASE_OPEN');
      setError(lossErrorText(failure));
    }
  };

  if (done) {
    // Its own key: the form's dialog unmounts with the Report lost button that held focus, and this
    // one mounts and focuses Close; on close, focus returns to the row action (screen 4.4,
    // treklink-web#468). Reusing the form's dialog left focus on the page body.
    return (
      <Dialog
        key="done"
        titleId="report-loss-title"
        title={`${assetTag} reported lost`}
        onClose={onClose}
        initialFocus={closeButton}
        footer={
          <Button ref={closeButton} variant="primary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <Alert tone="success">Loss reported. TrekLink will contact you.</Alert>
      </Dialog>
    );
  }

  return (
    <Dialog
      titleId="report-loss-title"
      title={`Report ${assetTag} lost`}
      description="TrekLink will contact you. Late and loss charges follow the contract."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={pending}
            loadingLabel="Reporting"
            onClick={() => void submit()}
          >
            Report lost
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          id="loss-description"
          label="Description"
          hint="Where and when it was last seen, and what happened."
          error={fieldError}
          required
        >
          <Textarea
            id="loss-description"
            rows={4}
            maxLength={MAX}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            {...invalid('loss-description', fieldError)}
          />
        </Field>
        {error && (
          <Alert tone="error">
            {error}
            {openCase && (
              <>
                {' '}
                <Link to={scope === 'o' ? '/o/loss-cases' : '/t/loss-cases'} className={LINK}>
                  Open the loss cases
                </Link>
              </>
            )}
          </Alert>
        )}
      </div>
    </Dialog>
  );
};
