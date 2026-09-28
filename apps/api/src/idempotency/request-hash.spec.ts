import { canonicalJson, requestHash } from './request-hash';

describe('request fingerprint', () => {
  it('ignores object key order, at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    );
    expect(requestHash('POST', '/v1/visits', { b: 1, a: 2 })).toBe(
      requestHash('post', '/v1/visits', { a: 2, b: 1 }),
    );
  });

  it('keeps array order, and treats missing and undefined properties alike', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('changes with the method, the path or the body', () => {
    const base = requestHash('POST', '/v1/visits', { a: 1 });
    expect(requestHash('PUT', '/v1/visits', { a: 1 })).not.toBe(base);
    expect(requestHash('POST', '/v1/visits/2', { a: 1 })).not.toBe(base);
    expect(requestHash('POST', '/v1/visits', { a: 2 })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});
