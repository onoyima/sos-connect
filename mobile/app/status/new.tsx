import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthContext';
import { db } from '@/db/database';
import { api } from '@/lib/api';
import { pickAudio, pickPhoto, pickVideo, upload, type Picked } from '@/lib/files';
import { STATUS_COLORS, type Person } from '@/status/status';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, Button, Icon, IconButton, Pill } from '@/ui/components';
import { colors } from '@/ui/theme';

const AUDIENCES: [string, string][] = [
    ['contacts', 'People I chatted with'], ['department', 'My department'], ['faculty', 'My faculty'],
    ['groups', 'Groups I choose'], ['selected', 'People I choose'], ['institution', 'Everyone'],
];
type Kind = 'image' | 'gif' | 'video' | 'audio';
const kindOf = (p: Picked): Kind => (p.mime === 'image/gif' ? 'gif' : p.mime.startsWith('video/') ? 'video' : p.mime.startsWith('audio/') ? 'audio' : 'image');

/** A status for 24 hours: text, photo, GIF, video or audio. Who sees it is the member's choice, minus anyone hidden. */
export default function NewStatus() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { has } = useAuth();
    const [body, setBody] = useState('');
    const [media, setMedia] = useState<Picked | null>(null);
    const [color, setColor] = useState(0);
    const [audience, setAudience] = useState('contacts');
    const [busy, setBusy] = useState(false);
    const [tags, setTags] = useState<Person[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [hidden, setHidden] = useState<Person[]>([]);
    const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
    const [groupIds, setGroupIds] = useState<number[]>([]);
    const [open, setOpen] = useState<null | 'tag' | 'hide'>(null);
    const kind = media ? kindOf(media) : null;
    const dark = !!media && kind !== 'audio';

    useEffect(() => { db().then((d) => d.getAllAsync<{ id: number; name: string }>("SELECT id, name FROM conversations WHERE type != 'direct' ORDER BY name")).then(setGroups).catch(() => {}); }, []);

    const choose = () => Alert.alert('Add to your status', undefined, [
        { text: 'Photo or GIF', onPress: async () => setMedia(await pickPhoto(false)) },
        { text: 'Take a photo', onPress: async () => setMedia(await pickPhoto(true)) },
        { text: 'Video', onPress: async () => setMedia(await pickVideo(false)) },
        { text: 'Record a video', onPress: async () => setMedia(await pickVideo(true)) },
        { text: 'Audio', onPress: async () => setMedia(await pickAudio()) },
        { text: 'Cancel', style: 'cancel' },
    ]);

    const post = async () => {
        if (!SyncEngine.online) { Alert.alert('Needs internet', 'Status updates need internet.'); return; }
        if (media?.size && media.size > 50 * 1024 * 1024) { Alert.alert('Too big', 'Files can be up to 50 MB.'); return; }
        setBusy(true);
        try {
            const path = media ? (await upload(media)).path : null;
            await api('/status', { body: {
                body: body.trim() || null, media_path: path, audience, background: dark ? null : STATUS_COLORS[color], mentions: tags.map((t) => t.id),
                group_ids: audience === 'groups' ? groupIds : undefined, people: audience === 'selected' ? people.map((p) => p.id) : undefined,
                hidden: hidden.map((p) => p.id),
            } });
            router.back();
        } catch (e) {
            Alert.alert('Not posted', (e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const ready = (!!body.trim() || !!media) && (audience !== 'groups' || groupIds.length > 0) && (audience !== 'selected' || people.length > 0);

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: dark ? '#000' : STATUS_COLORS[color] }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
                <IconButton name="close" label="Close" onPress={() => router.back()} />
                <View style={{ flexDirection: 'row' }}>
                    {has('file_sharing') && <IconButton name="attach" label="Add photo, GIF, video or audio" onPress={choose} />}
                    {!dark && <IconButton name="color-palette-outline" label="Change colour" onPress={() => setColor((c) => (c + 1) % STATUS_COLORS.length)} />}
                </View>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
                {media && (
                    <Pressable onLongPress={() => setMedia(null)} accessibilityHint="Long press to remove">
                        {kind === 'video' ? <VideoPreview uri={media.uri} />
                            : kind === 'audio' ? (
                                <View style={{ alignItems: 'center', gap: 10, padding: 20 }}>
                                    <Icon name="musical-notes" size={56} color="#fff" />
                                    <Text style={{ color: '#fff', fontWeight: '600' }} numberOfLines={1}>{media.name}</Text>
                                </View>
                            ) : <Image source={{ uri: media.uri }} style={{ width: '100%', height: 340, borderRadius: 12 }} resizeMode="contain" />}
                    </Pressable>
                )}
                <TextInput value={body} onChangeText={setBody} multiline maxLength={700} autoFocus={!media}
                    placeholder={media ? 'Add a caption' : 'Type a status'} placeholderTextColor="rgba(255,255,255,0.7)"
                    style={{ color: '#fff', fontSize: media ? 16 : 26, fontWeight: media ? '400' : '600', textAlign: 'center', marginTop: media ? 12 : 0 }} />
            </View>
            <ScrollView style={{ maxHeight: '55%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
                contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 12 }} keyboardShouldPersistTaps="handled">
                <Toggle icon="person-add-outline" label={tags.length ? `With ${tags.map((t) => t.name).join(', ')}` : 'Tag people'} open={open === 'tag'} onPress={() => setOpen(open === 'tag' ? null : 'tag')} />
                {open === 'tag' && <PeopleSearch chosen={tags} onChange={(l) => setTags(l.slice(0, 20))} placeholder="Search for someone to tag" />}

                <Text style={{ fontWeight: '600' }}>Who can see this (for 24 hours)</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {AUDIENCES.map(([k, l]) => <Pill key={k} label={l} active={audience === k} onPress={() => setAudience(k)} />)}
                </View>
                {audience === 'groups' && (
                    <View style={{ gap: 4 }}>
                        {groups.length === 0 && <Text style={{ color: colors.muted }}>You're not in any groups yet.</Text>}
                        {groups.map((g) => {
                            const on = groupIds.includes(g.id);
                            return (
                                <Pressable key={g.id} onPress={() => setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
                                    <Icon name={on ? 'checkbox' : 'square-outline'} color={on ? colors.leaf : colors.muted} size={22} />
                                    <Text style={{ flex: 1, color: colors.ink }} numberOfLines={1}>{g.name}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
                {audience === 'selected' && <PeopleSearch chosen={people} onChange={setPeople} placeholder="Search for people to share with" />}

                <Toggle icon="eye-off-outline" label={hidden.length ? `Hidden from ${hidden.length} ${hidden.length === 1 ? 'person' : 'people'}` : 'Hide from…'} open={open === 'hide'} onPress={() => setOpen(open === 'hide' ? null : 'hide')} />
                {open === 'hide' && <PeopleSearch chosen={hidden} onChange={setHidden} placeholder="Search for people to hide it from" />}

                <Button title="Share status" icon="send" onPress={post} busy={busy} disabled={!ready} />
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

function VideoPreview({ uri }: { uri: string }) {
    const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
    return <VideoView player={player} style={{ width: '100%', height: 340, borderRadius: 12 }} contentFit="contain" nativeControls />;
}

function Toggle({ icon, label, open, onPress }: { icon: 'person-add-outline' | 'eye-off-outline'; label: string; open: boolean; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityRole="button">
            <Icon name={icon} color={colors.leaf} size={20} />
            <Text style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>{label}</Text>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} color={colors.muted} size={18} />
        </Pressable>
    );
}

function PeopleSearch({ chosen, onChange, placeholder }: { chosen: Person[]; onChange: (l: Person[]) => void; placeholder: string }) {
    const [q, setQ] = useState('');
    const [found, setFound] = useState<Person[]>([]);
    useEffect(() => {
        if (q.trim().length < 2) { setFound([]); return; }
        const t = setTimeout(() => api<{ people: Person[] }>(`/directory?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.people)).catch(() => setFound([])), 250);
        return () => clearTimeout(t);
    }, [q]);
    return (
        <View style={{ gap: 8 }}>
            {chosen.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {chosen.map((t) => <Pill key={t.id} label={`${t.name}  ✕`} active onPress={() => onChange(chosen.filter((x) => x.id !== t.id))} />)}
                </View>
            )}
            <TextInput value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.mist, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: colors.ink }} />
            {found.filter((p) => !chosen.some((t) => t.id === p.id)).slice(0, 8).map((p) => (
                <Pressable key={p.id} onPress={() => { onChange([...chosen, p]); setQ(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
                    <Avatar name={p.name} size={30} />
                    <Text style={{ fontWeight: '600', color: colors.ink, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                </Pressable>
            ))}
        </View>
    );
}
