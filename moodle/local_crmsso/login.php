<?php
// GET /local/crmsso/login.php?token=<jwt>
//
// Verifies the CRM-minted JWT, resolves (or lazily provisions) the Moodle
// account by idnumber, starts the session and redirects to `wantsurl`.
// The CRM builds this URL in backend/src/services/lms/ssoToken.js.

require(__DIR__ . '/../../config.php');
require_once($CFG->dirroot . '/user/lib.php');

$token = required_param('token', PARAM_RAW);

$secret   = (string) get_config('local_crmsso', 'secret');
$issuer   = (string) (get_config('local_crmsso', 'issuer') ?: 'clc-crm');
$audience = (string) (get_config('local_crmsso', 'audience') ?: 'moodle');
$autocreate = (bool) get_config('local_crmsso', 'autocreate');

if ($secret === '') {
    throw new \moodle_exception('notconfigured', 'local_crmsso');
}

$claims = \local_crmsso\jwt::verify($token, $secret, $issuer, $audience);

// single-use: reject a jti we've already seen
$cache = cache::make('local_crmsso', 'spentjti');
if ($cache->get($claims['jti'])) {
    throw new \moodle_exception('badtoken', 'local_crmsso', '', 'replayed');
}
$cache->set($claims['jti'], time());

$idnumber = (string) $claims['sub'];
$user = $DB->get_record('user', ['idnumber' => $idnumber, 'deleted' => 0, 'mnethostid' => $CFG->mnet_localhost_id]);

if (!$user && !empty($claims['eml'])) {
    // fall back to an email match, then adopt the idnumber
    $user = $DB->get_record('user', ['email' => core_text::strtolower($claims['eml']), 'deleted' => 0, 'mnethostid' => $CFG->mnet_localhost_id]);
    if ($user) {
        $DB->set_field('user', 'idnumber', $idnumber, ['id' => $user->id]);
        $user->idnumber = $idnumber;
    }
}

if (!$user) {
    if (!$autocreate) {
        throw new \moodle_exception('nouser', 'local_crmsso');
    }
    // Lazy provision — the CRM sync worker normally does this first; this is
    // the safety net so a first login is never a dead end.
    $new = new stdClass();
    $new->auth = 'manual';
    $new->confirmed = 1;
    $new->mnethostid = $CFG->mnet_localhost_id;
    $new->username = 'crm.' . substr($idnumber, -12) . '.' . substr(md5($idnumber), 0, 6);
    $new->email = !empty($claims['eml']) ? core_text::strtolower($claims['eml']) : ($new->username . '@example.invalid');
    $names = preg_split('/\s+/', trim((string) ($claims['name'] ?? 'CRM User')), 2);
    $new->firstname = $names[0] ?: 'CRM';
    $new->lastname = $names[1] ?? 'User';
    $new->idnumber = $idnumber;
    $new->password = 'not-cached';
    $new->id = user_create_user($new, false, false);
    $user = $DB->get_record('user', ['id' => $new->id]);
}

if (!empty($user->suspended)) {
    throw new \moodle_exception('suspended', 'local_crmsso');
}

// keep names in step with the CRM on every hop
$dirty = false;
if (!empty($claims['name'])) {
    $names = preg_split('/\s+/', trim((string) $claims['name']), 2);
    if ($names[0] && $user->firstname !== $names[0]) { $user->firstname = $names[0]; $dirty = true; }
    if (isset($names[1]) && $user->lastname !== $names[1]) { $user->lastname = $names[1]; $dirty = true; }
}
if (!empty($claims['eml']) && $user->email !== core_text::strtolower($claims['eml'])) {
    $user->email = core_text::strtolower($claims['eml']);
    $dirty = true;
}
if ($dirty) {
    user_update_user($user, false, false);
}

// start the session
complete_user_login($user);

$wantsurl = isset($claims['wantsurl']) ? (string) $claims['wantsurl'] : '/my/';
if (!preg_match('#^/[A-Za-z0-9/_\-.?=&%]*$#', $wantsurl)) {
    $wantsurl = '/my/';
}
redirect(new moodle_url($wantsurl));
