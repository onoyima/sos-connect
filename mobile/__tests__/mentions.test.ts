import { insertMention, keptMentions, mentionQuery, splitMentions } from '@/chat/mentions';

const ada = { id: 1, name: 'Ada Obi' };
const bayo = { id: 2, name: 'Bayo Ade' };

describe('mentions', () => {
    it('finds what is being typed after @', () => {
        expect(mentionQuery('hello @ba')).toEqual({ query: 'ba', start: 6 });
        expect(mentionQuery('@')).toEqual({ query: '', start: 0 });
        expect(mentionQuery('email me at ada@school.test')).toBeNull(); // an email address isn't a mention
        expect(mentionQuery('no mention here')).toBeNull();
    });

    it('replaces the typed part with the full name', () => {
        const text = 'thanks @ba for this';
        const r = insertMention(text, 7, 10, 'Bayo Ade');
        expect(r.text).toBe('thanks @Bayo Ade  for this');
        expect(r.caret).toBe(17);
    });

    it('keeps only names still in the text, once each', () => {
        expect(keptMentions('@Ada Obi see this', [ada, bayo, ada])).toEqual([ada]);
        expect(keptMentions('nobody', [ada])).toEqual([]);
    });

    it('splits text into plain parts and mentions, preferring the longest name', () => {
        const parts = splitMentions('Hi @Ada Obi and @Bayo Ade!', [ada, bayo]);
        expect(parts.map((p) => p.text)).toEqual(['Hi ', '@Ada Obi', ' and ', '@Bayo Ade', '!']);
        expect(parts[1].mention).toEqual(ada);
        expect(splitMentions('Hi @Ada Obioma', [{ id: 9, name: 'Ada Obioma' }, ada])[1].mention?.id).toBe(9);
        expect(splitMentions('plain', [])).toEqual([{ text: 'plain' }]);
        expect(splitMentions('a (b) @C.D', [{ id: 3, name: 'C.D' }])[1].text).toBe('@C.D'); // names with regex characters
    });
});
