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
- **2026 budget:** from *Nab Camas 2026 Budget.xlsx*. Period July 2025 – June 2026, £19,332 funding need, charged at **£370 per week**. The service charges are **not issued yet**: press *Issue 2026 service charges* on the Payments page, then record the payments already received there.

It also adds **demo logins** (password `demo1234`) and a few demo week offers in 2027:

| Login | Role |
|---|---|
| admin@example.com | Site admin (no family) |
| white@example.com | Family admin of White |
| member@example.com | Family member, White |
| friend@example.com | Trusted friend of White |
| bonar@, ekserdjian@, howarth@, lunthall@, mackay@example.com | Each other family's admin |

To go live: log in as admin@example.com and go to **Site admin**:
1. **Expenditure** (the budget): check 2026. For next year, use *Copy from 2026* (with an uplift) or *Import from spreadsheet*. Then on **Payments**, set the charge per week, **Issue** the charges and record payments already made.
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

**Contact buttons.** On the Overview, *In residence this week* and *Arriving next* show who to contact, with **Email** and **WhatsApp** buttons (WhatsApp appears when the person has a phone number; UK numbers starting 0 are dialled as +44). The contact is the holding family's admin; for a week let to guests, the holding family and the site admin see the guest's details instead. Your own family's weeks show no buttons, and trusted friends never see contact details.

**View as (site admin, for testing).** The site admin can pick any household login from the **View as** list under "Logged in as" to see the portal exactly as that person does: their menu, Overview, permissions and buttons. A banner shows who you're viewing as, with **Back to site admin**. Anything done while viewing as someone really happens, as them, and the Activity log records it as "site admin acting as …". It can be switched off under **Settings**.

Every page shows who is **logged in** (their name). This appears at the top of the sidebar, or in a strip under the header on tablets and phones. The Overview greets families by household ("Good evening, Mackay family"), and trusted friends and the site admin by name.

Everyone lands on the **Overview** (Home), headed *Welcome to Camas*, with who's in residence this week, who's arriving next and your next stay. At the top, **Needs your attention** lists what needs doing; below it are panels with useful information and quick links. The calendar is its own tab.

| Who | Navigation | Needs your attention shows |
|---|---|---|
| Trusted friend | Home, Available weeks, My bookings, My details | Bookings to pay for |
| Family member | Home, Calendar, Enquiries, Bookings, Family & friends | Bookings to pay for, and first refusals to take or pass |
| Family admin | The same, plus Account | Also: enquiries to answer (release, using it or not sure yet), friends' booking enquiries, undecided weeks in the next 16 weeks, the balance to pay, and people who haven't set up their login |
| Site admin | A separate login with no family: Home, Calendar, Payments, Expenditure, Weeks, Lets, Families, Users, Settings, Activity | Syndicate jobs: payments to confirm, families owing money, families with no admin, service charges not issued, let-income pots not shared out, next year's weeks not set up, demo logins still active, email not switched on, and storage problems. Home also shows balances, credits, the pot and recent activity. |

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
| Propose expenditure | — | — | ✓ | ✓ |

## Gaps in the brief and how they're handled

**Weeks and the calendar**
- **Week numbering and changeover days** follow the syndicate's documents. Week 1 starts on the first **Friday on or after 26 December**, and weeks run back to back. Most years therefore have 52 weeks, but some (e.g. **2026**) have **53**; a new 53rd week starts unallocated ("Syndicate") until it's assigned. Weeks **12–43 change over on Saturday** and the rest on Friday, so the switch weeks are **8 and 6 nights**. The calendar shows this. The days and the week range are in Settings, and any week's start date can be edited.
- **Calendar notes** such as "School Half-term" or "Easter Day" are imported from the comment column and shown on the calendar.
- **Wrong-year protection.** The allocation importer compares the file's title, weekday names and dates with the year you're importing into, and warns if they don't match.
- **Seasons are set per week.** New years get seasons from month settings, and the admin can override any week.
- **Rotation.** If every family kept the same week numbers each year, they would always get the same season. **Roll forward** copies last year's allocation with an optional shift, or you can import a new allocation each year.
- **Ownership vs. holding.** Each week records who it was *allocated* to and who currently *holds* it. The site admin changes the allocation on **Weeks** before signing it off; a week given free to another family keeps its holder and shows who is using it.

