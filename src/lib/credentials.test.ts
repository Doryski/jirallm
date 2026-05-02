import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('keytar', () => {
  const k = (s: string, a: string) => `${s}::${a}`;
  return {
    default: {
      getPassword: vi.fn(async (s: string, a: string) => store.get(k(s, a)) ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => {
        store.set(k(s, a), p);
      }),
      deletePassword: vi.fn(async (s: string, a: string) => store.delete(k(s, a))),
    },
  };
});

import { getToken, setToken, removeToken, hasStoredToken, __test } from './credentials.js';

beforeEach(() => {
  store.clear();
  __test.resetKeytarCache();
});

afterEach(() => {
  store.clear();
});

describe('credentials', () => {
  it('round-trips token via keychain', async () => {
    await setToken('work', 'tok-1');
    expect(await hasStoredToken('work')).toBe(true);
    expect(await getToken('work')).toBe('tok-1');
    expect(await removeToken('work')).toBe(true);
    expect(await getToken('work')).toBeUndefined();
  });

  it('returns undefined when no keychain entry exists', async () => {
    expect(await getToken('anything')).toBeUndefined();
  });
});
