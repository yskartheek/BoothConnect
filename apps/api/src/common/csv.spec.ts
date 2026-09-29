import { csvLine, safeCsvCell } from './csv';

describe('CSV safety', () => {
  it('neutralises values that a spreadsheet would run as a formula', () => {
    for (const value of ['=1+1', '+91 99999', '-2', '@SUM(A1)', '\tx', '\rx']) {
      expect(safeCsvCell(value)).toBe(`'${value}`);
    }
    expect(safeCsvCell('=HYPERLINK("http://x","y")')).toBe(`'=HYPERLINK("http://x","y")`);
  });

  it('leaves ordinary values alone', () => {
    expect(safeCsvCell('Synthetic Person')).toBe('Synthetic Person');
    expect(safeCsvCell('16-64')).toBe('16-64');
    expect(safeCsvCell(42)).toBe('42');
    expect(safeCsvCell(null)).toBe('');
    expect(safeCsvCell(undefined)).toBe('');
    // A negative number is data, but still starts with "-": neutralised too.
    expect(safeCsvCell(-3)).toBe("'-3");
  });

  it('quotes cells with commas, quotes or line breaks', () => {
    expect(csvLine(['a', 'b,c', 'say "hi"', 'x\ny'])).toBe('a,"b,c","say ""hi""","x\ny"\r\n');
    // Neutralised first, then quoted.
    expect(csvLine(['=cmd|" /C calc"!A0'])).toBe(`"'=cmd|"" /C calc""!A0"\r\n`);
    expect(csvLine([])).toBe('\r\n');
  });
});
