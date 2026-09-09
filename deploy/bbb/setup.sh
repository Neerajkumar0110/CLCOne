#!/usr/bin/env bash
###############################################################################
# CLC LMS — BigBlueButton 2.7 setup on a DEDICATED host.
#
# BBB effectively takes over the machine (its own nginx, Kurento, FreeSWITCH,
# Docker). It must NOT share the CRM/Moodle/Asterisk VPS.
#
# Requirements (see deploy/bbb/README.md):
#   - fresh Ubuntu 22.04, 8 CPU / 16 GB RAM / 500 GB SSD minimum
#   - a public IPv4, ports 22/80/443 + 16384-32768/udp open
#   - a DNS A record: bbb.<domain> -> this IP
#   - an email for Let's Encrypt
#
#   Run as root:
#       DOMAIN=bbb.yourdomain.com EMAIL=ops@yourorg.com \
#         bash /path/to/clccrm/deploy/bbb/setup.sh
###############################################################################
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN=bbb.yourdomain.com}"
EMAIL="${EMAIL:?set EMAIL=ops@yourorg.com}"
BBB_VERSION="${BBB_VERSION:-jammy-270}"   # bbb-install branch/tag

[ "$(id -u)" -eq 0 ] || { echo "!! run as root"; exit 1; }

echo "==> DOMAIN=$DOMAIN  VERSION=$BBB_VERSION"
echo "==> checking DNS ..."
getent hosts "$DOMAIN" || { echo "!! $DOMAIN does not resolve yet — add the A record first"; exit 1; }

# The official installer does the heavy lifting: packages, TLS via certbot,
# Greenlight is skipped (-g omitted) because Moodle's mod_bigbluebuttonbn is
# the only front end we use.
curl -sSL https://raw.githubusercontent.com/bigbluebutton/bbb-install/v3.0.x-release/bbb-install.sh \
  | bash -s -- -v "$BBB_VERSION" -s "$DOMAIN" -e "$EMAIL"

### Harden + expose the shared secret ----------------------------------------
bbb-conf --secret
echo
echo "=============================================================="
echo " BigBlueButton is installed. Verify:"
echo "   bbb-conf --check"
echo "   bbb-conf --secret        # copy URL + secret"
echo
echo " In Moodle (Site admin > Plugins > Activity modules >"
echo " BigBlueButton):"
echo "   Server URL  = https://${DOMAIN}/bigbluebutton/"
echo "   Shared secret = <from bbb-conf --secret>"
echo
echo " In the CRM backend/.env (health check + replay links only):"
echo "   BBB_URL=https://${DOMAIN}/bigbluebutton"
echo "   BBB_SECRET=<same secret>"
echo
echo " Recordings: enable in Moodle per-activity; the 'recording ready'"
echo " webhook is wired in Phase 6 (local_crmbridge + lmsController)."
echo "=============================================================="
