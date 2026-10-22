# Kinboard browser tests

Sixty-five checks over the real app in headless Chromium, at phone, tablet and
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
| Levels | Badge and XP bar render, toggle off/on keeps progress |
| Daily bonus | One chore marked, pays what it advertised, same pick on a second device |
| Badges | Twelve tiles, locked/unlocked distinguished, toggle hides them |
| Leaderboard | Off by default, appears when switched on |
| Kid access | With a parent PIN set: settings gated, Rewards and chores still work |
| Switches | role=switch, labelled, state exposed, flips persist |

## Notes for future changes

- Each test clears `localStorage` and reloads, then passes the welcome screen via
  `[data-act="fam-local"]` and loads sample data. Browser contexts are *not*
  isolated — the bundled Chromium runs single-process, so `createBrowserContext`
  fails; clearing storage per test is the working substitute.
- `window.__kbCel` exposes the celebration queue and a log of played events. It
  is the hook the tests read; keep it when refactoring the celebration engine.
- Never hard-code a chore id. Sample chores are scheduled on different weekdays
  (`sample-c6` is Sunday only) and `sample-c1` starts already completed, so a
  fixed target makes the suite pass or fail depending on the day it runs. Use the
  `liveChore()` helper, which picks a chore that is on screen, not yet done and
  worth stars.
- Assert against what the row advertises, not a fixed number: with the daily
  bonus on, a 2-star chore shows and pays 4. `chore: awards exactly what the row
  showed` checks the promise matches the payout, which holds either way.
- The kid-access test sets a real PIN through its sheet (`#pin1`/`#pin2` plus a
  form submit — the keypad is only for *entering* a PIN) and asserts the PIN is
  actually on before checking what a kid can still reach. Without that assert the
  test passes even when no PIN was set.
