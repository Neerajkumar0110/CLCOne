<?php
// local_crmbridge — pushes Moodle events to the CLC CRM as signed webhooks.
// Part of the LMS integration (see the CRM repo: backend/src/services/lms/,
// backend/src/controllers/appControllers/lmsController/webhook.js).

defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_crmbridge';
$plugin->version   = 2026090900;      // YYYYMMDDXX
$plugin->requires  = 2023100900;      // Moodle 4.3+
$plugin->maturity  = MATURITY_ALPHA;
$plugin->release   = '0.1.0 (Phase 1 scaffold)';
