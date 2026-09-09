<?php
// Language strings for local_crmsso.

defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'CRM SSO';
$string['secret'] = 'Shared signing key';
$string['secret_desc'] = 'HS256 key shared with the CRM. Must match MOODLE_SSO_SECRET in the CRM environment.';
$string['issuer'] = 'Expected issuer (iss)';
$string['issuer_desc'] = 'Rejected unless the token\'s iss claim matches. Match MOODLE_SSO_ISSUER in the CRM.';
$string['audience'] = 'Expected audience (aud)';
$string['audience_desc'] = 'Rejected unless the token\'s aud claim matches. Match MOODLE_SSO_AUDIENCE in the CRM.';
$string['autocreate'] = 'Auto-create unknown users';
$string['autocreate_desc'] = 'If a verified token has no matching Moodle account (by idnumber or email), create one on the fly. Recommended on as a safety net; the CRM sync worker normally provisions accounts first.';
$string['crmreturnurl'] = 'CRM return URL';
$string['crmreturnurl_desc'] = 'Where /local/crmsso/logout.php sends the browser after ending the Moodle session, e.g. https://app.yourdomain.com/logout.';
$string['notconfigured'] = 'CRM SSO is not configured — set the shared signing key.';
$string['badtoken'] = 'The single sign-on token could not be verified.';
$string['nouser'] = 'No Moodle account is linked to this CRM user, and auto-create is off.';
$string['suspended'] = 'This account is suspended.';
$string['privacy:metadata'] = 'The CRM SSO plugin does not store personal data. It reads name and email from a signed token to keep the linked Moodle account in step, and caches spent token ids briefly to prevent replay.';
