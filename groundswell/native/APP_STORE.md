# Groundswell on the App Store

Everything to enter in App Store Connect, plus what App Review checks. Copy the text as it is.

## Before you submit (TestFlight doesn't need these)

- **Turn on real payments** (README → Turning on real payments). An app where "no real money moves" can read to a reviewer as a demo, which guideline 2.2 rejects.
- **Remove the sample projects** (Moderation → Remove sample projects) and launch at least one real project, so the reviewer sees real content.
- **Create the reviewer's demo account** (below), and back a project with it so the reviewer can see a pledge.
- **Set a support email** in `web/config.js` (`supportEmail`) if you have one. The Help page falls back to a GitHub link.
- Decide on an **Individual or Organization** developer account. Guideline 5.1.1(ix) says apps in "highly regulated fields (such as banking and financial services…)" should come from a company. Groundswell doesn't hold money (Stripe does), but a reviewer may still ask.

## 1. Create the app

App Store Connect → **Apps → + → New App**

| Field | Value |
|---|---|
| Platforms | iOS |
| Name | Groundswell (if it's taken: **Groundswell Crowdfunding**) |
| Primary language | English (U.S.) |
| Bundle ID | com.d3athstroke25.groundswell |
| SKU | groundswell-ios |
| User access | Full access |

## 2. App Information

| Field | Value |
|---|---|
| Subtitle (30 max) | Back new ideas, all or nothing |
| Category | Primary: **Lifestyle**. Leave Secondary empty. |
| Content rights | Yes, it contains third-party content (people post projects and comments), and you have the rights to show it under the Terms. |
| Age rating | See section 5 |

## 3. Pricing and Availability

Free. Pick the countries you want; Stripe Connect must support creators' countries.

## 4. App Privacy

**Privacy Policy URL:** `https://d3athstroke25.github.io/github-slideshow/groundswell/privacy.html`

**Data collection:** Yes. Declare these, each as **Linked to the user**, **Not used for tracking**, purpose **App Functionality** only:

| Category | Data type | Why |
|---|---|---|
| Contact Info | Name | Display name on the profile |
| Contact Info | Email Address | Optional, for notifications and password resets |
| Contact Info | Physical Address | Shipping address for rewards |
| Contact Info | Phone Number | Optional, on the shipping address |
| User Content | Photos or Videos | Project covers and profile photos |
| User Content | Other User Content | Projects, updates, comments, reports |
| Identifiers | User ID | Username |
| Purchases | Purchase History | Pledges |
| Financial Info | Payment Info | Card brand and last four digits (the card itself is entered at Stripe) |

Everything else: not collected. No tracking, no third-party analytics or ads. This matches `PrivacyInfo.xcprivacy` in the app.

## 5. Age rating questionnaire

Answer honestly for what the app allows:
- **User-generated content**: Yes, people post projects, updates and comments. Moderation (filter, reports, blocking, suspensions) is in place.
- **Messaging and chat**: No private messaging. Comments are public on project pages.
- **Gambling, contests, simulated gambling**: None (the Terms forbid lotteries and prizes).
- **Violence, sexual content, profanity, drugs, horror, medical**: None, or infrequent/mild, depending on how strict you want to be. They are against the Terms and filtered.
- **Unrestricted web access**: No. Links open in an in-app browser, but there's no general browser.

## 6. Version 1.0 page

**Promotional text (170 max)**
> Discover creative projects and back the ones you love. If a project reaches its goal by the deadline, it happens. If not, nobody pays.

**Description**
> Groundswell helps creators bring new ideas to life with the direct support of the people who want them to exist.
>
> ALL OR NOTHING
> Every project sets a funding goal and a deadline. If it reaches its goal, pledges are collected and the creator gets to work. If it falls short, nobody pays anything.
>
> FOR BACKERS
> • Discover projects in art, comics, design, film, food, games, music, publishing, technology and more
> • Pick a reward or pledge any amount, and change or cancel it until the deadline
> • Follow creators' updates and join the conversation in the comments
> • Save a project and get a reminder 48 hours before it ends
> • Enter your shipping address when a funded project is ready to ship
>
> FOR CREATORS
> • Build your campaign in five steps: basics, rewards, story, FAQ and launch
> • Add a cover image or video, and share a private preview before you launch
> • Watch pledges come in over time, see every backer, and export the list
> • Post updates, for everyone or for backers only, and send shipping surveys
> • Get paid through Stripe when your project is funded
>
> SAFE AND PRIVATE
> • Report projects or comments, and block anyone you don't want to hear from
> • Moderators review every report
> • No ads and no tracking
> • Delete your account any time in Settings
>
> Pledges are processed securely by Stripe. Groundswell isn't a store: creators are responsible for delivering what they promise.

**Keywords (100 max, commas, no spaces)**
> crowdfunding,crowdfund,back,pledge,creators,makers,indie,projects,rewards,campaign,design,games,art

**Support URL:** `https://d3athstroke25.github.io/github-slideshow/groundswell/support.html`
**Marketing URL (optional):** `https://d3athstroke25.github.io/github-slideshow/groundswell/`
**Copyright:** `2026 <your legal name or company>`

**Screenshots:** iPhone 6.9" (1320 × 2868) are required. The app also runs on iPad, so iPad 13" (2064 × 2752) are required too. Claude takes these from the simulator on the Mac.

## 7. App Review Information

**Sign-in required:** Yes. Demo account:
- Username: `appreview`
- Password: one you choose (don't reuse a real one). Create it in the app, back a live project with it, and add both here.

**Notes** (paste and adjust):
> Groundswell is an all-or-nothing crowdfunding app for creative projects (design, games, music, film and similar). Backers pledge toward a project's goal, usually in exchange for a reward such as an early copy of the product. Cards are charged only if the project reaches its goal by its deadline.
>
> Payments: pledges pay for physical goods and services delivered outside the app (guideline 3.1.3(e)). The card is entered on Stripe Checkout, which opens in an in-app Safari view; the app never sees the card number. Charitable fundraising is not allowed by our Terms of Use (guideline 3.2.2(iv)).
>
> User-generated content (guideline 1.2): objectionable words are filtered from comments, updates, profiles and projects; every project and comment has Report; people can Block others from a comment or profile (Settings → Blocked accounts to undo); moderators are notified of every report and can remove comments, hide projects and suspend accounts. Contact details are at Help & contact (account menu, footer and Settings). The Terms of Use state there is no tolerance for objectionable content or abusive users.
>
> Account deletion (guideline 5.1.1(v)): Settings → Delete account.
>
> To try backing: open any live project, tap Back this project, pick a reward and continue to payment. Stripe test cards are not accepted in live mode, so the demo account already has a pledge you can view, change or cancel.

**Contact information:** your name, phone and email (Apple only).

## 8. Build and submit

Claude archives and uploads the build from Xcode on the Mac. Then:
1. Wait for the build to finish processing (an email arrives, usually within 30 minutes).
2. **TestFlight**: add yourself as an internal tester and install it on your iPhone with the TestFlight app.
3. When it's ready for the store: on the 1.0 page, choose the build, answer the export question (the app uses only standard encryption, already declared as exempt), and **Add for Review → Submit**.

Review usually takes one to three days. If Apple asks a question, it appears in App Store Connect under **App Review**; paste it to Claude.
