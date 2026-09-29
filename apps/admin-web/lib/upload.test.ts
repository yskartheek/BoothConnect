import { PartFailedError, UploadExpiredError, type UploadTicket, uploadParts } from './upload';

const ticket = (size: number, partSize: number, expiresAt = '2999-01-01T00:00:00.000Z') =>
  ({
    id: 'up-1',
    kind: 'pdf',
    originalName: 'roll.pdf',
    sizeBytes: size,
    partSizeBytes: partSize,
    parts: Array.from({ length: Math.ceil(size / partSize) }, (_, i) => ({
      partNumber: i + 1,
      url: `https://storage.test/part/${i + 1}`,
    })),
    expiresAt,
  }) as UploadTicket;

const file = (size: number) => new Blob([new Uint8Array(size).map((_, i) => i % 251)]);
const noWait = () => Promise.resolve();

describe('uploadParts', () => {
  it('sends each slice to its URL and returns every ETag in order', async () => {
    const sent: [string, number][] = [];
    const progress: number[] = [];
    const parts = await uploadParts(file(25), ticket(25, 10), new Map(), {
      put: async (url, body, onProgress) => {
        sent.push([url, body.size]);
        onProgress(body.size / 2);
        return `"etag-${url.at(-1)}"`;
      },
      onProgress: (bytes) => progress.push(bytes),
    });
    expect(sent).toEqual([
      ['https://storage.test/part/1', 10],
      ['https://storage.test/part/2', 10],
      ['https://storage.test/part/3', 5],
    ]);
    expect(parts).toEqual([
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ]);
    expect(progress).toEqual([0, 5, 10, 15, 20, 22.5, 25]);
  });

  it('retries a failed part with a growing wait, after the connection is back', async () => {
    const waits: number[] = [];
    const retries: number[] = [];
    let onlineChecks = 0;
    let calls = 0;
    const parts = await uploadParts(file(10), ticket(10, 10), new Map(), {
      put: async () => {
        calls += 1;
        if (calls < 3) throw new Error('Network error');
        return '"e"';
      },
      wait: async (ms) => {
        waits.push(ms);
      },
      online: async () => {
        onlineChecks += 1;
      },
      onRetry: (_, attempt) => retries.push(attempt),
    });
    expect(parts).toEqual([{ partNumber: 1, etag: '"e"' }]);
    expect(waits).toEqual([1000, 2000]);
    expect(retries).toEqual([1, 2]);
    expect(onlineChecks).toBe(3);
  });

  it('gives up after the retries, keeping the parts already sent, and resumes from there', async () => {
    const done = new Map<number, string>();
    const urls: string[] = [];
    let fail = true;
    const put = async (url: string) => {
      urls.push(url);
      if (url.endsWith('/2') && fail) throw new Error('Network error');
      return `"${url.at(-1)}"`;
    };
    const error = await uploadParts(file(30), ticket(30, 10), done, {
      put,
      retries: 2,
      wait: noWait,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PartFailedError);
    expect((error as PartFailedError).partNumber).toBe(2);
    expect([...done.keys()]).toEqual([1]);
    expect(urls.filter((u) => u.endsWith('/2'))).toHaveLength(3);

    // Retry: part 1 isn't sent again.
    fail = false;
    urls.length = 0;
    const parts = await uploadParts(file(30), ticket(30, 10), done, { put, wait: noWait });
    expect(urls).toEqual(['https://storage.test/part/2', 'https://storage.test/part/3']);
    expect(parts.map((p) => p.etag)).toEqual(['"1"', '"2"', '"3"']);
  });

  it('stops when the links have expired', async () => {
    const put = vi.fn(async () => '"e"');
    await expect(
      uploadParts(file(10), ticket(10, 10, '2026-01-01T00:00:00.000Z'), new Map(), {
        put,
        now: () => Date.parse('2026-01-01T00:00:01.000Z'),
      }),
    ).rejects.toBeInstanceOf(UploadExpiredError);
    expect(put).not.toHaveBeenCalled();
  });

  it('stops without retrying when cancelled', async () => {
    const controller = new AbortController();
    const put = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(
      uploadParts(file(10), ticket(10, 10), new Map(), {
        put,
        signal: controller.signal,
        wait: noWait,
      }),
    ).rejects.toThrow('Aborted');
    expect(put).toHaveBeenCalledTimes(1);
  });
});
