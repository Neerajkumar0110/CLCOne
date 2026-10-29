#!/usr/bin/env bash
# Rebuild old LMS recordings so they get BBB's "video" format (one mp4 with
# screen share + slides + webcams + audio) — needs bbb-playback-video
# installed first. Recordings made before that package only have the
# presentation format, so their Download was the raw webcams.webm.
#
# One at a time: `bbb-record --rebuild` drops a recording's published files
# while it reprocesses, so a serial queue keeps only one class's Watch link
# down at any moment. Skips anything that already has a video. Safe to
# re-run (e.g. after a reboot) — it just carries on from where it stopped.
#
# Usage (on the BBB box, as root):
#   nohup bash rebuild-video.sh > /root/rebuild-video.log 2>&1 &
# Then on the CRM:  cd backend && node scripts/resyncBbbRecordingDownloads.cjs
set -u
PUB=/var/bigbluebutton/published
IDS="
2418955257e1c54e68731b24ed3c4f35c9f49c8d-1790165523611
1788f77d14dadbafcec390aed893469c0c7b4193-1790665789129
98ed94331781f238e5636874eaef739334345086-1790765636950
012827debfb5e581322b8555618910dc30f8c321-1790852034817
6107e197ccdc4d3064ac54ffbeb959587619d9de-1791189028059
012827debfb5e581322b8555618910dc30f8c321-1791196174215
6814fb3908ffdec63ac9ae027b5c765135eefd90-1791203418185
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1791210590076
6107e197ccdc4d3064ac54ffbeb959587619d9de-1791275220726
012827debfb5e581322b8555618910dc30f8c321-1791282551130
6814fb3908ffdec63ac9ae027b5c765135eefd90-1791289771243
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1791296967018
6107e197ccdc4d3064ac54ffbeb959587619d9de-1791361645184
012827debfb5e581322b8555618910dc30f8c321-1791368804472
6814fb3908ffdec63ac9ae027b5c765135eefd90-1791376158652
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1791383368155
6107e197ccdc4d3064ac54ffbeb959587619d9de-1791534410470
012827debfb5e581322b8555618910dc30f8c321-1791541660578
6814fb3908ffdec63ac9ae027b5c765135eefd90-1791548815267
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1791556157307
6107e197ccdc4d3064ac54ffbeb959587619d9de-1791793698620
012827debfb5e581322b8555618910dc30f8c321-1791800724438
6107e197ccdc4d3064ac54ffbeb959587619d9de-1791879923694
012827debfb5e581322b8555618910dc30f8c321-1791887238157
6814fb3908ffdec63ac9ae027b5c765135eefd90-1791894530357
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1791901528374
012827debfb5e581322b8555618910dc30f8c321-1791973773036
6814fb3908ffdec63ac9ae027b5c765135eefd90-1791980997095
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1791988188766
6107e197ccdc4d3064ac54ffbeb959587619d9de-1792052852462
012827debfb5e581322b8555618910dc30f8c321-1792060149576
6814fb3908ffdec63ac9ae027b5c765135eefd90-1792067236653
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1792074575286
6107e197ccdc4d3064ac54ffbeb959587619d9de-1792139340902
012827debfb5e581322b8555618910dc30f8c321-1792146449097
6107e197ccdc4d3064ac54ffbeb959587619d9de-1792398512028
012827debfb5e581322b8555618910dc30f8c321-1792405690868
6814fb3908ffdec63ac9ae027b5c765135eefd90-1792412913659
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1792420153949
6107e197ccdc4d3064ac54ffbeb959587619d9de-1792571407888
012827debfb5e581322b8555618910dc30f8c321-1792578608803
6814fb3908ffdec63ac9ae027b5c765135eefd90-1792585797171
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1792593010159
6814fb3908ffdec63ac9ae027b5c765135eefd90-1792672177375
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1792679367371
012827debfb5e581322b8555618910dc30f8c321-1792751421469
2def0bf3bd101245fd6790d1203573fd73f02fb3-1792758217355
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1792765784760
6107e197ccdc4d3064ac54ffbeb959587619d9de-1793003412956
012827debfb5e581322b8555618910dc30f8c321-1793010573748
6814fb3908ffdec63ac9ae027b5c765135eefd90-1793017809720
2def0bf3bd101245fd6790d1203573fd73f02fb3-1793017812264
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1793024997352
6107e197ccdc4d3064ac54ffbeb959587619d9de-1793089780654
012827debfb5e581322b8555618910dc30f8c321-1793096994343
2def0bf3bd101245fd6790d1203573fd73f02fb3-1793104193795
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1793111348557
6107e197ccdc4d3064ac54ffbeb959587619d9de-1793176209952
012827debfb5e581322b8555618910dc30f8c321-1793183365169
6814fb3908ffdec63ac9ae027b5c765135eefd90-1793190609643
2def0bf3bd101245fd6790d1203573fd73f02fb3-1793190616660
6baf2eb4def2b1bea9c1777ee73924f2d6bbc840-1793197737936
012827debfb5e581322b8555618910dc30f8c321-1793269820241
"
# Video rendering is CPU-heavy ffmpeg work — only start one outside class
# hours (classes run ~14:30–22:00 IST) and never while a meeting is live.
SECRET=$(bbb-conf --secret | awk '/Secret:/{print $2}')
API=$(bbb-conf --secret | awk '/URL:/{print $2}')
quiet_time() {
  local hm=$((10#$(date +%H%M)))
  [ "$hm" -ge 1300 ] && [ "$hm" -lt 2230 ] && return 1
  local sum=$(echo -n "getMeetings$SECRET" | sha1sum | cut -d' ' -f1)
  curl -s "${API}api/getMeetings?checksum=$sum" | grep -q noMeetings
}

for id in $IDS; do
  [ -d "$PUB/video/$id" ] && { echo "skip $id (has video)"; continue; }
  # --rebuild reprocesses from the raw capture; without it the published
  # presentation would be wiped and never come back.
  [ -d /var/bigbluebutton/recording/raw/$id ] || { echo "skip $id (no raw files)"; continue; }
  until quiet_time; do sleep 300; done
  echo "$(date '+%F %T') rebuild $id"
  bbb-record --rebuild "$id" > /dev/null
  for i in $(seq 1 360); do   # wait up to 3 h
    [ -d "$PUB/video/$id" ] && [ -d "$PUB/presentation/$id" ] && break
    sleep 30
  done
  if [ -d "$PUB/video/$id" ]; then echo "$(date '+%F %T') done $id"; else echo "$(date '+%F %T') TIMEOUT $id"; fi
done
echo "all finished"
