import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { CallProvider } from '@/calls/CallContext';
import { CallOverlay } from '@/ui/CallOverlay';
import { BroadcastPopup } from '@/broadcasts/Popup';
import { Button, Icon } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

/** Opening screen, like WhatsApp's: brand mark in the middle, a quiet line at the bottom. */
function Splash() {
    const fade = useRef(new Animated.Value(0)).current;
    const bar = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
        const loop = Animated.loop(Animated.timing(bar, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [fade, bar]);
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
            <StatusBar style="dark" />
            <Animated.View style={{ opacity: fade, alignItems: 'center' }}>
                <View style={{ width: 84, height: 84, borderRadius: 26, backgroundColor: colors.grove, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="chatbubbles" size={42} color="#fff" />
                    <View style={{ position: 'absolute', top: 12, right: 12, width: 13, height: 13, borderRadius: 7, backgroundColor: colors.sos, borderWidth: 2, borderColor: colors.grove }} />
                </View>
                <View style={{ marginTop: 26, width: 160, height: 3, borderRadius: 3, backgroundColor: colors.mist, overflow: 'hidden' }}>
                    <Animated.View style={{ width: 64, height: 3, borderRadius: 3, backgroundColor: colors.leaf, transform: [{ translateX: bar.interpolate({ inputRange: [0, 1], outputRange: [-64, 160] }) }] }} />
                </View>
            </Animated.View>
            <View style={{ position: 'absolute', bottom: 48, alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>from your institution</Text>
                <Text style={{ color: colors.grove, fontWeight: '800', fontSize: 17, letterSpacing: 1, marginTop: 2 }}>SOS Connect</Text>
            </View>
        </View>
    );
}

function Gate() {
    const { status, me } = useAuth();
    const segments = useSegments();
    const router = useRouter();

    // Tapping a notification opens the chat or the SOS screen it's about.
    useEffect(() => {
        if (status !== 'ready') return;
        const open = (data: Record<string, unknown> | undefined) => {
            if ((data?.type === 'message' || data?.type === 'group_call') && data.conversation_id) router.push(`/chat/${data.conversation_id}`);
            else if (data?.type === 'sos') router.push('/sos');
            else if (data?.type === 'status' && data.user_id) router.push(`/status/${data.user_id}`);
            else if (data?.type === 'call' || data?.type === 'call_missed' || data?.type === 'chat_request') router.push('/(tabs)');
        };
        Notifications.getLastNotificationResponseAsync().then((r) => r && open(r.notification.request.content.data));
        const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
        return () => sub.remove();
    }, [status]);

    useEffect(() => {
        if (status === 'loading') return;
        const inAuth = segments[0] === 'login';
        const inPolicies = segments[0] === 'policies';
        if (status === 'signedOut' && !inAuth) router.replace('/login');
        else if (status === 'ready' && me?.needs_policy_acceptance && !inPolicies) router.replace('/policies');
        else if (status === 'ready' && !me?.needs_policy_acceptance && (inAuth || inPolicies)) router.replace('/');
    }, [status, me?.needs_policy_acceptance, segments]);

    if (status === 'loading') {
        return <Splash />;
    }

    return (
        <>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="login" />
                <Stack.Screen name="policies" />
                <Stack.Screen name="status/[userId]" options={{ animation: 'fade' }} />
                <Stack.Screen name="status/new" options={{ presentation: 'modal' }} />
                <Stack.Screen name="face-capture" options={{ animation: 'slide_from_bottom' }} />
            </Stack>
            <CallOverlay />
            <BroadcastPopup ready={status === 'ready' && !me?.needs_policy_acceptance} />
        </>
    );
}

export default function RootLayout() {
    return (
        <AuthProvider>
            <CallProvider>
                <StatusBar style="light" />
                <Gate />
            </CallProvider>
        </AuthProvider>
    );
}

/** If a screen crashes, show a way out instead of a blank or frozen screen. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
    const router = useRouter();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14, backgroundColor: colors.bg }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="alert-circle-outline" size={32} color={colors.leaf} />
            </View>
            <Text style={[ui.h2, { textAlign: 'center' }]}>Something went wrong on this screen</Text>
            <Text style={[ui.small, { textAlign: 'center' }]}>{__DEV__ ? error.message : 'Please try again. SOS still works from the SOS tab.'}</Text>
            <Button title="Try again" icon="refresh" onPress={retry} />
            <Button title="Go to chats" variant="outline" icon="home-outline" onPress={() => router.replace('/')} />
        </View>
    );
}
