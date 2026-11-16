/** Which chat is open on screen right now (set by the chats page), so new messages there don't ring. */
let open: number | null = null;
export const setOpenChat = (id: number | null) => { open = id; };
export const openChat = () => open;
