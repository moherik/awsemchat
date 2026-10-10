import { nativeCrypto } from '../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';

declare const accountBrand: unique symbol;
declare const sessionBrand: unique symbol;
export type AccountHandle = string & { readonly [accountBrand]: true };
export type SessionHandle = string & { readonly [sessionBrand]: true };
export type PublicBundle = { identity: string; signingIdentity: string; prekey: string };
export type Ciphertext = { kind: number; body: string };
const codes = new Set(['INVALID_INPUT', 'INVALID_HANDLE', 'INPUT_TOO_LARGE', 'CAPACITY',
  'PREKEY_EXHAUSTED', 'CRYPTO_REJECTED', 'INVALID_PLAINTEXT', 'CLOSED', 'UNAVAILABLE', 'UNSUPPORTED_PLATFORM']);
export class EncryptionError extends Error {
  readonly code: string;
  constructor(code: string) {
    const safeCode = codes.has(code) ? code : 'UNAVAILABLE';
    super(safeCode);
    this.code = safeCode;
  }
}
async function call<T>(request: object): Promise<T> {
  try {
    const result = JSON.parse(await nativeCrypto().execute(JSON.stringify(request)));
    if (result.ok !== true) throw new EncryptionError(result.code);
    return result.value as T;
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    if (error instanceof Error && error.message === 'UNSUPPORTED_PLATFORM') throw new EncryptionError('UNSUPPORTED_PLATFORM');
    throw new EncryptionError('UNAVAILABLE');
  }
}

/** Experimental, ephemeral native state. Do not use for production sends before durable ratchet commits. */
export const encryption = {
  createAccount: () => call<AccountHandle>({ op: 'createAccount' }),
  publicBundle: (account: AccountHandle) => call<PublicBundle>({ op: 'publicBundle', account }),
  outbound: (account: AccountHandle, trustedPeer: PublicBundle) => call<SessionHandle>({
    op: 'outbound', account, identity: trustedPeer.identity, prekey: trustedPeer.prekey,
  }),
  inbound: (account: AccountHandle, trustedSenderIdentity: string, message: Ciphertext) =>
    call<{ session: SessionHandle; plaintext: string }>({ op: 'inbound', account, identity: trustedSenderIdentity, message }),
  encrypt: (session: SessionHandle, plaintext: string) => call<Ciphertext>({ op: 'encrypt', session, plaintext }),
  decrypt: (session: SessionHandle, message: Ciphertext) => call<string>({ op: 'decrypt', session, message }),
  disposeAccount: (account: AccountHandle) => call<null>({ op: 'disposeAccount', account }),
  disposeSession: (session: SessionHandle) => call<null>({ op: 'disposeSession', session }),
};
