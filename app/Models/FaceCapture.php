<?php

namespace App\Models;

use App\Models\Concerns\BelongsToInstitution;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One photo in a face capture (front, left, right, up, down, mouth open, front again). The file is encrypted. */
class FaceCapture extends Model
{
    use BelongsToInstitution;

    protected $fillable = ['institution_id', 'face_enrollment_id', 'user_id', 'pose', 'path', 'mime', 'width', 'height', 'bytes', 'sha256', 'metrics', 'landmarks'];

    protected $hidden = ['path', 'landmarks'];

    protected function casts(): array
    {
        return ['metrics' => 'array'];
    }

    public function enrollment(): BelongsTo
    {
        return $this->belongsTo(FaceEnrollment::class, 'face_enrollment_id');
    }
}
