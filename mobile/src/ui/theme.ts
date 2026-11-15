import { StyleSheet } from 'react-native';

/** Same palette as the web app: green campus colours, one loud red kept for SOS. */
export const colors = {
    grove: '#0e3b2e', grove2: '#164d3c', leaf: '#1e7b57', leafDark: '#17654a',
    mist: '#edf2ee', mint: '#d5eedf', chatBg: '#e9efe9',
    ink: '#1b2a24', muted: '#5c6f66', line: '#dde5e0', card: '#ffffff', bg: '#f6f8f6',
    sos: '#d62839', sosDark: '#a81d2c', amber: '#e8a33d', amberBg: '#fdf3e2',
    ok: '#1e7b57', warn: '#8a5a12',
};

export const ui = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    pad: { padding: 16, gap: 12 },
    card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 8 },
    h1: { fontSize: 26, fontWeight: '700', color: colors.ink },
    h2: { fontSize: 17, fontWeight: '700', color: colors.ink },
    text: { fontSize: 15, color: colors.ink, lineHeight: 21 },
    small: { fontSize: 13, color: colors.muted, lineHeight: 18 },
    label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 6 },
    input: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: '#fff', color: colors.ink },
    btn: { backgroundColor: colors.leaf, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    btnOutline: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', flexDirection: 'row', gap: 6 },
    btnOutlineText: { color: colors.ink, fontWeight: '600', fontSize: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
});
