# Groundswell

An all-or-nothing crowdfunding app, in the spirit of Kickstarter. Creators launch projects with a funding goal, a deadline and rewards. Backers pledge. If the goal is met by the deadline, the project is funded and pledges are collected. If not, nobody pays.

It runs in the browser on phones, tablets and computers, can be added to the Home Screen, and has an iPhone app project for the App Store.

| Folder | What it is |
|---|---|
| `web/` | The app: a single-page app with no build step. Deployed to GitHub Pages at `/groundswell/`. |
| `native/` | A Capacitor project that wraps `web/` as an iPhone app. |
| `supabase/migrations/` | Database schema and API, mirroring the Supabase project **groundswell** (`mrvuxjkahorglqnmyamh`). |
| `supabase/functions/gs/` | The one Edge Function: Stripe payments, the Stripe webhook, and a worker that sends email and charges cards. |
| `supabase/seed/` | Sample projects so a new site isn't empty. |
| `test/` | API, Edge Function and browser tests. They run against a local Postgres with fake Stripe and Resend servers. |

## What's in it

**Backers**
- Discover: featured project, trending, nearly funded, ending soon, just launched, recently funded, plus category browsing.
- Search by title, creator or place. Filter by category and live, funded or all. Sort by trending, newest, ending soon, most funded or most backed.
- Project pages with the story, a video or cover image, rewards, FAQ, updates, comments and community stats. A live funding panel refreshes every 20 seconds.
- Pledge with a reward (plus optional bonus) or without one. Change or cancel a pledge until the deadline. Limited rewards sell out.
- With real payments on: save a card at Stripe Checkout when you pledge. It's charged only if the project is funded. If the charge fails, you have 7 days to update the card.
- Shipping survey: when a funded project is ready to ship, backers enter their address on the project page.
- "Remind me" saves a project, and you get a reminder 48 hours before it ends.
- Activity feed, plus email if you add an address: creator updates, replies, results, receipts and payment problems.

