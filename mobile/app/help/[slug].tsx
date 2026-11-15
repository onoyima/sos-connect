import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '@/lib/api';
import { BackBar } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

const CSS = `body{font-family:-apple-system,Roboto,sans-serif;color:${colors.ink};font-size:16px;line-height:1.6;padding:4px 18px 40px;margin:0;overflow-wrap:anywhere}
h1,h2{color:${colors.grove}}h2{font-size:20px;margin-top:26px}h3{font-size:17px}a{color:${colors.leaf}}code{background:${colors.mist};padding:1px 5px;border-radius:5px}
table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}th,td{border:1px solid ${colors.line};padding:6px 8px;text-align:left}th{background:${colors.mist}}`;

/** One help page. The HTML comes from the server (made safe there), shown in a web view. */
export default function HelpPage() {
    const { slug } = useLocalSearchParams<{ slug: string }>();
    const [page, setPage] = useState<{ title: string; html: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { api<{ title: string; html: string }>(`/help/${slug}`).then(setPage).catch((e) => setError((e as Error).message)); }, [slug]);
    return (
        <View style={ui.screen}>
            <BackBar title={page?.title ?? 'Help'} />
            {error ? <Text style={[ui.text, { padding: 20 }]}>{error}</Text>
                : !page ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.leaf} />
                    : <WebView originWhitelist={['*']} source={{ html: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style><h1>${page.title.replace(/</g, '&lt;')}</h1>${page.html}` }}
                        onShouldStartLoadWithRequest={(r) => { if (r.url.startsWith('http')) { Linking.openURL(r.url); return false; } return true; }} style={{ flex: 1 }} />}
        </View>
    );
}
