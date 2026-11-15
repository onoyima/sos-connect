import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { takeSignOutNotice, useAuth } from '@/auth/AuthContext';
import { config } from '@/config';
import { kvGet, kvSet } from '@/db/database';
import { Button, Icon } from '@/ui/components';
import { colors, ui } from '@/ui/theme';

/** One sign-in for everyone. No list of schools: the server works out the school from what's typed. */
export default function Login() {
    const { login } = useAuth();
    const insets = useSafeAreaInsets();
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice] = useState(takeSignOutNotice);

    useEffect(() => { kvGet<string>('last.identifier').then((v) => v && setIdentifier(v)); }, []);

    const submit = async () => {
        if (!identifier.trim() || !password) return;
        setBusy(true);
        setError(null);
        try {
            await login(identifier.trim(), password);
            await kvSet('last.identifier', identifier.trim());
        } catch (e) {
            setError((e as Error).message || 'No internet. The first sign-in needs a connection; after that the app works offline.');
        } finally {
            setBusy(false);
            setPassword('');
        }
    };

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.grove }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 48 }} keyboardShouldPersistTaps="handled">
                <View style={{ paddingHorizontal: 24, gap: 10, marginBottom: 28 }}>
                    <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.leaf, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="chatbubbles" size={32} color="#fff" />
                    </View>
                    <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800' }}>SOS Connect</Text>
                    <Text style={{ color: '#b9d6c8', fontSize: 16, lineHeight: 22 }}>Chat with your campus and call for help, with or without internet.</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, gap: 14, paddingBottom: insets.bottom + 24 }}>
                    <Text style={ui.h1}>Sign in</Text>
                    <Text style={ui.small}>Use the same details as your school portal.</Text>
                    <View>
                        <Text style={ui.label}>Matric number, or staff email or staff number</Text>
                        <TextInput style={ui.input} value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" />
                    </View>
                    <View>
                        <Text style={ui.label}>Password</Text>
                        <View style={[ui.input, { flexDirection: 'row', alignItems: 'center', paddingVertical: 0 }]}>
                            <TextInput style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: colors.ink }} value={password} onChangeText={setPassword} secureTextEntry={!show}
                                autoComplete="current-password" textContentType="password" onSubmitEditing={submit} returnKeyType="go" />
                            <Pressable onPress={() => setShow(!show)} hitSlop={10} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                                <Icon name={show ? 'eye-off-outline' : 'eye-outline'} color={colors.muted} size={20} />
                            </Pressable>
                        </View>
                    </View>
                    {notice && !error && <View style={{ backgroundColor: colors.amberBg, borderRadius: 12, padding: 12 }}><Text style={{ color: colors.ink }}>{notice}</Text></View>}
                    {error && <View style={{ backgroundColor: '#fde8ea', borderRadius: 12, padding: 12 }}><Text style={{ color: colors.sosDark }}>{error}</Text></View>}
                    <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} busy={busy} disabled={!identifier.trim() || !password} />
                    <Text style={ui.small}>Forgot your password? Reset it on your school portal. Your password is checked by your school and never stored here.</Text>
                    <Pressable onPress={() => Linking.openURL(`${config.apiUrl}/legal`)}><Text style={[ui.small, { textDecorationLine: 'underline', marginTop: 8 }]}>Privacy policy and terms</Text></Pressable>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
