<?php
namespace local_crmbridge;

defined('MOODLE_INTERNAL') || die();

/**
 * Builds, signs and sends the CRM webhook. The signing scheme is identical
 * to the CRM's backend/src/services/lms/httpSign.js:
 *
 *   signature = HMAC_SHA256( "{timestamp}.{nonce}.{rawBody}", secret )  (hex)
 *
 * Headers: x-crm-key, x-crm-timestamp, x-crm-nonce, x-crm-signature.
 */
class webhook {

    /** @return array [component-relative config] */
    public static function config(): array {
        return [
            'enabled' => (bool) get_config('local_crmbridge', 'enabled'),
            'url'     => rtrim((string) get_config('local_crmbridge', 'crmurl'), '/'),
            'key'     => (string) get_config('local_crmbridge', 'apikey'),
            'secret'  => (string) get_config('local_crmbridge', 'hmacsecret'),
            'timeout' => (int) (get_config('local_crmbridge', 'timeout') ?: 10),
        ];
    }

    public static function is_ready(): bool {
        $c = self::config();
        return $c['enabled'] && $c['url'] !== '' && $c['secret'] !== '';
    }

    /**
     * Persist an event as a pending delivery and try to send it now. Called
     * from the adhoc task so the observer never blocks the request.
     *
     * @param string $eventid   unique, monotonic
     * @param string $eventname e.g. \core\event\course_completed
     * @param array  $payload   event-specific data
     */
    public static function queue_and_send(string $eventid, string $eventname, array $payload): void {
        global $DB, $CFG;

        if ($DB->record_exists('local_crmbridge_delivery', ['eventid' => $eventid])) {
            return; // already handled
        }

        $now = time();
        $envelope = [
            'eventid'   => $eventid,
            'eventname' => $eventname,
            'timestamp' => $now,
            'host'      => parse_url($CFG->wwwroot, PHP_URL_HOST),
            'payload'   => $payload,
        ];
        $body = json_encode($envelope, JSON_UNESCAPED_SLASHES);

        $rec = (object) [
            'eventid'      => $eventid,
            'eventname'    => $eventname,
            'payload'      => $body,
            'status'      => 'pending',
            'attempts'     => 0,
            'timecreated'  => $now,
            'timemodified' => $now,
        ];
        $rec->id = $DB->insert_record('local_crmbridge_delivery', $rec);

        self::send($rec);
    }

    /**
     * Send one delivery row. Updates its status/attempts in place.
     */
    public static function send(\stdClass $rec): bool {
        global $DB;

        $c = self::config();
        if (!self::is_ready()) {
            $rec->status = 'failed';
            $rec->lasterror = 'local_crmbridge is not configured (url / secret / enabled).';
            $rec->timemodified = time();
            $DB->update_record('local_crmbridge_delivery', $rec);
            return false;
        }

        $timestamp = (string) time();
        $nonce = bin2hex(random_bytes(16));
        $signature = hash_hmac('sha256', $timestamp . '.' . $nonce . '.' . $rec->payload, $c['secret']);

        $ch = curl_init($c['url'] . '/api/lms/webhook/moodle');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $rec->payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $c['timeout'],
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'x-crm-key: ' . $c['key'],
                'x-crm-timestamp: ' . $timestamp,
                'x-crm-nonce: ' . $nonce,
                'x-crm-signature: ' . $signature,
            ],
        ]);
        $response = curl_exec($ch);
        $httpcode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $curlerr = curl_error($ch);
        curl_close($ch);

        $rec->attempts += 1;
        $rec->httpcode = $httpcode;
        $rec->timemodified = time();

        if ($curlerr === '' && $httpcode >= 200 && $httpcode < 300) {
            $rec->status = 'sent';
            $rec->lasterror = null;
            $DB->update_record('local_crmbridge_delivery', $rec);
            return true;
        }

        $rec->lasterror = $curlerr !== '' ? $curlerr : ('HTTP ' . $httpcode . ' ' . substr((string) $response, 0, 500));
        $rec->status = $rec->attempts >= 8 ? 'dead' : 'failed';
        $DB->update_record('local_crmbridge_delivery', $rec);
        return false;
    }

    /** Send a synthetic "ping" event — used by the settings-page test button. */
    public static function send_test(): bool {
        $eventid = 'test-' . uniqid('', true);
        self::queue_and_send($eventid, '\local_crmbridge\event\ping', [
            'note' => 'Test event from local_crmbridge',
            'time' => time(),
        ]);
        global $DB;
        $rec = $DB->get_record('local_crmbridge_delivery', ['eventid' => $eventid]);
        return $rec && $rec->status === 'sent';
    }
}
