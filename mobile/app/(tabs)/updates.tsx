import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { db } from '@/db/database';
import { on } from '@/lib/events';
import { chatTime } from '@/lib/format';
import { MeshManager } from '@/mesh/MeshManager';
import { T } from '@/mesh/protocol';
import { fetchStatuses, type StatusGroup } from '@/status/status';
import { StatusThumb } from '@/status/StatusThumb';
import { SyncEngine } from '@/sync/SyncEngine';
import { Avatar, EmptyState, Icon, IconButton, TopBar } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Check = { uuid: string; json: string; answered: string | null };
type Ann = { id: number; json: string; published_at: string };

function Ring({ g, onPress, label }: { g: StatusGroup | null; onPress: () => void; label: string }) {
    return (
        <Pressable onPress={onPress} style={{ alignItems: 'center', width: 74, gap: 4 }}>
            <View style={{ padding: 2.5, borderRadius: 34, borderWidth: 2.5, borderColor: g ? (g.unseen ? colors.leaf : colors.line) : 'transparent' }}>
                {g?.items.length ? <StatusThumb s={g.items[g.items.length - 1]} /> : <Avatar name={g?.name ?? label} size={56} />}
            </View>
            <Text style={{ fontSize: 12, color: colors.ink }} numberOfLines={1}>{label}</Text>
        </Pressable>
    );
}

