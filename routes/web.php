<?php

use App\Http\Controllers\Web\AdminController;
use App\Http\Controllers\Web\AuthController;
use App\Http\Controllers\Web\GroupsAdminController;
use App\Http\Controllers\Web\BrandingController;
use App\Http\Controllers\Web\BroadcastsAdminController;
use App\Http\Controllers\Web\FacePageController;
use App\Http\Controllers\Web\FacesAdminController;
use App\Http\Controllers\Web\InvitationController;
use App\Http\Controllers\Web\LinkController;
use App\Http\Controllers\Web\MemberAccessController;
use App\Http\Controllers\Web\PagesController;
use App\Http\Controllers\Web\ParentsController;
use App\Http\Controllers\Web\RolesController;
use App\Http\Controllers\Web\StructureController;
use App\Http\Controllers\Web\LegalController;
use App\Http\Controllers\Web\OnboardingController;
use App\Http\Controllers\Web\PageController;
use App\Http\Controllers\Web\PlatformController;
use App\Http\Controllers\Web\PlatformBillingController;
use App\Http\Controllers\Web\SubscriptionController;
use Illuminate\Support\Facades\Route;

Route::redirect('/', '/chats');

// Public
Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'show'])->name('login');
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:20,1');
    // Link this browser to the phone app with a QR code (like WhatsApp Web).
    Route::post('/link', [LinkController::class, 'start'])->middleware('throttle:30,1');
    Route::get('/link/{code}', [LinkController::class, 'check'])->middleware('throttle:90,1');
    Route::get('/register-institution', [OnboardingController::class, 'show'])->name('onboarding');
    Route::post('/register-institution', [OnboardingController::class, 'store'])->middleware('throttle:30,60'); // corrections count too; only successful sign-ups are limited tightly (see controller)
});

Route::get('/invite/{token}', [InvitationController::class, 'show'])->name('invitation.show');
Route::post('/invite/{token}', [InvitationController::class, 'accept'])->middleware('throttle:10,1')->name('invitation.accept');

// Face capture inside the phone app (opened with a short-lived ticket; no website session needed)
Route::get('/face/app/{ticket}', [FacePageController::class, 'app'])->where('ticket', '[A-Za-z0-9]{48}')->name('face.app');

Route::get('/brand/{institution}/{kind}', [BrandingController::class, 'file'])->whereNumber('institution')->whereIn('kind', ['favicon', 'icon'])->name('brand.file');

// Paystack tells us about payments here (signed with our secret key; no session, no CSRF token).
// Browsers report blocked content here (Content-Security-Policy); logged so a real attack or a mistake shows up.
Route::post('/csp-report', function (\Illuminate\Http\Request $request) {
    $r = (array) (json_decode($request->getContent(), true)['csp-report'] ?? []);
    \Illuminate\Support\Facades\Log::channel(config('logging.default'))->warning('CSP blocked', array_intersect_key($r, array_flip(['document-uri', 'violated-directive', 'blocked-uri', 'source-file', 'line-number'])));

    return response()->noContent();
})->middleware('throttle:30,1');
Route::post('/webhooks/paystack', [SubscriptionController::class, 'paystackWebhook'])->middleware('throttle:120,1')->name('billing.paystack.webhook');

Route::get('/legal', [LegalController::class, 'index'])->name('legal.index');
Route::get('/legal/{slug}', [LegalController::class, 'show'])->name('legal.show');

