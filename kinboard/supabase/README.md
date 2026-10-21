# Kinboard backend (Supabase project `kinboard`, ref `bmmjtouptvkfxxlfqenm`)

These files mirror what is deployed, so the backend can be rebuilt in a fresh project:

1. Run the SQL files in `migrations/` in order (SQL editor or `supabase db push`).
2. Deploy `functions/kb-ics` with JWT verification **off**. The function checks the family code itself: `supabase functions deploy kb-ics --no-verify-jwt`.
3. Put the project URL and publishable key in `../web/config.js`.

Security model: the tables are never readable directly. Every read and write goes through `SECURITY DEFINER` functions that require the family's secret 16-character code. Only a SHA-256 hash of each code is stored. The Supabase security advisor flags these functions as callable by `anon`. That is intentional.
