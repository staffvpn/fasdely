# FASDELY — Backend Foundation

Multi-tenant Supabase backend for FASDELY (Telegram café ordering platform).
Design: `docs/superpowers/specs/2026-08-30-backend-foundation-design.md`.

- Pure Supabase: Postgres + RLS + PostgREST + Edge Functions + pg_cron.
- Migrations in `supabase/migrations/`, applied via the Supabase MCP
  `apply_migration` tool against project `rlxbhbdcecrnykwxnqtx` (no local
  Docker/Supabase CLI stack is used in this environment).
- Edge Functions in `supabase/functions/`; each has a dependency-free
  `logic.ts` unit-tested with Vitest, and a thin `index.ts` deployed via the
  `deploy_edge_function` MCP tool.

Run tests: `npm install && npm test`
