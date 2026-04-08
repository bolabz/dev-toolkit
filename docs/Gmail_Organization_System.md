# Gmail Organization System for Aaron Boehle

**Date:** April 5, 2026
**Account:** boehle.aaron@gmail.com

---

## Current State Assessment

**By the numbers:** 17,032 total messages across 16,196 threads, with roughly 200 unread. You have 24 user-created labels, 5 old drafts (dating back to July 2024), and no apparent filters routing mail automatically.

**What your inbox looks like right now:** Your most recent 50 emails break down roughly like this:

- ~50% pure marketing/promotions (Culture Kings, Synchro Arts, GuidingCross, HelloFresh, ATHLEAN-X, Stay Cold Apparel, Thursday Boots, Affirm, Expedia, RockAuto)
- ~20% newsletters and digests (Medium Daily Digest sends you one *every single day*, plus LinkedIn Learning, CodePath, Ollama, NASM)
- ~15% financial and billing (Chase credit card statement, tastytrade trade confirmations, Rockefeller Capital statement, USAA declined card alert, AWS billing, Sezzle, City of Carrollton utility bill)
- ~10% security and account alerts (Google sign-in alerts, GitHub OAuth, Anthropic login)
- ~5% things that actually need a human response

**The core problem:** Important financial emails — like your Chase statement being due 4/27 with a $4,901.20 balance, or a USAA credit card declined notice — are buried under an avalanche of clothing sales and supplement ads. Your existing labels (USAA, Chase, Finance, etc.) are good ideas, but they're not being applied to incoming mail, so they're doing nothing for you.

**Your existing labels (what you've already set up):**
USAA, Chase, Careers, Capital One, Reliant, Spectrum, Google, Promotions, Apple, SSFCU, Healthcare, Housing, Web Development, Automotive, Rockefeller, Fitness, 1Password, Personal, Finance, AWS, Shopping, Travel, Notes, Deleted Messages

**What's working:** You clearly had the right instinct — the labels map to real categories in your life. The issue is they're flat (no hierarchy), inconsistently applied, and there's overlap (e.g., "Finance" vs. individual bank labels, "Promotions" vs. Gmail's built-in Promotions category).

---

## The New Label System

The goal is a hierarchical system where every email has a clear home, and the most important stuff surfaces first. Gmail supports nested labels using the "/" separator (e.g., "Finance/Chase" appears as a nested label under "Finance").

### Recommended Label Structure

**ACTION-BASED (the most important labels):**

| Label | Purpose |
|-------|---------|
| `@Action Required` | Emails you need to DO something about (pay, respond, sign, etc.) |
| `@Waiting On` | You've done your part, waiting for someone else |
| `@Read Later` | Worth reading, but not urgent |

The "@" prefix forces these to the top of your label list alphabetically.

**LIFE CATEGORIES (hierarchical):**

| Parent Label | Sub-Labels | What Goes Here |
|-------------|------------|----------------|
| `Finance` | `Finance/Banking` (Chase, USAA, Capital One, SSFCU), `Finance/Investments` (tastytrade, Rockefeller), `Finance/Credit` (Affirm, Sezzle), `Finance/Taxes` | All money-related emails |
| `Bills` | `Bills/Utilities` (Reliant, Spectrum, City of Carrollton), `Bills/Subscriptions` (streaming, software, HelloFresh), `Bills/Insurance` | Recurring payments and statements |
| `Housing` | (keep as-is) | Rent, mortgage, maintenance, HOA |
| `Automotive` | (keep as-is) | Car payments, maintenance, RockAuto |
| `Healthcare` | (keep as-is) | Medical, dental, insurance claims |
| `Career` | `Career/Job Search`, `Career/Networking`, `Career/Learning` | Rename from "Careers"; job-related stuff, CodePath, LinkedIn Learning |
| `Tech` | `Tech/Dev Tools` (GitHub, AWS, Postman), `Tech/Accounts` (Google, Apple, 1Password) | Dev work, SaaS accounts, security alerts |
| `Shopping` | (keep as-is) | Order confirmations, shipping, returns |
| `Travel` | (keep as-is) | Flights, hotels, Expedia |
| `Fitness` | (keep as-is) | NASM, gym, training programs |
| `Personal` | (keep as-is) | Friends, family, personal correspondence |

