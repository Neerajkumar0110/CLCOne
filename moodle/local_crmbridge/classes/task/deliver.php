<?php
namespace local_crmbridge\task;

defined('MOODLE_INTERNAL') || die();

/**
 * Adhoc task queued by the observer for each event. Runs on the next cron
 * pass (or immediately with a fast cron) and hands the event to
 * \local_crmbridge\webhook for signing + delivery.
 */
class deliver extends \core\task\adhoc_task {

    public function get_name(): string {
        return get_string('task_deliver', 'local_crmbridge');
    }

    public function execute(): void {
        $data = (array) $this->get_custom_data();
        if (empty($data['eventid']) || empty($data['eventname'])) {
            return;
        }
        \local_crmbridge\webhook::queue_and_send(
            (string) $data['eventid'],
            (string) $data['eventname'],
            (array) ($data['payload'] ?? [])
        );
    }
}
