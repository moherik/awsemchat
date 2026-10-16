export async function nativePrivateProfilePhotoStorage(_fingerprint: string): Promise<never> {
  throw new Error('NATIVE_REQUIRED');
}
export async function nativePrivateProfilePublicationStorage(_fingerprint: string, _peerId: string, _requestId: string): Promise<never> {
  throw new Error('NATIVE_REQUIRED');
}
