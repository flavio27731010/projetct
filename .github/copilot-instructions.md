# Copilot / AI Agent Instructions for rdo-pwa

Short, focused guidance so an AI coding agent becomes productive quickly.

1) Big picture
- Frontend: React + TypeScript app bootstrapped with Vite (`npm run dev`).
- Offline-first local storage: `Dexie` (IndexedDB) under `src/lib/db.ts` (tables: `reports`, `activities`, `pendings`, `syncQueue`).
- Backend: Supabase (JS client in `src/lib/supabase.ts`). Environment vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Sync: `src/lib/sync.ts` pushes `syncQueue` items to Supabase and marks reports as `SINCRONIZADO`.

2) Key workflows / commands
- Start dev: `npm run dev` (uses Vite).
- Build: `npm run build` (runs `tsc -b && vite build`).
- Lint: `npm run lint`.

3) Authentication & routing
- Auth handled with `@supabase/supabase-js` v2. See `src/App.tsx`: app reads session with `supabase.auth.getSession()` and subscribes to `onAuthStateChange` to redirect to `/login` when signed out.

4) Dexie data model & important conventions (must preserve)
- `Report` fields important: `id` (string UUID), `userId`, `date`, `status` (`RASCUNHO`|`FINALIZADO`|`SINCRONIZADO`), `syncVersion`, `updatedAt`.
- `Pending` uses two special fields to manage global identity and inheritance:
  - `pendingKey`: global identity (indexed in `db.ts` and used to avoid duplicates across reports).
  - `sourcePendingId`: the original pending's id (used when a pending is inherited across reports).
- Dexie versioning: DB upgrades are in `src/lib/db.ts` via `this.version(...).upgrade(...)`. When changing schema, increment the version and add an upgrade migration. Tests and fixes assume this pattern.

5) Sync semantics (offline → online)
- Local changes queue into `syncQueue` (types: `UPSERT_REPORT` | `DELETE_REPORT`). `src/lib/sync.ts` iterates queue items and applies them to Supabase.
- Sync flow for `UPSERT_REPORT`: upsert `reports`, delete remote `activities`/`pendings` for that report id, insert local `activities` and `pendings` (maps fields as shown in `sync.ts`). After success update local `status` -> `SINCRONIZADO` and remove queue item.
- Sync uses `navigator.onLine` guard — avoid forcing network calls when offline.

6) Pending inheritance logic
- Implemented in `src/lib/pendingInheritance.ts`. New reports may inherit open pendings from the last `FINALIZADO` report. Avoid duplicating pendings by comparing `pendingKey`.

7) Supabase integration points
- Table names expected on the server: `reports`, `activities`, `pendings` (fields are mapped in `sync.ts`).
- Server-side functions: see `supabase/functions/admin-delete-reports` (Deno runtime) for examples of serverless logic. Keep server and client field names in sync.

8) Editing guidelines for contributors / AI
- If you change the Dexie schema: increment DB version in `src/lib/db.ts` and add an `upgrade` migration to transform existing rows.
- If you change report/pending column names or semantics: update `src/lib/sync.ts` mappings and any Supabase functions/SQL that depend on those names.
- Preserve `pendingKey` semantics — it's the canonical way to avoid duplicates and to link inherited pendings to their original.

9) Conventions & style
- IDs are UUID strings; do not switch to numeric IDs without a coordinated migration.
- Status and enum values are stored in Portuguese uppercase tokens (`RASCUNHO`, `FINALIZADO`, etc.). Keep these exact strings.

10) Where to look next (important files)
- `src/lib/db.ts` — Dexie schema & migrations.
- `src/lib/sync.ts` — sync implementation and Supabase mapping.
- `src/lib/pendingInheritance.ts` — how inheritance and de-duplication works.
- `src/lib/supabase.ts` — Supabase client initialization.
- `src/App.tsx` — routing and auth subscription pattern.
- `supabase/functions/*` — server-side functions (Deno) used by the project.

If anything above is unclear or you want the instructions to include more examples (e.g., full field mapping snippets or common PR templates), tell me which area to expand. I'd be happy to iterate.
