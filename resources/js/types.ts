export type Permission = string;

export interface SharedProps {
    auth: null | {
        user: { id: number; name: string; title: string | null; member_type: string; is_platform_admin: boolean; needs_policy_acceptance: boolean };
        permissions: Permission[];
        super: boolean;
        /** Platform owners and school admins: the platform chat widget. */
        platform_chat?: boolean;
        /** School admins: where the subscription stands. */
        billing?: { enforced: boolean; status: string; plan: string | null; cycle: string; renews_at: string | null; days_left: number | null; grace_ends_at: string | null; cancel_at_period_end: boolean; reminder_days: number } | null;
        session_tag: string | null;
        face_due?: boolean;
    };
    modules: Record<string, boolean>;
    branding?: Branding;
    institution: null | { id: number; name: string; short_code: string; security_phone: string | null; emergency_numbers: string[] };
    reverb: { key: string | null; host: string | null; port: number | null; scheme: string | null };
    flash: { status?: string | null; error?: string | null };
    errors: Record<string, string>;
    [key: string]: unknown;
}

export interface ChatMessage {
    id: number;
    client_id: string;
    conversation_id: number;
    sender_id: number;
    sender_name?: string;
    type: 'text' | 'image' | 'voice' | 'file' | 'system' | 'sticker';
    body: string | null;
    meta: Record<string, unknown> | null;
    via: 'online' | 'mesh' | 'gateway';
    sent_at: string;
    created_at: string;
    edited: boolean;
    deleted: boolean;
    pending?: boolean;
    reply_to_id?: number | null;
    reply_to?: { id: number; client_id: string; sender_id: number; sender_name?: string; type: string; body: string | null; deleted: boolean } | null;
    mentions?: { id: number; name: string }[];
}

export interface ConversationSummary {
    id: number;
    type: 'direct' | 'group' | 'auto_group';
    auto_type: string | null;
    community_id: number | null;
    name: string;
    peer: { id: number; name: string; title: string | null; last_seen_at: string | null } | null;
    posting: 'everyone' | 'admins';
    can_post: boolean;
    my_role: 'admin' | 'member';
    member_count: number;
    unread: number;
    muted: boolean;
    muted_until?: string | null;
    archived?: boolean;
    /** Set while I've paused this chat: messages newer than this id are held back until I resume. */
    paused_after?: number | null;
    last_message: ChatMessage | null;
    last_message_at: string | null;
}

export interface SosAlert {
    id: number;
    uuid: string;
    category: string;
    message: string | null;
    lat: number | null;
    lng: number | null;
    accuracy_m: number | null;
    location_label: string | null;
    status: string;
    via: string;
    raised_at: string;
    acknowledged_at: string | null;
    resolved_at: string | null;
    user: null | { id: number; name: string; identifier: string | null; phone: string | null; department: string | null; residence?: string | null };
    responses: { action: string; note: string | null; by: string; at: string }[];
}

export interface Community {
    id: number;
    name: string;
    description: string | null;
    parent_id: number | null;
    member_count: number;
}

export type AudienceOption = { value: { type: string; id?: number; who?: string }; label: string; group?: string };

export type UnitOption = { id: number; name: string; code: string | null; type: string; type_label: string; parent_id: number | null };

export type CatalogGroup = { key: string; label: string; items: { key: string; label: string; area: boolean; module: string | null }[] };

export type Paginated<T> = { data: T[]; links: { url: string | null; label: string; active: boolean }[]; total?: number };

export type Branding = {
    favicon: string | null;
    icon: string | null;
    season: null | { key: string; label: string; badge: string; accent: string };
};
