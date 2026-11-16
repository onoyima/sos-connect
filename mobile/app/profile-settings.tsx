import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';
import { playOnce } from '@/sound/play';
import { BackBar, Button, Icon } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

type Contact = { school_phone: string | null; whatsapp: string | null; show_whatsapp: boolean; shown_as: string | null };
type Catalog = { sounds: Record<string, string>; kinds: Record<string, { label: string; set: 'tones' | 'rings' }>; tones: Record<string, string>; rings: Record<string, string> };

/** My WhatsApp number (the school's records are never changed) and the tone for each kind of alert. */
export default function ProfileSettings() {
    const { refreshMe } = useAuth();
    const [contact, setContact] = useState<Contact | null>(null);
    const [number, setNumber] = useState('');
    const [show, setShow] = useState(true);
    const [cat, setCat] = useState<Catalog | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api<{ contact: Contact }>('/me/contact').then((r) => { setContact(r.contact); setNumber(r.contact.whatsapp ?? ''); setShow(r.contact.show_whatsapp); }).catch(() => {});
        api<Catalog>('/me/sounds').then(setCat).catch(() => {});
    }, []);

    const saveContact = async () => {
        setSaving(true);
        try {
            const r = await api<{ contact: Contact }>('/me/contact', { method: 'PATCH', body: { whatsapp: number.trim() || null, show_whatsapp: show } });
            setContact(r.contact);
            Alert.alert('Saved', r.contact.shown_as ? `Others see ${r.contact.shown_as}.` : 'Your number is hidden.');
        } catch (e) { Alert.alert('Not saved', (e as Error).message); }
        setSaving(false);
    };
    const choose = async (kind: string, set: 'tones' | 'rings', id: string) => {
        if (!cat) return;
        if (id !== 'silent') playOnce(set === 'rings' ? 'ring' : 'tone', id);
        const sounds = { ...cat.sounds, [kind]: id };
        setCat({ ...cat, sounds });
        try { await api('/me/sounds', { method: 'PUT', body: { sounds } }); refreshMe().catch(() => {}); } catch (e) { Alert.alert('Not saved', (e as Error).message); }
    };

    return (
        <View style={ui.screen}>
            <BackBar title="Profile and sounds" />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                <Text style={ui.sectionTitle}>My WhatsApp</Text>
                <View style={{ backgroundColor: '#fff', padding: 16, gap: 10 }}>
                    <Text style={{ color: colors.muted }}>People who open your profile see this number with a WhatsApp button. Your school's records aren't changed.</Text>
                    <Text style={{ color: colors.ink }}>Number from your school: <Text style={{ fontWeight: '700' }}>{contact?.school_phone ?? 'none'}</Text></Text>
                    <TextInput value={number} onChangeText={setNumber} keyboardType="phone-pad" placeholder="A different WhatsApp number (optional)"
                        style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.ink }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: colors.ink, fontSize: 15 }}>Show my number on my profile</Text>
                        <Switch value={show} onValueChange={setShow} trackColor={{ true: colors.leaf }} />
                    </View>
                    <Button title={saving ? 'Saving…' : 'Save'} onPress={saveContact} disabled={saving} />
                </View>

                <Text style={ui.sectionTitle}>Sounds</Text>
                <View style={{ backgroundColor: '#fff', paddingHorizontal: 16 }}>
                    {cat && Object.entries(cat.kinds).map(([kind, def]) => (
                        <View key={kind} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                            <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 15 }}>{def.label}</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                {Object.entries(def.set === 'rings' ? cat.rings : cat.tones).map(([id, label]) => {
                                    const on = cat.sounds[kind] === id;
                                    return (
                                        <Pressable key={id} onPress={() => choose(kind, def.set, id)} accessibilityState={{ selected: on }}
                                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: on ? colors.grove : colors.mist }}>
                                            {on ? <Icon name="checkmark" size={14} color="#fff" /> : id !== 'silent' ? <Icon name="play" size={12} color={colors.ink} /> : null}
                                            <Text style={{ color: on ? '#fff' : colors.ink, fontWeight: '600', fontSize: 13 }}>{label}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    ))}
                    <Text style={{ color: colors.muted, paddingVertical: 12 }}>SOS alarms always use the siren. Your phone's own sound settings and Do Not Disturb still apply (except to SOS).</Text>
                </View>
            </ScrollView>
        </View>
    );
}
