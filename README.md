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

## Home page and navigation

Everyone lands on **Home**. At the top, **Needs your attention** lists what needs doing; below it are panels with useful information and quick links. The calendar is its own tab.

| Who | Navigation | Needs your attention shows |
|---|---|---|
| Trusted friend | Home, Available weeks, My bookings, My details | Bookings to pay for |
| Family member | Home, Calendar, My weeks (view only), Enquiries, Bookings, Family & friends | Bookings to pay for, and first refusals to take or pass |
| Family admin | The same, plus Account | Also: swap offers to answer or confirm, enquiries about the family's weeks, undecided weeks in the next 16 weeks, the balance to pay, and people who haven't set up their login |
| Site admin | Their family's pages, plus Site admin | Also a **Syndicate admin** section: payments to confirm, families owing money, families with no admin, service charges not issued, let-income pots not shared out, next year's weeks not set up, demo logins still active, email not switched on, and storage problems |

The panels are:
- **Coming up:** the family's next weeks, or a friend's bookings.
- **Weeks you can book**
- **Your enquiries**
- **Family at a glance:** credits, releases, pot share and balance.
- **What's new:** the latest notifications.
- **Quick links**

Opening a page you don't have access to takes you back to Home.

**Storage check.** On Railway, if `DB_FILE` isn't set, the site now keeps its database on the attached volume automatically. The site admin's Home page warns if there's no volume, or if the database is somewhere else, and shows where the database is and since when its data dates.

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

**Credits: measuring fairness**
- **Entitlement:** each share is worth **100 credits** a year (5,200 for 52 shares). Uneven swaps and admin adjustments carry credits from one year to the next.
- **Week values:** every week has a credit value from its band: school holidays, summer, shoulder or winter (illustrative weights 170 / 130 / 100 / 45). The site scales the weights so each year adds up to about 5,200, give or take rounding; this also handles 53-week years.
- **School holidays:** the site admin marks school-holiday weeks under **Weeks & allocation**. 2026 and 2027 are preloaded with assumed English school holidays, so check them.
- **Fairness table:** **My weeks** and **Site admin → Credits & pot** show, for each family, the credit value of the weeks it holds against its entitlement.

**My weeks**
- The family admin gives each week a setting:
  - **Undecided** (the default)
  - **Using it**
  - **Willing to swap**
  - **Released**: the family won't use it, and others can book it
- For released weeks, the family can set its own **friend price** (blank means the admin's default for the band) and **who can book**: other members only; members and any family's trusted friends; or members and our own trusted friends.
- **Reminders:** family admins are reminded about weeks still **Undecided** at 16 and 8 weeks before arrival. Nothing is released automatically.

**Released weeks and the let-income pot**
- **Booking:** a released week can be booked by other members first, at the **member price** (75% of the friend price by default). Trusted friends can book it **7 days later**, and always from 3 weeks before arrival.
- **The pot:** all money paid for a year's released weeks goes into one **let-income pot**.
- **Release points:** the pot is shared by each released week's credit value, counted **in full if released 8+ weeks ahead**, otherwise at 50%. A released week counts whether or not anyone books it.
- **Paying out:** the site admin presses **Distribute pot** (Site admin → Credits & pot). Each family's share is credited against the following year's service charge. Re-distributing replaces the earlier figures.

**Swaps**
- **Asking:** any family member can ask for any other family's week that isn't *Using it*. They only name the week they want, and the request can only be sent if their family has at least one week that is *Willing to swap* or *Released*.
- **The owning family's admin** either:
  - **chooses one** of those weeks in exchange; or
  - **declines: we're using it**, and the week is marked *Using it*; or
  - **declines: not sure yet**.
- **The requesting family's admin** then **confirms**, or chooses **not that week**, in which case the other family can pick a different one.
- **Uneven swaps:** the family that gets the more valuable week has the difference taken off next year's credits, and the other family gains it.
- **Tidying up:** requests sort themselves out when weeks change (marked using, released, booked or swapped), and everyone involved is notified.

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
1. **Email.** Reminders, invitations and notifications are emailed through [Resend](https://resend.com) once two variables are set on the server: `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Nab Camas <portal@your-domain>`, from a domain verified in Resend). Until then, they only appear in the site's notification bell.
3. **Card payments** (optional). The bank-transfer flow is deliberately simple. To take card payments instead, add a Stripe Checkout step and confirm bookings from its webhook rather than by hand.
4. Agree a **cancellation and refund policy** and a rule on **who is liable for a friend's damage** (usually the family who offered the week). Put both on the booking screen.
