/** Response-header interpretation for iframe embeddability. */

export type HeaderMap = Record<string, string | undefined>;

export interface EmbedVerdict {
  embeddable: boolean;
  reason: string;
}

/**
 * Cross-origin embedding is refused by:
 *   - `X-Frame-Options: DENY` / `SAMEORIGIN` / `ALLOW-FROM …`
 *   - `Content-Security-Policy: frame-ancestors 'none' | 'self' | <origins>`
 *
 * `frame-ancestors *` and `frame-ancestors https:` permit embedding. When no
 * directive is present the page is considered embeddable.
 */
export function parseEmbeddable(headers: HeaderMap): EmbedVerdict {
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') lower.set(key.toLowerCase(), value);
  }

  const xfo = lower.get('x-frame-options')?.trim().toLowerCase();
  if (xfo !== undefined && xfo !== '') {
    if (xfo === 'deny') return { embeddable: false, reason: 'X-Frame-Options: DENY' };
    if (xfo === 'sameorigin') {
      return { embeddable: false, reason: 'X-Frame-Options: SAMEORIGIN' };
    }
    if (xfo.startsWith('allow-from')) {
      return { embeddable: false, reason: `X-Frame-Options: ${xfo}` };
    }
  }

  const csp = lower.get('content-security-policy');
  if (csp !== undefined && csp.trim() !== '') {
    // A response can carry several policies; each is enforced independently.
    for (const policy of csp.split(',')) {
      const directive = /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(policy);
      if (directive?.[1] === undefined) continue;
      const sources = directive[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (sources.length === 0) continue;
      if (sources.includes("'none'")) {
        return { embeddable: false, reason: "CSP frame-ancestors 'none'" };
      }
      if (sources.includes('*') || sources.includes('https:') || sources.includes('http:')) {
        continue;
      }
      if (sources.includes("'self'")) {
        return { embeddable: false, reason: "CSP frame-ancestors 'self'" };
      }
      // Explicit origin lists do not include our site (its domain is not fixed).
      return {
        embeddable: false,
        reason: `CSP frame-ancestors ${sources.join(' ')}`,
      };
    }
  }

  return { embeddable: true, reason: 'no framing restriction in response headers' };
}
