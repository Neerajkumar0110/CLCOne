# Backend module map

The backend is organized into the same 7 modules the database is split
into (see `src/config/multiDb.js`). Every model, controller, and route file
lives under a folder named after its module, so it's immediately obvious
where to work and which database a change touches.

| Module      | Folder name  | MongoDB database | What lives here |
|-------------|--------------|-------------------|------------------|
| Sales       | `sales`      | `salesDb`         | Leads, clients, deals, quotes, orders, products |
| Marketing   | `marketing`  | `marketingDb`     | Campaigns, Facebook/Google/LinkedIn ad integrations, email broadcasts, journeys, segments |
| LMS         | `lms`        | `lmsDb`           | Courses, batches, students, live classes, quizzes, assignments, certificates, Moodle sync — plus Support/Ticket |
| Finance     | `finance`    | `financeDb`       | Invoices, payments |
| HRMS        | `hrms`       | `hrmsDb`          | Employees, candidates, attendance, leave, payroll, appraisals, HR assets/documents |
| Operations  | `operation`  | `operationDb`     | Calling/call-center, Git & Vercel connections, messenger, telephony, ops projects |
| Core        | `core`       | `coreDb`          | Admin auth, settings, teams, permissions, dashboard/report/analytics shells |

The full model → database assignment is the single source of truth in
`src/config/multiDb.js`'s `DB_MAP` — every model is listed there exactly
once. All 7 databases live in the **same MongoDB Atlas cluster** (one
`DATABASE` connection string in `.env`); `multiDb.js` transparently routes
each model to its own logical database within that cluster via
`connection.useDb(name)`, so nothing else in the code needs to know this
split exists.

## Where each module's code lives

```
backend/src/
├── models/appModels/<module>/       # one file per model
│   └── coreModels/                  # Admin, AdminPassword, Setting (always core)
├── controllers/appControllers/<module>/<xController>/
│   └── index.js                     # entry point — the same as before, just relocated
├── routes/appRoutes/<module>/<xApi>.js
│   └── appApi.js                    # generic CRUD router for every module's simple
│                                     # entities — stays at the top level since it's
│                                     # cross-cutting, not owned by one module
└── services/
    ├── lms/                         # already module-scoped
    ├── calling/                     # operation-module services
    └── finance/                     # finance-module services
```

**Example** — a bug in the LMS quiz API:
- Model: `src/models/appModels/lms/Quiz.js`, `QuizAttempt.js`, `Question.js`
- Controller: `src/controllers/appControllers/lms/lmsController/quizzes.js`
- Route: `src/routes/appRoutes/lms/lmsApi.js`
- Database: `lmsDb`

**Example** — a bug in Facebook ad sync:
- Model: `src/models/appModels/marketing/FacebookAd.js` (and the other `Facebook*` models)
- Controller: `src/controllers/appControllers/marketing/facebookController/`
- Route: `src/routes/appRoutes/marketing/facebookApi.js`
- Database: `marketingDb`

## Notes for anyone touching this structure

- **Don't move a file without grepping for its old path first.** Requires
  are relative (`require('../../models/appModels/Lead')`), so moving a file
  breaks every relative `require()` that points at it — both from other
  files requiring it, and from its own `require()`s pointing back out at
  shared code (`config/`, `utils/`, `handlers/`, etc.).
- `backend/api/index.js` (the Vercel serverless entry point) force-requires
  every model by its literal path — a second, independent list from the
  glob-based loading `src/server.js` uses for local/VPS runs. If you add a
  new model, add it to **both** `DB_MAP` in `multiDb.js` and the `models`
  object in `api/index.js`, or the model exists locally but 500s on Vercel.
- `appApi.js`'s generic CRUD routing (`models/utils/index.js`) globs
  `models/appModels/**/*.js` recursively, so a new model file dropped into
  any module folder is automatically picked up — no route file to edit for
  a plain CRUD entity, only for one needing custom endpoints (see the
  `routerApp()` special cases in `appApi.js`).
