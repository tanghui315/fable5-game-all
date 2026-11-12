import { describe, expect, it } from 'vitest';
import { parseEmbeddable } from '../src/embeddable.js';

describe('parseEmbeddable', () => {
  it('allows pages without framing restrictions', () => {
    expect(parseEmbeddable({})).toEqual({
      embeddable: true,
      reason: 'no framing restriction in response headers',
    });
  });

  it('rejects X-Frame-Options DENY / SAMEORIGIN / ALLOW-FROM', () => {
    expect(parseEmbeddable({ 'X-Frame-Options': 'DENY' }).embeddable).toBe(false);
    expect(parseEmbeddable({ 'x-frame-options': 'sameorigin' }).embeddable).toBe(false);
    expect(parseEmbeddable({ 'X-Frame-Options': 'ALLOW-FROM https://a.example' }).embeddable).toBe(
      false,
    );
  });

  it('rejects restrictive CSP frame-ancestors', () => {
    expect(
      parseEmbeddable({ 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'" })
        .embeddable,
    ).toBe(false);
    expect(
      parseEmbeddable({ 'Content-Security-Policy': "frame-ancestors 'self'" }).embeddable,
    ).toBe(false);
    expect(
      parseEmbeddable({ 'Content-Security-Policy': 'frame-ancestors https://only.example' })
        .embeddable,
    ).toBe(false);
  });

  it('allows * / https: frame-ancestors and unrelated directives', () => {
    expect(parseEmbeddable({ 'Content-Security-Policy': 'frame-ancestors *' }).embeddable).toBe(
      true,
    );
    expect(
      parseEmbeddable({ 'Content-Security-Policy': 'frame-ancestors https:' }).embeddable,
    ).toBe(true);
    expect(parseEmbeddable({ 'Content-Security-Policy': "default-src 'self'" }).embeddable).toBe(
      true,
    );
  });

  it('applies every policy when several CSP headers are combined', () => {
    const verdict = parseEmbeddable({
      'Content-Security-Policy': "frame-ancestors *; default-src 'self', frame-ancestors 'none'",
    });
    expect(verdict.embeddable).toBe(false);
  });
});
