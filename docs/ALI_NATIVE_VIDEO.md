# Ali native TeamSpeak video (experimental)

Implemented 2026-10-05 on top of surround commit 5f473764d53c4585f1167724c7068a26c6065259.

## Usage

Open the music web UI, select a connected bot, click 视频共享, paste a public Bilibili BV link, and start. Join the bot's screen share in TeamSpeak 6. Pause/resume/stop are in the same dialog. Requires existing player.control permission and access to the bot. Starting video pauses music; stopping leaves music paused. Music playback commands stop video first. Music seeking is rejected during video playback. Existing music queue, EQ, and surround settings are retained.

## Scope

Selectable VP8 output: 360p/20fps at 650 kbit/s, 480p/20fps at 1000 kbit/s, default VOD 720p/20fps at 1600 kbit/s, or 1080p/15fps at 2500 kbit/s; stereo Opus 96 kbit/s. Live rooms default to 480p/30fps with a 250 ms RTP playout buffer. Output for VOD is capped at the available source height. There is no fixed viewer cap; one video may be active across all bots, with capacity determined by the host and network. Existing Bilibili search, queue and chat playback default to video and advance the queue on completion. Live URLs and canonical live:roomId references are supported, with transient reconnect and offline-room handling. Cookies go only to the Bilibili video/live APIs with redirects disabled, never to viewers or media CDN/FFmpeg. No video seeking or video EQ/surround; live playback cannot pause or seek. This is native TeamSpeak sharing; Piik SFU is not involved.

## Runtime

Keep the existing bridge network and loopback-only web port. Add 12198:12198/udp, 12199:12199/udp, 12200:12200/udp. Set TS_VIDEO_ENABLED=1, MEDIA_BIND_INTERFACE=eth0, PUBLIC_IP=8.133.175.38. A single interface is essential to avoid exhausting the allowed media ports. Server NAT maps each advertised port unchanged.

The TeamSpeak SDK needs scripts/patch-video-sdk.mjs to forward raw notifications. It fails closed if its expected insertion point changes. The standard Dockerfile applies it after the final production dependency installation and checks the copied runtime; Dockerfile.ali-video also applies it to the existing production image. For a local build, install dependencies, run node scripts/patch-video-sdk.mjs, then npm run build. Use node scripts/patch-video-sdk.mjs --check to verify the installed hook. The build copies the video .mjs modules into dist/video.

Publication and cancellation share a single ownership boundary. Stopping while setup is in flight waits for its result before permitting another publication. A timeout cannot prove that the remote share was never created: the session stays stopping, retains its late-notification listener and closes a late share. If confirmation never arrives, reconnect the bot to establish that its old shares are gone. Clear waits for video teardown; removing the queued video stops it and advances the remaining queue. Invalid commands leave the current share intact.

Protocol reference: https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak (setupstream / respondjoinstreamrequest / streamsignaling). The implementation here is an independent small sender integrated with this bot, not an embedded WebSpeak client.

## Validation and rollback

Eight video lifecycle/input/credential/quality/rejoin tests and 65 API/EQ/surround/profile tests pass. TypeScript and web production builds pass. The standalone prototype was verified by the user in native TS6 with BV1KN411N7sG: video, audio, and sync normal. See the deployment report for separate evidence on the integrated production path; do not equate packet reception with human playback/sync verification.

Compose: /root/teamspeak/docker-compose.yml. Production data: teamspeak_tsmusicbot-data mounted at /app/data. Only tsmusicbot is recreated. Backup directory is recorded in /opt/teamspeak-video-prototype/deployment.json and contains original Compose, stopped-state data archive, SQLite backup, and verification. Restore the backed-up Compose and run docker compose up -d --no-deps tsmusicbot to roll back code; do not restore old data over newer activity unless deliberately requested.

## October 5 integration follow-up

The main web page shows the current video title, state, resolution, and connected-viewer count. Video temporarily overrides the TS nickname, and a late music profile completion cannot replace it. Music URL resolution already in flight is suppressed when video has taken over.

A fresh join replaces any old peer for that TS client. Callbacks from the old peer cannot remove its replacement. Approval-queue removal notifications do not tear down an accepted viewer; actual viewer leave notifications clean up the peer. The connection deadline is 90 seconds. The application enforces the three-peer capacity; the server-side viewer_limit is zero to avoid a second independent quota. Diagnostic status includes peer/ICE states and command types, never SDP or credentials.

Before this follow-up, the user reported that the approval screen briefly appeared and closed. Internal receiver RTP tests passed (3539 video packets, 876 audio packets), and an external peer established ICE/DTLS, but neither result established that this particular user could view the integrated share. Obtain explicit native-client confirmation after the rejoin fix.
