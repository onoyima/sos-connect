import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';
import { pickPhoto, upload, type Picked } from '@/lib/files';
import { STATUS_COLORS, type Person } from '@/status/status';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, Button, Icon, IconButton, Pill } from '@/ui/components';
import { colors } from '@/ui/theme';

const AUDIENCES: [string, string][] = [['contacts', 'My contacts'], ['department', 'My department'], ['institution', 'Everyone']];

/** Text or photo status for 24 hours. Who can see it is the member's choice, within the institution's limit. */
export default function NewStatus() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { has } = useAuth();
    const [body, setBody] = useState('');
    const [photo, setPhoto] = useState<Picked | null>(null);
    const [color, setColor] = useState(0);
    const [audience, setAudience] = useState('contacts');
    const [busy, setBusy] = useState(false);
    const [tags, setTags] = useState<Person[]>([]);
    const [tagging, setTagging] = useState(false);
    const [q, setQ] = useState('');
    const [found, setFound] = useState<Person[]>([]);

    // Find people to tag (needs at least two letters).
    useEffect(() => {
        if (q.trim().length < 2) { setFound([]); return; }
        const t = setTimeout(() => api<{ people: Person[] }>(`/directory?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.people)).catch(() => setFound([])), 250);
        return () => clearTimeout(t);
    }, [q]);

    const post = async () => {
        if (!SyncEngine.online) { Alert.alert('Needs internet', 'Status updates need internet.'); return; }
        setBusy(true);
        try {
            const media = photo ? (await upload(photo)).path : null;
            await api('/status', { body: { body: body.trim() || null, media_path: media, audience, background: photo ? null : STATUS_COLORS[color], mentions: tags.map((t) => t.id) } });
            router.back();
        } catch (e) {
            Alert.alert('Not posted', (e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: photo ? '#000' : STATUS_COLORS[color] }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
                <IconButton name="close" label="Close" onPress={() => router.back()} />
                <View style={{ flexDirection: 'row' }}>
                    {has('file_sharing') && <IconButton name="image-outline" label="Add photo" onPress={async () => setPhoto(await pickPhoto(false))} />}
                    {has('file_sharing') && <IconButton name="camera-outline" label="Take photo" onPress={async () => setPhoto(await pickPhoto(true))} />}
                    {!photo && <IconButton name="color-palette-outline" label="Change colour" onPress={() => setColor((c) => (c + 1) % STATUS_COLORS.length)} />}
                </View>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
                {photo && <Pressable onLongPress={() => setPhoto(null)}><Image source={{ uri: photo.uri }} style={{ width: '100%', height: 360, borderRadius: 12 }} resizeMode="contain" /></Pressable>}
                <TextInput value={body} onChangeText={setBody} multiline maxLength={700} autoFocus={!photo}
                    placeholder={photo ? 'Add a caption' : 'Type a status'} placeholderTextColor="rgba(255,255,255,0.7)"
                    style={{ color: '#fff', fontSize: photo ? 16 : 26, fontWeight: photo ? '400' : '600', textAlign: 'center', marginTop: photo ? 12 : 0 }} />
            </View>
            <View style={{ backgroundColor: '#fff', padding: 16, paddingBottom: insets.bottom + 16, gap: 12, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
                <Pressable onPress={() => setTagging(!tagging)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLabel="Tag people">
                    <Icon name="person-add-outline" color={colors.leaf} size={20} />
                    <Text style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>{tags.length ? `With ${tags.map((t) => t.name).join(', ')}` : 'Tag people'}</Text>
                    <Icon name={tagging ? 'chevron-up' : 'chevron-down'} color={colors.muted} size={18} />
                </Pressable>
                {tagging && (
                    <View style={{ gap: 8 }}>
                        {tags.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                                {tags.map((t) => <Pill key={t.id} label={`${t.name}  ✕`} active onPress={() => setTags(tags.filter((x) => x.id !== t.id))} />)}
                            </View>
                        )}
                        <TextInput value={q} onChangeText={setQ} placeholder="Search for someone to tag" placeholderTextColor={colors.muted}
                            style={{ backgroundColor: colors.mist, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: colors.ink }} />
                        <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled">
                            {found.filter((p) => !tags.some((t) => t.id === p.id)).map((p) => (
                                <Pressable key={p.id} onPress={() => { setTags([...tags, p].slice(0, 20)); setQ(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
                                    <Avatar name={p.name} size={30} />
                                    <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: colors.ink }} numberOfLines={1}>{p.name}</Text>{p.title ? <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{p.title}</Text> : null}</View>
                                </Pressable>
                            ))}
                        </ScrollView>
                        <Text style={{ fontSize: 12, color: colors.muted }}>People you tag can see this update and are told about it.</Text>
                    </View>
                )}
                <Text style={{ fontWeight: '600' }}>Who can see this (for 24 hours)</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {AUDIENCES.map(([k, l]) => <Pill key={k} label={l} active={audience === k} onPress={() => setAudience(k)} />)}
                </View>
                <Button title="Share status" icon="send" onPress={post} busy={busy} disabled={!body.trim() && !photo} />
            </View>
        </KeyboardAvoidingView>
    );
}
