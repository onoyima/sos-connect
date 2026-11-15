import { chatTime, dayLabel, duration, fileSize, preview } from '@/lib/format';

describe('format', () => {
    it('shows the time for today and words for recent days', () => {
        const now = new Date();
        expect(chatTime(now.toISOString())).toMatch(/\d{1,2}[:.]\d{2}/);
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
        expect(chatTime(yesterday.toISOString())).toBe('Yesterday');
        expect(dayLabel(now.toISOString())).toBe('Today');
        expect(chatTime(null)).toBe('');
    });

    it('formats sizes and durations', () => {
        expect(fileSize(500)).toBe('500 B');
        expect(fileSize(2048)).toBe('2 KB');
        expect(fileSize(3 * 1024 * 1024)).toBe('3.0 MB');
        expect(fileSize(null)).toBe('');
        expect(duration(65)).toBe('1:05');
        expect(duration(0)).toBe('0:00');
    });

    it('previews messages the way the chat list shows them', () => {
        expect(preview(null, false, true)).toBe('No messages yet');
        expect(preview({ type: 'text', body: 'Hello', sender_name: 'Ada Obi' }, false, true)).toBe('Ada: Hello');
        expect(preview({ type: 'text', body: 'Hello', sender_name: 'Ada Obi' }, true, true)).toBe('You: Hello');
        expect(preview({ type: 'image', body: null, sender_name: 'Ada' }, false, false)).toBe('Photo');
        expect(preview({ type: 'voice', body: null }, false, false)).toBe('Voice note');
        expect(preview({ type: 'file', body: 'notes.pdf' }, false, false)).toBe('File · notes.pdf');
        expect(preview({ type: 'text', body: 'x', deleted: 1 }, false, false)).toBe('Message deleted');
    });
});
