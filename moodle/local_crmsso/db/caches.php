<?php
// Cache definitions. `spentjti` records single-use SSO token ids so a token
// can never be replayed within its (short) lifetime.

defined('MOODLE_INTERNAL') || die();

$definitions = [
    'spentjti' => [
        'mode'        => cache_store::MODE_APPLICATION,
        'simplekeys'  => true,
        'ttl'         => 300,
        'canuselocalstore' => true,
    ],
];
