import { BottomSheet } from '@expo/ui';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { SnackbarHost } from './snackbar';

export function FeedbackSheet({ children, ...props }: ComponentProps<typeof BottomSheet>) {
  return <BottomSheet {...props}><View style={{ width: '100%' }}>{children}<SnackbarHost sheet active={props.isPresented} /></View></BottomSheet>;
}
