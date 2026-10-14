# Kinboard

A family calendar, chore chart, rewards, lists and meal planner, inspired by wall-mounted smart calendars. It runs on iPhone, iPad and Android.

| Folder | What it is |
|---|---|
| `web/` | The app itself: a single-page app that works offline and can be added to the Home Screen. It is deployed to GitHub Pages. |
| `native/` | A Capacitor project that wraps `web/` as a real iOS app for TestFlight and the App Store. |
| `artifact/` | The original claude.ai prototype. |

Family sync uses the Supabase project **kinboard** (`bmmjtouptvkfxxlfqenm`). There are no logins. Each family gets a secret 16-character code, and every read and write goes through database functions that require that code. Clients cannot read the tables directly.

---

## 1. Home Screen app (available now)

One-time setup in GitHub:
1. Merge this branch into `main`.
2. Go to repo **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The **Deploy Kinboard to GitHub Pages** workflow publishes `web/` to
   **https://d3athstroke25.github.io/github-slideshow/**

On each iPhone:
1. Open that link in **Safari**. It must be Safari.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Kinboard** from the Home Screen.
   - First phone: tap **Create family**, then go to **Family → Share code**.
   - Every other phone: enter the code under **Join your family**.

Join from inside the installed app, not in Safari. On iPhone, Home Screen apps keep their own storage, separate from Safari.

Updates go live as soon as you push to `main`. Phones pick them up the next time the app is opened.

## 2. App Store app (on your Mac mini)

### Install the tools (once)
1. Install **Xcode** from the Mac App Store, open it once, and accept the license.
2. Install **Node.js 22 LTS** from nodejs.org.
3. In Xcode, go to **Settings → Accounts** and add your Apple ID.

### Build and run on your own iPhone (free Apple ID, works right away)
```bash
git clone https://github.com/D3athstroke25/github-slideshow.git
cd github-slideshow/kinboard/native
npm install
npm run ios          # copies web/ into the app, syncs plugins, opens Xcode
```
In Xcode:
1. Select the **App** target → **Signing & Capabilities** → **Team**: choose your Apple ID.
2. If the bundle ID `com.d3athstroke25.kinboard` is taken, change it, and change `appId` in `capacitor.config.json` to match.
3. Once only: drag `native/resources/PrivacyInfo.xcprivacy` into the **App** folder in Xcode's left sidebar. Tick **Copy items if needed** and the **App** target. Apple requires this privacy manifest.
4. Plug in your iPhone, select it in the device menu at the top, and press **Run ▶**.
5. On the iPhone, go to **Settings → General → VPN & Device Management**, trust your developer certificate, then turn on **Developer Mode** when asked.

With a free Apple ID the app stops opening after **7 days**. Press Run again to reinstall it. A paid account removes this limit.

After any change to `web/`, run `npm run ios` again.

### Ship to TestFlight and the App Store (after joining the Apple Developer Program, $99/yr)
1. In [App Store Connect](https://appstoreconnect.apple.com), go to **Apps → + → New App**. Choose platform iOS, name Kinboard, and bundle ID `com.d3athstroke25.kinboard`.
2. In Xcode, set the device to **Any iOS Device (arm64)**, then choose **Product → Archive** → **Distribute App** → **App Store Connect** → **Upload**.
3. In App Store Connect, the build shows up under **TestFlight** after about 15 minutes. Add family members as testers so they can install it with the TestFlight app.
4. For public release, fill in:
   - Screenshots: 6.9" iPhone and 13" iPad. Take them in the Simulator with **⌘S**.
   - Description, keywords, and Category: **Lifestyle** or **Productivity**.
   - **Privacy Policy URL**: `https://d3athstroke25.github.io/github-slideshow/privacy.html`
   - **App Privacy**: "Data Not Collected". The app has no accounts, analytics or tracking.
   - **Age rating**: 4+.
   - **Review notes**: give Apple a working family code so the reviewer can see a filled-in board. Create a demo family and load sample data first.
5. Submit for review.

Native features already built in: event reminders as local notifications (**Family → Reminders**), the iOS share sheet for the family code, offline use, and the app bundled on the device rather than loaded from a website. These help with App Store guideline 4.2, "minimum functionality". Good next native features: Home Screen widgets for today's events and chores, and live Apple Calendar sync through EventKit.

## Database

Schema and functions live in the Supabase project's migrations (`kinboard_core`):
- `families(id, secret_hash)`: stores only a SHA-256 hash of each family code.
- `docs(family_id, col, id, data, deleted, rev)`: all app records. Every change bumps a revision number, so each phone downloads only what changed.
- RPCs: `kb_create_family`, `kb_check`, `kb_pull(code, since)`, `kb_put_many(code, rows)`, `kb_delete_family`.
- Live updates use Supabase Realtime broadcast pings on a channel derived from a hash of the code. Phones also refresh every 30 seconds and whenever the app is opened.

The free Supabase plan pauses projects after about a week with no activity. Daily family use keeps it awake. If it does pause, restore it from the Supabase dashboard.

Fonts: Figtree and Young Serif (SIL Open Font License), self-hosted in `web/fonts/`.
