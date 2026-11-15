<?php

use App\Http\Controllers\Api;
use Illuminate\Support\Facades\Route;

// Public (rate limited)
Route::post('/auth/login', [Api\AuthController::class, 'login'])->middleware('throttle:20,1');

// Face capture inside the phone app: the ticket stands in for the sign-in (see FaceController).
Route::prefix('face/t/{ticket}')->where(['ticket' => '[A-Za-z0-9]{48}'])->middleware('throttle:60,1')->group(function () {
    Route::get('/', [Api\FaceController::class, 'show']);
    Route::post('/start', [Api\FaceController::class, 'start']);
    Route::post('/{uuid}/captures', [Api\FaceController::class, 'capture'])->whereUuid('uuid');
    Route::post('/{uuid}/complete', [Api\FaceController::class, 'complete'])->whereUuid('uuid');
    Route::get('/captures/{id}/image', [Api\FaceController::class, 'image'])->whereNumber('id');
    Route::delete('/', [Api\FaceController::class, 'destroy']);
});

Route::middleware(['auth:sanctum', 'member', 'throttle:api'])->group(function () {
    Route::post('/auth/logout', [Api\AuthController::class, 'logout']);
    Route::get('/me', [Api\MeController::class, 'show']);
    Route::get('/linked-devices', [Api\LinkedDevicesController::class, 'show']);
    Route::get('/broadcasts/active', [Api\BroadcastController::class, 'active']);
    Route::get('/help', [Api\HelpController::class, 'index']);
    Route::get('/help/{slug}', [Api\HelpController::class, 'show'])->where('slug', '[a-z0-9-]+');

    // Face capture (website; the phone app gets a ticket and opens the same page)
    Route::get('/face', [Api\FaceController::class, 'show']);
    Route::post('/face/start', [Api\FaceController::class, 'start'])->middleware('throttle:20,1');
    Route::post('/face/{uuid}/captures', [Api\FaceController::class, 'capture'])->whereUuid('uuid');
    Route::post('/face/{uuid}/complete', [Api\FaceController::class, 'complete'])->whereUuid('uuid');
    Route::get('/face/captures/{id}/image', [Api\FaceController::class, 'image'])->whereNumber('id');
    Route::delete('/face', [Api\FaceController::class, 'destroy']);
    Route::post('/face/ticket', [Api\FaceController::class, 'ticket'])->middleware('throttle:20,1');
    Route::post('/linked-devices/web', [Api\LinkedDevicesController::class, 'approve'])->middleware('throttle:20,1');
    Route::delete('/linked-devices/web', [Api\LinkedDevicesController::class, 'destroyWeb']);
    Route::get('/pulse', Api\PulseController::class);

    // Platform chat: platform owners ↔ each other ↔ school admins (the chat widget on the website).
    Route::prefix('platform-chat')->group(function () {
        Route::get('/', [Api\PlatformChatController::class, 'index']);
        Route::get('/people', [Api\PlatformChatController::class, 'people']);
        Route::post('/', [Api\PlatformChatController::class, 'start'])->middleware('throttle:30,1');
        Route::get('/{thread}/messages', [Api\PlatformChatController::class, 'messages'])->whereNumber('thread');
        Route::post('/{thread}/messages', [Api\PlatformChatController::class, 'send'])->whereNumber('thread')->middleware('throttle:60,1');
    });
    Route::get('/badges', [Api\PulseController::class, 'badges']);
    Route::get('/realtime', [Api\PulseController::class, 'settings']);
    Route::post('/me/accept-policies', [Api\MeController::class, 'acceptPolicies']);
    Route::post('/members/{userId}/guardian-consent', [Api\MeController::class, 'recordGuardianConsent']);

    Route::post('/devices', [Api\DeviceController::class, 'register']);
    Route::patch('/devices/{id}', [Api\DeviceController::class, 'updatePushToken']);
    Route::delete('/devices/{id}', [Api\DeviceController::class, 'destroy']);

    // Sync (phones): one pull, one push — minimal data
    Route::get('/sync', [Api\SyncController::class, 'pull']);
    Route::post('/sync', [Api\SyncController::class, 'push']);

    // Offline mesh
    Route::post('/mesh/relay', [Api\MeshController::class, 'relay'])->middleware('throttle:30,1');
    Route::get('/mesh/inbox', [Api\MeshController::class, 'inbox']);
    Route::get('/mesh/contact-keys', [Api\DirectoryController::class, 'contactKeys']);

    // Chat (needs chat.use — blocked for under-18 members until guardian consent is recorded)
    Route::middleware('can.do:chat.use')->group(function () {
    Route::get('/conversations', [Api\ConversationController::class, 'index']);
    Route::post('/conversations/direct', [Api\ConversationController::class, 'direct']);
    Route::post('/conversations/group', [Api\ConversationController::class, 'group']);
    Route::get('/conversations/{conversation}', [Api\ConversationController::class, 'show'])->whereNumber('conversation');
    Route::get('/conversations/{conversation}/messages', [Api\ConversationController::class, 'messages']);
    Route::get('/conversations/{conversation}/members', [Api\ConversationController::class, 'members']);
    Route::get('/conversations/{conversation}/search', [Api\ConversationController::class, 'search'])->middleware('throttle:30,1');
    Route::post('/conversations/{conversation}/members', [Api\ConversationController::class, 'addMember']);
    Route::delete('/conversations/{conversation}/members/{userId}', [Api\ConversationController::class, 'removeMember']);
    Route::patch('/conversations/{conversation}/members/{userId}', [Api\ConversationController::class, 'setRole']);
    Route::patch('/conversations/{conversation}', [Api\ConversationController::class, 'settings']);
    Route::post('/conversations/{conversation}/read', [Api\ConversationController::class, 'read']);
    Route::post('/conversations/{conversation}/messages', [Api\MessageController::class, 'store'])->middleware('throttle:60,1');
    Route::patch('/messages/{message}', [Api\MessageController::class, 'update']);
    Route::delete('/messages/{message}', [Api\MessageController::class, 'destroy']);
    Route::post('/messages/{message}/report', [Api\MessageController::class, 'report']);
    Route::get('/directory', [Api\DirectoryController::class, 'search'])->middleware('throttle:60,1');
    Route::get('/chat-requests', [Api\ChatRequestController::class, 'index']);
    Route::post('/chat-requests', [Api\ChatRequestController::class, 'store'])->middleware('throttle:20,1');
    Route::post('/chat-requests/{id}/accept', [Api\ChatRequestController::class, 'accept'])->whereNumber('id');
    Route::post('/chat-requests/{id}/decline', [Api\ChatRequestController::class, 'decline'])->whereNumber('id');
    Route::post('/chat-requests/responses/seen', [Api\ChatRequestController::class, 'seen']);
    Route::delete('/chat-requests/{id}', [Api\ChatRequestController::class, 'cancel'])->whereNumber('id');
    });

    // SOS + safety
    Route::get('/sos', [Api\SosController::class, 'index']);
    Route::post('/sos', [Api\SosController::class, 'store'])->middleware('throttle:10,1');
    Route::post('/sos/{alert}/respond', [Api\SosController::class, 'respond']);
    Route::get('/safety-checks', [Api\SafetyCheckController::class, 'index']);
    Route::post('/safety-checks', [Api\SafetyCheckController::class, 'store'])->middleware('can.do:safety_checks.create');
    Route::post('/safety-checks/{check:uuid}/respond', [Api\SafetyCheckController::class, 'respond']);
    Route::get('/safety-checks/{check:uuid}/results', [Api\SafetyCheckController::class, 'results']);

    // Announcements, status, calls, files
    Route::get('/announcements', [Api\AnnouncementController::class, 'index']);
    Route::post('/announcements', [Api\AnnouncementController::class, 'store'])->middleware('can.do:announcements.create');
    Route::put('/announcements/{announcement}', [Api\AnnouncementController::class, 'update']);
    Route::delete('/announcements/{announcement}', [Api\AnnouncementController::class, 'destroy']);
    Route::get('/status', [Api\StatusController::class, 'index']);
    Route::post('/status', [Api\StatusController::class, 'store'])->middleware('throttle:20,60');
    Route::post('/status/{status}/view', [Api\StatusController::class, 'view']);
    Route::get('/status/{status}/viewers', [Api\StatusController::class, 'viewers']);
    Route::delete('/status/{status}', [Api\StatusController::class, 'destroy']);
    Route::post('/status/{status}/react', [Api\StatusController::class, 'react'])->middleware('throttle:60,1');
    Route::get('/status/{status}/comments', [Api\StatusController::class, 'comments']);
    Route::post('/status/{status}/comments', [Api\StatusController::class, 'addComment'])->middleware('throttle:30,1');
    Route::delete('/status/{status}/comments/{comment}', [Api\StatusController::class, 'deleteComment']);
    Route::post('/status/{status}/reply', [Api\StatusController::class, 'reply'])->middleware(['can.do:chat.use', 'throttle:30,1']);
    Route::get('/calls', [Api\CallController::class, 'index']);
    Route::get('/calls/ice-servers', [Api\CallController::class, 'iceServers']);
    Route::post('/calls/seen', [Api\CallController::class, 'seen']);
    Route::get('/calls/pending', [Api\CallController::class, 'pending']);
    Route::post('/calls', [Api\CallController::class, 'start']);
    Route::post('/calls/{uuid}/signal', [Api\CallController::class, 'signal'])->middleware('throttle:300,1');
    Route::post('/calls/{uuid}/state', [Api\CallController::class, 'update']);
    Route::post('/conversations/{conversation}/call', [Api\GroupCallController::class, 'start'])->middleware('throttle:10,1');
    Route::get('/conversations/{conversation}/call', [Api\GroupCallController::class, 'current']);
    Route::get('/group-calls/{uuid}', [Api\GroupCallController::class, 'show']);
    Route::post('/group-calls/{uuid}/join', [Api\GroupCallController::class, 'join'])->middleware('throttle:20,1');
    Route::post('/group-calls/{uuid}/signal', [Api\GroupCallController::class, 'signal'])->middleware('throttle:600,1');
    Route::post('/group-calls/{uuid}/ping', [Api\GroupCallController::class, 'ping']);
    Route::post('/group-calls/{uuid}/leave', [Api\GroupCallController::class, 'leave']);
    Route::post('/uploads', [Api\UploadController::class, 'store'])->middleware('throttle:30,1');
    Route::get('/files/{institution}/{name}', [Api\UploadController::class, 'show']);

    // Privacy rights
    Route::get('/privacy/export', [Api\PrivacyController::class, 'export'])->middleware('throttle:3,60');
    Route::post('/privacy/requests', [Api\PrivacyController::class, 'request']);
    Route::delete('/privacy/account', [Api\PrivacyController::class, 'destroyAccount']);
});
