# Ali native TeamSpeak video (experimental)

Implemented 2026-10-05 on top of surround commit 5f473764d53c4585f1167724c7068a26c6065259.

## Usage

Open the music web UI, select a connected bot, click 视频共享, paste a public Bilibili BV link, and start. Join the bot's screen share in TeamSpeak 6. Pause/resume/stop are in the same dialog. Requires existing player.control permission and access to the bot. Starting video pauses music; stopping leaves music paused. Music playback commands stop video first. Music seeking is rejected during video playback. Existing music queue, EQ, and surround settings are retained.

## Scope

360p / 20 fps VP8, 650 kbit/s video, stereo Opus 96 kbit/s. Up to three viewers and one active video across all bots. Anonymous Bilibili videos only. No video seek, playlist auto-advance, video EQ/surround, or persistence of an active video through restart. Video ends automatically at end of input. This is native TeamSpeak P2P sharing; Piik SFU is not involved. Networks that block the media path may fail to connect.

## Runtime

Keep the existing bridge network and loopback-only web port. Add 12198:12198/udp, 12199:12199/udp, 12200:12200/udp. Set TS_VIDEO_ENABLED=1, MEDIA_BIND_INTERFACE=eth0, PUBLIC_IP=8.133.175.38. A single interface is essential to avoid exhausting the allowed media ports. Server NAT maps each advertised port unchanged.

The pinned @honeybbq/teamspeak-client 0.2.1 runtime needs scripts/patch-video-sdk.mjs to forward raw notifications. It is fail-closed if its expected insertion point changes. Dockerfile.ali-video applies it to the existing production image and installs werift 0.24.4 separately, preserving native audio and database dependencies. For a local build, install dependencies, run node scripts/patch-video-sdk.mjs, then npm run build. The build copies the video .mjs modules into dist/video.

Protocol reference: https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak (setupstream / respondjoinstreamrequest / streamsignaling). The implementation here is an independent small sender integrated with this bot, not an embedded WebSpeak client.

## Validation and rollback

Five video lifecycle/input tests and 42 API/EQ/surround tests pass. TypeScript and web production builds pass. The standalone prototype was verified by the user in native TS6 with BV1KN411N7sG: video, audio, and sync normal. See the deployment report for separate evidence on the integrated production path; do not equate packet reception with human playback/sync verification.

Compose: /root/teamspeak/docker-compose.yml. Production data: teamspeak_tsmusicbot-data mounted at /app/data. Only tsmusicbot is recreated. Backup directory is recorded in /opt/teamspeak-video-prototype/deployment.json and contains original Compose, stopped-state data archive, SQLite backup, and verification. Restore the backed-up Compose and run docker compose up -d --no-deps tsmusicbot to roll back code; do not restore old data over newer activity unless deliberately requested.
