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
1. **Service charge** (the budget): check 2026. For next year, use *Copy from 2026* (with an uplift) or *Import from spreadsheet*. Then on **Payments**, set the charge per week, **Issue** the charges and record payments already made.
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

**The public home page (v1: the future of NAB).** Before signing in, the home page is about NAB's future: a hero with **Fill in the questionnaire** and **Read the Manifesto**; the questionnaire with a card for each generation (and how many of each have answered); the Manifesto's summary with **Read it and comment**. Signing in is secondary: a small **Owners' sign in** at the top and a compact form at the bottom (and `/#/login`). Signing out returns here. Inside the portal, the families' Overview opens with a **Have your say** panel linking to the questionnaire, the Manifesto, Meetings (with the next meeting's date) and the results.

**The menu is in groups.** With the site growing, the sidebar groups its pages under headings that open and close: **Weeks**, **Money**, **The house**, **Have your say** and, for the site admin, **Admin**. Overview is always at the top (and Family & friends at the bottom for families). The group holding the page you're on is always open; open or close the others and the portal remembers it on that device. A closed group shows a count if something inside it needs you (e.g. new enquiries). Trusted friends have only six pages, so their menu isn't grouped.

**Check in.** During your family's own week (or a week another family gave you), the *In residence this week* card on the Overview has **Check in** and **Not in residence**. Either can be changed during the week. Everyone else in the families, and the site admin, then sees *In residence* or *Not in residence* on that card, with when and by whom (trusted friends don't). Checking in on an undecided week marks it *Using it*; if the week is still released for booking, the card says so. There's nothing to check into for a week let to guests, or outside the week itself.

**Contact buttons.** On the Overview, *In residence this week* and *Arriving next* show who to contact, with **Email** and **WhatsApp** buttons (WhatsApp appears when the person has a phone number; UK numbers starting 0 are dialled as +44). The contact is the holding family's admin; for a week let to guests, the holding family and the site admin see the guest's details instead. Your own family's weeks show no buttons, and trusted friends never see contact details.

**View as (site admin, for testing).** The site admin can pick any household login from the **View as** list under "Logged in as" to see the portal exactly as that person does: their menu, Overview, permissions and buttons. A banner shows who you're viewing as, with **Back to site admin**. Anything done while viewing as someone really happens, as them, and the Activity log records it as "site admin acting as …". It can be switched off under **Settings**.

Every page shows who is **logged in** (their name). This appears at the top of the sidebar, or in a strip under the header on tablets and phones. The Overview greets families by household ("Good evening, Mackay family"), and trusted friends and the site admin by name.

Everyone lands on the **Overview** (Home), headed *Welcome to Camas*, with who's in residence this week, who's arriving next and your next stay. At the top, **Needs your attention** lists what needs doing; below it are panels with useful information and quick links. The calendar is its own tab.

