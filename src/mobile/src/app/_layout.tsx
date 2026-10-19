import { SnackbarHost } from "@/features/feedback/snackbar";
import { Stack } from "expo-router";
export default function Layout() {
  return <><Stack screenOptions={{ headerShown: false }} /><SnackbarHost /></>;
}
