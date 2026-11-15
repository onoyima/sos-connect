import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { BackBar, Icon, ListRow } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

/** Help topics (written and kept up to date by the institution's admins). */
export default function HelpList() {
    const router = useRouter();
    const [pages, setPages] = useState<{ slug: string; title: string }[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { api<{ pages: { slug: string; title: string }[] }>('/help').then((r) => setPages(r.pages)).catch((e) => setError((e as Error).message)); }, []);
    return (
        <View style={ui.screen}>
            <BackBar title="Help" />
            {error ? <Text style={[ui.text, { padding: 20 }]}>Help needs internet. {error}</Text>
                : !pages ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.leaf} />
                    : <FlatList data={pages} keyExtractor={(p) => p.slug} style={{ backgroundColor: '#fff' }}
                        renderItem={({ item }) => <ListRow title={item.title} left={<Icon name="help-circle-outline" color={colors.leaf} />} right={<Icon name="chevron-forward" size={18} color={colors.line} />} onPress={() => router.push(`/help/${item.slug}`)} />} />}
        </View>
    );
}