**Letting to friends and families**
- **Double booking.** Booking a week puts a hold on it immediately. A second person trying to book sees "someone else has just booked this week".
- **Bank transfer payments.** The site can't see the bank account. Each booking gets a **unique reference**, and the week is held for N days (3 by default). The site admin ticks it as paid once the money arrives. Unpaid holds lapse automatically and the week becomes available again.
- **Where the money goes.** When payment is confirmed, the family that released the week is credited with what was paid, less the letting cost for the maintenance fund (see *Released weeks and let income* below).
- **Family members buying from another family** can pay by bank transfer like a friend, or from their household's credit if it covers the price (confirmed instantly).
- **Friend scope.** A family can let a week to *any* family's trusted friends, or only *their own*. Friends never see family contact details, other families' activity or weeks that aren't offered to them.
- **Price.** The default comes from the site-wide season rate. A family admin can override it for any one week.
- **Cancellations.** The booker or the family can cancel an unpaid hold. Only the site admin can cancel a paid booking. They can cancel any booking, paid or not, in two places:
  - **Site admin → Lets**, which lists every booking for the year with a Cancel button;
  - **Cancel booking** in the week's panel on the calendar.

  The dialog says what will happen and takes an optional message, which is sent to the guest and to the household.
  - The let income credited to the household is reversed automatically.
  - A member who paid from their account gets the amount back on it.
  - The week goes back on offer. The admin can then open it and set it to Undecided or Using it.
  - A guest who paid by bank transfer is refunded outside the site, under whatever cancellation policy you agree.

**Prices and seasons**
- **Prices still vary by season:** the site admin sets the trusted-friend price for school holidays, summer, shoulder and winter under **Settings**, and members and trusted friends pay the same price. A family can override the price for any one of its weeks.
- **School holidays:** the site admin marks school-holiday weeks under **Weeks**. 2026 and 2027 are preloaded with assumed English school holidays, so check them.


