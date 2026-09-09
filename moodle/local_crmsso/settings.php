<?php
// Admin settings — Site administration > Plugins > Local plugins > CRM SSO.

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_crmsso', get_string('pluginname', 'local_crmsso'));

    $settings->add(new admin_setting_configpasswordunmask(
        'local_crmsso/secret',
        get_string('secret', 'local_crmsso'),
        get_string('secret_desc', 'local_crmsso'),
        ''
    ));

    $settings->add(new admin_setting_configtext(
        'local_crmsso/issuer',
        get_string('issuer', 'local_crmsso'),
        get_string('issuer_desc', 'local_crmsso'),
        'clc-crm',
        PARAM_RAW_TRIMMED
    ));

    $settings->add(new admin_setting_configtext(
        'local_crmsso/audience',
        get_string('audience', 'local_crmsso'),
        get_string('audience_desc', 'local_crmsso'),
        'moodle',
        PARAM_RAW_TRIMMED
    ));

    $settings->add(new admin_setting_configcheckbox(
        'local_crmsso/autocreate',
        get_string('autocreate', 'local_crmsso'),
        get_string('autocreate_desc', 'local_crmsso'),
        1
    ));

    $settings->add(new admin_setting_configtext(
        'local_crmsso/crmreturnurl',
        get_string('crmreturnurl', 'local_crmsso'),
        get_string('crmreturnurl_desc', 'local_crmsso'),
        '',
        PARAM_URL
    ));

    $ADMIN->add('localplugins', $settings);
}