**Labels to RETIRE (replace with the new structure):**

| Old Label | Replace With |
|-----------|-------------|
| `USAA` | `Finance/Banking` (or handled by Gmail filter) |
| `Chase` | `Finance/Banking` |
| `Capital One` | `Finance/Banking` |
| `SSFCU` | `Finance/Banking` |
| `Rockefeller` | `Finance/Investments` |
| `Reliant` | `Bills/Utilities` |
| `Spectrum` | `Bills/Utilities` |
| `AWS` | `Tech/Dev Tools` |
| `Google` | `Tech/Accounts` |
| `Apple` | `Tech/Accounts` |
| `1Password` | `Tech/Accounts` |
| `Web Development` | `Tech/Dev Tools` or `Career/Learning` |
| `Promotions` | Delete (Gmail already has a built-in Promotions category) |
| `Deleted Messages` | Delete (that's what Trash is for) |
| `Notes` | Keep if you use it; otherwise delete |
| `Finance` | Becomes the parent for sub-labels |
| `Careers` | Rename to `Career` |

---

## Gmail Filters to Set Up

These filters will automatically label and sort incoming mail so you don't have to think about it. Set these up at **Settings > Filters and Blocked Addresses > Create a new filter** in Gmail.

### Priority Filters (set these up first)

**1. Financial Institutions → Finance/Banking + @Action Required (for statements/alerts)**
- From: `chase.com OR usaa.com OR capitalone.com OR ssfcu.org`
- Action: Apply label `Finance/Banking`, Never send to Spam

**2. Investments → Finance/Investments**
- From: `tastytrade.com OR investordelivery.com OR rockefeller OR mybrokerageinfo.com`
- Action: Apply label `Finance/Investments`, Never send to Spam

**3. Bills & Utilities → Bills/Utilities**
- From: `invoicecloud.net OR spectrumemails.com OR reliant.com`
- Action: Apply label `Bills/Utilities`, Never send to Spam

**4. Tech/Dev → Tech/Dev Tools**
- From: `github.com OR aws.com OR postman.com`
- Action: Apply label `Tech/Dev Tools`

**5. Fitness → Fitness**
- From: `nasm.org OR athleanx.com`
- Action: Apply label `Fitness`

### Newsletter & Noise Reduction Filters

**6. Medium Daily Digest → @Read Later, skip inbox**
- From: `noreply@medium.com`
- Action: Apply label `@Read Later`, Skip Inbox

**7. Marketing Noise → Auto-archive**
These are senders that showed up multiple times in your recent inbox and are pure promo:
- From: `culturekings.com OR synchroarts.com OR guidingcross.com OR staycoldapparel.com OR thursdayboots.com`
- Action: Apply label `Shopping`, Skip Inbox
- (Or just unsubscribe from these entirely — see Triage Plan below)

**8. HelloFresh → Auto-archive or Unsubscribe**
- From: `hellofresh.com`
- Action: Skip Inbox (or unsubscribe if you're not using the service)

---

## The Backlog Triage Plan

Don't try to read 17,000 emails. Here's the strategy:

### Phase 1: Surface the Important Stuff (Do This Week)

**Step 1: Find financial emails that need action.**
Ask me in Cowork to search for:
- `is:unread from:chase subject:statement` — find unpaid statements
- `is:unread from:usaa subject:(declined OR alert OR payment)` — find account issues
- `is:unread from:tastytrade subject:(expiration OR action)` — find options that need attention
- `is:unread subject:(payment due OR past due OR overdue OR declined)` — catch anything urgent

**Step 2: Find emails that need a human reply.**
Ask me to search for `is:unread -category:promotions -category:social from:(-noreply -no-reply -donotreply -notifications -newsletter -digest -hello@ -info@ -support@)` — this filters out automated emails and shows messages from real people.

**Step 3: Declare backlog bankruptcy on the rest.**
For everything older than 2 weeks that's promotional, newsletter, or social:
- Go to Gmail, search `is:unread older_than:14d category:promotions`
- Select all, mark as read. Let it go.
- Repeat for `category:social` and `category:forums`

### Phase 2: Unsubscribe Blitz (This Weekend)

Based on your inbox, here are the top candidates for unsubscribing:

| Sender | Frequency | Recommendation |
|--------|-----------|---------------|
| Culture Kings | 3x in 4 days | Unsubscribe unless actively shopping |
| Synchro Arts | 3x in 4 days | Unsubscribe — same sale email repeated |
| GuidingCross | 2x in 2 days | Unsubscribe |
| HelloFresh | 2x in 3 days | Unsubscribe if not using |
| ATHLEAN-X | 2x in 2 days | Unsubscribe (or filter to Fitness) |
| Medium Daily Digest | Daily | Filter to @Read Later, skip inbox |
| Take 5 Oil Change | Weekly-ish | Unsubscribe |
| Expedia | Regular | Unsubscribe unless planning travel |
| RockAuto | Monthly newsletter | Keep if you work on cars, otherwise unsubscribe |
| Insperity Perks at Work | Regular | Unsubscribe |
| Affirm | Regular | Unsubscribe |

### Phase 3: Clean Up Drafts

You have 5 drafts dating back to 2024, including a resume send to James and a RiPSIM offer letter response. These are likely no longer relevant. Review and delete any that are stale.

---

## Daily Email Management Playbook

### Your 10-Minute Morning Routine (Manual)

1. **Scan for @Action Required** — check this label first. Handle anything that takes less than 2 minutes immediately.
2. **Quick inbox scan** — look at the last 24 hours. Star anything important, archive everything you've seen.
3. **Don't read newsletters** — they'll be in @Read Later whenever you want them.

### What Cowork Can Do For You (On-Demand)

Here are specific things you can ask me to do in any Cowork session:

**Weekly inbox check-in:**
> "Search my Gmail for anything urgent — unpaid bills, declined cards, emails needing a reply from the last 7 days"

**Newsletter cleanup:**
> "Find newsletters and digests from the last week that I haven't read, and summarize any that look interesting"

**Financial summary:**
> "Find all financial emails from the last month — statements, bills, trade confirmations — and list the key dates and amounts"

**Draft replies:**
> "Find unread emails from real people in the last 2 weeks and help me draft responses"

**Subscription audit:**
> "Search for emails with 'unsubscribe' in the body from the last month and tell me who's emailing me most"

---

## Immediate Action Items

Here are the things that jumped out from your inbox that may need attention TODAY:

1. **Chase credit card statement** (received Apr 3): $4,901.20 balance, due 4/27/2026, minimum payment $187.00
2. **USAA credit card declined** (received Apr 2): Your card was declined — may need to activate or resolve
3. **tastytrade options expiration** (received Apr 2): You have expiring options that may need action
4. **City of Carrollton AutoPay** (received Apr 5): Utility payment scheduled — just confirm AutoPay is set
5. **Spectrum payment scheduled** (received Apr 4): Payment coming up, confirm funds available
6. **AWS billing statement** (received Apr 1): New billing statement for account ending in 5989
7. **Rockefeller Capital statement** (received Apr 2): Monthly statement available for account ending in 5154
8. **Claude Team credit offer** (received Apr 5): One-time credit expires April 17 — redeem if you want it

---

## How to Set This Up

### Step 1: Create the new labels in Gmail (5 minutes)
Go to Settings > Labels > Create new label. Create the hierarchical labels listed above. Gmail lets you nest them by selecting a parent when creating.

### Step 2: Set up filters (15 minutes)
Go to Settings > Filters and Blocked Addresses. Create the filters listed in the Filters section above. For each one, check "Also apply filter to matching conversations" to retroactively label old emails.

### Step 3: Unsubscribe blitz (20 minutes)
Open each promotional email, scroll to the bottom, click Unsubscribe. For the list above, this is ~10 senders, about 2 minutes each.

### Step 4: Backlog bankruptcy (5 minutes)
Mark old promotional/social/forum emails as read in bulk using the search queries in the Triage Plan.

### Step 5: Handle the urgent items (15 minutes)
Go through the Immediate Action Items list above and handle each one.

**Total setup time: ~1 hour.** After that, the system maintains itself with ~10 minutes/day plus periodic Cowork check-ins.
