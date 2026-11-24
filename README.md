# Nab Camas syndicate portal

A self-contained web portal for the syndicate: availability calendar, week letting, week swaps, family accounts and budget-driven service charges.

## Run it

Needs **Node.js 22.5 or newer**. There's nothing else to install.

```
node server.js
```

Open http://localhost:3000. Data is stored in `data/camas.db` (SQLite). Back up that one file.

On first run the site loads your real data:
- **Families and shares:** Bonar 8, Ekserdjian 10, Howarth 11, Lunt/Hall 9, Mackay 12, White 2. Shares equal weeks.
- **2026 allocation:** the 2025 document's week-by-week pattern, on 2026 dates. 2026 has 53 weeks, and **week 53 (25 Dec – 1 Jan) is Lunt/Hall's**.
- **2027 allocation:** from *Draft allocation 2027 draft 1A*, including its calendar notes.
- **2026 budget:** from *Nab Camas 2026 Budget.xlsx*. Period July 2025 – June 2026, £19,332 funding need, charged at **£370 per week**. The service charges are **not issued yet**: press *Issue* on the Budget page, then record the payments already received under Payments & balances.

It also adds **demo logins** (password `demo1234`) and a few demo week offers in 2027:

| Login | Role |
|---|---|
| admin@example.com | Site admin, and family admin of White |
| member@example.com | Family member, White |
| friend@example.com | Trusted friend of White |
| bonar@, ekserdjian@, howarth@, lunthall@, mackay@example.com | Each family's admin |

To go live: log in as admin@example.com and go to **Site admin**:
1. **Budget & charges**: check 2026, **Issue** the charges, and record payments already made. For next year, use *Copy from 2026* (with an uplift) or *Import from spreadsheet*.
2. **Weeks & allocation**: add future years with **+ Year** and import their allocation (Word, Excel or CSV).
3. **Settings & rates**: add the bank details and the summer, shoulder and winter rates.
4. **All users**: add each family's real admin, change your own email and password, and remove the demo users. In the calendar, untick the demo offers.

To start completely clean, delete the `data` folder before starting the server.

## Who can do what

| | Trusted friend | Family member | Family admin | Site admin |
|---|---|---|---|---|
| See calendar | Only weeks offered to them | All weeks and holders | All | All |
| Book a let week (pay by bank transfer) | ✓ | ✓ (buying from another family) | ✓ | ✓ |
| Charge a purchase to own family account | — | ✓ (switchable in settings) | ✓ | ✓ |
| Request a swap | — | ✓ | ✓ | ✓ |
| Offer own family's week for letting or swaps, set a price | — | — | ✓ | ✓ |
| Accept or decline swaps for own family | — | — | ✓ | ✓ |
| Add trusted friends | — | ✓ | ✓ | ✓ |
| Add family members, change roles | — | — | ✓ | ✓ |
| See own family account | — | ✓ | ✓ | All families |
| Budget, rates, allocation, confirm payments | — | — | — | ✓ |

## Gaps in the brief and how they're handled

**Weeks and the calendar**
- **Week numbering and changeover days** follow the syndicate's documents. Week 1 starts on the first **Friday on or after 26 December**, and weeks run back to back. Most years therefore have 52 weeks, but some (e.g. **2026**) have **53**; a new 53rd week starts unallocated ("Syndicate") until it's assigned. Weeks **12–43 change over on Saturday** and the rest on Friday, so the switch weeks are **8 and 6 nights**. The calendar shows this. The days and the week range are in Settings, and any week's start date can be edited.
- **Calendar notes** such as "School Half-term" or "Easter Day" are imported from the comment column and shown on the calendar.
- **Wrong-year protection.** The allocation importer compares the file's title, weekday names and dates with the year you're importing into, and warns if they don't match.
- **Seasons are set per week.** New years get seasons from month settings, and the admin can override any week.
- **Rotation.** If every family kept the same week numbers each year, they would always get the same season. **Roll forward** copies last year's allocation with an optional shift, or you can import a new allocation each year.
- **Ownership vs. holding.** Each week records who it was *allocated* to and who currently *holds* it. Swaps change the holder for that year only and never touch future years.

**Letting to friends and families**
- **Double booking.** Booking a week puts a hold on it immediately. A second person trying to book sees "someone else has just booked this week".
- **Bank transfer payments.** The site can't see the bank account. Each booking gets a **unique reference**, and the week is held for N days (3 by default). The site admin ticks it as paid once the money arrives. Unpaid holds lapse automatically and the week becomes available again.
- **Where the money goes.** When payment is confirmed, the offering family gets a **credit dated to the following year**, which reduces next year's service charge. An optional **syndicate commission %** (default 0) can keep a cut for wear and tear or cleaning.
- **Family members buying from another family** can pay by bank transfer like a friend. They can also **charge it to their own family account**, which is confirmed instantly and the family admins are notified. This saves a bank transfer and is cancelled out in the ledgers.
- **Friend scope.** A family can let a week to *any* family's trusted friends, or only *their own*. Friends never see family contact details, swap activity or weeks that aren't offered to them.
- **Price.** The default comes from the site-wide season rate. A family admin can override it for any one week.
- **Cancellations.** The booker or the family can cancel an unpaid hold. A paid booking can only be cancelled by the site admin, and the ledger entries are reversed automatically. The refund itself is handled outside the site, under whatever cancellation policy you agree.

