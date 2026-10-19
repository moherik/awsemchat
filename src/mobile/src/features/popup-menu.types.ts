import type { ReactNode } from "react";
import type Icon from '@expo/vector-icons/MaterialCommunityIcons';
export type PopupAction = { id: string; label: string; icon?: keyof typeof Icon.glyphMap; onPress: () => void; destructive?: boolean; disabled?: boolean };
export type PopupMenuProps = { label: string; actions: PopupAction[]; icon?: keyof typeof Icon.glyphMap; children?: ReactNode };
