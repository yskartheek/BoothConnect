import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('the downloadable master-data template', () => {
  it('is the same file as docs/templates/geography-master.csv', () => {
    const served = readFileSync(
      join(__dirname, '../public/templates/geography-master.csv'),
      'utf8',
    );
    const source = readFileSync(
      join(__dirname, '../../../docs/templates/geography-master.csv'),
      'utf8',
    );
    expect(served).toBe(source);
  });
});