**My weeks and swaps**
- **My weeks** lists only your family's weeks. The family admin gives each one a setting:
  - **Undecided** (the default)
  - **Using it**
  - **Willing to swap**
  - **For sale**
  - **Swap or sell**
- Sale weeks have a **price**; leave it blank to use the admin's summer, shoulder or winter rate. They also have a **who can buy** choice: other syndicate members only; members and any family's trusted friends; or members and our own trusted friends. Family members can see the list but not change it.
- **Asking for a swap:** any family member can ask for any other family's week that isn't *Using it*. They only name the week they want. The request can only be sent if their family has at least one week marked **Willing to swap**.
- **The owning family's admin** sees the request together with the requesting family's *Willing to swap* weeks, and either:
  - **chooses one** of those weeks in exchange; or
  - **declines: we're using it**, and the week is marked *Using it*; or
  - **declines: not sure yet**, and the requester can ask again later.
- **The requesting family's admin** then either **confirms**, and the weeks change hands for that year with both marked *Using it*, or chooses **not that week**, and the other family can pick a different one or decline.
- Requests tidy themselves up:
  - Marking a week *Using it* declines requests for it.
  - If a week that was chosen in exchange is no longer *Willing to swap*, the request goes back to the owning family to choose again.
  - A week that is sold or swapped cancels the other requests involving it.
  - Everyone involved is notified.
- Requests appear on the **Swaps** page and in the **Swap requests** section of each family's **Account** page. The Swaps tab shows a count of requests waiting for the family admin.

**Accounts and the budget**
- **Service charge = charge per week × the family's weeks.** The calculated rate is budget ÷ total weeks (2026: £19,332 ÷ 52 = £371.77). You can set a rounded figure, as the syndicate does (£370), and the page shows the resulting shortfall or surplus (2026: £19,240 raised, £92 short). Re-issuing a year's charges replaces only that year's service-charge lines. Payments, credits and adjustments are kept.
- Each account is a running **ledger**: charges are positive, credits and payments negative. The site admin records payments received and can make adjustments with a note.
- Each budget year has a **period label** (e.g. July 2025 – June 2026), and each line has a **type** (Regular, Postpone, …) and **commentary**, as on the spreadsheet.
- **Budget years** can be copied from the previous year with an inflation uplift, edited line by line, or imported from Excel or CSV. The importer lets you pick the columns and previews the result first. It also handles a sheet with the budget on the left and families and weeks on the right.

**People and security**
- Logins are by **invitation link**. The admin adds a person with an email and sends them the link to set their password. The same button produces a password-reset link. People added without an email are contact records only, with no login.
- Every family must keep at least one family admin.
- Passwords are hashed with scrypt, and sessions use HttpOnly cookies. All key actions are recorded in the **Activity log**.
- **Data protection.** You're storing third parties' contact details, so the add-person form asks the user to confirm consent. Consider a short privacy notice on the site.

## Putting it live (Railway, about £4–8 a month)

1. **GitHub:** create a free account and a **private** repository (e.g. `nab-camas-portal`), then upload these files to it. Leave out the `data` folder.
2. **Railway:** sign up at railway.com with that GitHub account. Choose **New Project → Deploy from GitHub repo** and pick the repository. Railway sees `package.json` and runs `npm start`.
3. **Storage:** in the service, use **Add Volume** with mount path `/data`. Without a volume, the database is wiped on every redeploy.
4. **Variables:** on the service's Variables tab, add:
   - `DB_FILE` = `/data/camas.db`
   - `ADMIN_EMAIL` = your email (this becomes your login)
   - `ADMIN_NAME` = your name
   - `BASE_URL` = the site's address, e.g. `https://nab-camas.up.railway.app` (use the domain from step 5)
5. **Domain:** under Settings → Networking, choose **Generate Domain** for a free `….up.railway.app` address. Or add a custom domain (for example one bought for about £10 a year from a domain registrar) and create the DNS record Railway shows you. HTTPS is automatic. Update `BASE_URL` to match.
6. **First login:** open the service's **Logs**. They show `Site admin set-up link for …`. Open that link, choose a password, and you're in. The link is printed on every restart until it's used.
7. In the site, go to Site admin: add the bank details and rates, issue the 2026 charges, and add each family's admin. Each family admin then adds their own members and trusted friends.

**Backups:** Railway volumes can be backed up from the volume's settings. The whole site's data is the single file `/data/camas.db`.

Other hosts work the same way. Render (a Starter service plus a persistent disk) or a small VPS both need Node 22.5+, a persistent folder for `DB_FILE`, and the same variables.

## Before going live
1. **Email.** Notifications currently appear in the in-app bell and are printed to the server console. To send real emails, plug an email service into `sendEmail()` in `server.js` (SMTP, Resend, Postmark, etc.).
3. **Card payments** (optional). The bank-transfer flow is deliberately simple. To take card payments instead, add a Stripe Checkout step and confirm bookings from its webhook rather than by hand.
4. Agree a **cancellation and refund policy** and a rule on **who is liable for a friend's damage** (usually the family who offered the week). Put both on the booking screen.
