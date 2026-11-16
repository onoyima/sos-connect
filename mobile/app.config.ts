import { existsSync } from 'node:fs';
import type { ExpoConfig } from 'expo/config';
// Plain .js: Expo only converts this file itself, not TypeScript files it imports.
const { ensureSiren } = require('./scripts/siren.js');
const { ensureTones, toneFiles } = require('./scripts/tones.js');

// The SOS alarm and the tones people choose are generated here (not stored), so they are always intact.
ensureSiren();
ensureTones();

// Push notifications on Android need Firebase: put google-services.json next to this file (see README).
const firebase = existsSync('./google-services.json') ? { googleServicesFile: './google-services.json' } : {};

const config: ExpoConfig = {
    name: 'SOS Connect',
    slug: 'sos-connect',
    scheme: 'sosconnect',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
        bundleIdentifier: 'ng.sosconnect.app',
        supportsTablet: false,
        infoPlist: {
            NSBluetoothAlwaysUsageDescription: 'SOS Connect uses Bluetooth to pass messages and SOS alerts between nearby phones when there is no internet.',
            NSLocalNetworkUsageDescription: 'SOS Connect finds nearby members on the same Wi-Fi to message and call without internet.',
            NSBonjourServices: ['_sos-mesh._tcp', '_sos-mesh._udp'],
            NSLocationWhenInUseUsageDescription: 'Your location is attached to SOS alerts only when you press SOS, so responders can find you.',
            NSMicrophoneUsageDescription: 'For voice notes and calls.',
            NSCameraUsageDescription: 'For video calls, photos you choose to send, and scanning the code to link a web browser.',
            UIBackgroundModes: ['remote-notification', 'voip'],
            LSApplicationQueriesSchemes: ['whatsapp'], // so a profile's WhatsApp button can open the WhatsApp app
        },
    },
    android: {
        package: 'ng.sosconnect.app',
        ...firebase,
        permissions: [
            'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'BLUETOOTH_SCAN', 'BLUETOOTH_ADVERTISE', 'BLUETOOTH_CONNECT',
            'NEARBY_WIFI_DEVICES', 'ACCESS_WIFI_STATE', 'CHANGE_WIFI_STATE', 'CHANGE_WIFI_MULTICAST_STATE', 'ACCESS_NETWORK_STATE',
            'RECORD_AUDIO', 'CAMERA', 'POST_NOTIFICATIONS', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_CONNECTED_DEVICE', 'VIBRATE',
        ],
        blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW'],
    },
    plugins: [
        'expo-router',
        'expo-sqlite',
        'expo-secure-store',
        ['expo-location', { locationWhenInUsePermission: 'Your location is attached to SOS alerts only when you press SOS.' }],
        // siren.wav is the SOS alarm sound (the 'sos-siren' notification channel and the in-app alarm).
        ['expo-notifications', { defaultChannel: 'messages', sounds: ['./assets/sounds/siren.wav', ...toneFiles()] }],
        ['expo-image-picker', { photosPermission: 'Choose photos to send.', cameraPermission: 'Take photos to send.' }],
        ['expo-audio', { microphonePermission: 'Record voice notes to send in chats.' }],
        '@config-plugins/react-native-webrtc',
        ['expo-camera', { cameraPermission: 'For video calls, photos you choose to send, and scanning the code to link a web browser.', recordAudioAndroid: false }],
    ],
    extra: {
        apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://sos.example.com',
        reverb: {
            key: process.env.EXPO_PUBLIC_REVERB_KEY ?? '',
            host: process.env.EXPO_PUBLIC_REVERB_HOST ?? 'ws.sos.example.com',
            port: Number(process.env.EXPO_PUBLIC_REVERB_PORT ?? 443),
            scheme: process.env.EXPO_PUBLIC_REVERB_SCHEME ?? 'https',
        },
        // From `php artisan sos:platform-keys` (public half only). Lets phones verify each other offline.
        platformPublicKey: process.env.EXPO_PUBLIC_PLATFORM_PUBLIC_KEY ?? '',
        eas: { projectId: 'a1c212fa-a9cc-47af-a870-2e2516753b57' },
    },
};

export default config;
