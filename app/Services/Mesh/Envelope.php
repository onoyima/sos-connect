<?php

namespace App\Services\Mesh;

/**
 * Wire format shared by phones, edge nodes and the server.
 *
 *   id   32 hex chars (16 random bytes)      t    type (see constants)
 *   iid  institution id of the sender        to   "c:<conversationId>" | "u:<userId>" | "i:<institutionId>"
 *   ts   created, unix ms (device clock)     exp  expiry, unix ms
 *   hop  hops left (not signed; each relay decrements it)
 *   enc  "k" = institution key (secretbox)    "b" = sealed to one device (crypto_box)
 *   kid  mesh key id (enc k) or recipient device id (enc b)
 *   n    base64 24-byte nonce                 ct   base64 ciphertext of the JSON payload
 *   cert sender's device certificate          sig  base64 Ed25519 signature by cert.spk
 *
 * Signed bytes: "SOSv1\n{id}\n{iid}\n{t}\n{to}\n{ts}\n{exp}\n{enc}\n{kid}\n{n}\n{ct}"
 */
final class Envelope
{
    public const MESSAGE = 1;

    public const SOS = 2;

    public const SOS_UPDATE = 3;

    public const SAFETY_RESPONSE = 4;

    public const READ_RECEIPT = 5;

    public const CALL_SIGNAL = 6;   // LAN calls only; never uploaded

    public const ANNOUNCEMENT = 7;  // signed by an authorised role, flooded to every member nearby

    public static function canonical(array $e): string
    {
        return implode("\n", ['SOSv1', $e['id'], $e['iid'], $e['t'], $e['to'], $e['ts'], $e['exp'], $e['enc'], $e['kid'], $e['n'], $e['ct']]);
    }

    public static function shapeIsValid(array $e): bool
    {
        foreach (['id', 'iid', 't', 'to', 'ts', 'exp', 'enc', 'kid', 'n', 'ct', 'cert', 'sig'] as $k) {
            if (! array_key_exists($k, $e)) {
                return false;
            }
        }

        return preg_match('/^[0-9a-f]{32}$/', (string) $e['id']) === 1
            && preg_match('/^[cui]:[0-9]{1,20}$/', (string) $e['to']) === 1
            && in_array($e['enc'], ['k', 'b'], true)
            && is_array($e['cert']);
    }
}
