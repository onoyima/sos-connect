import { useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';
import { BackBar, Button } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

/**
 * Face capture inside the app. The guided steps (blink, turn, look up and down, open mouth) run in the same
 * capture page as the website, opened here with a short-lived ticket so it needs no separate sign-in.
 */
export default function FaceCapture() {
    const router = useRouter();
    const { refreshMe } = useAuth();
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [permission, requestPermission] = useCameraPermissions();

    useEffect(() => {
        (async () => {
            try {
                const p = permission?.granted ? permission : await requestPermission();
                if (!p.granted) { setError('Allow the camera so your face can be captured.'); return; }
                const r = await api<{ url: string }>('/face/ticket', { method: 'POST' });
                setUrl(r.url);
            } catch (e) { setError((e as Error).message); }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => () => { Speech.stop(); }, []);

    if (error || !url) {
        return (
            <View style={ui.screen}>
                <BackBar title="Face capture" />
                <View style={{ padding: 24, gap: 16, alignItems: 'center' }}>
                    {error ? <><Text style={[ui.text, { textAlign: 'center' }]}>{error}</Text><Button title="Go back" variant="outline" onPress={() => router.back()} /></>
                        : <ActivityIndicator color={colors.leaf} size="large" />}
                </View>
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: '#071f18' }}>
            <WebView
                source={{ uri: url }}
                style={{ flex: 1, backgroundColor: '#071f18' }}
                originWhitelist={['*']}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                mediaCapturePermissionGrantType="grant"
                onMessage={(e) => {
                    const m = e.nativeEvent.data;
                    // The spoken guide ("Turn your head to the left" … "Good."): the phone's own voice, which works on
                    // every phone (Android's built-in browser has none).
                    if (m.startsWith('face:say:')) {
                        try {
                            const { t, q } = JSON.parse(m.slice(9)) as { t: string; q: boolean };
                            if (!q) Speech.stop();
                            Speech.speak(t, { language: 'en', rate: 0.95 });
                        } catch { /* ignore */ }
                        return;
                    }
                    if (m === 'face:hush') { Speech.stop(); return; }
                    if (m === 'face:done') refreshMe().catch(() => {});
                    if (m === 'face:close') router.back();
                }}
                onError={() => Alert.alert('Could not open face capture', 'Check your internet connection and try again.')}
            />
        </View>
    );
}
