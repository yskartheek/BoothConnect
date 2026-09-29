'use client';

import { newIdempotencyKey, type Schemas } from '@boothconnect/api-client';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { type MessageKey, t } from '@/lib/i18n';

import { AreaPicker, type AreaNode, PlaceBreadcrumb, placeLabel } from '../area-picker';
import { ErrorState, errorMessage, LoadingState } from '../states';
import { UploadFiles } from './upload-files';

export type Batch = Schemas['BatchDetail'];

export const STEPS = ['level', 'upload', 'extract', 'review', 'confirm'] as const;
export type Step = (typeof STEPS)[number];

const STEP_LABEL: Record<Step, MessageKey> = {
  level: 'imports.stepLevel',
  upload: 'imports.stepUpload',
  extract: 'imports.stepExtract',
  review: 'imports.stepReview',
  confirm: 'imports.stepConfirm',
};

export const importUrl = (batchId: string, step: Step) =>
  `/imports?batch=${encodeURIComponent(batchId)}&step=${step}`;

/** Where the import is: Choose level → Upload → Extract → Review → Confirm. */
export function Stepper({ current }: { current: Step }) {
  const at = STEPS.indexOf(current);
  return (
    <ol className="stepper" aria-label={t('imports.steps')}>
      {STEPS.map((step, i) => (
        <li
          key={step}
          className={i < at ? 'stepper-done' : i === at ? 'stepper-current' : undefined}
          aria-current={i === at ? 'step' : undefined}
        >
          <span className="stepper-number" aria-hidden="true">
            {i + 1}
          </span>
          {t(STEP_LABEL[step])}
        </li>
      ))}
    </ol>
  );
}

/**
 * The roll import wizard (#71; design §3). Without a batch: choose the
 * level. With one (its ID in the URL, so a reload or a shared link comes
 * back to it): upload files, then the later steps.
 */
export function ImportWizard({ batchId, step }: { batchId?: string; step?: string }) {
  const router = useRouter();
  if (!batchId) {
    return (
      <>
        <Stepper current="level" />
        <ChooseLevel onCreated={(id) => router.push(importUrl(id, 'upload'))} />
      </>
    );
  }
  const current: Step =
    step === 'extract' || step === 'review' || step === 'confirm' ? step : 'upload';
  return <BatchSteps batchId={batchId} current={current} />;
}

function BatchSteps({ batchId, current }: { batchId: string; current: Step }) {
  const batch = useQuery({
    queryKey: ['imports', 'batch', batchId],
    queryFn: () =>
      unwrap(apiClient().GET('/v1/imports/batches/{id}', { params: { path: { id: batchId } } })),
  });
  return (
    <>
      <Stepper current={current} />
      {batch.isPending ? (
        <LoadingState />
      ) : batch.isError ? (
        batch.error instanceof ApiRequestError &&
        (batch.error.status === 404 || batch.error.status === 400) ? (
          <section className="glass section">
            <p role="alert">{t('imports.batchNotFound')}</p>
            <p>
              <Link href="/imports">{t('imports.startNew')}</Link>
            </p>
          </section>
        ) : (
          <ErrorState error={batch.error} onRetry={() => void batch.refetch()} />
        )
      ) : (
        <>
          <p className="import-target">
            {t('imports.target', { place: placeLabel(batch.data.targetNode) })}{' '}
            <Link href="/imports">{t('imports.startNew')}</Link>
          </p>
          {current === 'upload' ? (
            <UploadFiles batch={batch.data} />
          ) : (
            <section className="glass section">
              <p>{t('state.notReadyMessage')}</p>
              <p>
                <Link href={importUrl(batchId, 'upload')}>{t('imports.backToUpload')}</Link>
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}

/** Step 1: the State, PC, AC or Part the rolls belong under. */
export function ChooseLevel({ onCreated }: { onCreated: (batchId: string) => void }) {
  const [path, setPath] = useState<AreaNode[]>([]);
  const target = path.at(-1);
  const create = useMutation({
    mutationFn: (targetNodeId: string) =>
      unwrap(
        apiClient().POST('/v1/imports/batches', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: { targetNodeId },
        }),
      ),
    onSuccess: (batch) => onCreated(batch.id),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (target) create.mutate(target.id);
  };

  return (
    <section className="glass section" aria-labelledby="choose-level-title">
      <h2 id="choose-level-title">{t('imports.levelTitle')}</h2>
      <p>{t('imports.levelIntro')}</p>
      <form className="form" onSubmit={submit}>
        <AreaPicker
          legend={t('imports.levelLegend')}
          path={path}
          deepest="part"
          emptyLabel={t('imports.choose')}
          onChange={setPath}
        />
        <PlaceBreadcrumb path={path} label={t('imports.chosenPlace')} />
        {target ? (
          <p className="form-hint">
            {target.type === 'part' ? t('imports.partRule') : t('imports.manyRule')}
          </p>
        ) : null}
        {create.isError ? (
          <p role="alert" className="form-error">
            {create.error instanceof ApiRequestError && create.error.status === 422
              ? create.error.message
              : errorMessage(create.error)}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="button" disabled={!target || create.isPending}>
            {t('imports.continue')}
          </button>
        </div>
      </form>
    </section>
  );
}
