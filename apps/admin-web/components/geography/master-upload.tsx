'use client';

import { newIdempotencyKey } from '@boothconnect/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { t } from '@/lib/i18n';

import { ErrorState, errorMessage } from '../states';
import { changesIn, ImportReport, type MasterImportReport } from './import-report';

/**
 * Upload the State → PC → AC list (#103): check the file (nothing saved),
 * see each row's result, then save. Uses POST /v1/geographies/imports.
 */
export function MasterUpload() {
  const queryClient = useQueryClient();
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<{ csv: string; report: MasterImportReport } | null>(null);
  const [saved, setSaved] = useState<MasterImportReport | null>(null);
  // Remounts the file picker after a save, so it shows no file (and the same
  // file can be picked again).
  const [pickerKey, setPickerKey] = useState(0);

  const send = (csv: string, confirm: boolean) =>
    unwrap(
      apiClient().POST('/v1/geographies/imports', {
        params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
        body: { csv, confirm },
      }),
    );

  const check = useMutation({
    mutationFn: async (picked: File) => {
      const csv = await picked.text();
      return { csv, report: await send(csv, false) };
    },
    onMutate: () => {
      setChecked(null);
      setSaved(null);
    },
    onSuccess: setChecked,
  });

  const confirm = useMutation({
    mutationFn: (csv: string) => send(csv, true),
    onSuccess: async (report) => {
      setSaved(report);
      setChecked(null);
      setFile(null);
      setPickerKey((key) => key + 1);
      await queryClient.invalidateQueries({ queryKey: ['geography'] });
    },
  });

  const onCheck = (event: FormEvent) => {
    event.preventDefault();
    if (file) check.mutate(file);
  };

  return (
    <section className="glass section" aria-labelledby={`${fileId}-title`}>
      <h2 id={`${fileId}-title`}>{t('geography.uploadTitle')}</h2>
      <p>{t('geography.uploadIntro')}</p>
      <p>
        <a href="/templates/geography-master.csv" download>
          {t('geography.downloadTemplate')}
        </a>
      </p>
      <form className="form form-inline" onSubmit={onCheck}>
        <label htmlFor={fileId}>{t('geography.file')}</label>
        <input
          key={pickerKey}
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setChecked(null);
          }}
        />
        <button type="submit" className="button" disabled={!file || check.isPending}>
          {t('geography.check')}
        </button>
      </form>

      {check.isError ? <FileProblem error={check.error} /> : null}
      {saved ? (
        <p role="status" className="form-success">
          {t('geography.saved', { create: saved.counts.create, update: saved.counts.update })}
        </p>
      ) : null}
      {checked ? (
        <>
          <ImportReport report={checked.report} />
          {checked.report.counts.error === 0 && changesIn(checked.report) > 0 ? (
            <button
              type="button"
              className="button"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate(checked.csv)}
            >
              {t('geography.confirm', { count: changesIn(checked.report) })}
            </button>
          ) : null}
          {confirm.isError ? <ErrorState error={confirm.error} /> : null}
        </>
      ) : null}
    </section>
  );
}

/** A file the API can't read (missing columns, no rows…): its reason, in the API's words. */
function FileProblem({ error }: { error: unknown }) {
  if (error instanceof ApiRequestError && error.code === 'UNPROCESSABLE') {
    return (
      <p role="alert" className="form-error">
        {t('geography.fileProblem', { problem: error.message })}
      </p>
    );
  }
  return (
    <p role="alert" className="form-error">
      {errorMessage(error)}
    </p>
  );
}
