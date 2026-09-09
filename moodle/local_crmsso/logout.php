<?php
// GET /local/crmsso/logout.php  — ends the Moodle session, then bounces back
// to the CRM (or Moodle's front page). The CRM calls this alongside its own
// logout so a user is never left with a stale Moodle session.

require(__DIR__ . '/../../config.php');

if (isloggedin() && !isguestuser()) {
    require_logout();
}

$return = optional_param('return', '', PARAM_LOCALURL);
$crmurl = (string) get_config('local_crmsso', 'crmreturnurl');

if ($crmurl !== '') {
    redirect(new moodle_url($crmurl));
}
redirect(new moodle_url($return !== '' ? $return : '/'));
