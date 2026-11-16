<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#0e3b2e">
    {{-- Bunny Fonts: a GDPR-friendly mirror of Google Fonts that does not log visitor IPs. --}}
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=figtree:400,500,600,700&display=swap" rel="stylesheet">
    <title inertia>{{ config('app.name', 'SOS Connect') }}</title>
    @viteReactRefresh
    @vite(['resources/css/app.css', 'resources/js/app.tsx'])
    @inertiaHead
</head>
<body class="h-full">
    @auth
    {{-- Opening screen for signed-in people (like WhatsApp Web): shown until the chats are ready. --}}
    <div id="boot" role="status" aria-label="Loading SOS Connect"
        style="position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f6f8f6;font-family:Figtree,system-ui,sans-serif;transition:opacity .25s">
        <svg width="72" height="72" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="12" fill="#1e7b57"/><circle cx="14" cy="26" r="3.2" fill="#fff"/>
            <path d="M14 18.5a7.5 7.5 0 0 1 7.5 7.5" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/>
            <path d="M14 12a14 14 0 0 1 14 14" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
            <circle cx="29" cy="11" r="4" fill="#d62839"/>
        </svg>
        <div style="margin-top:26px;width:min(320px,70vw);height:4px;border-radius:4px;background:#dde5e0;overflow:hidden">
            <div style="height:100%;width:40%;border-radius:4px;background:#1e7b57;animation:bootbar 1.1s ease-in-out infinite"></div>
        </div>
        <div style="margin-top:18px;color:#0e3b2e;font-weight:600;font-size:17px">SOS Connect</div>
        <div style="margin-top:6px;color:#5c6f66;font-size:13px">Loading your chats…</div>
        <div style="position:absolute;bottom:28px;color:#5c6f66;font-size:12.5px;display:flex;align-items:center;gap:6px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            Private to your institution
        </div>
        <style>@keyframes bootbar{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}</style>
    </div>
    <script nonce="{{ \Illuminate\Support\Facades\Vite::cspNonce() }}">
        window.__sosReady = function () {
            var b = document.getElementById('boot');
            if (!b) return;
            b.style.opacity = '0';
            setTimeout(function () { b.remove(); }, 260);
        };
        setTimeout(window.__sosReady, 8000); // never longer than this, even if something is slow
    </script>
    @endauth
    @inertia
</body>
</html>
