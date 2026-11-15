<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/** Serves the policy pack in docs/legal as public pages (/legal/privacy-policy, ...). */
class LegalController extends Controller
{
    public const DOCUMENTS = [
        'privacy-policy' => 'Privacy Policy',
        'terms-of-service' => 'Terms of Service',
        'sos-emergency-notice' => 'SOS & Emergency Notice',
        'acceptable-use-policy' => 'Acceptable Use Policy',
        'data-processing-agreement' => 'Data Processing Agreement (for institutions)',
        'children-and-minors' => 'Children & Members Under 18',
        'data-retention-schedule' => 'Data Retention Schedule',
        'cookie-and-storage-notice' => 'Cookie & Device Storage Notice',
        'sub-processors' => 'Sub-processors',
        'international-transfers' => 'International Data Transfers',
        'breach-response-plan' => 'Personal Data Breach Response Plan',
        'dpia' => 'Data Protection Impact Assessment',
        'institution-onboarding-checklist' => 'Institution Onboarding Checklist',
    ];

    public function index(): Response
    {
        return Inertia::render('Legal/Index', ['documents' => self::DOCUMENTS]);
    }

    public function show(string $slug): Response
    {
        abort_unless(isset(self::DOCUMENTS[$slug]), 404);
        $markdown = file_get_contents(base_path("docs/legal/{$slug}.md"));
        $markdown = strtr($markdown, [
            '{{OPERATOR}}' => config('sos.legal.operator_name'),
            '{{ADDRESS}}' => config('sos.legal.operator_address'),
            '{{DPO_EMAIL}}' => config('sos.legal.dpo_email'),
            '{{VERSION}}' => config('sos.legal.policy_version'),
        ]);

        return Inertia::render('Legal/Show', [
            'title' => self::DOCUMENTS[$slug],
            'html' => Str::markdown($markdown, ['html_input' => 'escape', 'allow_unsafe_links' => false]),
            'documents' => self::DOCUMENTS,
        ]);
    }
}
