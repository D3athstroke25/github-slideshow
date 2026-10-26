# Groundswell

An all-or-nothing crowdfunding app, in the spirit of Kickstarter. Creators launch projects with a funding goal, a deadline and rewards. Backers pledge. If the goal is met by the deadline, the project is funded and pledges are collected. If not, nobody pays.

It runs in the browser on phones, tablets and computers, and can be added to the Home Screen like an app.

| Folder | What it is |
|---|---|
| `web/` | The app: a single-page app with no build step. Deployed to GitHub Pages at `/groundswell/`. |
| `supabase/migrations/` | Database schema and API, mirroring the Supabase project **groundswell** (`mrvuxjkahorglqnmyamh`). |
| `supabase/seed/` | Sample projects so a new site isn't empty. |
| `test/` | API tests and browser tests that run against a local Postgres. |

## What's in it

**Backers**
- Discover: featured project, trending, nearly funded, ending soon, just launched, recently funded, plus category browsing.
- Search by title, creator or place. Filter by category and live, funded or all. Sort by trending, newest, ending soon, most funded or most backed.
- Project pages with the story, a video or cover image, rewards, FAQ, updates, comments and community stats. A live funding panel refreshes every 20 seconds.
- Pledge with a reward (plus optional bonus) or without one. Change or cancel a pledge until the deadline. Limited rewards sell out.
- "Remind me" saves a project, and you get a reminder 48 hours before it ends.
- Activity feed: creator updates, replies to your comments, and funded, unsuccessful or canceled results.

**Creators**
- A five-step editor (Basics, Rewards, Story, FAQ, Launch) that saves as you type, with a launch checklist.
- Cover image upload (cropped to 16:9 on the device) or generated cover art. Optional YouTube or Vimeo video.
- Story formatting toolbar with headings, bold, italics, lists, quotes, links and inline images, plus a live preview.
- Private preview link for drafts.
- Dashboard: pledged total, backers, average pledge and time left; funding-over-time chart against the goal (also as a table); backers by reward; backer list with CSV export; post and edit updates, optionally for backers only.
- Cancel a live campaign. Backers are told and nothing is collected.

**Everyone**
- Accounts with a username and password. No email needed. A recovery code is shown once at sign-up for password resets.
- Public profiles. The projects you back stay private unless you opt in.
- Light and dark mode. Offline shell. Installable on the Home Screen.
- Report a project. Moderators can feature or hide projects, resolve reports, and remove the sample projects.

## Test mode: what it means

`web/config.js` has `payments: 'test'`. Pledges are real records: they count toward goals, and projects succeed or fail on them. But **no card is taken and no money moves**. The app says so on every pledge screen and in the footer.

Taking real money is a business step, not just a code change. You'd need:
1. A Stripe account with **Stripe Connect**, so creators are paid out directly. Creators complete Stripe's identity checks.
2. At pledge time, save the backer's card with a SetupIntent instead of charging it.
3. At the deadline, if the project succeeded, charge each saved card and transfer the funds to the creator, less fees. This would run in a Supabase Edge Function, using the same settlement step `gs_settle()` already performs.
4. Updated Terms and Privacy policy, and a decision about fees, refunds and disputes.

The data model already tracks pledge status (`active`, `collected`, `dropped`, `canceled`), so payments can plug into the existing flow.

## Going live (one-time)

1. Merge this branch into `main`. GitHub Pages is already set to **GitHub Actions** for Kinboard. The **Deploy Kinboard and Groundswell to GitHub Pages** workflow now publishes both:
   - Kinboard: https://d3athstroke25.github.io/github-slideshow/
   - Groundswell: **https://d3athstroke25.github.io/github-slideshow/groundswell/**
2. Open **https://d3athstroke25.github.io/github-slideshow/groundswell/check.html** on your phone and tap **Run check**. It signs up a temporary account, uploads a test image, creates a draft and then deletes everything.
3. Sign up in the app, then make yourself a moderator. In the Supabase dashboard for **groundswell**, open **SQL Editor** and run (with your username):
   ```sql
   update users set is_admin = true where username = 'your_username';
   ```
   Log out and back in. **Moderation** now appears in your account menu.
4. When you have real projects, go to **Moderation → Remove sample projects**.

On iPhone: open the link in Safari, tap **Share → Add to Home Screen**.

## How the backend works

Everything runs through `SECURITY DEFINER` database functions named `gs_*`. The tables have row level security turned on with no policies, so the public API key can't read or write them directly. The Supabase security advisor flags these functions as callable by `anon`. That is intentional: each one checks the caller's session itself.

- **Accounts:** passwords are bcrypt hashed (`pgcrypto`). A session is a random 256-bit token, and only its SHA-256 hash is stored. Sessions last 90 days and renew while in use. Ten wrong passwords lock an account for 15 minutes, and sign-ups and logins are rate-limited per network.
- **All or nothing:** `gs_settle()` closes every project whose deadline has passed. It is called at the start of most API calls, so no scheduler is needed. Funded projects mark pledges `collected`; the rest mark them `dropped`. Backers and creators are notified.
- **Images:** the app asks `gs_upload_ticket()` for a one-time path, then uploads to the public `media` Storage bucket. The bucket's insert policy only accepts a path ticketed in the last 30 minutes. Files are capped at 5 MB, JPEG, PNG or WebP only.
- **Counters:** a trigger keeps each project's pledged total and backer count, and each reward's backer count, in step with the pledges. It also logs every change for the dashboard chart.

The free Supabase plan pauses projects after about a week with no activity. If that happens, restore it from the Supabase dashboard.

To rebuild the backend in a fresh Supabase project: run `supabase/migrations/*.sql` in order, optionally run `supabase/seed/samples.sql`, then put the new project URL and publishable key in `web/config.js`.

## Tests

Both suites run against a local Postgres 16+ loaded from the same migrations, and never touch the live project.

```bash
cd groundswell/test
npm install
# Postgres on 127.0.0.1:54329 with a trust-auth "postgres" superuser (set GS_PG_PORT to change the port)
npm run test:api   # 165 checks: every function, permissions, throttling, settlement, storage policy
npm run test:e2e   # 67 checks in headless Chromium: sign up, create, launch, pledge, comment, update, settle,
                   # and layout at phone/tablet/desktop in light and dark mode
```

The browser tests need Playwright with Chromium installed (`npx playwright install chromium`). `npm run serve` starts the app at http://127.0.0.1:8098 against the local database, with a small stand-in for the Supabase API and Storage.

## Not built yet

- Real payments. See "Test mode" above.
- Email. There is none by design; recovery codes replace password-reset emails.
- A native App Store wrapper. Kinboard's `native/` Capacitor setup could be copied for this.
- Reward surveys for collecting shipping addresses after a campaign succeeds.
