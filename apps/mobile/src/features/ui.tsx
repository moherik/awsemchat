import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useDemo } from "./demo-store";
import { ReactNode } from "react";
import type { TextInputProps } from 'react-native';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
export function usePalette() {
  const demo = useDemo();
  const system = useColorScheme();
  return (demo.theme === "system" ? system : demo.theme) === "dark"
    ? {
        bg: "#172027",
        surface: "#202C34",
        text: "#F2F4F3",
        muted: "#AFBDC5",
        line: "#3A4850",
        accent: "#80C3EA",
      }
    : {
        bg: "#F4F6F8",
        surface: "#FFFFFF",
        text: "#1B2731",
        muted: "#627079",
        line: "#E4E9ED",
        accent: "#066DB8",
      };
}
export function Page({
  title,
  subtitle,
  children,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  compact?: boolean;
  children: ReactNode;
}) {
  const c = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 600,
          alignSelf: "center",
          backgroundColor: c.surface,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 10,
            height: 60,
            borderBottomWidth: 1,
            borderColor: c.line,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/")
            }
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={c.text}
            />
          </Pressable>
          <Text
            style={{
              color: c.text,
              fontSize: 20,
              fontWeight: "600",
              flex: 1,
              marginLeft: 14,
            }}
          >
            {title}
          </Text>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: compact ? 18 : 22, gap: compact ? 10 : 18 }}
        >
          {subtitle && <Copy>{subtitle}</Copy>}
          {children}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
export function Copy({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  const c = usePalette();
  return (
    <Text
      style={{ color: muted ? c.muted : c.text, fontSize: 16, lineHeight: 24 }}
    >
      {children}
    </Text>
  );
}
export function Action({
  label,
  onPress,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        borderBottomWidth: primary ? 0 : StyleSheet.hairlineWidth,
        borderColor: c.line,
        backgroundColor: primary ? c.accent : c.surface,
        borderRadius: primary ? 8 : 0,
      }}
    >
      <Text
        style={{
          color: primary
            ? c.accent === "#066DB8"
              ? "#FFFFFF"
              : "#172027"
            : c.text,
          flex: 1,
          textAlign: primary ? "center" : "left",
          fontWeight: primary ? "600" : "400",
          fontSize: 16,
        }}
      >
        {label}
      </Text>
      {!primary && (
        <MaterialCommunityIcons
          name="chevron-right"
          size={21}
          color={c.muted}
        />
      )}
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChange,
  secure = false,
  keyboardType,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  maxLength?: number;
}) {
  const c = usePalette();
  return (
    <View style={{ gap: 7 }}>
      <Copy>{label}</Copy>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        maxLength={maxLength}
        style={{
          color: c.text,
          backgroundColor: c.bg,
          borderRadius: 6,
          padding: 14,
          minHeight: 48,
          fontSize: 16,
        }}
      />
    </View>
  );
}
export const rowStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
});
