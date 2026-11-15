import { describe, expect, it } from 'vitest';
import {
  evidenceKeywords,
  lookupX,
  normalizeHandle,
  parsePost,
  parseProfile,
  parseSearch,
  parseStatusInput,
  XApiError,
} from '../src/x.js';

function fakeFetch(payload: unknown, status = 200, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    seen.push(String(input));
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const profilePayload = {
  code: 200,
  message: 'OK',
  user: {
    screen_name: 'FiniYang',
    name: 'Fini.Yang',
    description: 'Agent 架构师',
    website: { url: 'https://www.zseven.tech/' },
    followers: 13479,
    tweets: 16797,
  },
};

const searchPayload = {
  code: 200,
  results: [
    {
      type: 'status',
      id: '2121212247515287740',
      url: 'https://x.com/FiniYang/status/2121212247515287740',
      text: '孤枪入夜上线 https://sanguo.finiyang.com/',
      created_at: 'Fri Nov 13 12:03:04 +0000 2026',
      likes: 63,
      retweets: 4,
      author: { screen_name: 'FiniYang' },
    },
    { type: 'status', url: 'https://x.com/i/status/1', text: 'no id' },
  ],
};

describe('parseStatusInput', () => {
  it('parses x.com and twitter.com status URLs', () => {
    expect(parseStatusInput('https://x.com/FiniYang/status/2121212247515287740')).toEqual({
      handle: 'FiniYang',
      id: '2121212247515287740',
    });
    expect(parseStatusInput('https://twitter.com/FiniYang/status/42/')).toEqual({
      handle: 'FiniYang',
      id: '42',
    });
  });

  it('rejects anything else', () => {
    expect(parseStatusInput('https://x.com/FiniYang')).toBeNull();
    expect(parseStatusInput('https://x.com/i/status/42')).toBeNull();
    expect(parseStatusInput('https://github.com/owner/repo')).toBeNull();
    expect(parseStatusInput('not a url')).toBeNull();
  });
});

describe('normalizeHandle', () => {
  it('strips a leading @ and validates the handle', () => {
    expect(normalizeHandle('@FiniYang')).toBe('FiniYang');
    expect(normalizeHandle(' FiniYang ')).toBe('FiniYang');
    expect(normalizeHandle('not a handle')).toBeNull();
    expect(normalizeHandle('@x')).toBeNull();
  });
});

describe('evidenceKeywords', () => {
  it('lists the model and tool terms a post mentions', () => {
    expect(evidenceKeywords('Claude Fable 5.2 负责复杂 Shader')).toEqual([
      'fable',
      'claude',
      'shader',
    ]);
    expect(evidenceKeywords('用模型做的游戏')).toEqual(['模型']);
    expect(evidenceKeywords('nothing here')).toEqual([]);
  });
});

describe('parseProfile', () => {
  it('reads handle, bio, website and counts', () => {
    expect(parseProfile(profilePayload)).toEqual({
      handle: 'FiniYang',
      name: 'Fini.Yang',
      bio: 'Agent 架构师',
      website: 'https://www.zseven.tech/',
      followers: 13479,
      posts: 16797,
    });
  });

  it('returns null for errors and missing users', () => {
    expect(parseProfile({ code: 404, message: 'User not found' })).toBeNull();
    expect(parseProfile(null)).toBeNull();
  });
});

describe('parseSearch', () => {
  it('keeps well-formed results and drops entries without an id', () => {
    const posts = parseSearch(searchPayload);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: '2121212247515287740', author: 'FiniYang', likes: 63 });
    expect(parseSearch({ code: 200, results: [] })).toEqual([]);
    expect(parseSearch({ code: 500 })).toEqual([]);
  });
});

describe('parsePost', () => {
  it('reads a single post', () => {
    const post = parsePost({ code: 200, tweet: searchPayload.results[0] });
    expect(post?.id).toBe('2121212247515287740');
    expect(parsePost({ code: 404, message: 'Not found' })).toBeNull();
  });
});

describe('lookupX', () => {
  it('searches posts and applies the limit', async () => {
    const seen: string[] = [];
    const result = await lookupX('sanguo.finiyang.com', {
      limit: 1,
      fetchImpl: fakeFetch(searchPayload, 200, seen),
    });
    expect(result.kind).toBe('search');
    expect(result.posts).toHaveLength(1);
    expect(seen[0]).toBe('https://api.fxtwitter.com/2/search?q=sanguo.finiyang.com');
  });

  it('reads a profile for @handle', async () => {
    const seen: string[] = [];
    const result = await lookupX('@FiniYang', { fetchImpl: fakeFetch(profilePayload, 200, seen) });
    expect(result.kind).toBe('profile');
    expect(result.profile?.handle).toBe('FiniYang');
    expect(seen[0]).toBe('https://api.fxtwitter.com/FiniYang');
  });

  it('reads one post from a status URL', async () => {
    const seen: string[] = [];
    const result = await lookupX('https://x.com/FiniYang/status/2121212247515287740', {
      fetchImpl: fakeFetch({ code: 200, tweet: searchPayload.results[0] }, 200, seen),
    });
    expect(result.kind).toBe('post');
    expect(result.posts[0]?.id).toBe('2121212247515287740');
    expect(seen[0]).toBe('https://api.fxtwitter.com/FiniYang/status/2121212247515287740');
  });

  it('surfaces API errors', async () => {
    const failing = fakeFetch({ code: 404, message: 'User not found' }, 404);
    await expect(lookupX('@nobodyhere', { fetchImpl: failing })).rejects.toBeInstanceOf(XApiError);
  });
});
