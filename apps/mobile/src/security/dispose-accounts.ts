export async function disposeAccounts<T>(accounts: readonly T[], dispose: (account: T) => Promise<unknown>): Promise<void> {
  const results = await Promise.allSettled(accounts.map(async (account) => dispose(account)));
  if (results.some((result) => result.status === 'rejected')) throw new Error('ACCOUNT_DISPOSAL_FAILED');
}
