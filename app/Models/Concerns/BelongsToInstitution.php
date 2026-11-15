<?php

namespace App\Models\Concerns;

use App\Models\Institution;
use App\Support\CurrentInstitution;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * Tenant isolation. Every query on a model using this trait is limited to the current institution,
 * and every new row is stamped with it. If no institution is set (and nobody asked to bypass),
 * queries return nothing instead of everything — failing closed.
 */
trait BelongsToInstitution
{
    public static function bootBelongsToInstitution(): void
    {
        static::addGlobalScope('institution', function (Builder $builder) {
            if (CurrentInstitution::bypassing()) {
                return;
            }
            $id = CurrentInstitution::id();
            $column = $builder->getModel()->qualifyColumn('institution_id');
            $id ? $builder->where($column, $id) : $builder->whereRaw('1 = 0');
        });

        static::creating(function ($model) {
            if (! $model->institution_id) {
                $model->institution_id = CurrentInstitution::id()
                    ?? throw new LogicException(static::class.' created without an institution.');
            }
        });
    }

    public function institution(): BelongsTo
    {
        return $this->belongsTo(Institution::class);
    }
}
