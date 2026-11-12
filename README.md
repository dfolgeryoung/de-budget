# D&E Budget

A two-person zero-based budget app replacing the Google Sheets budget: budget months, ledger,
Classic view, tracked amounts, reports. TypeScript end to end — React + Vite + Tailwind on the
client, Hono on Vercel functions, Postgres on Neon via Drizzle. Money is integer cents everywhere.

- `src/budget/` — the budget engine (pure functions; `tests/` prove they match the spreadsheet)
- `src/db/` — schema and client
- `src/server/` — API and auth
- `src/ui/` — screens
- `api/` — the Vercel function entry
- `DEPLOY.md` — how it is hosted

Spec and mockups live in Claude (Budget App Spec, D&E Budget Mockups).
