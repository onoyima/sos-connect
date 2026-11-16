import { useAuth } from '@/auth/AuthContext';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { useCalls, type GroupRemote } from '@/calls/CallContext';
import { startRing, stopRing } from '@/calls/ring';
import { Avatar, Icon, type IconName } from './components';
import { colors } from './theme';

function Round({ icon, color, label, onPress, active }: { icon: IconName; color?: string; label: string; onPress: () => void; active?: boolean }) {
    return (
        <View style={{ alignItems: 'center', gap: 6, width: 72 }}>
            <Pressable onPress={onPress} accessibilityLabel={label} accessibilityState={{ selected: !!active }}
                style={({ pressed }) => ({ width: 62, height: 62, borderRadius: 31, backgroundColor: color ?? (active ? '#fff' : 'rgba(255,255,255,0.18)'), alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
                <Icon name={icon} size={27} color={active && !color ? colors.grove : '#fff'} />
            </Pressable>
            <Text style={{ color: '#d7e6de', fontSize: 12 }} numberOfLines={1}>{label}</Text>
        </View>
    );
}

function useClock(since: number | null) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!since) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [since]);
    if (!since) return '';
    const s = Math.max(0, Math.floor((now - since) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CallOverlay() {
    const c = useCalls();
    const { me } = useAuth();
    // Ring (and vibrate) while a call is coming in; ringback while calling; stop as soon as it's answered or over.
    const ringing = c.ring && !c.group ? 'incoming' : c.phase === 'ringing-in' ? 'incoming' : c.phase === 'ringing-out' ? 'outgoing' : null;
    const tone = c.ring && !c.group ? me?.sounds?.group_call : me?.sounds?.call; // the ringtone they chose
    useEffect(() => {
        if (ringing) startRing(ringing, tone);
        else stopRing();
        return () => stopRing();
    }, [ringing]);
    if (c.group) return <GroupCallScreen />;
    if (c.ring) return <GroupRingBanner />;
    if (c.phase === 'idle' || !c.call) return null;
    return <DirectCallScreen />;
}

function DirectCallScreen() {
    const { phase, call, local, remote, muted, cameraOff, peerCameraOff, connectedAt, accept, hangUp, toggleMute, toggleCamera, switchCamera } = useCalls();
    const insets = useSafeAreaInsets();
    const time = useClock(connectedAt);
    if (!call) return null;
    const video = call.type === 'video';
    const showRemote = video && remote && !peerCameraOff;
    const label = phase === 'ringing-in' ? `Incoming ${call.type} call` : phase === 'ringing-out' ? 'Ringing…' : phase === 'connecting' ? 'Connecting…' : time;

    return (
        <Modal visible animationType="slide" onRequestClose={() => {}}>
            <View style={s.wrap}>
                {showRemote && <RTCView streamURL={remote.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />}
                {video && local && !cameraOff && <RTCView streamURL={local.toURL()} style={[s.pip, { top: insets.top + 16 }]} objectFit="cover" mirror zOrder={1} />}
                <View style={{ alignItems: 'center', marginTop: showRemote ? 0 : -80 }}>
                    {!showRemote && <PulsingAvatar name={call.peer.name} ringing={phase === 'ringing-in' || phase === 'ringing-out'} />}
                    <Text style={[s.name, showRemote && s.shadow]} numberOfLines={1}>{call.peer.name}</Text>
                    <Text style={[s.status, showRemote && s.shadow]}>
                        {label}{video && phase === 'connected' && peerCameraOff ? ' · camera off' : ''}{call.via === 'lan' ? ' · over campus Wi-Fi, no internet' : ''}
                    </Text>
                </View>
                <View style={[s.controls, { bottom: insets.bottom + 36 }]}>
                    {phase === 'ringing-in' ? (
                        <>
                            <Round icon="close" color={colors.sos} label="Decline" onPress={hangUp} />
                            <Round icon={video ? 'videocam' : 'call'} color={colors.leaf} label="Answer" onPress={accept} />
                        </>
                    ) : (
                        <>
                            <Round icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} active={muted} onPress={toggleMute} />
                            {video && <Round icon={cameraOff ? 'videocam-off' : 'videocam'} label={cameraOff ? 'Camera on' : 'Camera off'} active={cameraOff} onPress={toggleCamera} />}
                            {video && !cameraOff && <Round icon="camera-reverse" label="Flip" onPress={switchCamera} />}
                            <Round icon="call" color={colors.sos} label="End" onPress={hangUp} />
                        </>
                    )}
                </View>
            </View>
        </Modal>
    );
}

/** The caller's picture with rings spreading out while it rings. */
function PulsingAvatar({ name, ringing }: { name: string; ringing: boolean }) {
    const scale = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!ringing) return;
        const loop = Animated.loop(Animated.timing(scale, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [ringing]);
    return (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            {ringing && (
                <Animated.View style={{ position: 'absolute', width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(143,211,180,0.45)',
                    transform: [{ scale: scale.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }], opacity: scale.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }) }} />
            )}
            <Avatar name={name} size={112} />
        </View>
    );
}

function GroupCallScreen() {
    const { group, remotes, local, muted, cameraOff, toggleMute, toggleCamera, switchCamera, leaveGroup } = useCalls();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const time = useClock(group ? new Date(group.startedAt).getTime() : null);
    if (!group) return null;
    const video = group.type === 'video';
    const count = remotes.length + 1;
    const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
    const tile = (width - 12 - (cols - 1) * 6) / cols;

    return (
        <Modal visible animationType="slide" onRequestClose={() => Alert.alert('Leave the call?', undefined, [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: leaveGroup }])}>
            <View style={{ flex: 1, backgroundColor: '#0b2a21', paddingTop: insets.top + 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 }}>
                    <Icon name="people" color="rgba(255,255,255,0.7)" size={20} />
                    <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }} numberOfLines={1}>{group.name ?? 'Group call'}</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>{time} · {count} {count === 1 ? 'person, waiting for others' : 'people'}</Text>
                    </View>
                </View>
                <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 6 }}>
                    <Tile size={tile} name="You" muted={muted}>
                        {video && local && !cameraOff ? <RTCView streamURL={local.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror /> : null}
                    </Tile>
                    {remotes.map((r) => <RemoteTile key={r.id} r={r} size={tile} video={video} />)}
                </ScrollView>
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 12, paddingBottom: insets.bottom + 20 }}>
                    <Round icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} active={muted} onPress={toggleMute} />
                    {video && <Round icon={cameraOff ? 'videocam-off' : 'videocam'} label={cameraOff ? 'Camera on' : 'Camera off'} active={cameraOff} onPress={toggleCamera} />}
                    {video && !cameraOff && <Round icon="camera-reverse" label="Flip" onPress={switchCamera} />}
                    <Round icon="call" color={colors.sos} label="Leave" onPress={leaveGroup} />
                </View>
            </View>
        </Modal>
    );
}

