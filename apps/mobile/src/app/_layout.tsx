import { SnackbarHost } from "@/features/feedback/snackbar";
import { Stack } from "expo-router";
import { StatusBar } from 'expo-status-bar';
import { usePalette } from '@/features/ui';
export default function Layout() {
  const colors = usePalette();
  return <><StatusBar style={colors.surface === '#FFFFFF' ? 'dark' : 'light'} /><Stack screenOptions={{ headerShown: false }} /><SnackbarHost /></>;
}
