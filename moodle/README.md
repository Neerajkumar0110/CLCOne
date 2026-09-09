# Moodle plugins for the CLC CRM LMS

Two frankenstyle `local` plugins that connect a Moodle 4.3+ site to the CLC
CRM. They are the Moodle half of the integration layer described in the
**Moodle LMS Build Blueprint** (Section 04) and paired with
`backend/src/services/lms/` on the CRM side.

| Plugin | Direction | Job |
| --- | --- | --- |
| `local_crmbridge` | Moodle → CRM | Observes learning events and POSTs them to `<<crm>>/api/lms/webhook/moodle` as HMAC-signed webhooks, with a delivery log / dead-letter and a retry task. |
| `local_crmsso` | CRM → Moodle | Exchanges a short-lived, single-use JWT minted by the CRM for a Moodle session — users never see a Moodle login form. |

## Install

```bash
# on the Moodle server
cp -r moodle/local_crmbridge  /path/to/moodle/local/crmbridge
cp -r moodle/local_crmsso     /path/to/moodle/local/crmsso
sudo -u www-data php /path/to/moodle/admin/cli/upgrade.php --non-interactive
```

Then, in *Site administration → Plugins → Local plugins*:

### CRM bridge
- **Enable event delivery**: on
- **CRM base URL**: `https://app.yourdomain.com` (no trailing slash)
- **Webhook HMAC secret**: same value as `MOODLE_WEBHOOK_HMAC_SECRET` in the CRM env
- **API key**: same as `MOODLE_WEBHOOK_KEY` (or leave both blank)
- Open **test tools** (`/local/crmbridge/manage.php`) → **Send test event** → expect "delivered".

### CRM SSO
- **Shared signing key**: same as `MOODLE_SSO_SECRET` in the CRM env
- **Expected issuer / audience**: `clc-crm` / `moodle` (match `MOODLE_SSO_ISSUER` / `MOODLE_SSO_AUDIENCE`)
- **Auto-create unknown users**: on (safety net)
- **CRM return URL**: `https://app.yourdomain.com/logout`

## Events sent

`local_crmbridge` observes (keep in step with `HANDLERS` in
`backend/src/controllers/appControllers/lmsController/webhook.js`):

- `\core\event\user_enrolment_created` / `_deleted`
- `\core\event\course_completed`
- `\mod_quiz\event\attempt_submitted`
- `\mod_assign\event\submission_graded`
- `\core\event\badge_awarded`
- `\tool_customcert\event\certificate_issued`

## Signing scheme (both directions)

```
signature = HMAC_SHA256( "{timestamp}.{nonce}.{rawBody}", secret )   // hex
headers   = x-crm-key, x-crm-timestamp, x-crm-nonce, x-crm-signature
```

Identical to `backend/src/services/lms/httpSign.js`. The CRM verifies inbound
webhooks in `backend/src/middlewares/moodleWebhookAuth.js`; `local_crmsso`
verifies the JWT in `classes/jwt.php`.

## Delivery / retry

- The observer queues a `\local_crmbridge\task\deliver` **adhoc task** so the
  originating request never blocks on HTTP. Run Moodle cron often (or enable
  *fast cron*) in production.
- `\local_crmbridge\task\retry_failed` runs every 5 min: re-sends `failed`
  rows (up to 8 attempts, then `dead`) and prunes `sent` rows after a week.
- The CRM side also reconciles nightly, so a lost webhook self-heals.

## Status

Phase 1 scaffold — installs, configures, sends/verifies. Custom bulk external
functions (course-card data for N courses in one call) land in Phase 2; the
BBB and recording events in Phase 6.
