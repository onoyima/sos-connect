/** Pure helpers for @mentions, shared by the composer and the message bubbles (and unit-tested). */
export type Mention = { id: number; name: string };
export type Part = { text: string; mention?: Mention };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits message text into plain parts and @Name parts for the people mentioned. */
export function splitMentions(body: string, mentions: Mention[]): Part[] {
    if (!mentions.length || !body) return [{ text: body }];
    const byLongest = [...mentions].sort((a, b) => b.name.length - a.name.length);
    const re = new RegExp(`(@(?:${byLongest.map((m) => escape(m.name)).join('|')}))`, 'g');
    return body.split(re).filter((t) => t !== '').map((t) => {
        const who = mentions.find((m) => t === `@${m.name}`);
        return who ? { text: t, mention: who } : { text: t };
    });
}

/** If the person is typing "@na…" right before the cursor, what they've typed after the @ and where the @ is. */
export function mentionQuery(before: string): { query: string; start: number } | null {
    const m = /(?:^|\s)@([\p{L}][\p{L}.' -]{0,30})?$/u.exec(before);
    if (!m) return null;
    const start = m.index + m[0].indexOf('@');
    return { query: (m[1] ?? '').trim(), start };
}

/** Replaces "@na" (from start to the cursor) with "@Full Name ". */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
    const insert = `@${name} `;
    return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}

/** Only the mentions whose @Name is still in the text when it's sent. */
export function keptMentions(body: string, mentions: Mention[]): Mention[] {
    const seen = new Set<number>();
    return mentions.filter((m) => body.includes(`@${m.name}`) && !seen.has(m.id) && seen.add(m.id));
}