| Who | Navigation | Needs your attention shows |
|---|---|---|
| Trusted friend | Overview, Available weeks, My bookings, Maintenance, House guide, My details | Bookings to pay for |
| Family member | Overview; **Weeks:** Calendar, Enquiries, Bookings; **Money:** Service charge, Shares; **The house:** Upgrades, Maintenance, House guide; **Have your say:** Meetings, Questionnaire, Manifesto; Family & friends | Bookings to pay for, and first refusals to take or pass |
| Family admin | The same, plus Account (under Money) | Also: polls to vote in for the family, inaccuracies reported in the house guide, enquiries to answer (release, using it or not sure yet), friends' booking enquiries, undecided weeks in the next 16 weeks, the balance to pay, and people who haven't set up their login |
| Site admin | A separate login with no family: Overview; **Weeks:** Calendar, Weeks, Lets; **Money:** Payments, Service charge, Shares; **The house:** Upgrades, Maintenance, House guide; **Have your say:** Meetings, Questionnaire, Manifesto; **Admin:** Families, Users, Settings, Activity | Syndicate jobs: polls past their closing date, questions waiting with no next meeting set up, maintenance issues open (urgent ones in red), house guide inaccuracies, costs waiting to be adopted, payments to confirm, families owing money, families with no admin, service charges not issued, let-income pots not shared out, next year's weeks not set up, demo logins still active, email not switched on, and storage problems. Home also shows balances, credits, the pot and recent activity. |

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
| See each year's service charge, line by line | — | ✓ | ✓ | ✓ |
| Suggest an upgrade | — | ✓ | ✓ | ✓ |
| Add a quote to a maintenance report | — | — | ✓ | ✓ |
| Adopt, bump or cancel a cost | — | — | — | ✓ |
| Report a maintenance issue | ✓ (sees only their own) | ✓ | ✓ | ✓ |
| Update a maintenance issue (In hand, Fixed, Closed) | — | — | — | ✓ |
| Read the house guide, report an inaccuracy | ✓ | ✓ | ✓ | ✓ |
| Add a guide | — | ✓ | ✓ | ✓ |
| Edit a guide, mark reports as sorted | — | Their own guides | ✓ | ✓ |
| Check in / Not in residence | — | During their family's week | During their family's week | — |
| See the share register and shares for sale | — | ✓ | ✓ | ✓ |
| Offer the family's shares for sale; register interest in another family's | — | — | ✓ | — |
| Record a sale or a transfer of shares | — | — | — | ✓ |
| Comment on the Manifesto, suggest wording, reply | — | ✓ | ✓ | ✓ |
| Accept suggestions, edit the Manifesto's text | — | — | — | ✓ |
| Fill in the questionnaire | No login needed: anyone with the link, from the sign-in page | ✓ | ✓ | ✓ |
| See the questionnaire results (families and generations) | — | ✓ | ✓ | ✓ |
| See each response and edit the questions | — | — | — | ✓ |
| See meeting agendas, polls and minutes | — | ✓ | ✓ | ✓ |
| Ask a question for the next meeting (and withdraw it) | — | ✓ | ✓ | ✓ |
| Vote in a poll (one vote per family) | — | — | ✓ | — |
| Add meetings and agenda items, record minutes, create and close polls | — | — | — | ✓ |

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

**Service charge (the budget)**
- **The page.** *Service charge* shows each year's service charge, line by line: what each line is, its type, whether it's on the service charge or paid from the bank balance, and the amount, with the charge per week and whether it's issued. Every family login can read it; the site admin edits it. (It replaces the Expenditure page. Old links still work.)
- **Paid from:** each line is paid from either the **Service charge** (the default) or the **Bank balance**. The service charge is worked out from the service-charge lines only: their total ÷ the year's shares.
- **The bank-balance limit:** a year's bank-balance lines can't add up to more than the latest bank balance recorded on **Payments**. The portal refuses a change that would go over, whether you edit a line, add one, adopt a cost or copy a year. With no bank balance recorded, nothing can be paid from it yet. If a lower balance is recorded later, the page warns in red until lines are moved or bumped.
- **Totals:** the table shows what's added to the service charge, what's paid from the bank balance (next to the latest balance and its date), and the total. Issuing the charges and recording payments stay on **Payments**.
- **Copying a year leaves one-off lines behind.** *Copy from {last year}* skips adopted costs and any line whose type is *One-off*, since they aren't yearly costs, and says how many it left.

