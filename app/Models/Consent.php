<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Consent extends Model
{
    protected $fillable = ['user_id', 'kind', 'version', 'granted', 'ip_address', 'user_agent'];

    protected function casts(): array
    {
        return ['granted' => 'boolean'];
    }
}
