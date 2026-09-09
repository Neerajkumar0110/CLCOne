<?php
// Test tools + dead-letter viewer for local_crmbridge.

require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');

require_login();
$context = context_system::instance();
require_capability('moodle/site:config', $context);

$action = optional_param('action', '', PARAM_ALPHA);
$PAGE->set_context($context);
$PAGE->set_url(new moodle_url('/local/crmbridge/manage.php'));
$PAGE->set_pagelayout('admin');
$PAGE->set_title(get_string('testtools', 'local_crmbridge'));
$PAGE->set_heading(get_string('testtools', 'local_crmbridge'));

if ($action === 'test' && confirm_sesskey()) {
    $ok = \local_crmbridge\webhook::send_test();
    redirect(
        new moodle_url('/local/crmbridge/manage.php'),
        $ok ? get_string('testok', 'local_crmbridge') : get_string('testfail', 'local_crmbridge'),
        null,
        $ok ? \core\output\notification::NOTIFY_SUCCESS : \core\output\notification::NOTIFY_ERROR
    );
}

if ($action === 'requeue' && confirm_sesskey()) {
    $id = required_param('id', PARAM_INT);
    if ($rec = $DB->get_record('local_crmbridge_delivery', ['id' => $id])) {
        $rec->status = 'failed';
        $rec->attempts = 0;
        $DB->update_record('local_crmbridge_delivery', $rec);
        \local_crmbridge\webhook::send($rec);
    }
    redirect(new moodle_url('/local/crmbridge/manage.php'));
}

echo $OUTPUT->header();

echo html_writer::tag('p', get_string('ready', 'local_crmbridge') . ': '
    . (\local_crmbridge\webhook::is_ready() ? 'YES' : 'NO'));

echo $OUTPUT->single_button(
    new moodle_url('/local/crmbridge/manage.php', ['action' => 'test', 'sesskey' => sesskey()]),
    get_string('sendtest', 'local_crmbridge')
);

$rows = $DB->get_records('local_crmbridge_delivery', null, 'timemodified DESC', '*', 0, 100);
$table = new html_table();
$table->head = ['ID', 'Event', 'Status', 'Attempts', 'HTTP', 'Last error', 'Modified', ''];
foreach ($rows as $r) {
    $requeue = in_array($r->status, ['failed', 'dead'], true)
        ? html_writer::link(
            new moodle_url('/local/crmbridge/manage.php', ['action' => 'requeue', 'id' => $r->id, 'sesskey' => sesskey()]),
            get_string('requeue', 'local_crmbridge')
        )
        : '';
    $table->data[] = [
        $r->id,
        s($r->eventname),
        $r->status,
        $r->attempts,
        $r->httpcode,
        s((string) $r->lasterror),
        userdate($r->timemodified),
        $requeue,
    ];
}
echo html_writer::table($table);
echo $OUTPUT->footer();
