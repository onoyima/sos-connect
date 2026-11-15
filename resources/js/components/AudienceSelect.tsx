import type { AudienceOption } from '@/types';

export const audienceKey = (v: AudienceOption['value']) => JSON.stringify({ type: v.type, id: v.id ?? null, who: v.who ?? (v.type === 'unit' ? 'all' : null) });

/** "Send to" picker. Options come from the server and only include areas the person may address. */
export function AudienceSelect({ id, options, value, onChange }: { id?: string; options: AudienceOption[]; value: string; onChange: (v: string) => void }) {
    const groups = new Map<string, AudienceOption[]>();
    for (const o of options) {
        const g = o.group ?? 'Whole institution';
        groups.set(g, [...(groups.get(g) ?? []), o]);
    }
    return (
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
            {[...groups.entries()].map(([g, list]) => (
                <optgroup key={g} label={g}>
                    {list.map((o) => <option key={audienceKey(o.value)} value={audienceKey(o.value)}>{o.label}</option>)}
                </optgroup>
            ))}
        </select>
    );
}
