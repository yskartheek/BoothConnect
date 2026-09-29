'use client';

import type { Schemas } from '@boothconnect/api-client';
import { useId, useState } from 'react';

import { type MessageKey, t } from '@/lib/i18n';

export type MasterImportReport = Schemas['MasterImportReport'];
type Action = MasterImportReport['rows'][number]['action'];

const ACTION_LABEL: Record<Action, MessageKey> = {
  create: 'geography.actionCreate',
  update: 'geography.actionUpdate',
  unchanged: 'geography.actionUnchanged',
  error: 'geography.actionError',
};

const LEVEL_LABEL: Record<string, MessageKey> = {
  state: 'geography.levelState',
  pc: 'geography.levelPc',
  ac: 'geography.levelAc',
};

/** How many rows a confirm would save. */
export const changesIn = (report: MasterImportReport) =>
  report.counts.create + report.counts.update;

/**
 * The check of a master-data file (#103): counts, then each row with what
 * would happen to it and, for errors, why (the reasons come from the API).
 */
export function ImportReport({ report }: { report: MasterImportReport }) {
  const [onlyProblems, setOnlyProblems] = useState(report.counts.error > 0);
  const filterId = useId();
  const rows = onlyProblems ? report.rows.filter((row) => row.action === 'error') : report.rows;

  return (
    <div className="report">
      <p className="report-summary" role="status">
        {t('geography.summary', {
          create: report.counts.create,
          update: report.counts.update,
          unchanged: report.counts.unchanged,
          error: report.counts.error,
        })}
      </p>
      {report.counts.error > 0 ? (
        <p className="form-error">{t('geography.fixErrors')}</p>
      ) : changesIn(report) === 0 && !report.applied ? (
        <p>{t('geography.nothingToSave')}</p>
      ) : null}
      {report.counts.error > 0 ? (
        <label htmlFor={filterId} className="report-filter">
          <input
            id={filterId}
            type="checkbox"
            checked={onlyProblems}
            onChange={(event) => setOnlyProblems(event.target.checked)}
          />
          {t('geography.onlyProblems')}
        </label>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{t('geography.resultCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('geography.colLine')}</th>
              <th scope="col">{t('geography.colLevel')}</th>
              <th scope="col">{t('geography.colCode')}</th>
              <th scope="col">{t('geography.colName')}</th>
              <th scope="col">{t('geography.colParent')}</th>
              <th scope="col">{t('geography.colResult')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.line} data-action={row.action}>
                <td>{row.line}</td>
                <td>{LEVEL_LABEL[row.level] ? t(LEVEL_LABEL[row.level]!) : row.level}</td>
                <td>{row.code}</td>
                <td>{row.name}</td>
                <td>{row.parentCode ?? ''}</td>
                <td>
                  <span className={`badge badge-${row.action}`}>{t(ACTION_LABEL[row.action])}</span>
                  {row.errors.length > 0 ? (
                    <ul className="report-errors">
                      {row.errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
