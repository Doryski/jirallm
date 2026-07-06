const SERVICE = 'jirallm';

type Entry = {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
};

type KeyringModule = {
  Entry: new (service: string, account: string) => Entry;
};

let keyringLoadPromise: Promise<KeyringModule | undefined> | undefined;
let cachedKeyring: KeyringModule | undefined;

async function loadKeyring(): Promise<KeyringModule | undefined> {
  if (keyringLoadPromise) return keyringLoadPromise;
  keyringLoadPromise = (async () => {
    try {
      const mod = (await import('@napi-rs/keyring')) as Partial<KeyringModule> & {
        default?: Partial<KeyringModule>;
      };
      const resolved = mod.Entry ? (mod as KeyringModule) : (mod.default as KeyringModule | undefined);
      cachedKeyring = resolved && resolved.Entry ? resolved : undefined;
    } catch {
      cachedKeyring = undefined;
    }
    return cachedKeyring;
  })();
  return keyringLoadPromise;
}

function entryFor(keyring: KeyringModule, orgName: string): Entry {
  return new keyring.Entry(SERVICE, `${orgName}:api_token`);
}

function envTokenFor(orgName: string): string | undefined {
  const orgSpecific = process.env[`JIRALLM_API_TOKEN_${orgName.toUpperCase()}`];
  if (orgSpecific) return orgSpecific;
  return process.env.JIRALLM_API_TOKEN || undefined;
}

export async function getToken(orgName: string): Promise<string | undefined> {
  const keyring = await loadKeyring();
  const fromKeyring = await readKeyringToken(keyring, orgName);
  if (fromKeyring !== undefined) return fromKeyring;
  return envTokenFor(orgName);
}

export async function getTokenSource(orgName: string): Promise<'keychain' | 'env' | null> {
  const keyring = await loadKeyring();
  const fromKeyring = await readKeyringToken(keyring, orgName);
  if (fromKeyring !== undefined) return 'keychain';
  if (envTokenFor(orgName) !== undefined) return 'env';
  return null;
}

async function readKeyringToken(
  keyring: KeyringModule | undefined,
  orgName: string
): Promise<string | undefined> {
  if (!keyring) return undefined;
  try {
    return entryFor(keyring, orgName).getPassword() || undefined;
  } catch {
    // NoEntry / Ambiguous → treat as missing
    return undefined;
  }
}

export async function setToken(orgName: string, token: string): Promise<void> {
  const keyring = await loadKeyring();
  if (!keyring) {
    throw new Error(
      'OS keychain (@napi-rs/keyring) is unavailable. Reinstall jirallm or check that your platform binary is supported.'
    );
  }
  entryFor(keyring, orgName).setPassword(token);
}

export async function removeToken(orgName: string): Promise<boolean> {
  const keyring = await loadKeyring();
  if (!keyring) return false;
  try {
    return entryFor(keyring, orgName).deletePassword();
  } catch {
    return false;
  }
}

export async function hasStoredToken(orgName: string): Promise<boolean> {
  const token = await getToken(orgName);
  return Boolean(token);
}

export const __test = {
  resetKeytarCache: () => {
    keyringLoadPromise = undefined;
    cachedKeyring = undefined;
  },
};
