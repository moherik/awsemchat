import { View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { MenuView } from '@expo/ui/community/menu';
import { usePalette } from './ui';
import type { PopupMenuProps } from './popup-menu.types';
export function PopupMenu({ label, actions, icon = 'dots-horizontal', children }: PopupMenuProps) {
  const c = usePalette();
  return <MenuView style={children ? { width: '100%' } : undefined} shouldOpenOnLongPress={!!children} actions={actions.map(action => ({ id: action.id, title: action.label, attributes: { destructive: action.destructive, disabled: action.disabled } }))} onPressAction={({ nativeEvent }) => actions.find(action => action.id === nativeEvent.event)?.onPress()}>{children ?? <View accessible accessibilityRole="button" accessibilityLabel={label} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={21} color={c.muted} /></View>}</MenuView>;
}
