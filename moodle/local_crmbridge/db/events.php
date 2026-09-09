<?php
// Event observers. Each fires local_crmbridge\observer::dispatch(), which
// queues an adhoc task that POSTs a signed envelope to the CRM. Keep this
// list in step with the HANDLERS map in the CRM's lmsController/webhook.js.

defined('MOODLE_INTERNAL') || die();

$observers = [
    [
        'eventname'   => '\core\event\user_enrolment_created',
        'callback'    => '\local_crmbridge\observer::dispatch',
    ],
    [
        'eventname'   => '\core\event\user_enrolment_deleted',
        'callback'    => '\local_crmbridge\observer::dispatch',
    ],
    [
        'eventname'   => '\core\event\course_completed',
        'callback'    => '\local_crmbridge\observer::dispatch',
    ],
    [
        'eventname'   => '\mod_quiz\event\attempt_submitted',
        'callback'    => '\local_crmbridge\observer::dispatch',
    ],
    [
        'eventname'   => '\mod_assign\event\submission_graded',
        'callback'    => '\local_crmbridge\observer::dispatch',
    ],
    [
        'eventname'   => '\core\event\badge_awarded',
        'callback'    => '\local_crmbridge\observer::dispatch',
    ],
    [
        'eventname'   => '\tool_customcert\event\certificate_issued',
        'callback'    => '\local_crmbridge\observer::dispatch',
    ],
];
