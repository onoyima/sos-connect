import { Clock, Smile, Sticker as StickerIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EMOJI_GROUPS, STICKERS, stickerById } from '@/lib/stickers';

const RECENT_KEY = 'sos.recentEmoji';
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } };
const saveRecent = (list: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 24))); } catch { /* private mode */ } };

/**
 * Emoji and sticker panel above the message box. Emojis go into the text where the cursor is; a sticker is sent
 * straight away as its own message.
 */
export function EmojiPanel({ tab, onTab, onEmoji, onSticker, onClose, stickers = true }: {
    tab: 'emoji' | 'sticker'; onTab: (t: 'emoji' | 'sticker') => void; onEmoji: (e: string) => void; onSticker: (id: string) => void; onClose: () => void; stickers?: boolean;
}) {
    const [recent, setRecent] = useState<string[]>(readRecent);
    const [group, setGroup] = useState(recent.length ? -1 : 0);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onClose]);

    const pick = (e: string) => {
        const next = [e, ...recent.filter((x) => x !== e)];
        setRecent(next);
        saveRecent(next);
        onEmoji(e);
    };
    const list = group === -1 ? recent : EMOJI_GROUPS[group]?.list ?? [];

    return (
        <div ref={ref} className="sheet-in border-t border-line bg-white" role="dialog" aria-label={tab === 'emoji' ? 'Emojis' : 'Stickers'}>
            <div className="flex items-center gap-1 border-b border-line/70 px-2 py-1.5">
                <button className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tab === 'emoji' ? 'bg-mint text-grove' : 'text-muted hover:bg-mist'}`} onClick={() => onTab('emoji')}>
                    <Smile size={16} />Emoji
                </button>
                {stickers && (
                    <button className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tab === 'sticker' ? 'bg-mint text-grove' : 'text-muted hover:bg-mist'}`} onClick={() => onTab('sticker')}>
                        <StickerIcon size={16} />Stickers
                    </button>
                )}
                <button className="icon-btn ml-auto size-8" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
            {tab === 'emoji' ? (
                <>
                    <div className="no-scrollbar flex gap-0.5 overflow-x-auto px-2 pt-1.5">
                        {recent.length > 0 && (
                            <button className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${group === -1 ? 'bg-mist' : 'hover:bg-mist'}`} onClick={() => setGroup(-1)} aria-label="Recent" title="Recent"><Clock size={18} className="text-muted" /></button>
                        )}
                        {EMOJI_GROUPS.map((g, i) => (
                            <button key={g.name} className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-xl ${group === i ? 'bg-mist' : 'hover:bg-mist'}`} onClick={() => setGroup(i)} aria-label={g.name} title={g.name}>{g.icon}</button>
                        ))}
                    </div>
                    <div className="scroll-area grid max-h-52 grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-0.5 p-2">
                        {list.map((e, i) => (
                            <button key={`${e}-${i}`} className="flex aspect-square items-center justify-center rounded-lg text-2xl transition-transform hover:scale-110 hover:bg-mist" onClick={() => pick(e)} aria-label={`Add ${e}`}>{e}</button>
                        ))}
                    </div>
                </>
            ) : (
                <div className="scroll-area grid max-h-64 grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 p-3">
                    {STICKERS.map((st) => (
                        <button key={st.id} onClick={() => onSticker(st.id)} className="rounded-2xl transition-transform hover:scale-105 focus-visible:scale-105" aria-label={`Send sticker: ${st.label}`}>
                            <StickerView id={st.id} small />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** How a sticker looks in the chat and in the panel. */
export function StickerView({ id, small = false }: { id?: string | null; small?: boolean }) {
    const st = stickerById(id);
    if (!st) return <span className="text-sm text-muted italic">Sticker</span>;
    return (
        <span className={`inline-flex flex-col items-center justify-center rounded-3xl ${small ? 'h-24 w-full gap-0.5' : 'my-0.5 h-36 w-36 gap-1'} select-none`}
            style={{ background: st.bg, color: st.fg }} role="img" aria-label={`Sticker: ${st.label}`}>
            <span className={small ? 'text-4xl' : 'text-6xl'} style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.12))' }}>{st.emoji}</span>
            <span className={`rounded-full bg-white/70 px-2.5 py-0.5 font-bold ${small ? 'text-[11px]' : 'text-[13px]'}`}>{st.label}</span>
        </span>
    );
}
