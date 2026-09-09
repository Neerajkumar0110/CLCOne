<?php
// Scheduled tasks. The heavy lifting is done by the adhoc task queued from
// the observer; this scheduled task only re-sends failed deliveries and
// prunes old successful ones.

defined('MOODLE_INTERNAL') || die();

$tasks = [
    [
        'classname' => '\local_crmbridge\task\retry_failed',
        'blocking'  => 0,
        'minute'    => '*/5',
        'hour'      => '*',
        'day'       => '*',
        'month'     => '*',
        'dayofweek' => '*',
    ],
];
