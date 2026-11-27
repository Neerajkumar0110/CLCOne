# CLC Desktop Agent

The Attendance ERP agent from design boards A13 (System Tracking) and E9 (Desktop agent). It runs in the system tray.

It reports, every 30 seconds, to `POST /api/erp-agent-public/beat`:

- the operating system's idle time, which covers keyboard and mouse use in **any** app
- with `uiohook-napi` installed: the time since the last key press and the time since the last mouse use. Only timestamps are kept; it never stores **which** key was pressed.
- power events: boot, lock, unlock, sleep, wake, shutdown, agent start and stop

It never reads typed text, screens, files, app names or browser history.

## Connect a laptop (no login on the laptop)

1. The employee opens `/employee/agent` and clicks **Connect this laptop**. That shows a 6-digit code, valid for 10 minutes.
2. In the agent window, type the code and click **Connect**.

The agent never signs in to the CRM, so the one-device login rule does not log the browser out. The device token is stored with the OS keychain (`safeStorage`). The server keeps only a sha256 hash of it.

## Build

```bash
cd desktop-agent
npm install                # electron, electron-builder, uiohook-napi (optional)
npm start                  # run locally
npm run dist:win           # Windows installer (.exe) in dist/
npm run dist:mac           # macOS .dmg
```

Upload the installer somewhere public. Then set `VITE_AGENT_DOWNLOAD_URL` in the frontend `.env`, for example `https://…/CLC-Desktop-Agent-{os}.exe`, where `{os}` becomes `windows` or `mac`. The **Download** buttons in `/employee/agent` use this link.

Add an `icon.png` (256×256) next to `main.js` before building.
