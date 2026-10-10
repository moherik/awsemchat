export type StorageProbeStep = 'OPEN' | 'INTEGRITY' | 'REOPEN' | 'WRONG_KEY' |
  'ROLLBACK' | 'FAILED_IMPORT' | 'GENERATION_SWITCH' | 'CLOSE';

/** Only a fixed stage code crosses the test-runner logging boundary. */
export class NativeStorageProbeError extends Error {
  constructor(readonly step: StorageProbeStep) {
    super(`NATIVE_STORAGE_${step}_FAILED`);
    this.name = 'NativeStorageProbeError';
  }
}
