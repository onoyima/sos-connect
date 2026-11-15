<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InstitutionConnector extends Model
{
    protected $fillable = ['institution_id', 'base_url', 'key_id', 'secret', 'db_settings', 'query_set', 'sync_directory', 'last_tested_at', 'last_test_ok', 'last_error'];

    protected $hidden = ['secret', 'db_settings'];

    protected function casts(): array
    {
        return [
            'secret' => 'encrypted',
            'db_settings' => 'encrypted:array',
            'sync_directory' => 'boolean',
            'last_test_ok' => 'boolean',
            'last_tested_at' => 'datetime',
        ];
    }

    public function institution(): BelongsTo
    {
        return $this->belongsTo(Institution::class);
    }
}
