import type { Branding } from '@/types';

let last = '';

/**
 * Sets the browser-tab icon: the institution's favicon (or chat icon, or the built-in one), with today's seasonal
 * badge drawn in the corner (Christmas tree, Easter chick, crescent moon for Eid, the flag on Independence Day…).
 */
export function applyFavicon(b: Branding | null | undefined) {
    const src = b?.favicon ?? b?.icon ?? '/favicon.ico';
    const key = `${src}|${b?.season?.key ?? ''}`;
    if (key === last) return;
    last = key;
    const link = (document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null) ?? Object.assign(document.createElement('link'), { rel: 'icon' });
    if (!link.parentNode) document.head.appendChild(link);
    if (!b?.season) { link.href = src; return; }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            const g = c.getContext('2d')!;
            g.drawImage(img, 0, 0, 64, 64);
            g.beginPath();
            g.arc(46, 46, 18, 0, Math.PI * 2);
            g.fillStyle = '#fff';
            g.fill();
            g.lineWidth = 3;
            g.strokeStyle = b.season!.accent;
            g.stroke();
            g.font = '24px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(b.season!.badge, 46, 48);
            link.href = c.toDataURL('image/png');
        } catch { link.href = src; }
    };
    img.onerror = () => { link.href = src; };
    img.src = src;
}
