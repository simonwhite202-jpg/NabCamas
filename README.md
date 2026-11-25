# Nab Camas syndicate portal

A self-contained web portal for the syndicate: availability calendar, buying and letting weeks, next-year allocation changes, family accounts and budget-driven service charges.

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
| admin@example.com | Site admin (no family) |
| white@example.com | Family admin of White |
| member@example.com | Family member, White |
| friend@example.com | Trusted friend of White |
| bonar@, ekserdjian@, howarth@, lunthall@, mackay@example.com | Each other family's admin |

To go live: log in as admin@example.com and go to **Site admin**:
1. **Budget & charges**: check 2026, **Issue** the charges, and record payments already made. For next year, use *Copy from 2026* (with an uplift) or *Import from spreadsheet*.
2. **Weeks & allocation**: add future years with **+ Year** and import their allocation (Word, Excel or CSV).
3. **Settings & rates**: add the bank details and the summer, shoulder and winter rates.
4. **Users**: add each family's real admin, change your own email and password, and remove the demo users. The site admin login has no family, so if you also run a family, give yourself a second login as that family's admin, with a different email address (for example a `+family` alias of your usual address). In the calendar, untick the demo offers.

To start completely clean, delete the `data` folder before starting the server.

## Design

The look is contemporary Scandinavian minimalism: white cards on warm limestone, restrained green accents, one-pixel borders instead of shadows, and **Manrope** throughout. All of it comes from design tokens at the top of `public/styles.css` (palette, status colours, type sizes, spacing, radii), used by shared components:
- the woodland **sidebar**, which becomes a slide-in menu on tablets and phones;
- buttons, form fields, tables, tags, drawers, modals and toasts.

Icons are thin-stroke **Lucide** icons, bundled in `public/icons.js` (ISC licence), so nothing extra is downloaded.

| Token | Colour | Used for |
|---|---|---|
| Deep woodland | `#243D32` | Sidebar, your household's weeks |
| Fern green | `#597561` | Primary buttons, links, focus |
| Soft sage | `#E5EBE2` | Soft fills, active menu item |
| Limestone | `#F5F5F0` | Page background |
| Chalk white | `#FFFFFF` | Cards |
| Graphite | `#303833` | Text |
| Subtle border | `#DFE4DC` | One-pixel rules |

**Calendar status colours** are muted, and each one is always paired with a text label:

| Colour | Status |
|---|---|
| Woodland | Your household's weeks |
| Grey | Other households |
| Fern | Available to book |
| Sand | Requested or pending |
| Slate | Booked |

**Overview photograph.** The site admin can upload a panoramic photograph under **Settings → Overview photograph**. It's resized in the browser, stored next to the database (so it survives updates), and shown on the Overview and sign-in pages. Without one, both pages simply show the typographic header.

## Home page and navigation

**View as (site admin, for testing).** The site admin can pick any household login from the **View as** list under "Logged in as" to see the portal exactly as that person does: their menu, Overview, permissions and buttons. A banner shows who you're viewing as, with **Back to site admin**. Anything done while viewing as someone really happens, as them, and the Activity log records it as "site admin acting as …". It can be switched off under **Settings**.

Every page shows who is **logged in**: name, role (site admin, family admin, family member or trusted friend) and household. This appears at the top of the sidebar, or in a strip under the header on tablets and phones. The Overview greeting uses the same details.

Everyone lands on the **Overview** (Home), headed *Welcome to Camas*, with who's in residence this week, who's arriving next and your next stay. At the top, **Needs your attention** lists what needs doing; below it are panels with useful information and quick links. The calendar is its own tab.

| Who | Navigation | Needs your attention shows |
|---|---|---|
| Trusted friend | Home, Available weeks, My bookings, My details | Bookings to pay for |
| Family member | Home, Calendar, My weeks (view only), Enquiries, Bookings, Family & friends | Bookings to pay for, and first refusals to take or pass |
| Family admin | The same, plus Account | Also: enquiries to answer (release, using it or not sure yet), friends' booking enquiries, undecided weeks in the next 16 weeks, the balance to pay, and people who haven't set up their login |
| Site admin | A separate login with no family: Home, Calendar, Payments, Budget, Weeks, Lets, Families, Users, Settings, Activity | Syndicate jobs: payments to confirm, families owing money, families with no admin, service charges not issued, let-income pots not shared out, next year's weeks not set up, demo logins still active, email not switched on, and storage problems. Home also shows balances, credits, the pot and recent activity. |

The panels are:
- **Coming up:** the family's next weeks, or a friend's bookings.
- **Weeks you can book**
- **Your enquiries**
- **Family at a glance:** credits, releases, let income credited and balance.
- **What's new:** the latest notifications.
- **Quick links**

Opening a page you don't have access to takes you back to Home.

**Storage check.** On Railway, if `DB_FILE` isn't set, the site now keeps its database on the attached volume automatically. The site admin's Home page warns if there's no volume, or if the database is somewhere else, and shows where the database is and since when its data dates.

## Who can do what

| | Trusted friend | Family member | Family admin | Site admin |
|---|---|---|---|---|
| See calendar | Only weeks offered to them | All weeks and holders | All | All |
| Book a let week (pay by bank transfer) | ✓ | ✓ (buying from another family) | ✓ | ✓ |
| Pay for a week from the household's credit | — | ✓ (switchable in settings) | ✓ | ✓ |
| Enquire about another family's week | Undecided weeks only | ✓ | ✓ | — |
| Release own family's week, set a price | — | — | ✓ | ✓ |
| Change next year's allocation | — | — | Asks the site admin | ✓ |
| Top up the household's credit | — | — | ✓ | Confirms |
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
- **Ownership vs. holding.** Each week records who it was *allocated* to and who currently *holds* it. An approved next-year change request reallocates both weeks for that year only and never touches other years.

