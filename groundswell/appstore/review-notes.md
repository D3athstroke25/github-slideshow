# Groundswell 1.0: App Review access

Paste the **Notes** section into App Store Connect → version 1.0 → App Review Information → Notes.

## Demo account

| Field | Value |
|---|---|
| Username | `appreview` |
| Password | The one you set when you created this account on Oct 30. Type it into App Store Connect yourself. Don't put it in this file, because this file is on GitHub. |

If you've forgotten it: log in to the app as `appreview` with its recovery code, or create a fresh account in the app and use that instead. If you use a fresh account, back a project with it first.

What the account already has:
- **Its own live campaign**: *Tideline Tote: a bag sewn from retired sailcloth*. This shows the creator dashboard, the backer list and Updates (account menu → **My projects** → **Dashboard**).
- **A pledge**: $77 on *Lantern Keepers: a cooperative board game*. The reviewer can view, change or cancel it. Lantern Keepers ends **Nov 13, 2026**. If review happens after that, the pledge shows as collected (test mode), and the reviewer can back any other live project.

## Notes (paste into App Store Connect)

> Groundswell is an all-or-nothing crowdfunding app for creative projects such as board games, albums, comics and design products. Backers pledge toward a project's goal, usually in exchange for a reward such as an early copy of the product. Pledges are only collected if the project reaches its goal by its deadline.
>
> DEMO ACCOUNT: username appreview (password above). It owns a live campaign ("Tideline Tote") so you can see the creator dashboard, and it has a pledge on "Lantern Keepers" that you can view, change or cancel.
>
> PAYMENTS: The service is currently in test mode. Pledges are recorded and count toward goals, but no card is taken and no money moves; this is shown on every project page and in the footer. You can test the full flow: open any live project, tap Back this project, pick a reward, and confirm. To cancel, open the project again and tap Manage your pledge → Cancel my pledge.
>
> When real payments are switched on, cards are entered on Stripe Checkout in an in-app Safari view (SFSafariViewController); the app never sees card numbers. Pledges pay for physical goods and services delivered outside the app (guideline 3.1.3(e)). Nothing in the app unlocks digital content. Charitable fundraising and equity or investment offerings are prohibited by our Terms of Use. Paid promotion for creators is sold only on our website, not in the app.
>
> SAMPLE PROJECTS: Projects labelled "Sample" are example campaigns that show how the service works. Each has a notice on its page saying so.
>
> USER-GENERATED CONTENT (1.2): A word filter covers projects, comments, updates and profiles. Every project and comment has Report. Users can block others from a comment or a profile (Settings → Blocked accounts to undo). Moderators are notified of every report and can remove comments, hide projects and suspend accounts. Contact details are on Help & contact (account menu and Settings). The Terms of Use state there is no tolerance for objectionable content or abusive users.
>
> ACCOUNT DELETION (5.1.1(v)): You → Settings → Delete account.
>
> SIGN-IN: Username and password only. There is no third-party sign-in.

## Testing payments

- **Today (test mode):** no card is needed. Back a project, then change or cancel the pledge. Everything works end to end.
- **After real payments are switched on:** Stripe test cards don't work in live mode. Before the next review, either keep the reviewer's projects in test mode (each project keeps the payment mode it launched with), or give Apple a short screen recording of a real checkout.

## Links Apple will open

| Page | URL | Status Nov 9 |
|---|---|---|
| Privacy Policy | https://d3athstroke25.github.io/github-slideshow/groundswell/privacy.html | loads (200) |
| Terms of Use | https://d3athstroke25.github.io/github-slideshow/groundswell/terms.html | loads (200) |
| Support | https://d3athstroke25.github.io/github-slideshow/groundswell/support.html | loads (200) |
