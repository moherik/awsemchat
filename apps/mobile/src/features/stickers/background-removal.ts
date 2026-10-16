import { requireOptionalNativeModule } from 'expo';

type CutoutResult = { uri: string; width: number; height: number };
const module = requireOptionalNativeModule<{
  removeBackground(uri: string, options: { cropToSubject: boolean; maxDimension: number }): Promise<CutoutResult>;
}>('ExpoBackgroundRemoval');
export const canRemoveBackground = module !== null;
export async function removePhotoBackground(uri: string): Promise<CutoutResult> {
  if (!module) throw new Error('Background removal needs the installed mobile development build.');
  return module.removeBackground(uri, { cropToSubject: false, maxDimension: 1600 });
}