// Signed-in members
Route::middleware(['auth', 'member'])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout'])->name('logout');
    Route::get('/session', fn () => response()->json(['ok' => true]))->name('session.check'); // the page asks "am I still signed in?"

    // Member pages (the platform owner, who belongs to no institution, is sent to the institutions list instead).
    Route::middleware(\App\Http\Middleware\PlatformHome::class)->group(function () {
        Route::get('/chats/{conversation?}', [PageController::class, 'chats'])->whereNumber('conversation')->name('chats');
        Route::get('/sos', [PageController::class, 'sos'])->name('sos');
        Route::get('/announcements', [PageController::class, 'announcements'])->name('announcements');
        Route::get('/status', [PageController::class, 'status'])->name('status');
        Route::get('/calls', [PageController::class, 'calls'])->name('calls');
        Route::get('/safety', [PageController::class, 'safety'])->name('safety');
    });
    Route::get('/account/privacy', [PageController::class, 'privacy'])->name('account.privacy');
    Route::get('/account/settings', fn () => \Inertia\Inertia::render('Account/Settings'))->name('account.settings');
    Route::get('/billing/paystack/return', [SubscriptionController::class, 'paystackReturn'])->middleware('can.do:settings.edit')->name('billing.paystack.return');
    Route::get('/help/{slug?}', [PagesController::class, 'help'])->where('slug', '[a-z0-9-]+')->name('help');
    Route::get('/face', [FacePageController::class, 'web'])->middleware('can.do:face.capture')->name('face');

    Route::prefix('admin')->name('admin.')->group(function () {
        Route::get('/settings', [AdminController::class, 'settings'])->middleware('can.do:settings.edit')->name('settings');
        Route::post('/settings', [AdminController::class, 'saveSettings'])->middleware('can.do:settings.edit')->name('settings.save');
        Route::post('/settings/details', [AdminController::class, 'saveDetails'])->middleware('can.do:settings.edit')->name('settings.details');
        // The institution's subscription (plan, invoices, paying).
        Route::middleware('can.do:settings.edit')->group(function () {
            Route::get('/subscription', [SubscriptionController::class, 'show'])->name('subscription');
            Route::post('/subscription/plan', [SubscriptionController::class, 'choose'])->middleware('throttle:20,1')->name('subscription.plan');
            Route::post('/subscription/cancel', [SubscriptionController::class, 'cancel'])->name('subscription.cancel');
            Route::post('/invoices/{invoice}/pay', [SubscriptionController::class, 'pay'])->whereNumber('invoice')->middleware('throttle:20,1')->name('invoices.pay');
        });
        Route::post('/connector', [AdminController::class, 'saveConnector'])->middleware('can.do:connector.edit')->name('connector.save');
        Route::post('/sign-in', [AdminController::class, 'saveSignIn'])->middleware('can.do:connector.edit')->name('sign-in.save');
        Route::post('/connector/test', [AdminController::class, 'testConnector'])->middleware('can.do:connector.edit')->name('connector.test');
        Route::get('/modules', [AdminController::class, 'modules'])->middleware('can.do:modules.manage')->name('modules');
        Route::post('/modules', [AdminController::class, 'saveModules'])->middleware('can.do:modules.manage')->name('modules.save');
        Route::get('/reports', [AdminController::class, 'reports'])->name('reports');
        Route::get('/audit', [AdminController::class, 'audit'])->middleware('can.do:audit.view')->name('audit');

        // Members and their access (each action also checks the member is inside the admin's areas)
        Route::middleware('can.do:members.view')->group(function () {
            Route::get('/members', [MemberAccessController::class, 'index'])->name('members');
            // Accounts members closed ("Delete my account"): kept for tracing, and can be restored.
            Route::get('/deleted-accounts', [\App\Http\Controllers\Web\DeletedAccountsController::class, 'index'])->name('deleted');
            Route::get('/deleted-accounts/export', [\App\Http\Controllers\Web\DeletedAccountsController::class, 'export'])->middleware('throttle:10,1')->name('deleted.export');
            Route::post('/deleted-accounts/{record}/restore', [\App\Http\Controllers\Web\DeletedAccountsController::class, 'restore'])->whereNumber('record')->middleware('can.do:members.suspend')->name('deleted.restore');
            Route::get('/members/{id}', [MemberAccessController::class, 'show'])->whereNumber('id')->name('members.show');
            Route::post('/members/{id}/roles', [MemberAccessController::class, 'assignRole'])->name('members.roles.assign');
            Route::delete('/members/{id}/roles/{assignment}', [MemberAccessController::class, 'removeRole'])->name('members.roles.remove');
            Route::post('/members/{id}/permissions', [MemberAccessController::class, 'grantPermission'])->name('members.permissions.grant');
            Route::delete('/members/{id}/permissions/{permission}', [MemberAccessController::class, 'removePermission'])->name('members.permissions.remove');
            Route::post('/members/{id}/status', [MemberAccessController::class, 'setStatus'])->name('members.status');
            Route::post('/members/{id}/consent', [MemberAccessController::class, 'recordConsent'])->name('members.consent');
        });

        // Roles
        Route::middleware('can.do:roles.view')->group(function () {
            Route::get('/roles', [RolesController::class, 'index'])->name('roles');
            Route::get('/roles/new', [RolesController::class, 'create'])->name('roles.create');
            Route::post('/roles', [RolesController::class, 'store'])->name('roles.store');
            Route::get('/roles/{role}', [RolesController::class, 'edit'])->name('roles.edit');
            Route::put('/roles/{role}', [RolesController::class, 'update'])->name('roles.update');
            Route::delete('/roles/{role}', [RolesController::class, 'destroy'])->name('roles.destroy');
        });

        // Communities and groups
        Route::middleware('can.do:groups.view')->group(function () {
            Route::get('/groups', [GroupsAdminController::class, 'index'])->name('groups');
            Route::get('/groups/{conversation}', [GroupsAdminController::class, 'show'])->name('groups.show');
            Route::patch('/groups/{conversation}', [GroupsAdminController::class, 'update'])->name('groups.update');
            Route::post('/groups/{conversation}/members', [GroupsAdminController::class, 'addMember'])->name('groups.members.add');
            Route::delete('/groups/{conversation}/members/{userId}', [GroupsAdminController::class, 'removeMember'])->name('groups.members.remove');
            Route::post('/groups/{conversation}/members/{userId}/role', [GroupsAdminController::class, 'setAdmin'])->name('groups.members.role');
        });

        // Faculties, departments, units, courses
        Route::middleware('can.do:units.view')->group(function () {
            Route::get('/structure', [StructureController::class, 'index'])->name('structure');
            Route::post('/structure/units', [StructureController::class, 'saveUnit'])->name('structure.units.store');
            Route::put('/structure/units/{unit}', [StructureController::class, 'saveUnit'])->name('structure.units.update');
            Route::delete('/structure/units/{unit}', [StructureController::class, 'deleteUnit'])->name('structure.units.destroy');
            Route::post('/structure/courses', [StructureController::class, 'saveCourse'])->name('structure.courses.store');
            Route::put('/structure/courses/{course}', [StructureController::class, 'saveCourse'])->name('structure.courses.update');
            Route::delete('/structure/courses/{course}', [StructureController::class, 'deleteCourse'])->name('structure.courses.destroy');
            Route::post('/structure/sync', [StructureController::class, 'syncFromRecords'])->name('structure.sync');
            Route::post('/structure/build-groups', [StructureController::class, 'buildGroups'])->name('structure.build');
        });

        // Parents and guardians
        Route::middleware('can.do:parents.invite')->group(function () {
            Route::get('/parents', [ParentsController::class, 'index'])->name('parents');
            Route::post('/parents', [ParentsController::class, 'invite'])->name('parents.invite');
            Route::post('/parents/{parent}/link', [ParentsController::class, 'link'])->name('parents.link');
        });

        // Look and icons
        Route::middleware('can.do:branding.manage')->group(function () {
            Route::get('/branding', [BrandingController::class, 'index'])->name('branding');
            Route::post('/branding', [BrandingController::class, 'save'])->name('branding.save');
        });

        // Design document (admins) and editing help pages
        Route::get('/design', [PagesController::class, 'design'])->middleware('can.do:design.view')->name('design');
        Route::middleware('can.do:help.manage')->group(function () {
            Route::post('/pages/preview', [PagesController::class, 'preview'])->name('pages.preview');
            Route::post('/pages/{kind}/{slug?}', [PagesController::class, 'save'])->where(['kind' => 'help|design', 'slug' => '[a-z0-9-]+'])->name('pages.save');
            Route::post('/pages/{kind}/{slug}/reset', [PagesController::class, 'reset'])->where(['kind' => 'help|design', 'slug' => '[a-z0-9-]+'])->name('pages.reset');
            Route::delete('/pages/help/{slug}', [PagesController::class, 'destroy'])->where('slug', '[a-z0-9-]+')->name('pages.destroy');
        });

        // Pop-ups and marquee lines
        Route::middleware('can.do:broadcasts.manage')->group(function () {
            Route::get('/broadcasts', [BroadcastsAdminController::class, 'index'])->name('broadcasts');
            Route::post('/broadcasts', [BroadcastsAdminController::class, 'store'])->name('broadcasts.store');
            Route::put('/broadcasts/{broadcast}', [BroadcastsAdminController::class, 'update'])->name('broadcasts.update');
            Route::post('/broadcasts/{broadcast}/pause', [BroadcastsAdminController::class, 'pause'])->name('broadcasts.pause');
            Route::delete('/broadcasts/{broadcast}', [BroadcastsAdminController::class, 'destroy'])->name('broadcasts.destroy');
        });

        // Face capture: review and send to the school's systems
        Route::middleware('can.do:faces.view')->group(function () {
            Route::get('/faces', [FacesAdminController::class, 'index'])->name('faces');
            Route::get('/faces/people/{id}', [FacesAdminController::class, 'person'])->whereNumber('id')->name('faces.person');
            Route::get('/faces/image/{id}', [FacesAdminController::class, 'image'])->whereNumber('id')->name('faces.image');
        });
        Route::middleware('can.do:faces.export')->group(function () {
            Route::post('/faces/target', [FacesAdminController::class, 'saveTarget'])->name('faces.target');
            Route::post('/faces/export', [FacesAdminController::class, 'export'])->middleware('throttle:10,1')->name('faces.export');
            Route::get('/faces/exports/{id}/download', [FacesAdminController::class, 'download'])->whereNumber('id')->name('faces.download');
            Route::delete('/faces/people/{id}', [FacesAdminController::class, 'forget'])->whereNumber('id')->name('faces.forget');
        });
    });

    Route::prefix('platform')->name('platform.')->middleware('can.do:platform.manage')->group(function () {
        Route::get('/institutions', [PlatformController::class, 'institutions'])->name('institutions');
        Route::post('/institutions/{institution}/status', [PlatformController::class, 'setStatus'])->name('institutions.status');
        Route::get('/institutions/{institution}', [PlatformBillingController::class, 'show'])->whereNumber('institution')->name('institutions.show');
        Route::post('/institutions/{institution}/subscription', [PlatformBillingController::class, 'updateSubscription'])->name('institutions.subscription');
        Route::post('/institutions/{institution}/trial', [PlatformBillingController::class, 'extendTrial'])->name('institutions.trial');
        Route::post('/institutions/{institution}/invoices', [PlatformBillingController::class, 'createInvoice'])->name('institutions.invoices');
        Route::post('/invoices/{invoice}/paid', [PlatformBillingController::class, 'markPaid'])->name('invoices.paid');
        Route::post('/invoices/{invoice}/void', [PlatformBillingController::class, 'voidInvoice'])->name('invoices.void');
        Route::get('/plans', [PlatformBillingController::class, 'plans'])->name('plans');
        Route::post('/plans', [PlatformBillingController::class, 'savePlan'])->name('plans.store');
        Route::post('/plans/{plan}', [PlatformBillingController::class, 'savePlan'])->name('plans.update');
        Route::get('/billing', [PlatformBillingController::class, 'settings'])->name('billing');
        Route::post('/billing', [PlatformBillingController::class, 'saveSettings'])->name('billing.save');
    });
});
