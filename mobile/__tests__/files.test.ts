jest.mock('@/config', () => ({ config: { apiUrl: 'https://chat.school.test' } }));
jest.mock('@/lib/api', () => ({ api: jest.fn(), getToken: jest.fn(async () => 'tok') }));

import { authHeaders, fileUrl } from '@/lib/files';

describe('files', () => {
    it('turns an upload path into the protected download address', () => {
        expect(fileUrl('uploads/12/abc.jpg')).toBe('https://chat.school.test/api/files/12/abc.jpg');
    });
    it('sends the member token with downloads', async () => {
        expect(await authHeaders()).toEqual({ Authorization: 'Bearer tok' });
    });
});
