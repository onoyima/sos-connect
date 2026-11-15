import { Head } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Radio, Users, Video } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { joinGroupCall, startCall, startGroupCall } from '@/components/CallManager';
import { Avatar, EmptyState, PageBody, PageHeader, when } from '@/components/ui';
import { api } from '@/lib/api';
import { listenUser, refreshBadges } from '@/lib/live';

type Call = { call_uuid: string; type: 'voice' | 'video'; status: string; via: string; direction: string; other: { id: number; name: string } | null; group?: { conversation_id: number; name: string }; started_at: string; duration_s: number | null };

const duration = (s: number) => (s < 60 ? `${s} sec` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} sec` : ''}`.trim());

export default function Calls() {
    const [calls, setCalls] = useState<Call[]>([]);
    const [alerts, setAlerts] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    useEffect(() => {
        const load = () => api<{ calls: Call[] }>('/calls').then((r) => setCalls(r.calls)).catch(() => {});
        load();
        // Looking at the list clears the red missed-call count.
        api('/calls/seen', { method: 'POST' }).then(() => refreshBadges()).catch(() => {});
        const offs = ['call.state', 'call.incoming'].map((k) => listenUser(k, () => { load(); api('/calls/seen', { method: 'POST' }).then(() => refreshBadges()).catch(() => {}); }));
        return () => offs.forEach((f) => f());
    }, []);

    return (
        <AppLayout title="Calls">
            <Head title="Calls" />
            <PageHeader title="Calls" description="Voice and video calls, one-to-one and in groups. To call someone new, open your chat with them; for a group call, open the group." />
            <PageBody narrow>
                {alerts === 'default' && (
                    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-mint px-4 py-3 text-sm text-grove">
                        <span className="min-w-0 flex-1">Get a pop-up when someone calls while this tab is in the background.</span>
                        <button className="btn-primary px-4 py-1.5" onClick={() => Notification.requestPermission().then(setAlerts)}>Turn on call alerts</button>
                    </div>
                )}
                {calls.length === 0 ? (
                    <EmptyState icon={<Phone size={26} />} title="No calls yet">Start a call from the phone or camera button at the top of any one-to-one chat.</EmptyState>
                ) : (
                    <div className="overflow-hidden rounded-2xl bg-white">
                        {calls.map((c) => {
                            if (c.group) {
                                return (
                                    <div key={c.call_uuid} className="flex items-center gap-3 border-b border-line/70 px-4 py-3 last:border-b-0">
                                        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-mint text-grove"><Users size={20} /></span>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate font-semibold">{c.group.name}</div>
                                            <div className="truncate text-sm text-muted">Group {c.type} call, {when(c.started_at)}{c.duration_s ? `, ${duration(c.duration_s)}` : ''}{c.status === 'active' ? ', still going' : ''}</div>
                                        </div>
                                        {c.status === 'active'
                                            ? <button className="btn-primary px-4 py-1.5" onClick={() => joinGroupCall(c.call_uuid)}>Join</button>
                                            : <button className="icon-btn text-leaf" onClick={() => startGroupCall(c.group!.conversation_id, c.type)} aria-label={`Call ${c.group.name} again`}>{c.type === 'video' ? <Video size={21} /> : <Phone size={20} />}</button>}
                                    </div>
                                );
                            }
                            const missed = c.status === 'missed' && c.direction === 'incoming';
                            const Icon = missed ? PhoneMissed : c.direction === 'incoming' ? PhoneIncoming : PhoneOutgoing;
                            return (
                                <div key={c.call_uuid} className="flex items-center gap-3 border-b border-line/70 px-4 py-3 last:border-b-0">
                                    <Avatar name={c.other?.name ?? 'Former member'} size={44} />
                                    <div className="min-w-0 flex-1">
                                        <div className={`truncate font-semibold ${missed ? 'text-sos' : ''}`}>{c.other?.name ?? 'Former member'}</div>
                                        <div className="flex items-center gap-1.5 text-sm text-muted">
                                            <Icon size={15} className={missed ? 'text-sos' : c.direction === 'incoming' ? 'text-leaf' : ''} />
                                            <span className="truncate">
                                                {missed ? 'Missed' : c.status === 'declined' ? 'Declined' : c.status === 'failed' ? "Couldn't connect" : c.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
                                                {c.type === 'video' ? ' video' : ''}, {when(c.started_at)}
                                                {c.duration_s ? `, ${duration(c.duration_s)}` : ''}
                                            </span>
                                            {c.via === 'lan' && <span title="Over local Wi-Fi, without internet" className="inline-flex shrink-0 items-center gap-0.5"><Radio size={13} />Wi-Fi</span>}
                                        </div>
                                    </div>
                                    {c.other && (
                                        <div className="flex">
                                            <button className="icon-btn text-leaf" onClick={() => startCall(c.other!, 'voice')} aria-label={`Voice call ${c.other.name}`}><Phone size={20} /></button>
                                            <button className="icon-btn text-leaf" onClick={() => startCall(c.other!, 'video')} aria-label={`Video call ${c.other.name}`}><Video size={21} /></button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </PageBody>
        </AppLayout>
    );
}
