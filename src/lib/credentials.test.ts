import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const k = (s: string, a: string) => `${s}::${a}`;

vi.mock('@napi-rs/keyring', () => {
  class Entry {
    private key: string;
    constructor(service: string, account: string) {
      this.key = k(service, account);
    }
    getPassword(): string | null {
      return store.get(this.key) ?? null;
    }
    setPassword(password: string): void {
      store.set(this.key, password);
    }
    deletePassword(): boolean {
      return store.delete(this.key);
    }
  }
  return { Entry };
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
