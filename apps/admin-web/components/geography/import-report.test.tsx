import { fireEvent, render, screen, within } from '@testing-library/react';

import { changesIn, ImportReport, type MasterImportReport } from './import-report';

const row = (
  line: number,
  action: MasterImportReport['rows'][number]['action'],
  errors: string[] = [],
) => ({
  line,
  level: line === 2 ? 'state' : line === 3 ? 'pc' : 'ac',
  code: `C${line}`,
  name: `Synthetic ${line}`,
  parentCode: line === 2 ? null : `P${line}`,
  action,
  errors,
});

const report = (rows: MasterImportReport['rows']): MasterImportReport => {
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) counts[r.action] += 1;
  return { programId: 'p', applied: false, counts, rows };
};

describe('ImportReport', () => {
  it('shows the counts and every row with its result', () => {
    render(
      <ImportReport report={report([row(2, 'unchanged'), row(3, 'update'), row(4, 'create')])} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 to add, 1 to update, 1 unchanged, 0 with errors',
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ['2', 'State', 'C2', 'Synthetic 2', '', 'No change'],
      ['3', 'PC', 'C3', 'Synthetic 3', 'P3', 'Update'],
      ['4', 'AC', 'C4', 'Synthetic 4', 'P4', 'Add'],
    ]);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been saved/)).not.toBeInTheDocument();
  });

  it('with errors: says nothing was saved, shows the reasons, and starts with only those rows', () => {
    render(
      <ImportReport
        report={report([
          row(2, 'create'),
          row(3, 'error', ['Unknown State S00']),
          row(4, 'error', ['code is required', 'name is required']),
        ])}
      />,
    );
    expect(
      screen.getByText(
        'Fix the rows with errors in the file and check it again. Nothing has been saved.',
      ),
    ).toBeInTheDocument();
    const filter = screen.getByRole('checkbox', { name: 'Show only rows with errors' });
    expect(filter).toBeChecked();
    let rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.getAttribute('data-action'))).toEqual(['error', 'error']);
    expect(
      within(rows[1]!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['code is required', 'name is required']);
    fireEvent.click(filter);
    rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
  });

  it('says so when the file changes nothing', () => {
    render(<ImportReport report={report([row(2, 'unchanged')])} />);
    expect(screen.getByText('Everything in this file is already saved.')).toBeInTheDocument();
  });

  it('counts the changes a confirm would save', () => {
    expect(changesIn(report([row(2, 'create'), row(3, 'update'), row(4, 'unchanged')]))).toBe(2);
  });
});
