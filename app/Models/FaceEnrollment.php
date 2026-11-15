<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One guided face capture by one person (a new capture replaces the previous one when it is finished). */
class FaceEnrollment extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'user_id', 'uuid', 'status', 'device', 'liveness', 'quality', 'consent_version', 'consent_at',
        'completed_at', 'exported_file_at', 'exported_db_at'];

    protected function casts(): array
    {
        return [
            'liveness' => 'array', 'quality' => 'float', 'consent_at' => 'datetime', 'completed_at' => 'datetime',
            'exported_file_at' => 'datetime', 'exported_db_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function captures(): HasMany
    {
        return $this->hasMany(FaceCapture::class);
    }
}