**Your weeks (on the calendar)**
- There is no separate My weeks page for now: everything is done from the **Calendar**. Families have three filters: **All weeks**, **Our weeks** (just your own; opening one lets the family admin set it) and **Available for enquiry** (other families' released weeks, plus their weeks still *Undecided*). Another family's undecided week is labelled **Enquire** on the calendar; opening it shows **Ask about this week** with Email and WhatsApp buttons for that family's admin. The colour legend has been removed: every week carries a text label.
- The family admin gives each week a setting:
  - **Undecided** (the default)
  - **Using it**
  - **Released**: the family won't use it, and others can book it
- For released weeks, the family can set its own **friend price** (blank means the admin's default for the band). It also chooses **who can book**, and when:
  1. **Members and trusted friends, straight away.** This is the default.
  2. **Members first for 7 days, then trusted friends.** The number of days is set in Site admin → Settings.
  3. **Members and our own trusted friends.**
  4. **Other syndicate members only.**
- **Reminders:** family admins are reminded about weeks still **Undecided** at 16 and 8 weeks before arrival. Nothing is released automatically.

**Released weeks and let income**
- **Booking:** members and trusted friends pay the same price for a released week. There is no member discount. When they can book depends on the family's choice above: straight away, or after the members-first days. A members-first week always opens to friends from 3 weeks before arrival.
- **Your week, your income:** when the payment for a let is confirmed, the household that released the week is credited with what was paid, less the **letting cost** (£100 a let by default, set under Settings), which goes to the maintenance fund. The credit comes off that household's service charge, and anything beyond it carries forward against future charges. A released week that doesn't let earns nothing, so releasing early helps.
- **Members buying weeks:** members can pay by bank transfer, or from their household's **credit** (account in credit from lets or top-ups) if it covers the price. The seller is credited the price less the letting cost.
- **Top-ups:** a family admin can top up the household's credit from the Account page. They get the bank details and a reference; the site admin confirms it on the Payments page when the money arrives.
- **Cancellations:** if the site admin cancels a paid booking, the credit is reversed.

**Enquiries (signed-off years)**
- Once a year's allocation is signed off, weeks change hands only when they are:
  - **given** free to a family that enquired;
  - **released and bought**;
  - **let to a trusted friend**.
- Any family member can **enquire** about another family's week marked **Enquire** on the calendar, that is, one not yet *Using it* or *Released*. They open the week and send an optional message. The week panel also has Email and WhatsApp buttons to ask the holding family directly.
- The enquiry is logged on both families' **Enquiries** pages, in queue order, and the holding family's admin is notified.
- The holding family's admin can answer in one of these ways:
  - **Give it to them free.** The enquiring family can use the week. It is recorded as a £0 booking: no letting cost, nothing on either account, and it doesn't count as a let. The calendar shows *Given to Mackay* to the holder, *Given by Bonar* to the family that receives it, and the receiving family's name to everyone else. The week appears under the receiving family's *Our weeks* filter, and the other enquiries close. Only the site admin can cancel a gift; the week then goes back to its holder as *Undecided*.
  - **Let it to a trusted friend** who has enquired, at the friend price. See below.
  - **Release it.** Those who enquired get **first refusal** for 48 hours, first come first served; then whoever the family chose under **who can book**.
  - Mark it **Using it**, which closes the enquiries.
  - Reply **not sure yet**, which keeps the enquirers' places in the queue.
- **Questions about a week:** any family member can ask about another family's week, even one marked *Using it*. Examples: what time they're leaving, whether they could arrive a day early. Open the week on the calendar and use **Ask … about this week**; on an undecided week, choose **Just a question** in the enquiry form.
  - A question isn't a request for the week, so it never joins the queue.
  - Everyone in the holding family is notified, and anyone in that family can reply on the Enquiries page.
  - The asker is notified of the reply, which shows on their Enquiries page and in the week's panel.
  - The week's panel also has the holding family's Email and WhatsApp buttons.

**Next-year allocation: changes and sign-off**
- Next year's allocation shows as a **Draft** (on the family calendar and the site admin's Overview) until the site admin **signs it off** (the syndicate does this in November). The current year and earlier are always signed off.
- **Changes are arranged directly with the site admin**, who makes them on **Site admin → Weeks** with the "Allocated to" dropdowns. The bar above the table shows the year as *Draft* or *Signed off*, with **Sign off** (and **Reopen as draft** for a future year). Signing off tells every family.
  - **Before signing off,** the portal checks each family's allocated weeks against its shares for that year (set on **Families**).
  - **If any differ,** a pop-up lists them, for example "Bonar: 9 weeks allocated, 8 shares, 1 too many", with **Go back and fix** or **Sign off anyway**.
  - The table shows each week's start date, school holidays, season and who it's allocated to. Calendar notes come from the allocation import.

**Booking enquiries from trusted friends**
- **Asking:** a trusted friend can enquire about any week its household hasn't decided about yet (*Undecided*). The trusted friend's calendar has no filters. Every week shows one of three things: **Book now · £price** if it's released to them, **Enquire** if its household hasn't decided, or **Unavailable**. A week is unavailable if it's in use, booked, or released only to members for now. They give the lead guest, party size and an optional message. Friends still don't see which household holds a week.
- **The holding family's admin** sees the enquiry on the Enquiries page and Overview, with the friend's contact details and whose friend they are. They can:
  - **let it to them**: the week is released and reserved for the friend at the friend price, and the friend gets the bank details and a reference, as with any booking. The payment, less the letting cost, is credited to the family's account. Members who had requested the week are told it has been taken; or
  - **decline**, and the friend is told it isn't available this time.
- **Closing automatically:** if the family marks the week *Using it*, releases it in the usual way, the allocation changes, or someone else books it, the friend's enquiry closes and they're told why. Friends see their enquiries under **My bookings** and can withdraw them.

**Accounts and the budget**
- **Service charge = charge per week × the family's weeks.** The calculated rate is budget ÷ total weeks (2026: £19,332 ÷ 52 = £371.77). You can set a rounded figure, as the syndicate does (£370), and the page shows the resulting shortfall or surplus (2026: £19,240 raised, £92 short). Re-issuing a year's charges replaces only that year's service-charge lines. Payments, credits and adjustments are kept.
- Each account is a running **ledger**: charges are positive, credits and payments negative. The site admin records payments received and can make adjustments with a note.
- Each budget year has a **period label** (e.g. July 2025 – June 2026), and each line has a **type** (Regular, Postpone, …) and **commentary**, as on the spreadsheet.
- **Budget years** can be copied from the previous year with an inflation uplift, edited line by line, or imported from Excel or CSV. The importer lets you pick the columns and previews the result first. It also handles a sheet with the budget on the left and families and weeks on the right.

**Expenditure (the budget, and proposals)**
- The site admin's **Budget** page is now called **Expenditure**. It holds each year's budget lines. The service charge card has moved to **Payments**.
- **Proposing expenditure:** every family admin has an **Expenditure** page. There they can propose something for a coming year's budget, such as a new fridge or a quote for maintenance work: what it's for, the estimated cost, which year's budget, and details. They can withdraw it while it's waiting. The page also shows the agreed expenditure for each year, read-only.
- **Deciding:** the site admin sees the proposals waiting on the Expenditure page and on Overview. After the AGM or a board meeting, they **Accept** or **Reject** each one, recording where it was decided, the agreed amount and a note. An accepted proposal is paid for in one of four ways:
  - **Added to the year's budget:** a new line, so the service charge goes up. If that year's charges are already issued, the portal offers to re-issue them.
  - **Charged to households now:** split by shares as a one-off charge on each account; re-issuing the service charges leaves it alone. Each household's admins are told their share.
  - **Paid from the bank balance:** recorded, and nothing is charged.
  - **Moved from another budget line:** a new line, with the same amount taken off the line chosen, so the service charge is unchanged.
- The proposing family's admins are told the outcome.

**Families and shares (site admin)**
- Shares are set **per year**: pick the year at the top of **Families**, edit each family's shares for that year (one share = one week), then press **Save**. The shares must total **52**: a running total shows how far off you are. Save becomes clickable as soon as you change something, and if the total isn't 52 it says so and saves nothing. That year's service charges are charged per share, so changing 2026 never changes 2027. **Fill in from the {year} allocation** copies the week allocation into the boxes (nothing is saved until you press Save). Names and colours are saved with the same button. **Add family** starts a new family on 0 shares.
- A year without its own figures uses the most recent figure set for this year or later.

**Payments page (site admin)**
- **Service charges by year:** pick the year at the top. The card shows that year's budget, the budget divided by the weeks, the **charge per week** (type one in, or **Round to £5 / £10**), the total raised, and whether the year's charges are **issued**.
  - **Before issuing,** each household's planned charge from the budget shows as *Not issued*.
  - **Issue {year} service charges** puts each charge on the households' accounts and tells their admins. **Re-issue** replaces the charges and leaves payments alone.
- **The table:** each household's charge, what it has paid, what's **outstanding** (after any let income or purchases for that year), and a status: *Not issued*, *Unpaid*, *Part paid*, *Paid* or *In credit*.
- **Recording payments:** **Paid in full** records the outstanding amount as received today. **Record payment** takes a full or part amount, the date it arrived and a note, or an adjustment. It works before the charges are issued too. Statements show the date the money arrived, and the family admins get a thank-you notice.
- **Removing a payment recorded by mistake:** open the household's account (click its name on Payments) and press **Remove** on the payment or adjustment. The balance changes straight away, and the household's admins are told.
  - Removing a confirmed top-up puts it back under *Top-ups expected*.
  - Service charges can't be removed; change them by re-issuing.
  - Lines that belong to a booking can't be removed either; cancel the booking on the Lets page instead.
- **Bank balance:** add the syndicate account's balance by date (with a note) as you read it from the bank. The latest is shown at the top, with a history and the change between readings.
- **Payments to confirm** and **Top-ups expected** work as before.

**Start afresh (Settings, site admin)**
- **Check what would be removed** lists, from the live data, everything that will go: bookings and lets, enquiries and questions, expenditure proposals, top-ups, bank balances, notices and account lines, plus the weeks whose plans reset to Undecided. **Every login is kept**, the demo logins (@example.com) included.
- **Download a backup first** saves a copy of the whole database.
- **Remove it all** (type RESET) does it. Logins, families, who holds each week, budgets and settings are kept. Service charges are reissued from the budgets: **2026 marked paid in full**, **2027 left unpaid** (if there's no 2027 budget yet, add it and press *Issue charges*). The 2027 allocation goes back to draft. To get rid of a demo login later, open it under **Users** and press **Remove**.

**People and security**
- Logins are by **invitation link**. The admin adds a person with an email and sends them the link to set their password. The same button produces a password-reset link. People added without an email are contact records only, with no login.
- Every family must keep at least one family admin.
- Passwords are hashed with scrypt, and sessions use HttpOnly cookies. All key actions are recorded in the **Activity log**.
- **Data protection.** You're storing third parties' contact details, so the add-person form asks the user to confirm consent. Consider a short privacy notice on the site.

## How the pages fit together

- **One year for every page.** Pages that show a year (Calendar, Payments, Expenditure, Weeks, Lets, Families, the family Expenditure page and the Account page) share it. The portal opens on the *working year*: from October, next year if its weeks exist, otherwise this year. Pick another year on any page and the others follow.
- **The years listed** are the years whose weeks exist. To add one, use **Add year…** on **Weeks**; it then appears on every page, ready for its budget and allocation.
- **The bar at the top of a page** has the year picker (and the calendar's filters) on the left, and the page's actions on the right, such as Import, Copy, Add year, Add family or Add person.
- **Buttons:**
  - **Filled:** saving or committing something (Save, Issue, Sign off, Propose, Book).
  - **Green:** money arriving or accepting (Paid, Paid in full, Accept).
  - **Plain:** everything else.
  - **Red outline:** removing, cancelling or withdrawing.
- **Admin page titles** match the menu: Payments, Expenditure, Weeks, Lets, Families, Users, Settings, Activity. Old links to `#/admin/budget` and `#/admin/credits` still work.

## Clean-up (November 2026)

Features that had been retired were removed from the code and the database:
- in-year swaps;
- next-year change requests made through the portal, and the income cap on weeks gained by request;
- the credits system and the old let-income pot;
- the member discount and the weighting by how early a week was released;
- the switch for members' enquiries, which are always on.

On the first start after the clean-up, the server:
- drops the `swaps`, `change_requests` and `credit_ledger` tables;
- drops five unused columns and the retired settings;
- records that it has done so in `settings` (`cleanup_2026_11`).

Nothing else is touched: families, weeks, bookings, accounts, budgets and logins stay as they are.

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
