<?php

return [
    /*
     * Our React pages live in resources/js/pages (lower-case "pages"). Inertia's test helper looks in
     * resources/js/Pages by default, which only works on Windows/macOS where folder names ignore case;
     * on Linux (GitHub Actions, the server) it must be told the real folder.
     */
    'testing' => [
        'ensure_pages_exist' => true,
        'page_paths' => [resource_path('js/pages')],
        'page_extensions' => ['js', 'jsx', 'svelte', 'ts', 'tsx', 'vue'],
    ],
];
