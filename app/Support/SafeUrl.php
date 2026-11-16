<?php

namespace App\Support;

/**
 * Stops the server being used to reach its own private network (SSRF): addresses the server calls out to (school
 * connectors) must be public, unless SOS_CONNECTOR_ALLOW_PRIVATE=true (a connector on the same private network).
 */
final class SafeUrl
{
    /** null when the URL may be called, otherwise why not. */
    public static function problem(string $url): ?string
    {
        $parts = parse_url($url);
        $scheme = strtolower($parts['scheme'] ?? '');
        $host = $parts['host'] ?? '';
        if (! in_array($scheme, ['http', 'https'], true) || $host === '' || isset($parts['user']) || isset($parts['pass'])) {
            return 'Use a plain https:// address.';
        }
        if (config('sos.connector.allow_private_hosts')) {
            return null;
        }
        $host = trim($host, '[]');
        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : array_merge(
            gethostbynamel($host) ?: [],
            array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6'),
        );
        if (! $ips) {
            return "The address {$host} can't be found.";
        }
        foreach ($ips as $ip) {
            if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return 'That address is on a private or reserved network, which this server does not call.';
            }
        }

        return null;
    }
}