**Creators**
- A five-step editor (Basics, Rewards, Story, FAQ, Launch) that saves as you type, with a launch checklist.
- Cover image upload (cropped to 16:9 on the device) or generated cover art. Optional YouTube or Vimeo video.
- Story formatting toolbar with headings, bold, italics, lists, quotes, links and inline images, plus a live preview.
- Private preview link for drafts.
- Payouts: connect a Stripe account in Settings (Stripe checks identity and pays out to the creator's bank).
- Dashboard:
  - pledged total, backers, average pledge and time left
  - funding over time against the goal, as a chart or a table
  - backers by reward, and the backer list with CSV export (including shipping addresses)
  - after success: what was collected, the platform fee and the payout
  - sending the shipping survey, and posting or editing updates, optionally for backers only
- Cancel a live campaign. Backers are told and nothing is collected.

**Everyone**
- Accounts with a username and password, plus a recovery code shown at sign-up. With an email added and confirmed, a password can also be reset by email.
- Public profiles. The projects you back stay private unless you opt in.
- Light and dark mode. Offline shell. Installable on the Home Screen. Link previews when shared.
- Report a project. Moderators can feature or hide projects, resolve reports, switch payments between test and real, set the platform fee, and remove the sample projects.

## Test mode and real payments

Out of the box Groundswell is in **test mode**. Pledges are real records that count toward goals, and projects succeed or fail on them, but no card is taken and no money moves. The app says so on pledge screens and in the footer.

Real payments use **Stripe Connect** with destination charges:
- When a backer pledges, they save a card at Stripe Checkout. Nothing is charged yet.
- At the deadline, if the project is funded, the worker charges each card, off-session.
- The money goes to the creator's connected Stripe account, less the platform fee (8% by default, set in Moderation). Groundswell's Stripe account pays Stripe's processing fees out of that.
- A declined card puts the pledge in "payment failed": the backer gets a notification and an email, and has 7 days to update the card. After that the pledge is dropped.
- A project keeps the mode it launched with. Switching to real payments never turns existing test pledges into charges.

### Turning on real payments

1. Create a Stripe account at stripe.com and finish activating it (business details and bank account).
2. In the Stripe dashboard, open **Connect**, choose **Express** accounts, and fill in the platform profile and branding.
3. **Developers → Webhooks → Add endpoint**:
   - Set the URL to `https://mrvuxjkahorglqnmyamh.supabase.co/functions/v1/gs/webhook`.
   - Select these events: `checkout.session.completed`, `account.updated`, `payment_intent.succeeded` and `payment_intent.payment_failed`.
   - Turn on **Listen to events on Connected accounts**, so `account.updated` arrives for creators.
4. In Supabase, open **groundswell → Edge Functions → Secrets** and add `STRIPE_SECRET_KEY` (`sk_live_…`, or `sk_test_…` to try it first) and `STRIPE_WEBHOOK_SECRET` (the endpoint's `whsec_…`).
5. Within a minute the worker reports Stripe as ready. In the app, go to **Moderation → Payments** and choose **Real (Stripe)**.
6. Creators now see **Settings → Payouts → Connect with Stripe**. The launch checklist requires it.

Update the Terms and Privacy policy with your business details, fees and refund policy before taking real money.

### Turning on email

1. Create a free account at resend.com and create an API key.
2. Add it in Supabase as the Edge Function secret `RESEND_API_KEY`.
3. Optionally set `GS_EMAIL_FROM`, for example `Groundswell <hello@yourdomain.com>`. Until you verify a domain in Resend, Resend only delivers to your own address from `onboarding@resend.dev`; to email everyone, verify a domain you own.
4. Within a minute **Moderation** shows email as on. People add their address in **Settings → Email** and confirm it with a 6-digit code.

## Going live (one-time)

1. In the Supabase SQL Editor, run any migrations not yet applied, in order. `004` adds email, payments and surveys, and `005` schedules the worker.
   - Deploy the function with JWT verification off: `supabase functions deploy gs --no-verify-jwt`.
2. Merge into `main`. The **Deploy Kinboard and Groundswell to GitHub Pages** workflow publishes:
   - Kinboard: https://d3athstroke25.github.io/github-slideshow/
   - Groundswell: **https://d3athstroke25.github.io/github-slideshow/groundswell/**
3. On your phone, open **…/groundswell/check.html** and tap **Run check**.
4. Make yourself a moderator in the SQL Editor (usernames are lowercase), then log out and back in:
   ```sql
   update users set is_admin = true where username = 'your_username';
   ```
5. When you have real projects, go to **Moderation → Remove sample projects**.

The repository must stay **public** for GitHub Pages on a free GitHub account.

## iPhone app (on your Mac mini)

Install Xcode and Node.js 22 first, as described in Kinboard's README. Then:

```bash
git clone https://github.com/D3athstroke25/github-slideshow.git
cd github-slideshow/groundswell/native
npm install
npm run ios          # copies web/ into the app, syncs plugins, opens Xcode
```

In Xcode, select the **App** target → **Signing & Capabilities** and choose your team. The bundle ID is `com.d3athstroke25.groundswell`. Then pick your iPhone and press **Run ▶**. After any change to `web/`, run `npm run ios` again.

The app already has:
- **App icon, splash screen, and photo and camera permission text** for cover and profile uploads.
- **A privacy manifest** (`PrivacyInfo.xcprivacy`) registered in the project. It declares the data Groundswell stores: name, email, address, phone for shipping, username, photos, project content and pledge history. All of it is linked to the account, used only to run the app, and never used for tracking.
- **Stripe pages that open in an in-app browser.** When Stripe finishes, the `groundswell://` link brings people back into the app.
- **The native iOS share sheet.**

For TestFlight and the App Store, follow the same steps as Kinboard's README. In App Store Connect's privacy section, declare the data types above as "Linked to you" and "App functionality". Physical rewards and pledges are allowed outside Apple's in-app purchase.

## How the backend works

Everything the app does runs through `SECURITY DEFINER` database functions named `gs_*`. The tables have row level security turned on with no policies, so the public API key can't read or write them directly. The Supabase security advisor flags these functions as callable by `anon`; that is intentional, because each one checks the caller's session itself. Functions named `gs_svc_*` can only be called with the service role key, which only the Edge Function has.

- **Accounts:** passwords are bcrypt hashed (`pgcrypto`). A session is a random 256-bit token, and only its SHA-256 hash is stored. Sessions last 90 days and renew while in use. Ten wrong passwords lock an account for 15 minutes, and sign-ups, logins and code emails are rate-limited.
- **All or nothing:** `gs_settle()` closes every project whose deadline has passed. It runs at the start of most API calls and every minute from the worker. Funded projects mark pledges `collected` and, for real-payment projects, due for charging. The rest are marked `dropped`.
- **Pledges on real-payment projects** start as a `pledge_intent`. They become a pledge, counted toward the goal, once Stripe confirms the saved card, either when the backer returns or through the webhook.
- **The worker** (`/gs/worker`) is called every minute by `pg_cron` through `pg_net`, with a secret kept in Vault. It:
  - sends queued emails through Resend
  - charges due pledges, with Stripe idempotency keys per pledge and card, so nothing is charged twice
  - reports which services are configured, and tidies old rows
- **Email:** every notification for someone with a confirmed email (and email turned on) is queued in `outbox`. Codes are erased from the queue once sent.
- **Images:** the app asks `gs_upload_ticket()` for a one-time path, then uploads to the public `media` Storage bucket. The bucket's insert policy only accepts a path ticketed in the last 30 minutes. Uploads are limited to 5 MB and JPEG, PNG or WebP.
- **Shipping addresses** are visible only to the backer and the project's creator.

The free Supabase plan pauses projects after about a week with no activity. If that happens, restore it from the Supabase dashboard.

To rebuild the backend in a fresh Supabase project:
1. Run `supabase/migrations/*.sql` in order. In `005`, change the project URL first.
2. Optionally run `supabase/seed/samples.sql`.
3. Deploy `supabase/functions/gs` with JWT verification off.
4. Put the new project URL and publishable key in `web/config.js`.

## Tests

All three suites run against a local Postgres 16+ loaded from the same migrations, and never touch the live project. Stripe and Resend are replaced by `test/mock-stripe.mjs`.

```bash
cd groundswell/test
npm install
# Postgres on 127.0.0.1:54329 with a trust-auth "postgres" superuser (set GS_PG_PORT to change the port)
npm run test:api        # 241 checks: every database function, permissions, throttling, settlement, storage policy,
                        # email codes, payment intents, charging and retries, surveys
npm run test:functions  # 61 checks: the Edge Function with fake Stripe and Resend: Connect onboarding, Checkout,
                        # webhook signatures, charges and declines, emails and templates
npm run test:e2e        # 94 checks in headless Chromium: the whole app, including real-payment pledges through a
                        # fake Checkout, a declined card and its fix, the shipping survey, email, and layout at
                        # phone/tablet/desktop in light and dark mode
```

The Edge Function is TypeScript; Node 22 runs it directly in the tests. The browser tests need Playwright with Chromium (`npx playwright install chromium`). `npm run serve` starts the app at http://127.0.0.1:8098 against the local database.
