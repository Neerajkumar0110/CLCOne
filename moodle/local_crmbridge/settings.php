<?php
// Admin settings — Site administration > Plugins > Local plugins > CRM bridge.

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_crmbridge', get_string('pluginname', 'local_crmbridge'));

    $settings->add(new admin_setting_configcheckbox(
        'local_crmbridge/enabled',
        get_string('enabled', 'local_crmbridge'),
        get_string('enabled_desc', 'local_crmbridge'),
        0
    ));

    $settings->add(new admin_setting_configtext(
        'local_crmbridge/crmurl',
        get_string('crmurl', 'local_crmbridge'),
        get_string('crmurl_desc', 'local_crmbridge'),
        '',
        PARAM_URL
    ));

    $settings->add(new admin_setting_configpasswordunmask(
        'local_crmbridge/hmacsecret',
        get_string('hmacsecret', 'local_crmbridge'),
        get_string('hmacsecret_desc', 'local_crmbridge'),
        ''
    ));

    $settings->add(new admin_setting_configtext(
        'local_crmbridge/apikey',
        get_string('apikey', 'local_crmbridge'),
        get_string('apikey_desc', 'local_crmbridge'),
        '',
        PARAM_RAW_TRIMMED
    ));

    $settings->add(new admin_setting_configtext(
        'local_crmbridge/timeout',
        get_string('timeout', 'local_crmbridge'),
        get_string('timeout_desc', 'local_crmbridge'),
        '10',
        PARAM_INT
    ));

    // Link to the test page (renders the "send test event" button + dead-letter list).
    $settings->add(new admin_setting_description(
        'local_crmbridge/testlink',
        get_string('testtools', 'local_crmbridge'),
        html_writer::link(
            new moodle_url('/local/crmbridge/manage.php'),
            get_string('opentesttools', 'local_crmbridge')
        )
    ));

    $ADMIN->add('localplugins', $settings);
}
