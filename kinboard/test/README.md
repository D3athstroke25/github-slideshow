# Kinboard browser tests

Thirty-one checks over the real app in headless Chromium, at phone, tablet and
wall-screen sizes. They drive the actual UI — clicking real chore toggles and
reward buttons — rather than calling internals, so they fail when a user-visible
path breaks.

## Running

    cd kinboard/test
    npm install
    npm test

The app is served from `kinboard/web` on port 8099 by the test itself. Nothing
needs to be running first, and no network access is required: the tests use
local mode and never touch Supabase.

Chromium comes from the `@sparticuz/chromium` npm package rather than
Playwright's CDN, so it installs on machines where that CDN is blocked. On a
normal workstation `puppeteer` or `playwright` would work equally well — swap the
`executablePath` for whatever browser is available.

## What is covered

| Area | Checks |
| --- | --- |
| Layout | Loads at 390x844, 820x1180, 1920x1080; no console errors; no horizontal overflow |
| Chore celebration | Fires, awards the right stars, finishes under 2s, leaves no error |
| Queueing | Three completions in one tick all play, strictly one at a time |
| Reward overlay | Renders, then removes its nodes and canvas |
| Reduced motion | No confetti, still announced through `aria-live` |
| Celebrations off | Visuals suppressed, counters still update |

## Notes for future changes

- Each test clears `localStorage` and reloads, then passes the welcome screen via
  `[data-act="fam-local"]` and loads sample data. Browser contexts are *not*
  isolated — the bundled Chromium runs single-process, so `createBrowserContext`
  fails; clearing storage per test is the working substitute.
- `window.__kbCel` exposes the celebration queue and a log of played events. It
  is the hook the tests read; keep it when refactoring the celebration engine.
- Target `sample-c2` ("Feed the dog") when a chore must award stars. `sample-c5`
  and `sample-c6` are deliberately worth zero and will not move a balance.
