<?php
// local_crmsso — logs a user in from a short-lived JWT minted by the CLC CRM.
// The CRM is the identity provider; normal users never see a Moodle login
// form. See the CRM repo: backend/src/services/lms/ssoToken.js.

defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_crmsso';
$plugin->version   = 2026090900;
$plugin->requires  = 2023100900;      // Moodle 4.3+
$plugin->maturity  = MATURITY_ALPHA;
$plugin->release   = '0.1.0 (Phase 1 scaffold)';