function Tile({ size, name, muted, state, children }: { size: number; name: string; muted?: boolean; state?: string; children?: React.ReactNode }) {
    return (
        <View style={{ width: size, height: size * 1.25, borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' }}>
            {children ?? <Avatar name={name === 'You' ? 'Y' : name} size={Math.min(72, size * 0.45)} />}
            <View style={{ position: 'absolute', left: 8, bottom: 8, right: 8, flexDirection: 'row' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, maxWidth: '100%' }}>
                    {muted ? <Icon name="mic-off" size={12} color="#fff" /> : null}
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{name}{state && state !== 'connected' ? ' · connecting' : ''}</Text>
                </View>
            </View>
        </View>
    );
}

function RemoteTile({ r, size, video }: { r: GroupRemote; size: number; video: boolean }) {
    // Voice-only calls still need an RTCView-less stream; react-native-webrtc plays remote audio by itself.
    const show = video && r.stream && r.camera !== false;
    return (
        <Tile size={size} name={r.name} muted={r.muted} state={r.state}>
            {show ? <RTCView streamURL={r.stream!.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" /> : null}
        </Tile>
    );
}

function GroupRingBanner() {
    const { ring, joinGroup, dismissRing } = useCalls();
    const insets = useSafeAreaInsets();
    if (!ring) return null;
    return (
        <Modal visible transparent animationType="fade" onRequestClose={dismissRing}>
            <View style={{ flex: 1, justifyContent: 'flex-end', padding: 12, paddingBottom: insets.bottom + 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.grove, borderRadius: 22, padding: 14, elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12 }}>
                    <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="people" color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '700' }} numberOfLines={1}>{ring.conversation_name ?? 'Group'}</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }} numberOfLines={1}>{ring.caller.name} started a {ring.type} call</Text>
                    </View>
                    <Pressable onPress={dismissRing} accessibilityLabel="Ignore" style={s.small}><Icon name="close" color="#fff" /></Pressable>
                    <Pressable onPress={() => joinGroup(ring.call_uuid).catch((e) => Alert.alert('Call', (e as Error).message))} accessibilityLabel="Join call"
                        style={[s.small, { backgroundColor: colors.leaf }]}><Icon name={ring.type === 'video' ? 'videocam' : 'call'} color="#fff" /></Pressable>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.grove, alignItems: 'center', justifyContent: 'center', gap: 10 },
    pip: { position: 'absolute', right: 16, width: 104, height: 150, borderRadius: 14, overflow: 'hidden' },
    name: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 12, paddingHorizontal: 24 },
    status: { color: '#b9d6c8', fontSize: 15, marginTop: 4, textAlign: 'center', paddingHorizontal: 24 },
    shadow: { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
    controls: { position: 'absolute', flexDirection: 'row', justifyContent: 'center', gap: 8, left: 0, right: 0 },
    small: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
