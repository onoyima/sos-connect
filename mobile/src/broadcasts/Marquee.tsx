import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hideMarquees, useMarquees } from './store';

const BG = { info: '#0b3226', urgent: '#c81f33', celebration: '#7a3fd1' } as const;

/** A thin line of messages from the institution, sliding under the top bar. Never blocks anything; tap X to hide. */
export function MarqueeStrip() {
    const items = useMarquees();
    const x = useRef(new Animated.Value(0)).current;
    const [boxW, setBoxW] = useState(0);
    const [textW, setTextW] = useState(0);
    const text = items.map((m) => (m.title ? `${m.title}: ${m.body}` : m.body)).join('     •     ');

    useEffect(() => {
        if (!boxW || !textW) return;
        x.setValue(boxW);
        const loop = Animated.loop(Animated.timing(x, { toValue: -textW, duration: ((boxW + textW) / 45) * 1000, easing: Easing.linear, useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [boxW, textW, text, x]);

    if (!items.length) return null;
    const link = items.find((m) => m.link_url)?.link_url;
    return (
        <View style={{ height: 28, backgroundColor: BG[items[0].style], flexDirection: 'row', alignItems: 'center' }} accessibilityRole="text" accessibilityLabel={`Message from your institution: ${text}`}>
            <View style={{ paddingHorizontal: 8 }}><Ionicons name="megaphone-outline" size={15} color="#fff" /></View>
            <Pressable style={{ flex: 1, overflow: 'hidden', height: 28, justifyContent: 'center' }} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
                onPress={() => { if (link) (link.startsWith('/') ? router.push(link as never) : Linking.openURL(link)); }}>
                <Animated.Text numberOfLines={1} onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
                    style={{ position: 'absolute', color: '#fff', fontSize: 13.5, fontWeight: '600', transform: [{ translateX: x }], width: Math.max(2000, text.length * 9) }}>
                    {text}
                </Animated.Text>
            </Pressable>
            <Pressable onPress={hideMarquees} hitSlop={8} accessibilityLabel="Hide these messages" style={{ paddingHorizontal: 8 }}><Text style={{ color: '#fff', fontSize: 16 }}>✕</Text></Pressable>
        </View>
    );
}
