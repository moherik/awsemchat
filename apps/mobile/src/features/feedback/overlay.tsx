import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
export function FeedbackOverlay({ children, sheet }: { children: ReactNode; sheet: boolean }) {
  return <KeyboardAvoidingView pointerEvents="box-none" behavior={!sheet && Platform.OS === 'ios' ? 'padding' : undefined} style={{ position: 'absolute', inset: 0, justifyContent: 'flex-end', zIndex: 9999, elevation: 24 }}>{children}</KeyboardAvoidingView>;
}
