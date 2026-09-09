# CLC LMS — BigBlueButton (dedicated host)

Phase 0. Live classes for the LMS. BBB runs its **own** nginx, media servers
(Kurento/mediasoup), FreeSWITCH and Docker — it cannot share the CRM/Moodle/
Asterisk VPS. Provision a separate server.

## Server spec

| | Minimum | Comfortable (≈150 concurrent) |
| --- | --- | --- |
| OS | Ubuntu 22.04 LTS (clean) | same |
| CPU | 8 vCPU | 16 vCPU |
| RAM | 16 GB | 16–32 GB |
| Disk | 500 GB SSD (recordings) | 1 TB SSD |
| Network | 250 Mbit/s symmetric, public IPv4 | 1 Gbit/s |
| Ports | 22, 80, 443 tcp · 16384–32768 udp | same |

Plan a **Scalelite** cluster before scaling past one BBB server (Blueprint §12).

## Install

1. Point DNS: `bbb.yourdomain.com  A  <server-ip>`.
2. Run:
   ```bash
   DOMAIN=bbb.yourdomain.com EMAIL=ops@yourorg.com \
     bash /path/to/clccrm/deploy/bbb/setup.sh
   ```
   Wraps the upstream `bbb-install.sh` (BBB 2.7 / `jammy-270`), which installs
   everything and gets a Let's Encrypt cert. Greenlight is intentionally not
   installed — Moodle's `mod_bigbluebuttonbn` is the only front end.
3. Verify:
   ```bash
   bbb-conf --check        # all green
   bbb-conf --secret       # prints the API URL + shared secret
   ```

## Wire into Moodle

*Site administration → Plugins → Activity modules → BigBlueButton*:

- **BigBlueButton Server URL**: `https://bbb.yourdomain.com/bigbluebutton/`
- **Shared Secret**: from `bbb-conf --secret`
- Default activity settings: recording **on**, wait-for-moderator **on** for
  classes, mute-on-start for large sessions.

## Wire into the CRM

`backend/.env` (used only for the health check and building replay links —
Moodle does the actual API calls):

```
BBB_URL=https://bbb.yourdomain.com/bigbluebutton
BBB_SECRET=<same secret>
```

## Recordings

- BBB processes recordings asynchronously (minutes to hours after a session).
- Phase 6 adds a `\mod_bigbluebuttonbn\event\*` observer to `local_crmbridge`
  so the CRM is told when a recording is ready and can surface it in the
  course + move the learner's progress.
- Copy `/var/bigbluebutton/published` to object storage on a nightly rsync;
  set a retention policy.

## Operations

| Task | Command |
| --- | --- |
| Health check | `bbb-conf --check` |
| Restart stack | `bbb-conf --restart` |
| Show secret/URL | `bbb-conf --secret` |
| Live sessions | `bbb-conf --debug` / check `/var/log/bigbluebutton` |
| Disk (recordings) | `du -sh /var/bigbluebutton/*` |
