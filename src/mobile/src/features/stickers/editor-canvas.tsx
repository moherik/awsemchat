/* eslint-disable react-hooks/refs -- PanResponder stores these handlers; refs are read only when a gesture fires, never during render. */
import { useRef, useEffect, useMemo } from 'react';
import { PanResponder, Platform, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { StickerTextBox } from './model';

export type CropRect = { x: number; y: number; width: number; height: number };
const touchStyle = Platform.OS === 'web' ? { touchAction: 'none' } as const : {};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function DraggableText({ box, size, selected, onSelect, onChange }: { box: StickerTextBox; size: number; selected: boolean; onSelect: () => void; onChange: (box: StickerTextBox) => void }) {
  const current = useRef(box); useEffect(() => { current.current = box; }, [box]);
  const start = useRef(box); const callbacks = useRef({ onSelect, onChange }); useEffect(() => { callbacks.current = { onSelect, onChange }; }, [onSelect, onChange]);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = current.current; callbacks.current.onSelect(); },
    onPanResponderMove: (_, gesture) => callbacks.current.onChange({ ...start.current, x: clamp(start.current.x + gesture.dx / size, 0, .3), y: clamp(start.current.y + gesture.dy / size, 0, Math.max(0, 1 - (start.current.size * 2.3 + 10) / 280)) }),
  }), [size]);
  return <View {...pan.panHandlers} accessible accessibilityRole="button" accessibilityLabel={`Move text: ${box.text || 'Empty text'}`} style={{ position: 'absolute', left: box.x * size, top: box.y * size, width: size * .7, minHeight: 44, borderWidth: 1, borderStyle: 'dashed', borderColor: selected ? '#066DB8' : 'transparent', padding: 4 * size / 280, ...touchStyle }}><Text numberOfLines={2} style={{ textAlign: 'center', color: box.color, fontSize: box.size * size / 280, lineHeight: box.size * 1.15 * size / 280, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } }}>{box.text || 'Your text'}</Text></View>;
}
function CropHandle({ corner, rect, width, height, onChange }: { corner: string; rect: CropRect; width: number; height: number; onChange: (rect: CropRect) => void }) {
  const current = useRef(rect); useEffect(() => { current.current = rect; }, [rect]); const start = useRef(rect); const change = useRef(onChange); useEffect(() => { change.current = onChange; }, [onChange]);
  const pan = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderGrant: () => { start.current = current.current; }, onPanResponderMove: (_, g) => {
    const minWidth = Math.min(40, width); const minHeight = Math.min(40, height); const r = start.current; const left = corner.includes('w'); const top = corner.includes('n');
    const x = left ? clamp(r.x + g.dx, 0, r.x + r.width - minWidth) : r.x;
    const y = top ? clamp(r.y + g.dy, 0, r.y + r.height - minHeight) : r.y;
    change.current({ x, y, width: left ? r.x + r.width - x : clamp(r.width + g.dx, minWidth, width - r.x), height: top ? r.y + r.height - y : clamp(r.height + g.dy, minHeight, height - r.y) });
  } }), [corner, width, height]);
  return <View {...pan.panHandlers} accessible accessibilityLabel={`Resize crop ${corner}`} style={{ position: 'absolute', width: 44, height: 44, left: corner.includes('w') ? -22 : rect.width - 22, top: corner.includes('n') ? -22 : rect.height - 22, alignItems: 'center', justifyContent: 'center', ...touchStyle }}><View style={{ width: 14, height: 14, borderWidth: 2, borderColor: '#fff', backgroundColor: '#066DB8', borderRadius: 2 }} /></View>;
}
export function CropCanvas({ uri, width, height, rect, onChange }: { uri: string; width: number; height: number; rect: CropRect; onChange: (rect: CropRect) => void }) {
  const current = useRef(rect); useEffect(() => { current.current = rect; }, [rect]); const start = useRef(rect); const change = useRef(onChange); useEffect(() => { change.current = onChange; }, [onChange]);
  const pan = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderGrant: () => { start.current = current.current; }, onPanResponderMove: (_, g) => change.current({ ...start.current, x: clamp(start.current.x + g.dx, 0, width - start.current.width), y: clamp(start.current.y + g.dy, 0, height - start.current.height) }) }), [width, height]);
  return <View style={{ width, height, ...touchStyle }}><Image source={{ uri }} contentFit="fill" style={{ width, height }} /><View pointerEvents="none" style={{ position: 'absolute', inset: 0, backgroundColor: '#00000065' }} /><View {...pan.panHandlers} accessible accessibilityLabel="Move crop selection" style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderWidth: 2, borderColor: '#fff', ...touchStyle, overflow: 'visible' }}><View pointerEvents="none" style={{ overflow: 'hidden', width: rect.width - 4, height: rect.height - 4 }}><Image source={{ uri }} contentFit="fill" style={{ width, height, left: -rect.x - 2, top: -rect.y - 2 }} /></View>{['nw','ne','sw','se'].map(corner => <CropHandle key={corner} corner={corner} rect={rect} width={width} height={height} onChange={onChange} />)}</View></View>;
}
