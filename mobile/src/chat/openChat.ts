/** Which chat is open on screen (set by the chat screen), so its new messages don't ring or pop up. */
let open: number | null = null;
export const setOpenChat = (id: number | null) => { open = id; };
export const openChat = () => open;
