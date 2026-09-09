<?php
namespace local_crmbridge\task;

defined('MOODLE_INTERNAL') || die();

/**
 * Scheduled task (every 5 min, db/tasks.php): re-sends `failed` deliveries and
 * prunes `sent` rows older than a week. `dead` rows are left for an admin to
 * inspect on the settings page.
 */
class retry_failed extends \core\task\scheduled_task {

    public function get_name(): string {
        return get_string('task_retry_failed', 'local_crmbridge');
    }

    public function execute(): void {
        global $DB;

        $failed = $DB->get_records_select(
            'local_crmbridge_delivery',
            "status = :status AND attempts < 8",
            ['status' => 'failed'],
            'timemodified ASC',
            '*',
            0,
            50
        );
        foreach ($failed as $rec) {
            \local_crmbridge\webhook::send($rec);
        }

        $DB->delete_records_select(
            'local_crmbridge_delivery',
            "status = :status AND timemodified < :cutoff",
            ['status' => 'sent', 'cutoff' => time() - 7 * DAYSECS]
        );
    }
}
