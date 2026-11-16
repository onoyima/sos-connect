<?php

namespace App\Services\Billing;

use App\Models\Invoice;
use App\Support\PlatformSettings;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Paystack card / bank / USSD payments for invoices.
 * Start: the school admin is sent to Paystack's page. Finish: Paystack sends them back (we verify with Paystack)
 * and also calls our webhook (signed with the secret key); whichever arrives first marks the invoice paid.
 * Amounts are always checked against the invoice, so a changed amount in the browser can't pay a bill.
 */
class Paystack
{
    public static function configured(): bool
    {
        return (string) config('services.paystack.secret') !== '';
    }

    public static function enabled(): bool
    {
        return self::configured() && (bool) PlatformSettings::get('payments.online', false);
    }

    private static function http()
    {
        return Http::baseUrl(rtrim((string) config('services.paystack.url'), '/'))
            ->withToken((string) config('services.paystack.secret'))->acceptJson()->timeout(20);
    }

    /** Returns the Paystack page to send the payer to. */
    public static function start(Invoice $invoice, string $email, string $callbackUrl): string
    {
        abort_unless(self::enabled(), 422, 'Online payment is not available. Please pay by bank transfer.');
        abort_unless($invoice->status === 'open', 422, 'This invoice is not open for payment.');

        $reference = $invoice->number.'-'.Str::lower(Str::random(8));
        $res = self::http()->post('/transaction/initialize', [
            'email' => $email, 'amount' => $invoice->amount, 'currency' => $invoice->currency, 'reference' => $reference,
            'callback_url' => $callbackUrl, 'metadata' => ['invoice_id' => $invoice->id, 'invoice' => $invoice->number, 'institution_id' => $invoice->institution_id],
        ]);
        if (! $res->successful() || ! $res->json('status')) {
            throw new RuntimeException('Paystack could not start the payment: '.($res->json('message') ?? $res->status()));
        }
        $invoice->update(['gateway_reference' => $reference]);

        return (string) $res->json('data.authorization_url');
    }

    /** Asks Paystack whether the payment went through, and records it if so. */
    public static function confirm(string $reference): ?Invoice
    {
        $invoice = Invoice::where('gateway_reference', $reference)->first();
        if (! $invoice) {
            return null;
        }
        if ($invoice->status === 'paid') {
            return $invoice;
        }
        $res = self::http()->get('/transaction/verify/'.rawurlencode($reference));
        $d = $res->json('data') ?? [];
        if ($res->successful() && ($d['status'] ?? null) === 'success'
            && (int) ($d['amount'] ?? 0) === (int) $invoice->amount && strtoupper((string) ($d['currency'] ?? '')) === strtoupper($invoice->currency)) {
            return Billing::markPaid($invoice, 'paystack', $reference);
        }

        return $invoice;
    }

    /** The webhook is genuine only if signed with our secret key. */
    public static function validSignature(string $payload, ?string $signature): bool
    {
        $secret = (string) config('services.paystack.secret');

        return $secret !== '' && $signature && hash_equals(hash_hmac('sha512', $payload, $secret), $signature);
    }
}
