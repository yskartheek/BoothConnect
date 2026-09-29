import { checkFiles, contentTypeOf, kindOf, MAX_BYTES } from './upload-rules';

const pdf = (name = 'part-1.pdf', size = 1000) => ({ name, size, type: 'application/pdf' }) as File;
const zip = (name = 'ac-101.zip', size = 5000) => ({ name, size, type: '' }) as File;
const names = (list: { name: string }[]) => list.map((f) => f.name);

describe('checkFiles: how many files, and which kinds, per level', () => {
  it('takes exactly one PDF at Part level', () => {
    const first = checkFiles('part', [pdf('a.pdf'), pdf('b.pdf')], []);
    expect(names(first.accepted.map((a) => a.file))).toEqual(['a.pdf']);
    expect(first.problems).toEqual([{ name: 'b.pdf', reason: 'a Part takes exactly one PDF' }]);

    // One already listed (or in the batch): no more.
    const second = checkFiles('part', [pdf('c.pdf')], [{ name: 'a.pdf', size: 1000 }]);
    expect(second.accepted).toEqual([]);
    expect(second.problems[0]!.reason).toBe('a Part takes exactly one PDF');
  });

  it('refuses a ZIP at Part level', () => {
    const checked = checkFiles('part', [zip()], []);
    expect(checked.accepted).toEqual([]);
    expect(checked.problems[0]!.reason).toBe('only a PDF can be uploaded at Part level');
  });

  it.each(['ac', 'pc', 'state'] as const)('takes many PDFs and ZIPs at %s level', (level) => {
    const picked = [pdf('1.pdf'), pdf('2.pdf'), zip('more.zip'), pdf('3.PDF')];
    const checked = checkFiles(level, picked, [{ name: 'old.pdf', size: 1 }]);
    expect(names(checked.accepted.map((a) => a.file))).toEqual([
      '1.pdf',
      '2.pdf',
      'more.zip',
      '3.PDF',
    ]);
    expect(checked.accepted.map((a) => a.kind)).toEqual(['pdf', 'pdf', 'zip', 'pdf']);
    expect(checked.problems).toEqual([]);
  });

  it('refuses other types, empty and oversized files, and a file listed twice', () => {
    const checked = checkFiles(
      'ac',
      [
        { name: 'photo.jpg', size: 10, type: 'image/jpeg' } as File,
        pdf('empty.pdf', 0),
        pdf('huge.pdf', MAX_BYTES.pdf + 1),
        pdf('ok.pdf', MAX_BYTES.pdf),
        pdf('ok.pdf', MAX_BYTES.pdf),
        pdf('queued.pdf', 7),
      ],
      [{ name: 'queued.pdf', size: 7 }],
    );
    expect(names(checked.accepted.map((a) => a.file))).toEqual(['ok.pdf']);
    expect(checked.problems).toEqual([
      { name: 'photo.jpg', reason: 'only PDF and ZIP files can be uploaded' },
      { name: 'empty.pdf', reason: 'the file is empty' },
      { name: 'huge.pdf', reason: 'the file is larger than 100 MB' },
      { name: 'ok.pdf', reason: 'already in the list' },
      { name: 'queued.pdf', reason: 'already in the list' },
    ]);
  });

  it('names the kind by extension, and sends only content types the API accepts', () => {
    expect(kindOf('A.Zip')).toBe('zip');
    expect(kindOf('roll.pdf.exe')).toBeNull();
    expect(contentTypeOf(zip(), 'zip')).toBeUndefined();
    expect(contentTypeOf({ type: 'application/x-zip-compressed' } as File, 'zip')).toBe(
      'application/x-zip-compressed',
    );
    expect(contentTypeOf(pdf(), 'pdf')).toBe('application/pdf');
  });
});
