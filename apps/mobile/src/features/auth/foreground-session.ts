export function createForegroundSessionGate(
  pauseSync: () => void,
  validateSavedSession: () => Promise<unknown>,
  resumeSync: () => void,
) {
  let validation: Promise<void> | undefined;
  return function validateBeforeSync(): Promise<void> {
    if (validation) return validation;
    pauseSync();
    validation = Promise.resolve()
      .then(validateSavedSession)
      .then(() => undefined, () => undefined)
      .finally(() => {
        validation = undefined;
        resumeSync();
      });
    return validation;
  };
}
