import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

export function ScrollingStatus({ text, color }: { text: string; color: string }) {
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const reducedMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  useEffect(() => {
    cancelAnimation(offset);
    offset.set(0);
    const overflow = content - viewport;
    if (viewport > 0 && overflow > 1 && !reducedMotion) {
      const duration = Math.max(1800, overflow * 35);
      offset.set(withRepeat(withSequence(
        withDelay(1800, withTiming(-overflow, { duration, easing: Easing.linear })),
        withDelay(1800, withTiming(0, { duration, easing: Easing.linear })),
      ), -1));
    }
    return () => cancelAnimation(offset);
  }, [content, viewport, text, reducedMotion, offset]);

  return (
    <View style={{ overflow: 'hidden', height: 20 }} onLayout={event => setViewport(event.nativeEvent.layout.width)} accessibilityLabel={text}>
      {reducedMotion ? (
        <Text numberOfLines={1} style={{ color, fontSize: 13, lineHeight: 20 }}>{text}</Text>
      ) : (
        <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} onContentSizeChange={width => setContent(width)} style={{ flex: 1 }}>
          <Animated.View style={animatedStyle}>
            <Text numberOfLines={1} style={{ color, fontSize: 13, lineHeight: 20 }}>{text}</Text>
          </Animated.View>
        </ScrollView>
      )}
    </View>
  );
}
