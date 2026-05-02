const SERVICE = 'jirallm';

type Keytar = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let keytarLoadPromise: Promise<Keytar | undefined> | undefined;
let cachedKeytar: Keytar | undefined;

async function loadKeytar(): Promise<Keytar | undefined> {
  if (keytarLoadPromise) return keytarLoadPromise;
  keytarLoadPromise = (async () => {
    try {
      const mod = (await import('keytar')) as { default?: Keytar } & Partial<Keytar>;
      cachedKeytar = (mod.default ?? (mod as unknown as Keytar)) satisfies Keytar;
    } catch {
      cachedKeytar = undefined;
    }
    return cachedKeytar;
  })();
  return keytarLoadPromise;
}

export async function getToken(orgName: string): Promise<string | undefined> {
  const keytar = await loadKeytar();
  if (!keytar) return undefined;
  try {
    const t = await keytar.getPassword(SERVICE, `${orgName}:api_token`);
    return t ?? undefined;
  } catch {
    return undefined;
  }
}

export async function setToken(orgName: string, token: string): Promise<void> {
  const keytar = await loadKeytar();
  if (!keytar) {
    throw new Error(
      'OS keychain (keytar) is unavailable. Run `pnpm rebuild keytar` after `pnpm approve-builds`.'
    );
  }
  await keytar.setPassword(SERVICE, `${orgName}:api_token`, token);
}

export async function removeToken(orgName: string): Promise<boolean> {
  const keytar = await loadKeytar();
  if (!keytar) return false;
  return keytar.deletePassword(SERVICE, `${orgName}:api_token`);
}

export async function hasStoredToken(orgName: string): Promise<boolean> {
  const keytar = await loadKeytar();
  if (!keytar) return false;
  try {
    const t = await keytar.getPassword(SERVICE, `${orgName}:api_token`);
    return Boolean(t);
  } catch {
    return false;
  }
}

export const __test = {
  resetKeytarCache: () => {
    keytarLoadPromise = undefined;
    cachedKeytar = undefined;
  },
};