**Upgrades, maintenance quotes and adopting them**
- **One-off costs come from two places.** On **Upgrades**, anyone in the families (members and admins) suggests something for the house: a new fridge, a hot tub, a coffee grinder, with a rough cost if they know it. On **Maintenance**, a family admin or the site admin adds a **quote** to a report when one comes in; a new quote replaces one still waiting. The site admin can also **Add a cost…** directly on the Service charge page (from a works list, say). No year is chosen for any of them.
- **They wait on the Service charge page**, under *Waiting to be adopted*, until the site admin decides. Families see the same list, read-only. Doing nothing is fine: a cost just stays there.
- **Adopting (site admin).** **Adopt…** offers two ways:
  - **Carry it out now, paid from the bank balance:** a One-off line in a year's budget (this year by default) paid from the bank balance, within its limit. Nothing is charged.
  - **Put it forward for a year's service charge:** a One-off line in that year's budget (by default the first year whose charges aren't issued), so the charge goes up. It shows as *Put forward: for the AGM* until the year's charges are issued, then *In the {year} service charge*.
  - The amount can be changed as it's adopted, with a note (e.g. "Agreed by the board, 1 Dec 2026").
- **Bumping and cancelling.** Money set aside for one job sometimes goes to something more urgent. **Bump or cancel…** (on the cost, or the bin on its line) moves an adopted cost **back to the waiting list**, **to another year**, or **cancels** it, with a reason; its line moves or comes out of the budget with it. A waiting cost can be cancelled too, and a cancelled one **reinstated**. Removing an adopted line from the table puts its cost back on the waiting list.
- **Editing.** Whoever suggested it (or added the quote) can edit or withdraw it while it waits; the site admin can edit it while it waits or once adopted, and its line follows. Editing an adopted line in the table changes the cost too.
- **Issued years.** If a change affects a year whose charges are already issued, the site admin is asked whether to re-issue them. If a rounded charge per week is set on Payments, the re-issue uses the rate the budget now works out at; round it again on Payments and issue again if you like.
- **History.** Each cost keeps a short history (quotes, adopted, bumped, moved, cancelled, with who and when), and whoever suggested it or reported the issue is told when it's adopted, bumped, moved or cancelled.
- **Older proposals** (from the Expenditure page) became costs when the site was updated: waiting ones still wait, accepted ones are adopted with their lines, rejected ones are cancelled, and where each was decided is in its history. One that was charged to households by shares stays as it was.

**Maintenance**
- **Reporting.** Anyone who logs in (family members, family admins, trusted friends, the site admin) can report a problem at the house from **Maintenance**: what it is, where (kitchen, heating and hot water, water and drainage, roof and walls, safety…), how urgent (urgent: safety or the house can't be used; needs fixing soon; when convenient), details and one photo. The photo is made smaller in the browser before it's sent. The site admin is told straight away; urgent reports start with "URGENT".
- **Who sees what.** Families and the site admin see every report, so nothing gets reported twice. Trusted friends see only their own. Photos are only shown to people who can see the report.
- **Keeping it up to date (site admin).** **Update…** sets the status (Reported, In hand, Fixed, Closed) with a note; the person who reported it is sent both. The site admin can also delete a report made by mistake. Open reports are listed with urgent ones first; fixed and closed ones stay on the page for a year.
- **The reporter** can edit a report, or withdraw it, until the site admin has picked it up.
- **Quotes.** A family admin or the site admin can **Add a quote…** (amount, who quoted, details). It becomes a cost waiting to be adopted on the Service charge page, and the report shows the quote and how it's getting on (waiting, put forward, adopted, cancelled).
- The site admin's Overview shows how many reports are open, and how many are urgent.

**House guide**
- **What it's for:** how things work at the house, grouped into sections (arriving and leaving, heating and hot water, water and drainage, electrics and Wi-Fi, kitchen, rubbish, safety and emergencies, outside, local area). Each guide opens in place; web addresses become links; a guide can have one photo. **Search** shows just the guides that match.
- **Adding.** Anyone in the families (members and admins) and the site admin can **Add a guide**. Trusted friends can read the guide but not add to it.
- **Editing.** Family admins and the site admin can edit any guide; members can edit the guides they wrote. The text before each edit is kept: **Earlier versions** in the edit dialog loads one back into the form, to save again. A guide can be removed by the same people.
- **Reporting an inaccuracy.** Anyone who can read a guide, trusted friends included, can **Report an inaccuracy**. The site admin and the guide's author are told, and every family admin's Overview lists it until it's sorted. On the guide, editors see the report with **Mark as sorted**; the person who reported it is thanked when it is.
- **Start afresh** leaves the house guide alone: it's content, not test activity.

**Shares**
- **The share register** shows each family's shares for any year, and its share of the house. The agreed price per share is set in **Settings** (£8,650 to start with: a 52nd of about £450,000).
- **Offering shares.** A family admin offers some of the family's shares to the other syndicate families: how many, an asking price per share (the agreed price unless they choose another), the year the sale would take effect from, and a closing date for interest (28 days by default, set in Settings). A family has one offer open at a time. The other families' admins and the site admin are told, and it's on each family admin's Overview.
- **Interest.** Another family's admin registers how many shares the family would like, with a note, until the closing date; they can change it or withdraw it. Registering interest isn't a commitment. If more shares are wanted than offered, they're shared out in proportion to holdings (one share at a time to the family holding the most shares per share it would get, up to what each asked for).
- **Recording the sale (site admin).** The sale itself is completed outside the portal, under the syndicate's articles and any shareholders' agreement. The site admin then records it: who gets how many (filled in from the proportions above, and changeable), the price per share and the year it takes effect. From that year, the shares move, so the weeks and the service charge follow them; earlier years stay as they were. If those years' charges are already issued, the site admin is offered a re-issue. Reallocate weeks on **Weeks** for any year that's already allocated. The site admin can instead **close the offer without a sale**, and the family can **withdraw** it while it's open.
- **Transfers without an offer.** **Record a transfer…** moves shares between families from a year: a holding split between the next generation's households (add the new household on **Families** first), a gift, or a sale agreed another way. Every sale and transfer is listed under *Transfers recorded*.
- The site admin's Overview lists offers that have closed for interest, so the sale can be recorded or the offer closed.

**Manifesto**
- **The page.** *Manifesto* (`/#/manifesto`) holds the Nab Camas 2.0 proposal, "Nab Camas: making the most of our house", the syndicate paper. Its text is loaded from `content/manifesto.md` the first time the site starts; after that it lives in the database.
- **Comments and suggestions.** Anyone can read it and comment from the home page **without a login**, giving their name and family (remembered on their device); family logins comment as themselves. Comments can be on any heading, paragraph, point or table, with the speech bubble beside it, or **suggest different wording** for it. Visitors' comments are kept with their name and family; a hidden box catches robots, and one address can post at most 30 an hour. Comments are visible to anyone who opens the page. Anyone can reply. Comments show under the part they're on; the bubble counts the open ones. **Comment on the whole manifesto** adds a general comment.
- **The site admin** accepts a suggestion (its wording goes straight into the text and the comment stays with the new wording), declines it with an optional note, marks comments as resolved or reopens them, and can delete any comment. Whoever made a comment is told what happened to it; the site admin is told about new comments and replies.
- **Editing the text (site admin).** **Edit the text…** opens the whole manifesto as Markdown (# headings, - points, **bold**, | tables). The text before each edit is kept, and **Earlier versions** loads one back. Comments stay with paragraphs whose wording doesn't change; comments on changed wording are kept under *On wording that has since changed*.
- Trusted friends don't have it in their menu.

**Questionnaire: "NAB: your house, your future"**
- **No login needed.** The home page leads with it (questionnaire 1) (`/#/survey`; `/#/survey?g=founder`, `second` or `third` starts with that generation ticked), so anyone in the families can fill it in without a login. Logged-in people can fill it in from the Questionnaire page too: their name and family are filled in, and filling it in again replaces their earlier answers.
- **Generation first.** The first question is which generation you are: founder member, second generation (many already hold shares alongside the founders) or third generation. Each generation then answers the same underlying questions, **worded for them**: founders are asked about the younger generations ("Do you believe the younger generations will want to keep…"), the second generation as owners now or later ("Would you want to keep your family's shares, whether you hold them now or take them on later?"), and the third about their own future ("If you inherited…"). Answer options are worded for each generation too, but line up so the answers can be compared.
  - **Shared by all three (18):** how important NAB is to the family; keeping the shares; paying the subscriptions; how often they'd use it; passing on ownership; buying and selling weeks; paid exchanges between families; trusted guests and their prices; whether guest income would help keep the shares; how to maintain and improve the house; the £20,000 (every area from both questionnaires, including drainage and sauna/hot tub); contributing more; when; what would keep the family involved; helping to manage NAB; anything else.
  - **One generation only:** founders, whether they've already passed shares on and whether they've talked with the younger generations about NAB; the second generation, whether they're already a shareholder or director; the third generation, how often they've stayed at NAB in the last five years. So founders answer 20 questions, the second and third generations 19.
  - The wording comes from the syndicate's two questionnaires (the succession one for directors and shareholders, the next-generation one), adapted for each generation.
- **Answering.** Family (or a family not listed), name and optional email; then the questions, one card per section. "Choose up to three" stops at three; the £20,000 adds up as you go and must be shared out exactly (or left blank); an answer can carry an amount (e.g. a lump sum in £ thousands). Every question is optional. A hidden box catches robots, and one address can send at most 20 an hour.
- **Results (families and the site admin).** The **Questionnaire** page shows how many have answered, by generation and by family, then a summary of every question, under a plain heading. Questions asked of one generation only are marked "Only asked of …" in that generation's colour, and **How each generation was asked** shows each generation's wording. For each question: bars for the share who chose each answer (split by generation when all generations are shown), the average for each £20,000 area, the amounts given, and every comment with its family and generation. Names aren't shown to the families. Filter by generation and by family. **The numbers** under each question gives the figures as a table.
- **The site admin** also sees **Responses** (name, email, family, generation and every answer, with **Delete** for duplicates or tests, and **Download as a spreadsheet**, one column per question) and **Questions**: open or close the questionnaire, edit its title and introduction, copy the link, and add, edit, reorder or remove questions. Each question has its plain wording for the results, its wording for each generation (blank: not asked of that generation), and options with a plain label and, where it helps, each generation's own wording. A question with answers is switched off rather than deleted.
- **Start afresh** leaves questionnaire responses and Manifesto comments alone; delete test responses on the Responses list.

**Questionnaire 2: "Trading weeks: how should it work?"**
- A second questionnaire (`/#/survey/trading`), on the home page under the first, to clarify **how each family would like weeks to be traded**. It also starts with which generation you are, but every generation gets the same 23 questions:
  - **What a share should mean:** particular weeks, a budget of credits, or a mix; keeping "our" weeks or flexibility; which of the four ways (A to D, as in "Nab Camas: four ways to share and trade our weeks").
  - **Changing next year's weeks:** through the site admin, direct swaps, or a trading window; rotating peak weeks; school holidays for families with children.
  - **Releasing and selling weeks:** who gets first chance, for how long, what members pay, who sets the price, who receives the money, the letting cost, letting undecided weeks to friends, part weeks, refunds.
  - **Fairness and value:** peak weeks earning more, credits that follow prices, weeks nobody wanted, unused credits.
  - **Your family's plans:** what the family expects to do (all that apply), how many weeks it might release, and **100 points** shared between what matters most (keeping our weeks, changing weeks, earning, fairness, simplicity, families before friends).
- **Results:** on the Questionnaire page, switch between the two questionnaires. Under each question, **Each family's answers** sets the families side by side (how many of each family's people chose each answer, or its average points), so you can see how each family would like trading to work.
- Each questionnaire has its own responses, spreadsheet, questions, title, introduction and open/closed switch; a login can answer each once. A share-out question can be in pounds or points.

**Meetings: agendas, questions, polls and minutes**
- The **Meetings** page (under *Have your say*) is for the syndicate's AGMs and board meetings ("ADM" in the brief). Everyone in the families and the site admin can see it; trusted friends can't.
- **Ask a question for the next meeting:** anyone in the families can. It goes on the agenda of the next meeting (marked *Question from the X family*, with who asked and when). If no meeting is set up yet, it waits and goes on the agenda as soon as the site admin adds the next one. The site admin is told. The person who asked can withdraw it until the meeting is held.
- **The next meeting** shows its date, place and numbered agenda. The site admin adds a meeting (AGM, board meeting or other; the title fills itself in, e.g. "AGM 2027"), adds and edits agenda items, moves them up and down, or moves an item to another meeting. Everyone in the families is told when a meeting is added. An AGM's agenda also lists the **costs put forward for the service charge** (from the Service charge page) for the meeting to agree.
- **Polls of the family admins:** the site admin creates a poll (a question, answers one per line, an optional closing date, and which meeting it's for). The family admins are told, and it shows in their *Needs your attention* ("Vote for your family: …"). **Each family gets one vote**, cast by any of its admins, with an optional comment; they can change it until the poll closes. Everyone in the families can see the running result: how many families chose each answer and the shares they hold, which families haven't voted yet, and the comments. The site admin is reminded when a poll passes its closing date.
- **Close and add to the agenda:** closing a poll stops the voting and puts its result on the agenda (of the meeting chosen, or the next one) as *Poll of the family admins: …* with each answer's families and shares written out. The family admins are told.
- **Past meetings and minutes:** a meeting moves to *Past meetings* once its date has passed or its minutes are in. The site admin records the minutes (paragraphs, "- " for points and "# " for headings; on the day itself, **Record the minutes…** is on the next meeting's card). Everyone in the families is told when minutes are first added, and can read them with the meeting's agenda. A meeting with minutes can't be removed.
- The Overview's *Have your say* panel shows the next meeting and how many items are on its agenda.
- **Start afresh** leaves meetings, agendas, polls and minutes alone.

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
- **Check what would be removed** lists, from the live data, everything that will go: bookings and lets, enquiries and questions, upgrades and quotes, share offers, maintenance reports, top-ups, bank balances, notices and account lines, plus the weeks whose plans (and check-ins) reset to Undecided. The house guide is kept. **Every login is kept**, the demo logins (@example.com) included.
- **Download a backup first** saves a copy of the whole database.
- **Remove it all** (type RESET) does it. Logins, families, who holds each week, budgets and settings are kept. Service charges are reissued from the budgets: **2026 marked paid in full**, **2027 left unpaid** (if there's no 2027 budget yet, add it and press *Issue charges*). The 2027 allocation goes back to draft. To get rid of a demo login later, open it under **Users** and press **Remove**.

**People and security**
- Logins are by **invitation link**. The admin adds a person with an email and sends them the link to set their password. The same button produces a password-reset link. People added without an email are contact records only, with no login.
- Every family must keep at least one family admin.
- Passwords are hashed with scrypt, and sessions use HttpOnly cookies. All key actions are recorded in the **Activity log**.
- **Data protection.** You're storing third parties' contact details, so the add-person form asks the user to confirm consent. Consider a short privacy notice on the site.

## How the pages fit together

- **One year for every page.** Pages that show a year (Calendar, Payments, Service charge, Weeks, Lets, Families and the Account page) share it. The portal opens on the current calendar year (2026 until 1 January 2027). Pick another year on any page and the others follow.
- **The years listed** are the years whose weeks exist. To add one, use **Add year…** on **Weeks**; it then appears on every page, ready for its budget and allocation.
- **The bar at the top of a page** has the year picker (and the calendar's filters) on the left, and the page's actions on the right, such as Import, Copy, Add year, Add family or Add person.
- **Buttons:**
  - **Filled:** saving or committing something (Save, Issue, Sign off, Suggest, Book).
  - **Green:** money arriving or accepting (Paid, Paid in full, Accept).
  - **Plain:** everything else.
  - **Red outline:** removing, cancelling or withdrawing.
- **Shared pages:** Upgrades, Maintenance, House guide, Shares, Meetings, Manifesto and Questionnaire are the same pages for every role; what you can do on them depends on your role.
- **Admin page titles** match the menu: Payments, Service charge, Weeks, Lets, Families, Users, Settings, Activity. Old links to `#/admin/budget`, `#/admin/expenditure`, `#/expenditure` and `#/admin/credits` still work.

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