/** Status updates, "Are you safe?" checks and notices. Posting notices is done on the website. */
export default function Updates() {
    const router = useRouter();
    const { me, has, can } = useAuth();
    const [checks, setChecks] = useState<Check[]>([]);
    const [anns, setAnns] = useState<Ann[]>([]);
    const [mine, setMine] = useState<StatusGroup | null>(null);
    const [others, setOthers] = useState<StatusGroup[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        const d = await db();
        setChecks(await d.getAllAsync<Check>('SELECT * FROM safety_checks ORDER BY rowid DESC LIMIT 20'));
        setAnns(await d.getAllAsync<Ann>('SELECT * FROM announcements ORDER BY published_at DESC LIMIT 50'));
        if (me && has('status') && SyncEngine.online) {
            fetchStatuses(me.id).then((r) => { setMine(r.mine); setOthers(r.others); }).catch(() => {});
        }
    }, [me, has]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => { const a = on('safety', load); const b = on('announcements', load); const c = on('statusActivity', load); return () => { a(); b(); c(); }; }, [load]);

    /** Works offline too: saved for the server and sent over the mesh so responders nearby see it. */
    const answer = async (c: Check, a: 'safe' | 'need_help') => {
        const d = await db();
        const payload = { check_uuid: c.uuid, answer: a, note: null };
        await d.runAsync('UPDATE safety_checks SET answered = ? WHERE uuid = ?', a, c.uuid);
        await d.runAsync('INSERT OR REPLACE INTO outbox (client_id, kind, payload, created_at) VALUES (?, ?, ?, ?)', c.uuid, 'safety', JSON.stringify(payload), Date.now());
        if (me?.institution) await MeshManager.publish(T.SAFETY_RESPONSE, `i:${me.institution.id}`, payload).catch(() => null);
        SyncEngine.run();
        load();
        if (a === 'need_help') Alert.alert('Noted', 'Responders can see your answer. Press SOS if you need help right now.', [{ text: 'OK' }, { text: 'Open SOS', onPress: () => router.push('/sos') }]);
    };

    const open = checks.filter((c) => !c.answered);
    const status = has('status') && me?.member_type !== 'parent';

    return (
        <View style={ui.screen}>
            <TopBar title="Updates" subtitle={me?.institution?.name}
                right={status && can('status.post') ? <IconButton name="add-circle-outline" label="New status" onPress={() => router.push('/status/new')} /> : null} />
            <ScrollView refreshControl={<RefreshControl colors={[colors.leaf]} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await SyncEngine.run(); await load(); setRefreshing(false); }} />}>
                {status && (
                    <View style={{ backgroundColor: '#fff', paddingVertical: 12 }}>
                        <Text style={[ui.h2, { paddingHorizontal: 16, marginBottom: 10 }]}>Status</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, gap: 4 }}>
                            <Pressable onPress={() => (mine ? router.push(`/status/${me!.id}`) : can('status.post') && router.push('/status/new'))} style={{ alignItems: 'center', width: 74, gap: 4 }}>
                                <View>
                                    <View style={{ padding: 2.5, borderRadius: 34, borderWidth: 2.5, borderColor: mine ? colors.line : 'transparent' }}>{mine?.items.length ? <StatusThumb s={mine.items[mine.items.length - 1]} /> : <Avatar name={me?.name ?? 'Me'} size={56} />}</View>
                                    {!mine && can('status.post') && <View style={{ position: 'absolute', right: 0, bottom: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.leaf, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Icon name="add" size={14} color="#fff" /></View>}
                                </View>
                                <Text style={{ fontSize: 12, color: colors.ink }}>My status</Text>
                            </Pressable>
                            {others.map((g) => <Ring key={g.userId} g={g} label={g.name.split(' ')[0]} onPress={() => router.push(`/status/${g.userId}`)} />)}
                        </ScrollView>
                        {others.length === 0 && <Text style={[ui.small, { paddingHorizontal: 16, paddingTop: 6 }]}>{SyncEngine.online ? 'No status updates from people you know yet.' : 'Status needs internet.'}</Text>}
                    </View>
                )}

                {has('safety_checks') && checks.length > 0 && (
                    <View style={{ marginTop: 10 }}>
                        <Text style={ui.sectionTitle}>Safety checks{open.length ? ` · ${open.length} waiting for you` : ''}</Text>
                        {checks.map((c) => {
                            const j = JSON.parse(c.json);
                            return (
                                <View key={c.uuid} style={[ui.card, { marginHorizontal: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: c.answered ? colors.line : colors.sos }]}>
                                    <View style={ui.row}><Icon name="shield-checkmark" color={colors.sos} /><Text style={[ui.h2, { flex: 1 }]}>{j.title}</Text></View>
                                    {j.message ? <Text style={ui.text}>{j.message}</Text> : null}
                                    <View style={[ui.row, { marginTop: 4 }]}>
                                        <Pressable onPress={() => answer(c, 'safe')} style={[ui.btnOutline, { flex: 1 }, c.answered === 'safe' && { backgroundColor: colors.mint, borderColor: colors.leaf }]}>
                                            <Icon name="checkmark-circle" size={18} color={colors.leaf} /><Text style={ui.btnOutlineText}>I'm safe</Text>
                                        </Pressable>
                                        <Pressable onPress={() => answer(c, 'need_help')} style={[ui.btnOutline, { flex: 1 }, c.answered === 'need_help' && { backgroundColor: '#fde8ea', borderColor: colors.sos }]}>
                                            <Icon name="alert-circle" size={18} color={colors.sos} /><Text style={ui.btnOutlineText}>I need help</Text>
                                        </Pressable>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}

                {has('announcements') && (
                    <View style={{ marginTop: 10, paddingBottom: 24 }}>
                        <Text style={ui.sectionTitle}>Notices</Text>
                        {anns.length === 0 && <EmptyState icon="megaphone-outline" title="No notices yet">Official notices from your institution, faculty and department appear here, even offline.</EmptyState>}
                        {anns.map((a) => {
                            const j = JSON.parse(a.json);
                            const urgent = j.priority === 'urgent';
                            return (
                                <View key={a.id} style={[ui.card, { marginHorizontal: 12, marginBottom: 10 }, urgent && { borderLeftWidth: 4, borderLeftColor: colors.sos }]}>
                                    <View style={ui.row}>
                                        <Avatar name={j.author?.name ?? 'Notice'} size={36} icon="megaphone" />
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ fontWeight: '700', color: colors.ink }} numberOfLines={1}>{j.author?.name ?? 'Notice'}</Text>
                                            <Text style={ui.small} numberOfLines={1}>{[j.author?.role ?? j.author?.title, j.audience_label, chatTime(a.published_at)].filter(Boolean).join(' · ')}</Text>
                                        </View>
                                        {urgent && <Text style={{ color: colors.sos, fontWeight: '800', fontSize: 12 }}>URGENT</Text>}
                                    </View>
                                    <Text style={ui.h2}>{j.title}</Text>
                                    <Text style={ui.text}>{j.body}</Text>
                                </View>
                            );
                        })}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}
