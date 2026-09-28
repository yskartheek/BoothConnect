import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { fakePdf, zipOf } from '../../test/support/files';
import { BadZip, saveAndHash, TooLarge, unpackPdfs, withTempDir } from './zip';

describe('saveAndHash', () => {
  it('stores the bytes, hashes them and recognises a PDF', () =>
    withTempDir(async (dir) => {
      const pdf = fakePdf('hash');
      const saved = await saveAndHash(Readable.from([pdf]), join(dir, 'a'), 1_000);
      expect(saved).toMatchObject({
        size: pdf.length,
        isPdf: true,
        sha256: createHash('sha256').update(pdf).digest('hex'),
      });
      expect(await readFile(saved.path)).toEqual(pdf);
      const text = await saveAndHash(Readable.from([Buffer.from('hello')]), join(dir, 'b'), 1_000);
      expect(text.isPdf).toBe(false);
    }));

  it('stops at the size limit', () =>
    withTempDir(async (dir) => {
      await expect(
        saveAndHash(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), join(dir, 'a'), 1_000),
      ).rejects.toBeInstanceOf(TooLarge);
    }));
});

describe('unpackPdfs', () => {
  const unpack = (zip: Buffer, maxPdf = 10_000, maxTotal = 100_000) =>
    withTempDir(async (dir) => {
      const path = join(dir, 'in.zip');
      await writeFile(path, zip);
      const result = await unpackPdfs(path, dir, maxPdf, maxTotal);
      return {
        names: result.pdfs.map((p) => p.name),
        skipped: result.skipped,
      };
    });

  it('keeps the PDFs and says why other entries were skipped', async () => {
    const result = await unpack(
      zipOf([
        { name: 'a.pdf', data: fakePdf('a') },
        { name: 'docs/', data: Buffer.alloc(0) },
        { name: '.DS_Store', data: Buffer.from('x') },
        { name: 'nested.zip', data: zipOf([{ name: 'b.pdf', data: fakePdf('b') }]) },
        { name: 'big.pdf', data: fakePdf('big', 20_000) },
      ]),
    );
    expect(result.names).toEqual(['a.pdf']);
    expect(result.skipped).toEqual([
      { name: 'nested.zip', reason: 'not a PDF' },
      { name: 'big.pdf', reason: 'larger than 10000 bytes' },
    ]);
  });

  it('refuses a ZIP that unpacks to more than the total limit', async () => {
    const zip = zipOf(
      Array.from({ length: 5 }, (_, i) => ({ name: `${i}.pdf`, data: fakePdf(`${i}`, 5_000) })),
    );
    await expect(unpack(zip, 10_000, 12_000)).rejects.toBeInstanceOf(BadZip);
  });

  it('refuses something that is not a ZIP', async () => {
    await expect(unpack(Buffer.from('not a zip at all'))).rejects.toBeInstanceOf(BadZip);
  });
});
