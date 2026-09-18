import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexOfBytes } from '../../src/core/sha256';
import { fixtures } from './fixtures';

function nodeSha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('sha256', () => {
  it('matches known digests', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches Node for random byte lengths across block boundaries', () => {
    for (let length = 0; length < 200; length += 1) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(sha256HexOfBytes(bytes)).toBe(nodeSha(bytes));
    }
    const big = new Uint8Array(randomBytes(300_000));
    expect(sha256HexOfBytes(big)).toBe(nodeSha(big));
  });

  it('matches every fixture source hash, including BOM and line-ending variants', () => {
    const sources: Array<{ text: string; sha256: string }> = [];
    for (const c of fixtures.cases) {
      for (const key of ['source', 'source_a', 'invalid_source_b']) {
        if (c[key]) sources.push(c[key]);
      }
      for (const s of c.sources ?? []) sources.push(s.source);
      for (const v of c.variants ?? []) sources.push(v.source);
      if (c.header_variant) sources.push(c.header_variant.source);
    }
    expect(sources.length).toBeGreaterThan(15);
    for (const s of sources) {
      expect(sha256Hex(s.text)).toBe(s.sha256);
    }
  });
});
