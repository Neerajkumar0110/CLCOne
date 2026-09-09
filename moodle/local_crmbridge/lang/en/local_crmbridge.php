<?php
// Language strings for local_crmbridge.

defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'CRM bridge';
$string['enabled'] = 'Enable event delivery';
$string['enabled_desc'] = 'When off, events are dropped silently and the CRM reconciliation job backfills. Turn on once the CRM URL and secret are set.';
$string['crmurl'] = 'CRM base URL';
$string['crmurl_desc'] = 'Root URL of the CLC CRM, e.g. https://app.yourdomain.com. Events are POSTed to {this}/api/lms/webhook/moodle.';
$string['hmacsecret'] = 'Webhook HMAC secret';
$string['hmacsecret_desc'] = 'Must match MOODLE_WEBHOOK_HMAC_SECRET in the CRM environment. Used to sign every delivery.';
$string['apikey'] = 'API key (optional)';
$string['apikey_desc'] = 'Sent as the x-crm-key header. Match MOODLE_WEBHOOK_KEY in the CRM environment, or leave both blank.';
$string['timeout'] = 'HTTP timeout (seconds)';
$string['timeout_desc'] = 'Per-request timeout when POSTing to the CRM.';
$string['testtools'] = 'CRM bridge — test tools';
$string['opentesttools'] = 'Open test tools & delivery log';
$string['sendtest'] = 'Send test event';
$string['testok'] = 'Test event delivered to the CRM.';
$string['testfail'] = 'Test event was not accepted — check the delivery log below.';
$string['ready'] = 'Configured and ready';
$string['requeue'] = 'Re-queue';
$string['task_deliver'] = 'Deliver a CRM webhook event';
$string['task_retry_failed'] = 'Retry failed CRM webhook deliveries';
$string['privacy:metadata'] = 'The CRM bridge plugin transmits event metadata (user ids, course ids, activity ids, grades and completion timestamps) to the connected CLC CRM so the two systems stay in sync. It stores a short-lived delivery log locally.';
