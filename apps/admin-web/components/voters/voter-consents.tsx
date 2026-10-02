'use client';

import { newIdempotencyKey, type Schemas } from '@boothconnect/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from 'radix-ui';
import { useId, useState } from 'react';

import { apiClient, unwrap } from '@/lib/api';
import { isMessageKey, type MessageKey, t } from '@/lib/i18n';

import { ErrorState, errorMessage, LoadingState } from '../states';
import { fieldLabel } from './voter-record';

type Consent = Schemas['StaffConsent'];

const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });

function methodText(method: string): string {
  const key = `voter.consentMethod.${method}`;
  return isMessageKey(key) ? t(key as MessageKey) : method;
}

/**
 * A voter's consents (#213): what each covers, when and how it was given
 * and who recorded it, and whether it was withdrawn. A granted one can be
 * withdrawn at the voter's request, after a confirmation.
 */
export function VoterConsents({ voterId }: { voterId: string }) {
  const id = useId();
  const consents = useQuery({
    queryKey: ['voters', voterId, 'consents'],
    queryFn: () =>
      unwrap(apiClient().GET('/v1/voters/{id}/consents', { params: { path: { id: voterId } } })),
  });

  return (
    <section className="glass section" aria-labelledby={`${id}-consents`}>
      <h2 id={`${id}-consents`}>{t('voter.consentsTitle')}</h2>
      {consents.isPending ? (
        <LoadingState />
      ) : consents.isError ? (
        <ErrorState error={consents.error} onRetry={() => void consents.refetch()} />
      ) : consents.data.items.length === 0 ? (
        <p>{t('voter.consentsNone')}</p>
      ) : (
        <ul className="plain-list">
          {consents.data.items.map((consent) => (
            <ConsentItem key={consent.id} voterId={voterId} consent={consent} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConsentItem({ voterId, consent }: { voterId: string; consent: Consent }) {
  const field = fieldLabel(consent.purpose);
  const granted = consent.status === 'granted';
  return (
    <li>
      <strong>{field}</strong>{' '}
      <span className={granted ? 'badge' : 'badge badge-error'}>
        {t(granted ? 'voter.consentStatusGranted' : 'voter.consentStatusWithdrawn')}
      </span>
      <br />
      <span className="muted">
        {t('voter.consentGivenLine', {
          date: date(consent.capturedAt),
          method: methodText(consent.method),
          name: consent.capturedBy?.name ?? t('voter.consentSomeone'),
        })}
      </span>
      {consent.withdrawnAt ? (
        <>
          <br />
          <span className="muted">
            {t('voter.consentWithdrawnLine', {
              date: date(consent.withdrawnAt),
              name: consent.withdrawnBy?.name ?? t('voter.consentSomeone'),
            })}
          </span>
        </>
      ) : null}
      {granted ? <Withdraw voterId={voterId} consent={consent} field={field} /> : null}
    </li>
  );
}

/** "Withdraw", after a confirmation (POST /v1/voters/:id/consents/:consentId/withdraw). */
function Withdraw({
  voterId,
  consent,
  field,
}: {
  voterId: string;
  consent: Consent;
  field: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const withdraw = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient().POST('/v1/voters/{id}/consents/{consentId}/withdraw', {
          params: {
            path: { id: voterId, consentId: consent.id },
            header: { 'Idempotency-Key': newIdempotencyKey() },
          },
        }),
      ),
    onSuccess: async () => {
      setOpen(false);
      // The consents and the record: the covered values are no longer shown.
      await queryClient.invalidateQueries({ queryKey: ['voters', voterId] });
    },
  });

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) withdraw.reset();
      }}
    >
      <div>
        <AlertDialog.Trigger asChild>
          <button
            type="button"
            className="button button-quiet button-small"
            aria-label={t('voter.consentWithdrawLabel', { field })}
          >
            {t('voter.consentWithdraw')}
          </button>
        </AlertDialog.Trigger>
      </div>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog glass">
          <AlertDialog.Title>{t('voter.consentWithdrawTitle')}</AlertDialog.Title>
          <AlertDialog.Description>
            {t('voter.consentWithdrawMessage', { field })}
          </AlertDialog.Description>
          {withdraw.isError ? (
            <p role="alert" className="form-error">
              {errorMessage(withdraw.error)}
            </p>
          ) : null}
          <div className="form-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="button button-quiet">
                {t('voter.cancel')}
              </button>
            </AlertDialog.Cancel>
            {/* Not AlertDialog.Action: that would close before the request is answered. */}
            <button
              type="button"
              className="button button-danger"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              {t('voter.consentWithdraw')}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
