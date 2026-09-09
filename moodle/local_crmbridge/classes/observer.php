<?php
namespace local_crmbridge;

defined('MOODLE_INTERNAL') || die();

/**
 * Single entry point for every observed event (see db/events.php). Extracts a
 * flat payload and queues an adhoc task so the originating request is never
 * blocked on the outbound HTTP call.
 */
class observer {

    public static function dispatch(\core\event\base $event): void {
        if (!webhook::is_ready()) {
            return; // nothing configured — drop silently, the CRM reconcile job backfills
        }

        $data = $event->get_data();
        $payload = [
            'eventname'     => $data['eventname'] ?? get_class($event),
            'action'        => $data['action'] ?? null,
            'objecttable'   => $data['objecttable'] ?? null,
            'objectid'      => $data['objectid'] ?? null,
            'courseid'      => $data['courseid'] ?? null,
            'contextid'     => $data['contextid'] ?? null,
            'contextlevel'  => $data['contextlevel'] ?? null,
            'contextinstanceid' => $data['contextinstanceid'] ?? null,
            'userid'        => $data['userid'] ?? null,
            'relateduserid' => $data['relateduserid'] ?? null,
            'timecreated'   => $data['timecreated'] ?? time(),
            'other'         => $data['other'] ?? null,
        ];
        // Flatten a few common `other` keys the CRM handlers look for.
        if (is_array($payload['other'])) {
            foreach (['timecompleted', 'grade', 'code', 'certificatecode', 'verifyurl', 'badgeid'] as $k) {
                if (array_key_exists($k, $payload['other'])) {
                    $payload[$k] = $payload['other'][$k];
                }
            }
        }

        $eventid = $data['eventname'] . ':' . ($data['id'] ?? '') . ':' . ($data['timecreated'] ?? time())
            . ':' . ($data['objectid'] ?? '') . ':' . ($data['relateduserid'] ?? $data['userid'] ?? '');

        $task = new \local_crmbridge\task\deliver();
        $task->set_custom_data([
            'eventid'   => $eventid,
            'eventname' => $payload['eventname'],
            'payload'   => $payload,
        ]);
        \core\task\manager::queue_adhoc_task($task, true);
    }
}
