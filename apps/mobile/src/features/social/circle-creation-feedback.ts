export function creationFailure(error: unknown, hasPending: boolean, recoveryReadable: boolean): {
  kind: 'invalid-input' | 'retry' | 'resume' | 'unavailable'; message: string;
} {
  if (!recoveryReadable) return { kind: 'unavailable', message: 'Could not read your saved Circle creation. Retry opening it.' };
  if (hasPending) return { kind: 'resume', message: 'Could not finish creating your Circle. Resume using your saved choices.' };
  if (error instanceof Error && ['INVALID_INPUT', 'INVALID_PROFILE'].includes(error.message)) {
    return { kind: 'invalid-input', message: 'Check the Circle name and description.' };
  }
  return { kind: 'retry', message: 'Could not start creating your Circle. Please retry.' };
}