**Letting to friends and families**
- **Double booking.** Booking a week puts a hold on it immediately. A second person trying to book sees "someone else has just booked this week".
- **Bank transfer payments.** The site can't see the bank account. Each booking gets a **unique reference**, and the week is held for N days (3 by default). The site admin ticks it as paid once the money arrives. Unpaid holds lapse automatically and the week becomes available again.
- **Where the money goes.** When payment is confirmed, the family that released the week is credited with what was paid, less the letting cost for the maintenance fund (see *Released weeks and let income* below).
- **Family members buying from another family** can pay by bank transfer like a friend, or from their household's credit if it covers the price (confirmed instantly).
- **Friend scope.** A family can let a week to *any* family's trusted friends, or only *their own*. Friends never see family contact details, other families' activity or weeks that aren't offered to them.
- **Price.** The default comes from the site-wide season rate. A family admin can override it for any one week.
- **Cancellations.** The booker or the family can cancel an unpaid hold. A paid booking can only be cancelled by the site admin, and the ledger entries are reversed automatically. The refund itself is handled outside the site, under whatever cancellation policy you agree.

**Credits (switched off for now)**
- Week credits are hidden from every screen for now, and every season counts the same in the background. The code is kept for when the syndicate decides how to value weeks (see the four-frameworks paper).
- **Prices still vary by season:** the site admin sets the trusted-friend price for school holidays, summer, shoulder and winter under **Settings**, and members pay a percentage of it. A family can override the price for any one of its weeks.
- **School holidays:** the site admin marks school-holiday weeks under **Weeks & allocation**. 2026 and 2027 are preloaded with assumed English school holidays, so check them.


**My weeks**
- The family admin gives each week a setting:
  - **Undecided** (the default)
  - **Using it**
  - **Released**: the family won't use it, and others can book it
- For released weeks, the family can set its own **friend price** (blank means the admin's default for the band) and **who can book**: other members only; members and any family's trusted friends; or members and our own trusted friends.
- **Reminders:** family admins are reminded about weeks still **Undecided** at 16 and 8 weeks before arrival. Nothing is released automatically.

**Released weeks and let income**
- **Booking:** a released week can be booked by other members first, at the **member price** (75% of the friend price by default). Trusted friends can book it **7 days later**, and always from 3 weeks before arrival.
- **Your week, your income:** when the payment for a let is confirmed, the household that released the week is credited with what was paid, less the **letting cost** (£100 a let by default, set under Settings), which goes to the maintenance fund. The credit comes off that household's service charge, and anything beyond it carries forward against future charges. A released week that doesn't let earns nothing, so releasing early helps.
- **Members buying weeks:** members can pay by bank transfer, or from their household's **credit** (account in credit from lets or top-ups) if it covers the price. The seller is credited the member price less the letting cost.
- **Top-ups:** a family admin can top up the household's credit from the Account page. They get the bank details and a reference; the site admin confirms it on the Payments page when the money arrives.
- **Weeks gained by a change request** (when requests are switched on): if a household lets a week it got through a next-year change request, its credit is capped at that year's service charge per share (£370 in 2026). Anything above goes to the maintenance fund, so there's no profit in asking for peak weeks just to let them.
- **Cancellations:** if the site admin cancels a paid booking, the credit is reversed.
- **Moving from the old pot:** on the first start of this version, paid lets that were waiting for a pot share-out are credited to the families that released them. Years already shared out are left as they were.

**Enquiries (signed-off years)**
- Once a year's allocation is signed off, weeks change hands only by being **released and bought**: there are no swaps between families.
- Any family member can **enquire** about another family's week that isn't *Using it*. If the family releases it, those who enquired get **first refusal** for 48 hours at the member price, first come first served; then all members for 7 days; then trusted friends.
- The holding family can also mark it *Using it* (the enquiries close) or reply **not sure yet** (enquirers keep their place).

**Next-year allocation: changes and sign-off**
- The next year's allocation stays a **draft** until the site admin **signs it off** (the syndicate does this in November). The current year and earlier are always signed off.
- **For now, changes are arranged directly with the site admin**, who makes them on **Site admin → Weeks** ("Allocated to"). The portal's change-request feature (family admins asking from My weeks, the site admin approving) is built but switched off (`CHANGE_REQUESTS_OPEN` in `server.js`).
- **Sign off** closes the year to changes and tells everyone that weeks are now bought and sold.
- **Moving from the old swaps:** on the first start of this version, *Willing to swap* becomes *Undecided*. Swap offers still waiting lapse (with a notice); their enquiries stay in the queue.

**Booking enquiries from trusted friends**
- **Asking:** a trusted friend can enquire about any week its household hasn't decided about yet (*Undecided*). On their calendar these weeks are marked *Open to enquiries*. They give the lead guest, party size and an optional message. Friends still don't see which household holds a week.
- **The holding family's admin** sees the enquiry on the Enquiries page and Overview, with the friend's contact details and whose friend they are. They can:
  - **let it to them**: the week is released and reserved for the friend at the friend price, and the friend gets the bank details and a reference, as with any booking. The payment, less the letting cost, is credited to the family's account. Members who had requested the week are told it has been taken; or
  - **decline**, and the friend is told it isn't available this time.
- **Closing automatically:** if the family marks the week *Using it*, releases it in the usual way, the allocation changes, or someone else books it, the friend's enquiry closes and they're told why. Friends see their enquiries under **My bookings** and can withdraw them.

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
   - `ADMIN_EMAIL` = your email (this becomes the site admin login, which belongs to no family)
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
