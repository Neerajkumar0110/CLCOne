# CLCOne — Frontend

React + Vite admin/LMS dashboard for Career Lab Consulting's CRM.

## Setup

```bash
npm install
npm run dev
```

This starts the dev server at **http://localhost:3000**.

## Connecting to a backend — you don't need to run the backend locally

By default, `npm run dev` proxies every `/api` request to a backend running
on your own machine at `http://localhost:8888`. If you don't have the
backend running there, every request will fail.

**You don't need to set any of that up.** Instead, point the dev server at
the live backend that's already running in production:

1. Create a file named `.env.local` in this `frontend/` folder (next to
   `.env`) with exactly this one line:

   ```
   VITE_DEV_REMOTE=remote
   ```

2. Restart `npm run dev` (stop it with `Ctrl+C` and run it again).

That's it — every API call now goes to the real, live backend
(`https://clcone.careerlabconsulting.com`), so you'll see real data and
your changes to the UI can be tested against it directly. `.env.local` is
git-ignored, so this setting stays local to your machine and never gets
committed.

If you *do* have the backend running locally and want to test against
that instead, just don't create `.env.local` (or delete it) — the default
already points at `localhost:8888`.

## Build

```bash
npm run build
```

Outputs to `dist/`.
