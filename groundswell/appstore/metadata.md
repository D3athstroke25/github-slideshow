# Groundswell Crowdfunding 1.0: App Store metadata

Copy each field into App Store Connect as written. Character limits are Apple's.

## App Information

| Field | Value |
|---|---|
| Name (30) | Groundswell Crowdfunding |
| Subtitle (30) | Back new ideas, all or nothing |
| Bundle ID | com.d3athstroke25.groundswell |
| SKU | groundswell001 |
| Primary category | **Lifestyle** |
| Secondary category | Leave empty (or Social Networking) |
| Content rights | Yes, it contains third-party content, and you have the rights to show it under the Terms of Use |

**Why Lifestyle, not Finance:** Groundswell sells nothing financial. Backers pre-order creative products, and it doesn't hold money, lend or invest. Listing it under Finance tells the reviewer to judge it as a financial-services app, which makes guideline 5.1.1(ix) much more likely to be raised (see the compliance notes). Kickstarter and Indiegogo are not in Finance either.

## Version 1.0

**Promotional text (170)**
> Discover creative projects and back the ones you love. If a project reaches its goal by the deadline, it happens. If not, nobody pays.

**Description (4000)**
> Groundswell helps creators bring new ideas to life with the direct support of the people who want them to exist.
>
> ALL OR NOTHING
> Every project sets a funding goal and a deadline. If it reaches its goal, pledges are collected and the creator gets to work. If it falls short, nobody pays anything.
>
> FOR BACKERS
> • Discover projects in art, comics, design, film, food, games, music, publishing, technology and more
> • Pick a reward and change or cancel your pledge any time before the deadline
> • Follow creators' updates and join the conversation in the comments
> • Save a project and get a reminder 48 hours before it ends
> • Enter your shipping address when a funded project is ready to ship
>
> FOR CREATORS
> • Build your campaign in five steps: basics, rewards, story, FAQ and launch
> • Add a cover image or video, and share a private preview before you launch
> • Watch pledges come in over time, see every backer, and export the list
> • Post updates, for everyone or for backers only, and send shipping surveys
>
> SAFE AND PRIVATE
> • Report projects or comments, and block anyone you don't want to hear from
> • Moderators review every report
> • No ads and no tracking
> • Delete your account any time in Settings
>
> Groundswell isn't a store: creators are responsible for delivering what they promise. Charity fundraising, investments and lotteries aren't allowed.

I removed "Get paid through Stripe" and "Pledges are processed securely by Stripe" from the earlier draft. Payments are in test mode today, and the listing must describe what the app does now (guideline 2.3.1). Add them back when real payments are on.

**Keywords (100, commas, no spaces)**
> crowdfunding,crowdfund,kickstart,pledge,backer,creators,makers,indie,rewards,campaign,boardgame,art

(99 characters. "kickstart" is a plain word; don't use "Kickstarter", which is a trademark.)

| Field | Value |
|---|---|
| Support URL | https://d3athstroke25.github.io/github-slideshow/groundswell/support.html |
| Marketing URL | https://d3athstroke25.github.io/github-slideshow/groundswell/ |
| Privacy Policy URL | https://d3athstroke25.github.io/github-slideshow/groundswell/privacy.html |
| Copyright | 2026 Hemish Mehta |
| Version | 1.0 |
| Build | 1.0 (2) |

## Screenshots

In `appstore/screenshots/`:
- **iPhone 6.9"** (1320 × 2868): `iphone-1-home`, `iphone-2-project`, `iphone-3-reward`, `iphone-5-activity`
- **iPad 13"** (2064 × 2752): `ipad-1-home`, `ipad-2-project`, `ipad-3-reward`, `ipad-5-activity`

The app runs on iPad, so both sets are required. The dashboard shots were left out because they show an empty "Demo project for App Review". Retake them later from a project with pledges.

## Age rating questionnaire

| Question | Answer |
|---|---|
| Parental controls | No |
| Age assurance | No |
| Unrestricted web access | No (links open one page in an in-app Safari view, with no address bar to browse) |
| User-generated content | **Yes** |
| Messaging and chat | No (comments are public on project pages; there are no private messages) |
| Advertising | No |
| Violence (cartoon, realistic, graphic) | None |
| Sexual content, nudity | None |
| Profanity or crude humour | None (filtered and against the Terms) |
| Alcohol, tobacco, drugs | None |
| Mature or suggestive themes | None |
| Horror or fear themes | None |
| Medical or treatment information | None |
| Simulated gambling, contests, real-money gambling | None |
| Loot boxes | No |

Expected result: **13+**, which matches the Terms (13+ to use, 18+ to pay). If Apple shows a lower rating, set the age-rating override to 13+.

## App Privacy ("nutrition label")

**Do you collect data?** Yes. For every type below: **Linked to the user: Yes**, **Used for tracking: No**, **Purpose: App Functionality** only.

| Category | Type | Why |
|---|---|---|
| Contact Info | Name | Display name on the profile |
| Contact Info | Email Address | Optional, for notifications and password reset |
| Contact Info | Phone Number | Optional, on a shipping address |
| Contact Info | Physical Address | Shipping address for rewards |
| User Content | Photos or Videos | Project covers and profile photos |
| User Content | Other User Content | Projects, updates, comments, reports |
| Identifiers | User ID | Username |
| Purchases | Purchase History | Pledges |
| Financial Info | Payment Info | Card brand and last four digits, once real payments are on (Stripe holds the card) |

Everything else: **Not collected**. That includes Location, Contacts, Health, Browsing History, Search History, Device ID, Usage Data, Diagnostics and Advertising Data. There are no analytics or ad SDKs. This matches `PrivacyInfo.xcprivacy` in the app.

## App Review Information

See `review-notes.md` for the sign-in details and the Notes text.

| Field | Value |
|---|---|
| Sign-in required | Yes |
| Contact | Your name, phone and email (only Apple sees these) |
