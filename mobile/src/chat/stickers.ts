/** The built-in sticker set (the same list is on the website: resources/js/lib/stickers.ts). Sent by name only. */
export type Sticker = { id: string; emoji: string; label: string; bg: string; fg: string };

export const STICKERS: Sticker[] = [
    { id: 'hello', emoji: '👋', label: 'Hello!', bg: '#d5eedf', fg: '#0e3b2e' },
    { id: 'thanks', emoji: '🙏', label: 'Thank you', bg: '#efe2c8', fg: '#5a3d0c' },
    { id: 'ok', emoji: '👌', label: 'Okay', bg: '#d6e4f0', fg: '#173a5c' },
    { id: 'yes', emoji: '✅', label: 'Yes', bg: '#d5eedf', fg: '#0e3b2e' },
    { id: 'no', emoji: '🙅', label: 'No', bg: '#f3d9d2', fg: '#5c2417' },
    { id: 'lol', emoji: '😂', label: 'LOL', bg: '#fff1c2', fg: '#6b4a00' },
    { id: 'love', emoji: '❤️', label: 'Love it', bg: '#fbd5dc', fg: '#7a1f33' },
    { id: 'congrats', emoji: '🎉', label: 'Congrats!', bg: '#e6dcef', fg: '#3f2a5c' },
    { id: 'wow', emoji: '😮', label: 'Wow', bg: '#d9ece9', fg: '#134540' },
    { id: 'cool', emoji: '😎', label: 'Cool', bg: '#d6e4f0', fg: '#173a5c' },
    { id: 'sorry', emoji: '😔', label: 'Sorry', bg: '#e8e8ef', fg: '#33334d' },
    { id: 'amen', emoji: '🙌', label: 'Amen', bg: '#efe2c8', fg: '#5a3d0c' },
    { id: 'omw', emoji: '🏃', label: 'On my way', bg: '#d5eedf', fg: '#0e3b2e' },
    { id: 'late', emoji: '🕒', label: 'Running late', bg: '#fde3c8', fg: '#6b3b0b' },
    { id: 'brb', emoji: '⏳', label: 'Be right back', bg: '#e8e8ef', fg: '#33334d' },
    { id: 'inclass', emoji: '📚', label: 'In class', bg: '#d6e4f0', fg: '#173a5c' },
    { id: 'exam', emoji: '✍️', label: 'Exam mode', bg: '#e6dcef', fg: '#3f2a5c' },
    { id: 'meet', emoji: '📍', label: 'Meet me here', bg: '#f3d9d2', fg: '#5c2417' },
    { id: 'callme', emoji: '📞', label: 'Call me', bg: '#d9ece9', fg: '#134540' },
    { id: 'food', emoji: '🍲', label: 'Food?', bg: '#fde3c8', fg: '#6b3b0b' },
    { id: 'morning', emoji: '☀️', label: 'Good morning', bg: '#fff1c2', fg: '#6b4a00' },
    { id: 'night', emoji: '🌙', label: 'Good night', bg: '#dfe1f2', fg: '#26285c' },
    { id: 'safe', emoji: '🛡️', label: "I'm safe", bg: '#d5eedf', fg: '#0e3b2e' },
    { id: 'happy', emoji: '😊', label: 'Smile', bg: '#fff1c2', fg: '#6b4a00' },
];

export const stickerById = (id?: string | null) => STICKERS.find((s) => s.id === id);

/** Emojis by group, for the emoji panel. */
export const EMOJI_GROUPS: { name: string; icon: string; list: string[] }[] = [
    { name: 'Smileys', icon: '😀', list: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕'.split(' ') },
    { name: 'Gestures', icon: '👍', list: '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫡 🫶 👀 🧠 🙋 🙆 🙅 🤷 🤦 💁 🙇 🏃 🚶 🧍 🧎 💃 🕺'.split(' ') },
    { name: 'Hearts', icon: '❤️', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💯 ✨ ⭐ 🌟 🔥 💥 🎉 🎊 🥂 🏆 🥇 🎯'.split(' ') },
    { name: 'Campus', icon: '📚', list: '📚 📖 📝 ✏️ 🖊️ 📒 📓 📅 🗓️ ⏰ ⏳ 🎓 🏫 🧪 🔬 🧮 💻 📱 🔋 🔌 📶 📍 🗺️ 🚌 🚕 🏠 🛏️ 🍽️ ⚽ 🏀 🎵 🎧 🎤 📸 💡 🔔 📣 🛡️ 🚑 🚒 🚓 ⚠️ 🆘'.split(' ') },
    { name: 'Food', icon: '🍲', list: '🍲 🍛 🍚 🍝 🍜 🍕 🍔 🍟 🌭 🥪 🌯 🥗 🍗 🍖 🥩 🍤 🍳 🥞 🍞 🥐 🧀 🍿 🍩 🍪 🎂 🍰 🍫 🍬 🍎 🍌 🍉 🍇 🍓 🍍 🥭 🥥 🥤 🧃 ☕ 🍵 🧋 🥛 💧'.split(' ') },
    { name: 'Nature', icon: '🌿', list: '☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌩️ 🌈 🌙 ⭐ 🌍 🌱 🌿 🍀 🌴 🌳 🌵 🌻 🌹 🌸 🌺 🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐔 🐧 🐦 🦋 🐝 🐢 🐍 🐟 🐬'.split(' ') },
    { name: 'Symbols', icon: '✅', list: '✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❓ ❗ ‼️ ⁉️ 💤 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔺 🔻 ⬆️ ⬇️ ⬅️ ➡️ 🔁 🔄 🆗 🆕 🆒 🆓 🔝 ℹ️ ♻️ ⛔ 🚫 📵'.split(' ') },
];
