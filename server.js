// Nab Camas syndicate portal — zero-dependency Node server (Node 22.5+)
// Run: node server.js   then open http://localhost:3000
'use strict';
process.removeAllListeners('warning');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
// The database must live on persistent storage. On Railway, a service's attached volume is announced in
// RAILWAY_VOLUME_MOUNT_PATH, so use it when DB_FILE isn't set; otherwise fall back to ./data (fine locally).
const VOLUME = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const DB_FILE = process.env.DB_FILE || (VOLUME ? path.join(VOLUME, 'camas.db') : path.join(__dirname, 'data', 'camas.db'));
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

// ---------------------------------------------------------------- schema
// The tables as they stand. A database created by an earlier version gets any newer columns from addColumn() below.
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, share_units REAL NOT NULL DEFAULT 1,
  color TEXT NOT NULL DEFAULT '#888', active INTEGER NOT NULL DEFAULT 1);
-- each family's shares (one share = one week) for a year; that year's service charge is charged per share.
-- A year without its own row uses families.share_units, the current figure.
CREATE TABLE IF NOT EXISTS family_shares (family_id INTEGER NOT NULL REFERENCES families(id), year INTEGER NOT NULL, units REAL NOT NULL, PRIMARY KEY (family_id, year));
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, family_id INTEGER REFERENCES families(id), name TEXT NOT NULL,
  email TEXT UNIQUE, phone TEXT, relationship TEXT, notes TEXT,
  role TEXT NOT NULL CHECK (role IN ('site_admin','family_admin','family_member','friend')),
  is_site_admin INTEGER NOT NULL DEFAULT 0, password_hash TEXT, invite_token TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
-- viewer_id: while the site admin uses "View as", the session keeps the admin's own id
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, viewer_id INTEGER);
-- A week. status: own_use (Undecided, or Using it when in_use=1), offered (Released: offer_friends=1), pending/booked (a
-- booking), syndicate (not allocated). original_family_id = the family it was allocated to. sale_to = who can book it once
-- released: all | members_first | own | members. comment = calendar note; note = the holding family's note.
CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY, year INTEGER NOT NULL, week_no INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
  season TEXT NOT NULL CHECK (season IN ('summer','shoulder','winter')), school_holiday INTEGER NOT NULL DEFAULT 0, comment TEXT,
  family_id INTEGER REFERENCES families(id), original_family_id INTEGER REFERENCES families(id),
  status TEXT NOT NULL DEFAULT 'own_use' CHECK (status IN ('own_use','offered','pending','booked','syndicate')),
  offer_friends INTEGER NOT NULL DEFAULT 0, in_use INTEGER NOT NULL DEFAULT 0, sale_to TEXT NOT NULL DEFAULT 'all',
  price_override REAL, note TEXT, released_at TEXT, enquiry_until TEXT, reminded INTEGER NOT NULL DEFAULT 0, UNIQUE(year, week_no));
-- allocation sign-off for a year
CREATE TABLE IF NOT EXISTS year_status (year INTEGER PRIMARY KEY, signed_off_at TEXT, signed_off_by INTEGER);
-- letting_cost = kept from a paid let for the maintenance fund; gift = a week given free to another family (a £0 booking)
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, week_id INTEGER NOT NULL REFERENCES weeks(id), user_id INTEGER NOT NULL REFERENCES users(id),
  seller_family_id INTEGER NOT NULL REFERENCES families(id), buyer_family_id INTEGER REFERENCES families(id),
  amount REAL NOT NULL, method TEXT NOT NULL CHECK (method IN ('bank','account')),
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','cancelled','expired')),
  reference TEXT NOT NULL, guest_name TEXT, party_size INTEGER, notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, confirmed_at TEXT, confirmed_by INTEGER, letting_cost REAL, gift INTEGER);
-- the budget (the Service charge page): lines per year, and per year its period and the charge per week actually levied.
-- funding: 'charge' = added to the service charge; 'bank' = paid from the bank balance (a year's bank lines can't
-- total more than the latest bank balance)
CREATE TABLE IF NOT EXISTS budget_items (
  id INTEGER PRIMARY KEY, year INTEGER NOT NULL, category TEXT, description TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, sort INTEGER DEFAULT 0, notes TEXT,
  funding TEXT NOT NULL DEFAULT 'charge');
CREATE TABLE IF NOT EXISTS budget_years (year INTEGER PRIMARY KEY, label TEXT, rate_per_week REAL);
-- a one-off cost waiting to be adopted into the service charge: an upgrade the families suggest (a new fridge, a hot tub) or a
-- quote for a maintenance issue. The site admin adopts it (now, paid from the bank balance; or put forward for a year's service
-- charge, for the AGM to agree), leaves it waiting, bumps it back or to another year, or cancels it. amount = the estimate or
-- quote (an upgrade's may not be known yet); year, funding (charge | bank; levy on older records) and budget_item_id = its line
-- once adopted; history = what happened to it, as JSON [{at, by, text}].
CREATE TABLE IF NOT EXISTS costs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'upgrade' CHECK (kind IN ('upgrade','maintenance')),
  family_id INTEGER, user_id INTEGER NOT NULL, issue_id INTEGER, title TEXT NOT NULL, amount REAL, quote_from TEXT, details TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','adopted','cancelled','withdrawn')),
  year INTEGER, funding TEXT, budget_item_id INTEGER, history TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT);
-- shares a family offers to the other syndicate families: how many, the asking price per share, the year the transfer would take
-- effect from (weeks and the service charge follow the shares from then), and the closing date for registering interest.
CREATE TABLE IF NOT EXISTS share_offers (id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL, user_id INTEGER NOT NULL, shares INTEGER NOT NULL, price REAL,
  from_year INTEGER NOT NULL, closes_on TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sold','closed','withdrawn')),
  outcome TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT);
-- a family's interest in an offer: how many shares it would like. allotted = how many it got when the sale was recorded.
CREATE TABLE IF NOT EXISTS share_interests (id INTEGER PRIMARY KEY, offer_id INTEGER NOT NULL, family_id INTEGER NOT NULL, user_id INTEGER NOT NULL, shares INTEGER NOT NULL,
  note TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','declined','withdrawn')), allotted INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
-- the share register's changes: shares moved from one family to another from a year, at a price per share (none for a gift or a
-- split between households), recorded by the site admin once the sale or transfer is complete outside the portal
CREATE TABLE IF NOT EXISTS share_transfers (id INTEGER PRIMARY KEY, from_family_id INTEGER NOT NULL, to_family_id INTEGER NOT NULL, shares INTEGER NOT NULL, price REAL,
  from_year INTEGER NOT NULL, offer_id INTEGER, note TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
-- a document the families read and comment on (the manifesto): its text as Markdown, the text before each edit, and comments.
-- A comment is on one block of the text (block_text = that block's wording when it was made, so it follows the block if others
-- move) or on the whole document (block_index -1). kind: comment | suggestion (with new wording) | reply (parent_id).
CREATE TABLE IF NOT EXISTS documents (slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated_by INTEGER, updated_at TEXT);
CREATE TABLE IF NOT EXISTS document_versions (id INTEGER PRIMARY KEY, slug TEXT NOT NULL, body TEXT NOT NULL, edited_by INTEGER, edited_at TEXT);
CREATE TABLE IF NOT EXISTS document_comments (id INTEGER PRIMARY KEY, slug TEXT NOT NULL, parent_id INTEGER, block_text TEXT, block_index INTEGER,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','suggestion','reply')), text TEXT, suggestion TEXT, user_id INTEGER NOT NULL, family_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','declined','resolved')), resolved_by INTEGER, resolved_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
-- a problem at the house, reported by anyone who logs in and kept up to date by the site admin. urgency: urgent (safety, or the
-- house can't be used) | soon | whenever. status: open (reported) | in_hand | fixed | closed. photo = one picture, resized in the
-- browser. A quote for the work is a cost (costs.issue_id).
CREATE TABLE IF NOT EXISTS maintenance_issues (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, family_id INTEGER, title TEXT NOT NULL, area TEXT,
  urgency TEXT NOT NULL DEFAULT 'soon' CHECK (urgency IN ('urgent','soon','whenever')), details TEXT, photo BLOB, photo_type TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_hand','fixed','closed')), update_note TEXT, updated_by INTEGER, updated_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
-- the house guide: how things work at the house. Anyone in the families adds a guide; family admins (and its author) keep it up
-- to date. guide_versions keeps the text as it was before each edit; guide_reports are inaccuracies anyone can report.
CREATE TABLE IF NOT EXISTS guides (id INTEGER PRIMARY KEY, section TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, photo BLOB, photo_type TEXT,
  created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_by INTEGER, updated_at TEXT);
CREATE TABLE IF NOT EXISTS guide_versions (id INTEGER PRIMARY KEY, guide_id INTEGER NOT NULL, section TEXT, title TEXT, body TEXT, edited_by INTEGER, edited_at TEXT);
CREATE TABLE IF NOT EXISTS guide_reports (id INTEGER PRIMARY KEY, guide_id INTEGER NOT NULL, user_id INTEGER NOT NULL, note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sorted')), sorted_by INTEGER, sorted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
-- each household's account: charges positive, payments and credits negative. entry_date = when the money arrived.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), year INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('service_charge','rental_credit','purchase','payment','adjustment')),
  description TEXT NOT NULL, amount REAL NOT NULL, booking_id INTEGER, created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, entry_date TEXT);
-- money a household sends in to build up credit, confirmed by the site admin when it arrives
CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), user_id INTEGER NOT NULL REFERENCES users(id), amount REAL NOT NULL, reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')), created_at TEXT DEFAULT CURRENT_TIMESTAMP, confirmed_at TEXT, confirmed_by INTEGER);
-- the syndicate's bank balance as the site admin reads it from the bank, by date
CREATE TABLE IF NOT EXISTS bank_balances (id INTEGER PRIMARY KEY, as_of TEXT NOT NULL, amount REAL NOT NULL, note TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
-- a family's place in the queue for another family's week. If the holder releases it, enquirers get first refusal
-- (enquiry_hours), first come first served. reply = 'unsure' when the holder isn't sure yet.
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY, week_id INTEGER NOT NULL REFERENCES weeks(id), family_id INTEGER NOT NULL REFERENCES families(id), user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','closed','withdrawn')), close_reason TEXT,
  claim TEXT CHECK (claim IN ('yes','no')), claim_method TEXT, claim_guest TEXT, claim_party INTEGER, claimed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT, reply TEXT, replied_at TEXT);
-- a trusted friend asking to book a week its household hasn't decided about
CREATE TABLE IF NOT EXISTS friend_enquiries (
  id INTEGER PRIMARY KEY, week_id INTEGER NOT NULL REFERENCES weeks(id), user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT, guest_name TEXT, party_size INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','declined','closed','withdrawn')),
  close_reason TEXT, booking_id INTEGER, answered_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT);
-- a member's question about another family's week (arrival times, arriving a day early). Never joins the queue.
CREATE TABLE IF NOT EXISTS week_questions (id INTEGER PRIMARY KEY, week_id INTEGER NOT NULL, family_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  message TEXT NOT NULL, reply TEXT, replied_by INTEGER, replied_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, text TEXT NOT NULL, link TEXT,
  read INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
// columns added since a database was first created (each is a no-op when the column is already there)
for (const [t, def] of [['weeks', 'end_date TEXT'], ['weeks', 'comment TEXT'], ['weeks', 'school_holiday INTEGER NOT NULL DEFAULT 0'], ['weeks', 'in_use INTEGER NOT NULL DEFAULT 0'],
  ['weeks', "sale_to TEXT NOT NULL DEFAULT 'all'"], ['weeks', 'released_at TEXT'], ['weeks', 'enquiry_until TEXT'], ['weeks', 'reminded INTEGER NOT NULL DEFAULT 0'],
  ['weeks', 'residence TEXT'], ['weeks', 'residence_by INTEGER'], ['weeks', 'residence_at TEXT'],
  ['sessions', 'viewer_id INTEGER'], ['bookings', 'letting_cost REAL'], ['bookings', 'gift INTEGER'], ['budget_items', 'notes TEXT'], ["budget_items", "funding TEXT NOT NULL DEFAULT 'charge'"], ['ledger', 'entry_date TEXT'],
  ['enquiries', 'reply TEXT'], ['enquiries', 'replied_at TEXT'], ['outgoing_proposals', 'funding TEXT'], ['outgoing_proposals', 'funding_detail TEXT']])
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${def}`); } catch { }
db.exec("UPDATE users SET is_site_admin = CASE WHEN role='site_admin' THEN 1 ELSE 0 END WHERE is_site_admin <> (role='site_admin')");
// One-off clean-up: retired features' tables, columns and settings go. They were in-year swaps, change requests, credits and
// the let-income pot, the income cap on weeks gained by request, the member discount and release weighting.
if (!db.prepare("SELECT 1 FROM settings WHERE key='cleanup_2026_11'").get()) {
  for (const sql of ['DROP TABLE IF EXISTS swaps', 'DROP TABLE IF EXISTS change_requests', 'DROP TABLE IF EXISTS credit_ledger',
    'ALTER TABLE weeks DROP COLUMN offer_swap', 'ALTER TABLE weeks DROP COLUMN friend_scope', 'ALTER TABLE weeks DROP COLUMN gained_by_request',
    'ALTER TABLE ledger DROP COLUMN pot_year', 'ALTER TABLE bookings DROP COLUMN fund_extra']) try { db.exec(sql); } catch { }
  db.exec(`DELETE FROM settings WHERE key IN ('commission_pct','member_rate_pct','credits_per_share','credit_school','credit_summer','credit_shoulder','credit_winter',
      'early_release_weeks','late_release_weight','income_model','credits_equal','member_requests_off','change_requests_removed','shares_per_year','in_year_swaps');
    INSERT INTO settings (key,value) VALUES ('cleanup_2026_11','1')`);
}
// Expenditure proposals became costs (November 2026). Each proposal is copied across with its id: waiting ones keep waiting,
// accepted ones stay adopted with their budget line, rejected ones are cancelled; where it was decided goes into its history.
// A maintenance report's link to its proposal becomes the cost's link to the report. Then the old table and column go.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='outgoing_proposals'").get()) {
  const linked = db.prepare("SELECT 1 FROM pragma_table_info('maintenance_issues') WHERE name='proposal_id'").get()
    ? Object.fromEntries(db.prepare('SELECT id, proposal_id FROM maintenance_issues WHERE proposal_id IS NOT NULL').all().map(r => [r.proposal_id, r.id])) : {};
  const who = id => (db.prepare('SELECT name FROM users WHERE id=?').get(id) || {}).name || '';
  db.exec('BEGIN');
  try {
    for (const p of db.prepare('SELECT * FROM outgoing_proposals ORDER BY id').all()) {
      const status = { proposed: 'waiting', accepted: 'adopted', rejected: 'cancelled', withdrawn: 'withdrawn' }[p.status] || 'waiting';
      const line = status === 'adopted' && p.budget_item_id ? db.prepare('SELECT * FROM budget_items WHERE id=?').get(p.budget_item_id) : null;
      const funding = status !== 'adopted' ? null : p.funding === 'levy' ? 'levy' : line ? line.funding || 'charge' : p.funding === 'reserves' ? 'bank' : 'charge';
      const text = p.status === 'accepted' ? `Accepted at ${p.meeting}${p.funding_detail ? ` (${p.funding_detail})` : ''}` : p.status === 'rejected' ? `Not accepted at ${p.meeting}`
        : p.status === 'withdrawn' ? 'Withdrawn' : p.year ? `Was allocated to ${p.year}` : '';
      const history = text ? [{ at: p.decided_at || p.created_at, by: who(p.decided_by), text: [text, p.decision_note].filter(Boolean).join('. ') }] : [];
      db.prepare('INSERT INTO costs (id,kind,family_id,user_id,issue_id,title,amount,details,status,year,funding,budget_item_id,history,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(p.id, linked[p.id] ? 'maintenance' : 'upgrade', p.family_id, p.user_id, linked[p.id] || null, p.title, p.amount, p.details, status,
          status === 'adopted' ? p.year : null, funding, line ? line.id : null, JSON.stringify(history), p.created_at, p.decided_at);
    }
    db.exec('DROP TABLE outgoing_proposals');
    if (db.prepare("SELECT 1 FROM pragma_table_info('maintenance_issues') WHERE name='proposal_id'").get()) db.exec('ALTER TABLE maintenance_issues DROP COLUMN proposal_id');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------------------------------------------------------------- helpers
const q = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
let txDepth = 0;   // tx() inside tx() joins the outer transaction; a failure anywhere rolls back the whole thing
function tx(fn) { if (txDepth) return fn(); txDepth++; db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { txDepth--; } }
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };
const round2 = n => Math.round(n * 100) / 100;

const DEFAULT_SETTINGS = {
  site_name: 'Nab Camas', place_line: 'Loch Carron · Scottish Highlands', hero_version: '', currency: '£', view_as_enabled: '1',
  // prices per week by band (a family can set its own when it releases a week); the same for members and trusted friends
  rate_school: '1400', rate_summer: '1200', rate_shoulder: '800', rate_winter: '500', letting_cost: '100',
  // releasing and booking: days a "Members first" release is for members only, hours of first refusal for enquirers,
  // days a bank-transfer booking is held, reminders about undecided weeks (weeks before)
  members_first_days: '7', enquiry_hours: '48', hold_days: '3', reminder_weeks: '16,8', allow_member_account_charge: '1',
  // shares: the agreed price per share (a 52nd of the house's value), and how many days an offer stays open for interest
  share_price: '8650', share_offer_days: '28',
  // creating a new year's weeks
  winter_changeover_day: '5', summer_changeover_day: '6', summer_changeover_from: '12', summer_changeover_to: '43', summer_months: '6,7,8', shoulder_months: '4,5,9,10',
  bank_name: 'Syndicate bank account', bank_account_name: 'Nab Camas Syndicate', bank_sort_code: '00-00-00', bank_account_no: '00000000', bank_iban: '',
};
function settings() { const s = { ...DEFAULT_SETTINGS }; for (const r of q('SELECT key,value FROM settings')) s[r.key] = r.value; return s; }
const bandOf = w => w.school_holiday ? 'school' : w.season;            // school | summer | shoulder | winter
const rateFor = (band, s = settings()) => Number(s['rate_' + band]) || 0;
// a week's price: the family's own, or the price for its band. Members and trusted friends pay the same.
const priceOf = (w, s = settings()) => w.price_override != null ? w.price_override : rateFor(bandOf(w), s);

function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); }
function checkPw(pw, h) { if (!h) return false; const [salt, hex] = h.split(':'); const a = Buffer.from(hex, 'hex'); const b = crypto.scryptSync(pw, salt, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); }
const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

function notify(userIds, text, link) { for (const id of new Set(userIds)) { run('INSERT INTO notifications (user_id,text,link) VALUES (?,?,?)', id, text, link || null); } sendEmail(userIds, text, link); }
// Email goes out through Resend (resend.com) when RESEND_API_KEY and EMAIL_FROM are set; otherwise it is only logged.
async function deliver(to, subject, text) {
  if (!to || /@example\.(com|org)$/i.test(to)) return;            // demo logins
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) { console.log(`[email → ${to}] ${subject}`); return; }
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }) });
    if (!r.ok) console.error(`email to ${to} failed: ${r.status} ${await r.text()}`);
  } catch (e) { console.error(`email to ${to} failed: ${e.message}`); }
}
function sendEmail(userIds, text, link) {
  const site = settings().site_name;
  for (const id of new Set(userIds)) { const u = q1('SELECT email FROM users WHERE id=? AND active=1', id); if (u && u.email) deliver(u.email, `${site}: ${text.length > 80 ? text.slice(0, 77) + '…' : text}`, `${text}\n\nOpen the portal: ${BASE_URL}/${link || ''}`); }
}
const familyAdmins = fid => q("SELECT id FROM users WHERE family_id=? AND role='family_admin' AND active=1", fid).map(r => r.id);
const siteAdmins = () => q('SELECT id FROM users WHERE is_site_admin=1 AND active=1').map(r => r.id);
let actingAdmin = null;   // set for the duration of a request made while the site admin views as someone
const audit = (uid, action, detail) => {
  let d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  if (actingAdmin && uid !== actingAdmin) { d = `site admin acting as ${(q1('SELECT name FROM users WHERE id=?', uid) || {}).name || uid}: ${d}`; uid = actingAdmin; }
  run('INSERT INTO audit (user_id,action,detail) VALUES (?,?,?)', uid, action, d);
};
const famName = id => (q1('SELECT name FROM families WHERE id=?', id) || {}).name || 'Syndicate';
const weekLabel = w => `Week ${w.week_no} ${w.year} (${fmtDate(w.start_date)})`;
function fmtDate(d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }

// Weeks follow the syndicate's calendar: week 1 starts on the first winter changeover day (Friday) on or after 26 Dec of the
// previous year, and runs continuously, so most years have 52 weeks and some have 53 (e.g. 2026). Weeks in the summer
// range change over on the summer day (Saturday), so the weeks either side of each switch are 8 and 6 nights.
// Every week's start date can be edited, and imported allocation documents can supply exact dates.
function seasonForDate(dateStr, s = settings()) {
  const m = Number(dateStr.slice(5, 7));
  if (s.summer_months.split(',').map(Number).includes(m)) return 'summer';
  if (s.shoulder_months.split(',').map(Number).includes(m)) return 'shoulder';
  return 'winter';
}
const iso = d => d.toISOString().slice(0, 10);
function yearStart(year, s = settings()) { const dow = Number(s.winter_changeover_day); const d = new Date(Date.UTC(year - 1, 11, 26)); while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1); return d; }
function weekStart(year, n, s = settings()) {
  const d = yearStart(year, s); d.setUTCDate(d.getUTCDate() + 7 * (n - 1));
  if (n >= Number(s.summer_changeover_from) && n <= Number(s.summer_changeover_to)) d.setUTCDate(d.getUTCDate() + ((Number(s.summer_changeover_day) - Number(s.winter_changeover_day) + 7) % 7));
  return d;
}
function recomputeEnds(year) {
  const ws = q('SELECT id, start_date FROM weeks WHERE year=? ORDER BY week_no', year);
  const next = q1('SELECT start_date FROM weeks WHERE year=? AND week_no=1', year + 1);
  ws.forEach((w, i) => run('UPDATE weeks SET end_date=? WHERE id=?', i + 1 < ws.length ? ws[i + 1].start_date : (next ? next.start_date : iso(yearStart(year + 1))), w.id));
  const prev = q1('SELECT id FROM weeks WHERE year=? ORDER BY week_no DESC LIMIT 1', year - 1);
  if (prev && ws.length) run('UPDATE weeks SET end_date=? WHERE id=?', ws[0].start_date, prev.id);
}
function generateYear(year) {
  const s = settings();
  if (q1('SELECT 1 FROM weeks WHERE year=?', year)) fail(400, `Weeks for ${year} already exist`);
  const end = yearStart(year + 1, s); let n = 1;
  tx(() => { for (let d = yearStart(year, s); d < end; d.setUTCDate(d.getUTCDate() + 7), n++) { const ds = iso(weekStart(year, n, s)); run("INSERT INTO weeks (year,week_no,start_date,season,status) VALUES (?,?,?,?, 'syndicate')", year, n, ds, seasonForDate(ds, s)); } recomputeEnds(year); });
  return n - 1;
}
function expireHolds() {
  const rows = q("SELECT * FROM bookings WHERE status='pending' AND method='bank' AND expires_at < datetime('now')");
  for (const b of rows) tx(() => {
    run("UPDATE bookings SET status='expired' WHERE id=?", b.id);
    run("UPDATE weeks SET status='offered' WHERE id=? AND status='pending'", b.week_id);
    const w = q1('SELECT * FROM weeks WHERE id=?', b.week_id);
    notify([b.user_id], `Your hold on ${weekLabel(w)} expired because payment wasn't confirmed in time. The week is available again.`, '#/bookings');
  });
}

// ---------------------------------------------------------------- auth
function currentUser(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
  const s = q1("SELECT * FROM sessions WHERE token=? AND expires_at > datetime('now')", m[1]); if (!s) return null;
  const u = q1('SELECT * FROM users WHERE id=? AND active=1', s.user_id); if (!u) return null;
  // not enumerable, so they never leak into API responses
  Object.defineProperty(u, 'sid', { value: s.token }); Object.defineProperty(u, 'viewer', { value: s.viewer_id || null });
  return u;
}
const isFamily = u => u.role === 'family_admin' || u.role === 'family_member';
// the household's contact: its first family admin with an email or phone (cached for the length of a request)
let contactMemo = new Map();
const reachOf = u => u && (u.email || u.phone) ? { name: u.name, email: u.email || null, phone: u.phone || null } : null;
function holderContact(fid) {
  if (!fid) return null;
  if (!contactMemo.has(fid)) contactMemo.set(fid, reachOf(q1("SELECT name, email, phone FROM users WHERE family_id=? AND role='family_admin' AND active=1 AND (email IS NOT NULL OR phone IS NOT NULL) ORDER BY id LIMIT 1", fid)));
  return contactMemo.get(fid);
}
const need = (u, cond, msg = 'Not allowed') => { if (!u) fail(401, 'Please log in'); if (!cond) fail(403, msg); };
const needAdmin = u => need(u, u && u.is_site_admin, 'Site admin only');
const canManageFamily = (u, fid) => u && (u.is_site_admin || (u.role === 'family_admin' && u.family_id === fid));
function publicUser(u) { const { password_hash, invite_token, ...rest } = u; return { ...rest, has_password: !!password_hash }; }
function sessionCookie(tok, maxAge) { return `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${BASE_URL.startsWith('https') ? '; Secure' : ''}`; }

// ---------------------------------------------------------------- week view model
function weekView(w, u, s) {
  const v = { ...w, family_name: w.family_id ? famName(w.family_id) : 'Syndicate', price: priceOf(w, s) };   // one price for members and trusted friends
  if (u.role !== 'friend') v.friends_from = friendsFrom(w, s);
  v.family_color = w.family_id ? q1('SELECT color FROM families WHERE id=?', w.family_id).color : '#9aa1a9';
  const mine = u.family_id === w.family_id && isFamily(u);
  const b = q1("SELECT * FROM bookings WHERE week_id=? AND status IN ('pending','confirmed') ORDER BY id DESC", w.id);
  if (b) {
    const seeGuest = u.is_site_admin || b.user_id === u.id || (isFamily(u) && (u.family_id === w.family_id || u.family_id === b.buyer_family_id));
    v.booking = { id: b.id, status: b.status, mine: b.user_id === u.id, guest: seeGuest ? (b.guest_name || q1('SELECT name FROM users WHERE id=?', b.user_id).name) : null, reference: seeGuest ? b.reference : null, expires_at: b.expires_at,
      ...(u.is_site_admin ? { amount: b.amount, method: b.method, seller: famName(b.seller_family_id), buyer: b.buyer_family_id ? famName(b.buyer_family_id) : null } : {}),
      ...(b.gift && (isFamily(u) || u.is_site_admin) ? { gift: true, given_to: famName(b.buyer_family_id), ours: isFamily(u) && u.family_id === b.buyer_family_id } : {}) };
  }
  // what this user can do
  const friendVisible = w.offer_friends && (['all', 'members_first'].includes(w.sale_to) || (w.sale_to === 'own' && u.family_id === w.family_id)) && (friendsFrom(w, s) || '9') <= today();
  v.first_refusal_until = w.offer_friends && w.status === 'offered' && w.enquiry_until && w.enquiry_until > nowSql() && q1("SELECT 1 FROM enquiries WHERE week_id=? AND status='open'", w.id) ? w.enquiry_until : null;
  v.can_book = w.status === 'offered' && !!w.offer_friends && !mine && w.start_date >= today() && !v.first_refusal_until && ((u.role === 'friend' && friendVisible) || isFamily(u));
  v.plan = planOf(w);
  if (isFamily(u) || u.is_site_admin) {
    const queue = openEnquiries(w.id), i = queue.findIndex(e => e.family_id === u.family_id);
    v.enquiries = queue.length;
    v.my_enquiry = i >= 0 ? { id: queue[i].id, position: i + 1, claim: queue[i].claim, created_at: queue[i].created_at } : null;
  }
  // enquire = join the queue for another family's week that isn't marked Using it, let or released
  v.can_enquire = isFamily(u) && !mine && w.family_id != null && !w.in_use && w.status === 'own_use' && w.start_date >= today() && !v.my_enquiry;
  if (isFamily(u) && !mine && w.family_id) {
    v.holder_contact = holderContact(w.family_id);
    v.can_ask = (w.end_date || w.start_date) >= today();
    v.my_questions = q('SELECT * FROM week_questions WHERE week_id=? AND family_id=? ORDER BY id', w.id, u.family_id).map(questionView);
  }
  v.can_manage = canManageFamily(u, w.family_id) && w.family_id != null;
  v.is_mine = mine;
  if (u.role === 'friend' && !friendVisible && w.status === 'offered') v.status = 'own_use'; // friends only see what's offered to them
  if (u.role === 'friend') {
    const fe = q1("SELECT id, created_at FROM friend_enquiries WHERE week_id=? AND user_id=? AND status='open'", w.id, u.id);
    v.my_friend_enquiry = fe || null; v.can_friend_enquire = !fe && undecidedWeek(w);
    v.in_use = 0; v.plan = null; v.enquiry_until = null;
  } else if (mine) v.friend_enquiries = q1("SELECT COUNT(*) n FROM friend_enquiries WHERE week_id=? AND status='open'", w.id).n;
  return v;
}
const today = () => new Date().toISOString().slice(0, 10);
const thisYear = () => new Date().getFullYear();
const sharesFor = (fid, year) => { const r = q1('SELECT units FROM family_shares WHERE family_id=? AND year=?', fid, year); return r ? r.units : (q1('SELECT share_units FROM families WHERE id=?', fid) || {}).share_units || 0; };
function setShares(fid, year, units) {
  run('INSERT INTO family_shares (family_id,year,units) VALUES (?,?,?) ON CONFLICT(family_id,year) DO UPDATE SET units=excluded.units', fid, year, units);
  if (year >= thisYear()) run('UPDATE families SET share_units=? WHERE id=?', units, fid);   // the newest decision becomes the default for later years
}
// A year's allocation is a draft until the site admin signs it off (this year and earlier always count as signed off).
const signedOff = year => year <= thisYear() || !!q1('SELECT 1 FROM year_status WHERE year=? AND signed_off_at IS NOT NULL', year);
const openYears = () => q('SELECT DISTINCT year FROM weeks ORDER BY year').map(r => r.year).filter(y => !signedOff(y));
const familyBalance = fid => round2(q1('SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE family_id=?', fid).n);
const creditAvailable = fid => Math.max(0, -familyBalance(fid));
// Each week's setting: undecided | using | released (others can book it; income → that family's account, less the letting cost)
const PLANS = ['undecided', 'using', 'released'];
const planOf = w => w.in_use ? 'using' : w.offer_friends ? 'released' : 'undecided';
// the short form of a week used in lists (Enquiries, questions)
const weekBrief = w => w && { id: w.id, year: w.year, week_no: w.week_no, start_date: w.start_date, end_date: w.end_date, season: w.season, comment: w.comment, school_holiday: w.school_holiday };

// ---------------------------------------------------------------- let income
const daysBetween = (fromIso, toDate) => (Date.parse(toDate + 'T00:00:00Z') - Date.parse(fromIso.replace(' ', 'T') + (fromIso.length > 10 ? 'Z' : 'T00:00:00Z'))) / 864e5;
// When trusted friends can book a released week. The family chooses when it releases (sale_to):
//   all / own      straight away (after any enquirers' first refusal); 'own' = only the family's own trusted friends
//   members_first  members_first_days later (but always from 3 weeks before arrival)
//   members        never
function friendsFrom(w, s = settings()) {
  if (!w.released_at || w.sale_to === 'members') return null;
  const from = w.enquiry_until && w.enquiry_until > w.released_at ? w.enquiry_until : w.released_at;   // after enquirers' first refusal
  const a = new Date(from.replace(' ', 'T') + 'Z'); if (w.sale_to === 'members_first') a.setUTCDate(a.getUTCDate() + Number(s.members_first_days || 0));
  const b = new Date(w.start_date + 'T00:00:00Z'); b.setUTCDate(b.getUTCDate() - 21);
  return (a < b ? a : b).toISOString().slice(0, 10);
}
// Let income: each paid let is credited to the family that released the week, less the letting cost, which goes to
// the maintenance fund. Credit sits on the family's account and carries forward against future charges.
function letIncome(year) {
  const g = q1(`SELECT COALESCE(SUM(b.amount),0) n, COUNT(*) c, COALESCE(SUM(COALESCE(b.letting_cost,0)),0) f FROM bookings b JOIN weeks w ON w.id=b.week_id WHERE b.status='confirmed' AND COALESCE(b.gift,0)=0 AND w.year=?`, year);
  return { gross: round2(g.n), lets: g.c, fund: round2(g.f), credited: round2(g.n - g.f) };
}
// the Lets page and each household's account: weeks held and released, lets and the income credited, per household
function letsSummary(year) {
  const weeks = q('SELECT * FROM weeks WHERE year=?', year), income = letIncome(year);
  const rows = q('SELECT * FROM families WHERE active=1 ORDER BY name').map(f => {
    const held = weeks.filter(w => w.family_id === f.id);
    const lets = q1(`SELECT COUNT(*) c, COALESCE(SUM(b.amount - COALESCE(b.letting_cost,0)),0) n FROM bookings b JOIN weeks w ON w.id=b.week_id
      WHERE b.status='confirmed' AND COALESCE(b.gift,0)=0 AND w.year=? AND b.seller_family_id=?`, year, f.id);
    return { id: f.id, name: f.name, color: f.color, shares: sharesFor(f.id, year), weeks: held.length, released_weeks: held.filter(w => w.offer_friends && w.released_at).length, lets: lets.c, let_income: round2(lets.n) };
  });
  return { year, rows, income };
}

// Reminders: weeks still "undecided" get a nudge to their family admins at each reminder point (default 16 and 8 weeks before).
function runReminders() {
  const s = settings(); const points = String(s.reminder_weeks || '').split(',').map(Number).filter(n => n > 0).sort((a, b) => b - a);
  if (!points.length) return;
  const due = {};
  for (const w of q("SELECT * FROM weeks WHERE family_id IS NOT NULL AND in_use=0 AND offer_friends=0 AND status='own_use' AND start_date > date('now') AND start_date <= date('now', ?)", `+${points[0] * 7} days`)) {
    const days = daysBetween(today(), w.start_date);
    let bits = w.reminded, hit = false;
    points.forEach((p, i) => { if (days <= p * 7 && !(bits & (1 << i))) { hit = true; bits |= 1 << i; } });
    if (!hit) continue;
    for (let i = 0; i < points.length; i++) if (days <= points[i] * 7) bits |= 1 << i;   // don't send older reminders late
    run('UPDATE weeks SET reminded=? WHERE id=?', bits, w.id);
    (due[w.family_id] ||= []).push(w);
  }
  const asked = w => { const n = openEnquiries(w.id).length; return n ? `, ${n} famil${n > 1 ? 'ies have' : 'y has'} enquired` : ''; };
  for (const [fid, ws] of Object.entries(due)) notify(familyAdmins(Number(fid)),
    `Still undecided: ${ws.map(w => `week ${w.week_no} (${fmtDate(w.start_date)}${asked(w)})`).join('; ')}. Please mark ${ws.length > 1 ? 'them' : 'it'} Using it or Released. If you release a week and it lets, the payment, less the ${s.currency}${s.letting_cost} letting cost, is credited to your account.`, '#/calendar');
}

// ---------------------------------------------------------------- enquiries & first refusal
const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const openEnquiries = weekId => q("SELECT * FROM enquiries WHERE week_id=? AND status='open' ORDER BY created_at, id", weekId);
const CLOSED_WHY = { using: 'they are using it', taken: 'it has been taken', given: 'it has been given to another family' };
// close the queue for a week; the winning family's enquiry (if any) is marked won
function closeEnquiries(w, reason, winnerFamily = null) {
  for (const e of openEnquiries(w.id)) {
    const won = winnerFamily != null && e.family_id === winnerFamily;
    run("UPDATE enquiries SET status=?, close_reason=?, closed_at=datetime('now') WHERE id=?", won ? 'won' : 'closed', won ? null : reason, e.id);
    if (!won) notify([e.user_id], `Your enquiry about ${weekLabel(w)} is closed: ${reason === 'using' ? `${famName(w.family_id)} are using it` : CLOSED_WHY[reason] || reason}.`, '#/enquiries');
  }
}
// trusted friends can enquire about a week only while its family hasn't decided (not Using it or Released)
const undecidedWeek = w => w.family_id != null && !w.in_use && !w.offer_friends && w.status === 'own_use' && w.start_date >= today();
const openFriendEnquiries = weekId => q("SELECT * FROM friend_enquiries WHERE week_id=? AND status='open' ORDER BY created_at, id", weekId);
// close friends' enquiries when the week stops being theirs to ask for. Friends aren't told which household holds a week.
function closeFriendEnquiries(w, reason, s = settings()) {
  for (const e of openFriendEnquiries(w.id)) {
    run("UPDATE friend_enquiries SET status='closed', close_reason=?, closed_at=datetime('now') WHERE id=?", reason, e.id);
    const from = reason === 'released' && w.sale_to !== 'members' ? friendsFrom(w, s) : null;
    notify([e.user_id], {
      using: `${weekLabel(w)} isn't available: the household is using it.`,
      taken: `${weekLabel(w)} has been booked by someone else, so your enquiry is closed.`,
      released: from ? (from <= today() ? `${weekLabel(w)} has been released: you can book it now on the Available weeks page.` : `${weekLabel(w)} has been released. Syndicate members get the first chance; if it's still free you can book it from ${fmtDate(from)} on the Available weeks page.`) : `${weekLabel(w)} has been released to syndicate members only, so your enquiry is closed.`,
    }[reason] || `Your enquiry about ${weekLabel(w)} is closed.`, '#/bookings');
  }
}
// a week with enquirers is released → they get first refusal for enquiry_hours, in the order they asked
function startFirstRefusal(w, s = settings()) {
  const queue = openEnquiries(w.id); if (!queue.length) return false;
  const hrs = Number(s.enquiry_hours || 48);
  run("UPDATE weeks SET enquiry_until=datetime('now', ?) WHERE id=?", `+${hrs} hours`, w.id);
  run("UPDATE enquiries SET claim=NULL, claim_method=NULL, claim_guest=NULL, claim_party=NULL, claimed_at=NULL WHERE week_id=? AND status='open'", w.id);
  queue.forEach((e, i) => notify([e.user_id, ...familyAdmins(e.family_id)],
    `${famName(w.family_id)} have released ${weekLabel(w)}, which your family enquired about. You're ${ordinal(i + 1)} of ${queue.length} in the queue and have first refusal for ${hrs} hours. Take it or pass on the Enquiries page.`, '#/enquiries'));
  return true;
}
// Settle first-refusal windows: the earliest enquirer who says yes gets the week, but an earlier enquirer who hasn't
// answered yet keeps priority until the window closes. If everyone passes (or time runs out), the week opens to all members.
function resolveFirstRefusal() {
  for (const w of q("SELECT * FROM weeks WHERE enquiry_until IS NOT NULL AND status='offered' AND offer_friends=1 AND EXISTS (SELECT 1 FROM enquiries e WHERE e.week_id=weeks.id AND e.status='open')")) {
    const queue = openEnquiries(w.id), expired = w.enquiry_until <= nowSql();
    let winner = null, waiting = false;
    for (const e of queue) { if (e.claim === 'yes') { winner = e; break; } if (e.claim === 'no') continue; if (!expired) { waiting = true; break; } }
    if (winner) {
      const u = q1('SELECT * FROM users WHERE id=?', winner.user_id);
      try {
        const price = priceOf(w), method = winner.claim_method === 'account' && creditAvailable(winner.family_id) + 0.005 < price ? 'bank' : winner.claim_method;
        const b = createBooking(u, w, { method, guest_name: winner.claim_guest, party_size: winner.claim_party }, price);
        notify([winner.user_id, ...familyAdmins(winner.family_id)].filter((x, i, a) => a.indexOf(x) === i), b.status === 'confirmed'
          ? `Your family has ${weekLabel(w)}: it's booked and charged to your family account.`
          : `Your family has ${weekLabel(w)}. Please pay ${settings().currency}${b.amount} by bank transfer within ${settings().hold_days} days, reference ${b.reference}.`, '#/bookings');
      } catch (err) { console.error('first refusal award failed', err.message); }
    } else if (!waiting) {
      run("UPDATE weeks SET enquiry_until=MIN(enquiry_until, datetime('now')) WHERE id=?", w.id);
      for (const e of queue) run("UPDATE enquiries SET status='closed', close_reason=?, closed_at=datetime('now') WHERE id=?", e.claim === 'no' ? 'passed' : 'no_reply', e.id);
      notify(familyAdmins(w.family_id), `Nobody who enquired took ${weekLabel(w)}, so it is now open to all members.`, '#/calendar');
    }
  }
}

// ---------------------------------------------------------------- ledger
function balances() {
  return q(`SELECT f.id, f.name, f.color, f.share_units, COALESCE(SUM(l.amount),0) balance FROM families f
            LEFT JOIN ledger l ON l.family_id=f.id WHERE f.active=1 GROUP BY f.id ORDER BY f.name`).map(r => ({ ...r, balance: round2(r.balance) }));
}
function confirmBooking(b, byUser) {
  const s = settings(); const w = q1('SELECT * FROM weeks WHERE id=?', b.week_id);
  const cost = round2(Math.min(b.amount, Number(s.letting_cost) || 0)), credit = round2(b.amount - cost);
  const buyer = q1('SELECT * FROM users WHERE id=?', b.user_id), guest = b.guest_name || buyer.name;
  run("UPDATE bookings SET status='confirmed', confirmed_at=datetime('now'), confirmed_by=?, letting_cost=? WHERE id=?", byUser.id, cost, b.id);
  if (credit > 0) run("INSERT INTO ledger (family_id,year,type,description,amount,booking_id,created_by) VALUES (?,?,'rental_credit',?,?,?,?)",
    b.seller_family_id, w.year, `Week ${w.week_no} ${w.year} let to ${guest}: ${s.currency}${b.amount} less ${s.currency}${cost} letting cost`, -credit, b.id, byUser.id);
  run("UPDATE weeks SET status='booked' WHERE id=?", w.id);
  if (b.method === 'account') run("INSERT INTO ledger (family_id,year,type,description,amount,booking_id,created_by) VALUES (?,?,?,?,?,?,?)",
    b.buyer_family_id, w.year, 'purchase', `Bought week ${w.week_no} ${w.year} from ${famName(b.seller_family_id)}`, b.amount, b.id, byUser.id);
  notify([b.user_id], `Confirmed: ${weekLabel(w)} is booked. Reference ${b.reference}.`, '#/bookings');
  notify(familyAdmins(b.seller_family_id), `${weekLabel(w)} has been let to ${guest}. ${s.currency}${credit} has been credited to your account (the ${s.currency}${b.amount} paid, less the ${s.currency}${cost} letting cost for the maintenance fund).`, '#/account');
}
// the year the portal opens on: the current calendar year (or, if its weeks aren't set up, the latest year that is)
const workingYear = () => q1('SELECT 1 FROM weeks WHERE year=?', thisYear()) ? thisYear() : (q1('SELECT MAX(year) y FROM weeks') || {}).y || thisYear();

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('POST', '/api/login', ({ body, res }) => {
  const u = q1('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1', String(body.email || '').trim());
  if (!u || !checkPw(String(body.password || ''), u.password_hash)) fail(401, 'Email or password is incorrect');
  const t = token(); run("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))", t, u.id);
  res.setHeader('Set-Cookie', sessionCookie(t, 2592000)); return { ok: true };
});
route('POST', '/api/logout', ({ req, res }) => {
  const m = /sid=([^;]+)/.exec(req.headers.cookie || ''); if (m) run('DELETE FROM sessions WHERE token=?', m[1]);
  res.setHeader('Set-Cookie', sessionCookie('', 0)); return { ok: true };
});
route('GET', '/api/invite/:tok', ({ params }) => {
  const u = q1('SELECT name,email FROM users WHERE invite_token=? AND active=1', params.tok); if (!u) fail(404, 'This invitation link is invalid or has already been used'); return u;
});
route('POST', '/api/invite/:tok', ({ params, body, res }) => {
  const u = q1('SELECT * FROM users WHERE invite_token=? AND active=1', params.tok); if (!u) fail(404, 'Invitation invalid');
  if (String(body.password || '').length < 8) fail(400, 'Password must be at least 8 characters');
  run('UPDATE users SET password_hash=?, invite_token=NULL WHERE id=?', hashPw(body.password), u.id);
  const t = token(); run("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))", t, u.id);
  res.setHeader('Set-Cookie', sessionCookie(t, 2592000)); return { ok: true };
});

route('GET', '/api/me', ({ user }) => {
  need(user, true); resolveFirstRefusal(); const s = settings();
  const unread = q1('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', user.id).n;
  const years = q('SELECT DISTINCT year FROM weeks ORDER BY year').map(r => r.year);
  const pub = { site_name: s.site_name, place_line: s.place_line, hero: s.hero_version || null, currency: s.currency, rate_summer: +s.rate_summer, rate_shoulder: +s.rate_shoulder, rate_winter: +s.rate_winter, rate_school: +s.rate_school, hold_days: +s.hold_days,
    members_first_days: +s.members_first_days, enquiry_hours: +s.enquiry_hours, letting_cost: +s.letting_cost,
    bank: { name: s.bank_name, account_name: s.bank_account_name, sort_code: s.bank_sort_code, account_no: s.bank_account_no, iban: s.bank_iban }, allow_member_account_charge: s.allow_member_account_charge === '1' };
  const fam = user.family_id ? q1('SELECT * FROM families WHERE id=?', user.family_id) : null;
  // the number on the Enquiries menu item: for family admins, enquiries and friends' enquiries waiting for an answer; for
  // everyone in the family, unanswered questions about its weeks and first refusals to take or pass
  const enquiryCount = !isFamily(user) ? 0 : (user.role === 'family_admin' ? q1(`SELECT COUNT(*) n FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE w.family_id=? AND e.status='open' AND e.reply IS NULL AND w.status='own_use' AND w.in_use=0`, user.family_id).n
      + q1("SELECT COUNT(*) n FROM friend_enquiries f JOIN weeks w ON w.id=f.week_id WHERE w.family_id=? AND f.status='open' AND w.in_use=0 AND w.status IN ('own_use','offered')", user.family_id).n : 0)
    + (isFamily(user) ? q1('SELECT COUNT(*) n FROM week_questions x JOIN weeks w ON w.id=x.week_id WHERE w.family_id=? AND x.reply IS NULL AND COALESCE(w.end_date, w.start_date) >= ?', user.family_id, today()).n : 0)
    + q1("SELECT COUNT(*) n FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE e.family_id=? AND e.status='open' AND e.claim IS NULL AND w.status='offered' AND w.enquiry_until > datetime('now')", user.family_id).n;
  const families = q('SELECT id,name,color FROM families WHERE active=1 ORDER BY name');
  const family = fam && isFamily(user) ? { ...fam, credit_available: creditAvailable(fam.id) } : fam;
  const admin = realAdmin(user);
  const view_as = admin && viewAsOn() ? q("SELECT id, name, role, family_id FROM users WHERE active=1 AND is_site_admin=0 ORDER BY family_id, CASE role WHEN 'family_admin' THEN 0 WHEN 'family_member' THEN 1 ELSE 2 END, name")
    .map(u => ({ id: u.id, name: u.name, role: u.role, family: famName(u.family_id) })) : null;
  return { user: publicUser(user), family, settings: pub, unread, years, open_years: openYears(), working_year: workingYear(), enquiryCount, families,
    viewing_as: user.viewer && admin ? { admin: admin.name } : null, view_as };
});
route('PUT', '/api/me', ({ user, body }) => {
  need(user, true);
  run('UPDATE users SET name=?, phone=?, email=? WHERE id=?', body.name || user.name, body.phone ?? user.phone, (body.email || user.email).trim(), user.id);
  if (body.new_password) {
    if (!checkPw(String(body.current_password || ''), user.password_hash)) fail(400, 'Current password is incorrect');
    if (body.new_password.length < 8) fail(400, 'New password must be at least 8 characters');
    run('UPDATE users SET password_hash=? WHERE id=?', hashPw(body.new_password), user.id);
  }
  return { ok: true };
});

// --- calendar
// --- home: what needs this person's attention, plus useful information, worked out per role
route('GET', '/api/home', ({ user }) => {
  need(user, true); expireHolds(); resolveFirstRefusal();
  const s = settings(), fid = user.family_id, fam = isFamily(user), admin = user.role === 'family_admin', now = nowSql(), t = today();
  const money = n => `${s.currency}${Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const W = id => q1('SELECT * FROM weeks WHERE id=?', id);
  const when = d => new Date(d.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const attention = [];   // { tone: urgent | action | info, title, detail, link, cta }
  // bookings this person still has to pay for
  for (const b of q("SELECT * FROM bookings WHERE user_id=? AND status='pending' AND method='bank' ORDER BY expires_at", user.id)) {
    const w = W(b.week_id);
    attention.push({ tone: 'urgent', title: `Pay ${money(b.amount)} for ${weekLabel(w)}`, detail: `Bank transfer to ${s.bank_account_name} by ${fmtDate(b.expires_at.slice(0, 10))}, reference ${b.reference}. If it doesn't arrive in time, the week is released again.`, link: '#/bookings', cta: 'Payment details' });
  }
  if (user.role === 'friend') for (const f of q("SELECT * FROM friend_enquiries WHERE user_id=? AND status='open' ORDER BY created_at", user.id)) {
    const w = W(f.week_id);
    attention.push({ tone: 'info', title: `Waiting to hear about ${weekLabel(w)}`, detail: `You enquired on ${fmtDate(f.created_at.slice(0, 10))}. The household that holds it will let you know.`, link: '#/bookings', cta: 'View' });
  }
  if (fam) {
    // first refusal on released weeks the family enquired about
    for (const e of q(`SELECT e.* FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE e.family_id=? AND e.status='open' AND w.status='offered' AND w.enquiry_until > ? ORDER BY w.enquiry_until`, fid, now)) {
      const w = W(e.week_id), pos = openEnquiries(w.id).findIndex(x => x.id === e.id) + 1;
      attention.push(e.claim === 'yes'
        ? { tone: 'info', title: `You've said yes to ${weekLabel(w)}`, detail: `Families who enquired before you have until ${when(w.enquiry_until)} to answer. If none of them take it, it's yours.`, link: '#/enquiries', cta: 'View' }
        : { tone: 'urgent', title: `You have first refusal on ${weekLabel(w)}`, detail: `${famName(w.family_id)} have released it. You're ${ordinal(pos)} in the queue. Take it at ${money(priceOf(w, s))} or pass before ${when(w.enquiry_until)}.`, link: '#/enquiries', cta: 'Take it or pass' });
    }
    if (admin) {
      for (const f of q(`SELECT f.*, u.name friend FROM friend_enquiries f JOIN weeks w ON w.id=f.week_id JOIN users u ON u.id=f.user_id WHERE w.family_id=? AND f.status='open' AND w.in_use=0 AND w.status IN ('own_use','offered') ORDER BY w.start_date`, fid)) attention.push({ tone: 'action',
        title: `${f.friend} (trusted friend) would like to book your ${weekLabel(W(f.week_id))}`, detail: `Let it to them at ${money(priceOf(W(f.week_id), s))}, or decline.${f.party_size ? ` Party of ${f.party_size}.` : ''}`, link: '#/enquiries', cta: 'Answer' });
      // enquiries waiting for an answer: not released, not in use, no "not sure yet" reply
      for (const r of q(`SELECT w.*, COUNT(e.id) n FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE w.family_id=? AND e.status='open' AND e.reply IS NULL AND w.status='own_use' AND w.in_use=0
          GROUP BY w.id ORDER BY w.start_date`, fid)) attention.push({ tone: 'action',
        title: `${r.n} famil${r.n > 1 ? 'ies have' : 'y has'} enquired about your ${weekLabel(r)}`, detail: 'Release it (they get first refusal), say you are using it, or reply not sure yet.', link: '#/enquiries', cta: 'Answer' });
      const horizon = Math.max(...String(s.reminder_weeks || '16').split(',').map(Number).filter(n => n > 0), 0) * 7;
      const undecided = q("SELECT * FROM weeks WHERE family_id=? AND in_use=0 AND offer_friends=0 AND status='own_use' AND start_date >= ? AND start_date <= date(?, ?) ORDER BY start_date", fid, t, t, `+${horizon} days`);
      if (undecided.length) attention.push({ tone: 'action', title: `${undecided.length} of your weeks in the next ${horizon / 7} weeks ${undecided.length > 1 ? 'are' : 'is'} still undecided`,
        detail: `${undecided.slice(0, 5).map(w => `week ${w.week_no} (${fmtDate(w.start_date)})`).join(', ')}${undecided.length > 5 ? '…' : ''}. If you release a week and it lets, the payment, less the ${s.currency}${s.letting_cost} letting cost, is credited to your account.`, link: '#/calendar', cta: 'See your weeks' });
      const bal = round2(q1('SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE family_id=?', fid).n);
      if (bal > 0.005) attention.push({ tone: 'action', title: `Balance to pay: ${money(bal)}`, detail: `Pay ${s.bank_account_name} using reference ${famName(fid).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}-SC.`, link: '#/account', cta: 'View account' });
      for (const o of q("SELECT * FROM share_offers WHERE status='open' AND family_id<>? AND closes_on>=? AND id NOT IN (SELECT offer_id FROM share_interests WHERE family_id=? AND status='open')", fid, t, fid))
        attention.push({ tone: 'info', title: `The ${famName(o.family_id)} family is offering ${o.shares} share${o.shares > 1 ? 's' : ''} for sale`, detail: `${o.price != null ? `${s.currency}${Number(o.price).toLocaleString('en-GB')} a share, ` : ''}from ${o.from_year}. Register interest by ${fmtDate(o.closes_on)} if your family would like some.`, link: '#/shares', cta: 'Shares' });
      const gr = q1("SELECT COUNT(DISTINCT guide_id) g, COUNT(*) n FROM guide_reports WHERE status='open'");
      if (gr.n) attention.push({ tone: 'info', title: `${gr.n} inaccurac${gr.n > 1 ? 'ies' : 'y'} reported in the house guide`, detail: `In ${gr.g} guide${gr.g > 1 ? 's' : ''}. Any family admin can correct the guide, then mark the report as sorted.`, link: '#/guide', cta: 'House guide' });
      const invited = q("SELECT name FROM users WHERE family_id=? AND active=1 AND email IS NOT NULL AND password_hash IS NULL", fid).map(r => r.name);
      if (invited.length) attention.push({ tone: 'info', title: `${invited.length} ${invited.length > 1 ? 'people haven’t' : 'person hasn’t'} set up their login yet`, detail: `${invited.join(', ')}. You can send a fresh invitation link from Family & friends.`, link: '#/people', cta: 'Family & friends' });
    }
  }
  // what's coming up for this person or family
  const upcoming = [];
  if (fam) for (const w of q("SELECT * FROM weeks WHERE family_id=? AND start_date >= ? ORDER BY start_date LIMIT 5", fid, t)) {
    const b = q1("SELECT * FROM bookings WHERE week_id=? AND status IN ('pending','confirmed')", w.id);
    upcoming.push({ start: w.start_date, title: weekLabel(w), detail: b ? (b.gift ? `Given to ${famName(b.buyer_family_id)}, free` : `Let to ${b.guest_name || q1('SELECT name FROM users WHERE id=?', b.user_id).name}`) : planOf(w) === 'using' ? 'Your family is using it' : planOf(w) === 'released' ? 'Released' : 'Undecided', week_id: w.id, year: w.year, plan: b ? 'let' : planOf(w) });
  }
  const trips = q(`SELECT b.*, w.start_date, w.week_no, w.year, w.end_date FROM bookings b JOIN weeks w ON w.id=b.week_id
    WHERE (b.user_id=? OR (? AND b.buyer_family_id=?)) AND b.status IN ('pending','confirmed') AND w.start_date >= ? ORDER BY w.start_date LIMIT 5`,
    user.id, fam ? 1 : 0, fid ?? 0, t).map(b => ({ start: b.start_date, title: weekLabel(b), detail: b.gift ? `Given to your family free by ${famName(b.seller_family_id)}` : `${b.status === 'confirmed' ? 'Booked' : 'Reserved, awaiting payment'} · ${b.guest_name || ''} · from ${famName(b.seller_family_id)}`, week_id: b.week_id, year: b.year, plan: b.status === 'confirmed' ? 'booked' : 'reserved' }));
  // weeks this person can book now
  const available = q("SELECT * FROM weeks WHERE status='offered' AND offer_friends=1 AND start_date >= ? ORDER BY start_date LIMIT 40", t).map(w => weekView(w, user, s)).filter(v => v.can_book).slice(0, 6)
    .map(v => ({ week_id: v.id, year: v.year, title: weekLabel(v), price: v.price, band: bandOf(v), family: user.role === 'friend' ? null : v.family_name }));
  const myEnquiries = fam ? q("SELECT * FROM enquiries WHERE family_id=? AND status='open' ORDER BY created_at", fid).map(e => { const w = W(e.week_id), qn = openEnquiries(w.id);
    return { title: weekLabel(w), holder: famName(w.family_id), position: qn.findIndex(x => x.id === e.id) + 1, queue: qn.length, plan: planOf(w), week_id: w.id, year: w.year }; }) : [];
  // family snapshot: weeks released and let income for the working year
  let family = null;
  if (fam) {
    const year = workingYear(), r = letsSummary(year).rows.find(x => x.id === fid);
    family = { name: famName(fid), year, lets: r && { released: r.released_weeks, lets: r.lets, let_income: r.let_income },
      balance: admin ? round2(q1('SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE family_id=?', fid).n) : null };
  }
  // site admin: syndicate-wide jobs and system health
  const syndicate = [];
  if (user.is_site_admin) {
    const pend = q("SELECT * FROM bookings WHERE status='pending' AND method='bank'");
    if (pend.length) syndicate.push({ tone: 'action', title: `${pend.length} payment${pend.length > 1 ? 's' : ''} to confirm (${money(pend.reduce((a, b) => a + b.amount, 0))})`, detail: 'Check the bank statement for each reference, then mark it paid.', link: '#/admin/overview', cta: 'Payments' });
    const owing = balances().filter(b => b.balance > 0.005);
    const tops = q("SELECT * FROM topups WHERE status='pending'");
    if (tops.length) syndicate.push({ tone: 'action', title: `${tops.length} top-up${tops.length > 1 ? 's' : ''} expected (${money(tops.reduce((a, t) => a + t.amount, 0))})`, detail: 'Check the bank statement for each reference, then confirm the top-up on the Payments page.', link: '#/admin/overview', cta: 'Payments' });
    for (const y of openYears()) syndicate.push({ tone: 'info', title: `The ${y} allocation is still a draft`, detail: 'Make any agreed changes on the Weeks page, then sign it off.', link: '#/admin/weeks', cta: 'Weeks' });
    if (owing.length) syndicate.push({ tone: 'info', title: `${owing.length} famil${owing.length > 1 ? 'ies owe' : 'y owes'} ${money(owing.reduce((a, b) => a + b.balance, 0))} in total`, detail: owing.map(b => `${b.name} ${money(b.balance)}`).join(' · '), link: '#/admin/overview', cta: 'Balances' });
    const noAdmin = q("SELECT name FROM families f WHERE active=1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.family_id=f.id AND u.role='family_admin' AND u.active=1)").map(r => r.name);
    if (noAdmin.length) syndicate.push({ tone: 'urgent', title: `${noAdmin.join(', ')} ${noAdmin.length > 1 ? 'have' : 'has'} no family admin`, detail: 'Nobody can manage their weeks or answer enquiries.', link: '#/admin/users', cta: 'All users' });
    for (const { year } of q('SELECT DISTINCT year FROM budget_items ORDER BY year')) { const b = budgetSummary(year); if (b.total && !b.generated) syndicate.push({ tone: 'action', title: `${b.label || year} service charges not issued yet`, detail: `Budget ${money(b.total)} at ${money(b.rate)} a share.`, link: '#/admin/overview', cta: 'Payments' }); }
    const issues = q("SELECT urgency FROM maintenance_issues WHERE status IN ('open','in_hand')"), urgent = issues.filter(i => i.urgency === 'urgent').length;
    if (issues.length) syndicate.push({ tone: urgent ? 'urgent' : 'action', title: `${issues.length} maintenance issue${issues.length > 1 ? 's' : ''} open${urgent ? `, ${urgent} urgent` : ''}`, detail: 'Reported by families and friends. Mark each one In hand, then Fixed, with a note for whoever reported it.', link: '#/maintenance', cta: 'Maintenance' });
    const mc = q1("SELECT COUNT(*) n FROM document_comments WHERE parent_id IS NULL AND status='open'").n;
    if (mc) syndicate.push({ tone: 'info', title: `${mc} comment${mc > 1 ? 's and suggestions' : ' or suggestion'} open on the Manifesto`, detail: 'Reply, accept or decline suggestions, and mark comments as resolved.', link: '#/manifesto', cta: 'Manifesto' });
    const grs = q1("SELECT COUNT(*) n FROM guide_reports WHERE status='open'").n;
    if (grs) syndicate.push({ tone: 'info', title: `${grs} inaccurac${grs > 1 ? 'ies' : 'y'} reported in the house guide`, detail: 'Correct the guide (or ask a family admin to), then mark each report as sorted.', link: '#/guide', cta: 'House guide' });
    const offers = q("SELECT * FROM share_offers WHERE status='open'"), due = offers.filter(o => o.closes_on < today());
    if (due.length) syndicate.push({ tone: 'action', title: `${due.length} share offer${due.length > 1 ? 's have' : ' has'} closed for interest`, detail: due.map(o => `${famName(o.family_id)}: ${o.shares} share${o.shares > 1 ? 's' : ''}`).join(' · ') + '. Record the sale once it’s complete, or close the offer.', link: '#/shares', cta: 'Shares' });
    else if (offers.length) syndicate.push({ tone: 'info', title: `${offers.length} share offer${offers.length > 1 ? 's' : ''} open`, detail: offers.map(o => `${famName(o.family_id)}: ${o.shares} share${o.shares > 1 ? 's' : ''}, until ${fmtDate(o.closes_on)}`).join(' · '), link: '#/shares', cta: 'Shares' });
    const waiting = q("SELECT amount FROM costs WHERE status='waiting'"), known = waiting.filter(c => c.amount != null);
    if (waiting.length) syndicate.push({ tone: 'action', title: `${waiting.length} cost${waiting.length > 1 ? 's' : ''} waiting to be adopted${known.length ? ` (${money(known.reduce((a, c) => a + c.amount, 0))})` : ''}`, detail: 'Upgrades the families suggested and maintenance quotes. Adopt them now from the bank balance, put them forward for a year’s service charge, or leave them waiting.', link: '#/admin/service-charge', cta: 'Service charge' });
    const ny = new Date().getFullYear() + 1; if (!q1('SELECT 1 FROM weeks WHERE year=?', ny)) syndicate.push({ tone: 'action', title: `No weeks set up for ${ny} yet`, detail: 'Create the year and import its allocation.', link: '#/admin/weeks', cta: 'Weeks & allocation' });
    const demo = q1("SELECT COUNT(*) n FROM users WHERE active=1 AND email LIKE '%@example.com'").n;
    if (demo) syndicate.push({ tone: 'urgent', title: `${demo} demo logins are still active`, detail: 'Anyone who knows the demo password can log in. Add the real family admins, then remove the demo users, before families start using the site.', link: '#/admin/users', cta: 'All users' });
    if (ON_RAILWAY && !VOLUME) syndicate.push({ tone: 'urgent', title: 'No storage volume attached: data is lost on every update', detail: 'In Railway, add a volume to this service (mount path /data). The site will then keep its database there automatically.', link: '#/home', cta: '' });
    else if (VOLUME && !DB_FILE.startsWith(VOLUME)) syndicate.push({ tone: 'urgent', title: 'The database isn’t on the storage volume: data is lost on every update', detail: `It’s at ${DB_FILE}, but the volume is mounted at ${VOLUME}. In Railway, change the DB_FILE variable to ${path.join(VOLUME, 'camas.db')} (or delete it).`, link: '#/home', cta: '' });
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) syndicate.push({ tone: 'info', title: 'Emails aren’t being sent', detail: 'Reminders, invitations and notifications only appear in the bell. Set RESEND_API_KEY and EMAIL_FROM on the server to send them by email.', link: '#/home', cta: '' });
  }
  const notes = q('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 6', user.id);
  // who to contact about a stay: the holding family's admin, or the guest who booked it (only for the holding family and
  // the site admin). Trusted friends never see contact details.
  const reach = reachOf, familyContact = holderContact;
  // a week's family can say whether they're at the house: shown on the In residence card for everyone (not to trusted friends)
  const resNote = w => w.residence && `${w.residence === 'in' ? 'Checked in' : 'Not in residence'} · ${fmtDate(w.residence_at.slice(0, 10))}${w.residence_by ? `, ${nameOf(w.residence_by)}` : ''}`;
  const stay = w => {
    const r = stayCard(w); if (!r || user.role === 'friend' || !w.residence) return r;
    return { ...r, residence: w.residence, status: w.residence === 'in' ? 'In residence' : 'Not in residence', detail: [r.detail, resNote(w)].filter(Boolean).join(' · ') };
  };
  const stayCard = w => {
    if (!w) return null;
    const b = q1("SELECT * FROM bookings WHERE week_id=? AND status IN ('pending','confirmed')", w.id), p = planOf(w), friend = user.role === 'friend';
    const base = { week_no: w.week_no, year: w.year, start: w.start_date, end: w.end_date, week_id: w.id, mine: fam && w.family_id === fid,
      can_check_in: fam && w.start_date <= t && w.end_date > t && (b ? !!b.gift && b.buyer_family_id === fid : w.family_id === fid), released: !b && !w.in_use && !!w.offer_friends };
    if (friend) return { ...base, household: b && b.user_id === user.id ? 'Your stay' : null,
      status: b && b.user_id === user.id ? 'Your stay' : b || p !== 'released' ? 'Occupied' : 'Available' };
    if (b && b.gift) return { ...base, household: famName(b.buyer_family_id), detail: `Given by ${famName(w.family_id)}`, status: 'Using it', mine: fam && b.buyer_family_id === fid,
      contact: fam && b.buyer_family_id === fid ? null : familyContact(b.buyer_family_id) };
    if (b) return { ...base, household: b.guest_name || q1('SELECT name FROM users WHERE id=?', b.user_id).name, detail: `Guests, via ${famName(w.family_id)}`, status: b.status === 'confirmed' ? 'Booked' : 'Reserved',
      contact: user.is_site_admin || base.mine ? reach(q1('SELECT name, email, phone FROM users WHERE id=?', b.user_id)) : familyContact(w.family_id) };
    if (!w.family_id) return { ...base, household: 'Syndicate week', detail: '', status: 'Syndicate' };
    return { ...base, household: famName(w.family_id), detail: '', contact: base.mine ? null : familyContact(w.family_id), status: { using: 'Using it', undecided: 'Undecided', released: 'Released' }[p] };
  };
  const residence = { now: stay(q1('SELECT * FROM weeks WHERE start_date <= ? AND end_date > ? ORDER BY start_date DESC LIMIT 1', t, t)),
    next: q('SELECT * FROM weeks WHERE start_date > ? ORDER BY start_date LIMIT 3', t).map(stay) };
  const since = q1('SELECT MIN(created_at) d FROM users').d;
  if (user.role === 'site_admin') {
    const year = workingYear(), c = letsSummary(year);
    const activity = q('SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 8');
    const counts = { families: q1('SELECT COUNT(*) n FROM families WHERE active=1').n, logins: q1('SELECT COUNT(*) n FROM users WHERE active=1').n,
      released: q1("SELECT COUNT(*) n FROM weeks WHERE year=? AND offer_friends=1", year).n, enquiries: q1("SELECT COUNT(*) n FROM enquiries WHERE status='open'").n };
    return { admin_home: true, residence, attention: syndicate, balances: balances(), lets: { year, rows: c.rows, income: c.income }, activity, counts, notifications: notes,
      system: { database: DB_FILE, volume: VOLUME || null, on_railway: ON_RAILWAY, data_since: since, email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) } };
  }
  return { residence, attention, upcoming: [...trips, ...upcoming].sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6), available, enquiries: myEnquiries, family, syndicate, notifications: notes,
    system: user.is_site_admin ? { database: DB_FILE, volume: VOLUME || null, on_railway: ON_RAILWAY, data_since: since, email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) } : null };
});
route('GET', '/api/weeks', ({ user, query }) => {
  need(user, true); expireHolds(); const s = settings();
  const year = Number(query.year) || new Date().getFullYear(); resolveFirstRefusal();
  const draft = !signedOff(year);   // not yet signed off by the site admin
  return q('SELECT * FROM weeks WHERE year=? ORDER BY week_no', year).map(w => ({ ...weekView(w, user, s), year_open: draft }));
});
route('PUT', '/api/weeks/:id', ({ user, params, body }) => {
  const w = q1('SELECT * FROM weeks WHERE id=?', params.id) || fail(404, 'Week not found');
  need(user, canManageFamily(user, w.family_id), 'Only this week’s family admin can change it');
  if (['pending', 'booked'].includes(w.status)) fail(400, 'This week has a booking. Cancel the booking first.');
  let plan = body.plan !== undefined ? body.plan : planOf(w);
  if (!PLANS.includes(plan)) fail(400, 'Unknown setting');
  const using = plan === 'using', sell = plan === 'released';
  const price = body.price_override === undefined ? w.price_override : body.price_override === '' || body.price_override == null ? null : Number(body.price_override);
  if (price != null && (isNaN(price) || price < 0)) fail(400, 'Price must be a positive number');
  const saleTo = ['members', 'members_first', 'all', 'own'].includes(body.sale_to) ? body.sale_to : w.sale_to;
  tx(() => {
    run(`UPDATE weeks SET status=?, offer_friends=?, in_use=?, sale_to=?, price_override=?, note=?,
      released_at=${sell ? (w.offer_friends ? 'released_at' : "datetime('now')") : 'NULL'} WHERE id=?`,
      sell ? 'offered' : 'own_use', sell ? 1 : 0, using ? 1 : 0, saleTo, price, body.note !== undefined ? body.note || null : w.note, w.id);
    const now = q1('SELECT * FROM weeks WHERE id=?', w.id);
    if (sell && !w.offer_friends) {
      const s = settings(), enquirers = startFirstRefusal(now, s), rel = q1('SELECT * FROM weeks WHERE id=?', w.id);
      const skip = new Set(openEnquiries(w.id).map(e => e.family_id));
      notify(q("SELECT id, family_id FROM users WHERE active=1 AND role IN ('family_admin','family_member') AND family_id<>?", w.family_id).filter(r => !skip.has(r.family_id)).map(r => r.id),
        `${famName(w.family_id)} have released ${weekLabel(rel)}. Members can book it at ${s.currency}${priceOf(rel, s)}${enquirers ? ` once the families who enquired have had first refusal (until ${fmtDate(rel.enquiry_until.slice(0, 10))})` : ''}${friendsFrom(rel, s) > today() ? `, before it opens to trusted friends on ${fmtDate(friendsFrom(rel, s))}` : ''}.`, '#/calendar');
    }
    if (!sell && w.offer_friends) {   // un-released: any first-refusal window stops, the queue stays
      run('UPDATE weeks SET enquiry_until=NULL WHERE id=?', w.id);
      run("UPDATE enquiries SET claim=NULL, claim_method=NULL, claim_guest=NULL, claim_party=NULL, claimed_at=NULL WHERE week_id=? AND status='open'", w.id);
    }
    if (using && !w.in_use) { closeEnquiries(now, 'using'); closeFriendEnquiries(now, 'using'); }
    if (sell && !w.offer_friends) closeFriendEnquiries(q1('SELECT * FROM weeks WHERE id=?', w.id), 'released');
  });
  audit(user.id, 'week.update', { week: w.id, ...body });
  return { ok: true };
});

// --- bookings
function createBooking(user, w, body, price) {
  const s = settings();
  const method = body.method === 'account' ? 'account' : 'bank';
  if (method === 'account' && !(isFamily(user) && (user.role === 'family_admin' || s.allow_member_account_charge === '1'))) fail(403, 'Paying from the family account is not allowed for your login');
  if (method === 'account' && creditAvailable(user.family_id) + 0.005 < price) fail(400, `Your household has ${s.currency}${creditAvailable(user.family_id).toFixed(2).replace(/\.00$/, '')} in credit, which doesn’t cover ${s.currency}${price}. Top up your balance from the Account page, or pay by bank transfer.`);
  const ref = `NC${String(w.year).slice(2)}W${String(w.week_no).padStart(2, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const id = tx(() => {
    const r = run("UPDATE weeks SET status='pending', enquiry_until=CASE WHEN enquiry_until > datetime('now') THEN datetime('now') ELSE enquiry_until END WHERE id=? AND status='offered'", w.id);
    if (!r.changes) fail(409, 'Sorry — someone else has just booked this week');
    const ins = run("INSERT INTO bookings (week_id,user_id,seller_family_id,buyer_family_id,amount,method,status,reference,guest_name,party_size,notes,expires_at) VALUES (?,?,?,?,?,?,'pending',?,?,?,?,datetime('now', ?))",
      w.id, user.id, w.family_id, isFamily(user) ? user.family_id : null, price, method, ref, body.guest_name || null, Number(body.party_size) || null, body.notes || null, `+${Number(s.hold_days) || 3} days`);
    closeEnquiries(w, 'taken', isFamily(user) ? user.family_id : null);
    closeFriendEnquiries(w, 'taken');
    return Number(ins.lastInsertRowid);
  });
  const b = q1('SELECT * FROM bookings WHERE id=?', id);
  if (method === 'account') {
    tx(() => confirmBooking(b, user));
    notify(familyAdmins(user.family_id).filter(i => i !== user.id), `${user.name} bought ${weekLabel(w)} from ${famName(w.family_id)} for ${s.currency}${price}, charged to your family account.`, '#/account');
  } else {
    notify(familyAdmins(w.family_id), `${user.name} has reserved ${weekLabel(w)} and is paying ${s.currency}${price} by bank transfer (ref ${ref}).`, '#/calendar');
    notify(siteAdmins(), `Payment expected: ${s.currency}${price} from ${user.name} for ${weekLabel(w)}, reference ${ref}.`, '#/admin/payments');
  }
  audit(user.id, 'booking.create', { booking: id, method });
  return q1('SELECT * FROM bookings WHERE id=?', id);
}
route('POST', '/api/weeks/:id/book', ({ user, params, body }) => {
  need(user, true); expireHolds(); resolveFirstRefusal(); const s = settings();
  const w = q1('SELECT * FROM weeks WHERE id=?', params.id) || fail(404, 'Week not found');
  const v = weekView(w, user, s);
  if (!v.can_book) fail(400, v.first_refusal_until ? `The families who enquired have first refusal on this week until ${fmtDate(v.first_refusal_until.slice(0, 10))}` : 'This week is not available for you to book');
  return createBooking(user, w, body, v.price);
});
route('GET', '/api/bookings', ({ user, query }) => {
  need(user, true); expireHolds();
  const all = query.all && user.is_site_admin;
  const rows = all ? q('SELECT * FROM bookings ORDER BY id DESC') :
    isFamily(user) ? q('SELECT * FROM bookings WHERE user_id=? OR seller_family_id=? OR buyer_family_id=? ORDER BY id DESC', user.id, user.family_id, user.family_id)
      : q('SELECT * FROM bookings WHERE user_id=? ORDER BY id DESC', user.id);
  return rows.map(b => { const w = q1('SELECT * FROM weeks WHERE id=?', b.week_id); const bu = q1('SELECT name,email,phone FROM users WHERE id=?', b.user_id);
    return { ...b, week: { year: w.year, week_no: w.week_no, start_date: w.start_date, season: w.season }, seller: famName(b.seller_family_id), buyer: b.buyer_family_id ? famName(b.buyer_family_id) : null, booker: bu.name, booker_contact: (user.is_site_admin || canManageFamily(user, b.seller_family_id)) ? bu : null, mine: b.user_id === user.id }; });
});
route('POST', '/api/bookings/:id/cancel', ({ user, params, body }) => {
  need(user, true); const b = q1('SELECT * FROM bookings WHERE id=?', params.id) || fail(404, 'Not found');
  const w = q1('SELECT * FROM weeks WHERE id=?', b.week_id);
  if (b.gift) need(user, b.status === 'confirmed' && user.is_site_admin, 'Only the site admin can cancel this');
  else if (b.status === 'pending') need(user, b.user_id === user.id || user.is_site_admin || canManageFamily(user, b.seller_family_id));
  else if (b.status === 'confirmed') need(user, user.is_site_admin, 'Only the site admin can cancel a confirmed (paid) booking — contact them to arrange a refund');
  else fail(400, 'Booking already closed');
  tx(() => {
    if (b.status === 'confirmed') {
      for (const l of q('SELECT * FROM ledger WHERE booking_id=?', b.id))
        run("INSERT INTO ledger (family_id,year,type,description,amount,booking_id,created_by) VALUES (?,?,'adjustment',?,?,?,?)", l.family_id, l.year, 'Reversal: ' + l.description, -l.amount, b.id, user.id);
    }
    run("UPDATE bookings SET status='cancelled' WHERE id=?", b.id);
    // a week given free goes back to its family as Undecided; a let week goes back on offer
    run(b.gift ? "UPDATE weeks SET status='own_use', offer_friends=0, in_use=0 WHERE id=?" : "UPDATE weeks SET status='offered' WHERE id=?", w.id);
  });
  const reason = String((body && body.reason) || '').trim().slice(0, 500), s = settings();
  const why = reason ? ` Reason: ${reason}${/[.!?]$/.test(reason) ? '' : '.'}` : '';
  if (b.gift) {
    const msg = `${famName(b.seller_family_id)}’s free use of ${weekLabel(w)} given to ${famName(b.buyer_family_id)} was cancelled by ${user.name}.${why}`;
    notify([...new Set([b.user_id, ...familyAdmins(b.buyer_family_id)])].filter(i => i !== user.id), msg, '#/calendar');
    notify(familyAdmins(b.seller_family_id).filter(i => i !== user.id), msg + ' The week is back with your family as Undecided.', '#/calendar');
  } else {
    const refundNote = b.status !== 'confirmed' ? '' : b.method === 'account' ? ` The ${s.currency}${b.amount} has gone back on ${famName(b.buyer_family_id)}’s account.` : ' Any refund is arranged with the site admin.';
    const msg = `Booking ${b.reference} for ${weekLabel(w)} was cancelled by ${user.name}.${why}`;
    notify([b.user_id].filter(i => i !== user.id), msg + refundNote, '#/bookings');
    notify(familyAdmins(b.seller_family_id).filter(i => i !== user.id && i !== b.user_id), msg + (b.status === 'confirmed' ? ' The let income credited for it has been reversed and the week is available again.' : ' The week is available again.'), '#/calendar');
  }
  audit(user.id, 'booking.cancel', { booking: b.id, was: b.status, reason: reason || undefined }); return { ok: true };
});
route('POST', '/api/admin/bookings/:id/confirm', ({ user, params }) => {
  needAdmin(user); const b = q1("SELECT * FROM bookings WHERE id=? AND status='pending'", params.id) || fail(404, 'No pending booking');
  tx(() => confirmBooking(b, user)); audit(user.id, 'booking.confirm', { booking: b.id }); return { ok: true };
});

// --- enquiries
// 1. A family member enquires about another family's week (not Using it, not let). Their family joins the queue for it.
// 2. The holder can give it to them free, release it (enquirers get first refusal for enquiry_hours, first come first
//    served, then whoever the family chose under "who can book"), say they're using it (the queue closes), or reply not
//    sure yet (the enquirer is told and keeps their place).
const isAdminOf = (u, fid) => u && u.role === 'family_admin' && u.family_id === fid;
route('POST', '/api/enquiries', ({ user, body }) => {
  need(user, isFamily(user), 'Only family members can enquire about weeks');
  resolveFirstRefusal();
  const w = q1('SELECT * FROM weeks WHERE id=?', body.week_id) || fail(404, 'Week not found');
  if (w.family_id === user.family_id) fail(400, 'That week is already your family’s');
  if (w.family_id == null || w.start_date < today()) fail(400, 'You can’t enquire about that week');
  if (w.in_use) fail(400, `${famName(w.family_id)} are using this week`);
  if (['pending', 'booked'].includes(w.status)) fail(400, 'That week has already been taken');
  if (w.status === 'offered') fail(400, 'This week has been released, so you can book it straight away');
  if (q1("SELECT 1 FROM enquiries WHERE week_id=? AND family_id=? AND status='open'", w.id, user.family_id)) fail(400, 'Your family has already enquired about this week');
  const id = run('INSERT INTO enquiries (week_id,family_id,user_id,message) VALUES (?,?,?,?)', w.id, user.family_id, user.id, body.message || null).lastInsertRowid;
  const queue = openEnquiries(w.id), pos = queue.findIndex(x => x.id === id) + 1;
  notify(familyAdmins(w.family_id), `${user.name} (${famName(user.family_id)}) enquired about your ${weekLabel(w)}. On the Enquiries page you can give it to them free, release it (the families who asked get first refusal, first come first served) or say you’re using it.${queue.length > 1 ? ` ${queue.length} families have now asked.` : ''}`, '#/enquiries');
  audit(user.id, 'enquiry.create', { id }); return { id, position: pos, queue: queue.length };
});
// the holder isn't sure yet: the requesting family is told and keeps its place in the queue
route('POST', '/api/enquiries/:id/reply', ({ user, params }) => {
  const e = q1("SELECT * FROM enquiries WHERE id=? AND status='open'", params.id) || fail(404, 'This request is closed');
  const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id);
  need(user, isAdminOf(user, w.family_id), 'Only your family admin can answer requests');
  run("UPDATE enquiries SET reply='unsure', replied_at=datetime('now') WHERE id=?", e.id);
  notify([e.user_id], `${famName(w.family_id)} aren’t sure about their ${weekLabel(w)} yet. Your family stays in the queue: if they release it, you get first refusal.`, '#/enquiries');
  audit(user.id, 'enquiry.reply', { id: e.id }); return { ok: true };
});
// the holder lets the family who enquired use the week free of charge. It isn't a let, so there's no letting cost and
// nothing on either account; it's recorded as a £0 booking so the calendar shows who is there.
route('POST', '/api/enquiries/:id/give', ({ user, params }) => {
  const e = q1("SELECT * FROM enquiries WHERE id=? AND status='open'", params.id) || fail(404, 'This enquiry is closed');
  const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id);
  need(user, isAdminOf(user, w.family_id), 'Only your family admin can give a week to another family');
  if (w.in_use || ['pending', 'booked'].includes(w.status) || w.start_date < today()) fail(400, 'This week can no longer be given');
  const ref = `NC${String(w.year).slice(2)}W${String(w.week_no).padStart(2, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const id = tx(() => {
    const ins = run(`INSERT INTO bookings (week_id,user_id,seller_family_id,buyer_family_id,amount,method,status,reference,notes,confirmed_at,confirmed_by,letting_cost,gift)
      VALUES (?,?,?,?,0,'account','confirmed',?,?,datetime('now'),?,0,1)`, w.id, e.user_id, w.family_id, e.family_id, ref, `Given free by ${user.name} after an enquiry`, user.id);
    run("UPDATE weeks SET status='booked', offer_friends=0, in_use=0, enquiry_until=NULL WHERE id=?", w.id);
    closeEnquiries(w, 'given', e.family_id);
    closeFriendEnquiries(w, 'taken');
    return Number(ins.lastInsertRowid);
  });
  notify([...new Set([e.user_id, ...familyAdmins(e.family_id)])].filter(i => i !== user.id), `Good news: ${famName(w.family_id)} have given your family ${weekLabel(w)}, free of charge. It’s yours to use.`, '#/calendar');
  audit(user.id, 'enquiry.give', { id: e.id, booking: id, to: e.family_id }); return { ok: true, booking: id };
});
// --- booking enquiries from trusted friends (weeks still Undecided)
route('POST', '/api/friend-enquiries', ({ user, body }) => {
  need(user, user.role === 'friend', 'Booking enquiries are for trusted friends; members request weeks from the calendar');
  const w = q1('SELECT * FROM weeks WHERE id=?', body.week_id) || fail(404, 'Week not found');
  if (!undecidedWeek(w)) fail(400, 'You can only enquire about a week its household hasn’t decided about yet');
  if (q1("SELECT 1 FROM friend_enquiries WHERE week_id=? AND user_id=? AND status='open'", w.id, user.id)) fail(400, 'You’ve already enquired about this week');
  const party = Math.max(1, Math.min(30, Number(body.party_size) || 0)) || null;
  const id = run('INSERT INTO friend_enquiries (week_id,user_id,message,guest_name,party_size) VALUES (?,?,?,?,?)', w.id, user.id, body.message || null, body.guest_name || user.name, party).lastInsertRowid;
  notify(familyAdmins(w.family_id), `${user.name}, a trusted friend of the ${famName(user.family_id)} family, would like to book your ${weekLabel(w)}${party ? ` (party of ${party})` : ''}. Let it to them or decline on the Enquiries page.`, '#/enquiries');
  audit(user.id, 'friend_enquiry.create', { id, week: w.id }); return { id };
});
route('GET', '/api/friend-enquiries', ({ user }) => {
  need(user, user.role === 'friend');
  return q("SELECT * FROM friend_enquiries WHERE user_id=? AND (status='open' OR closed_at > datetime('now','-60 days')) ORDER BY status<>'open', created_at DESC", user.id).map(e => {
    const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id), b = e.booking_id && q1('SELECT reference, amount, status FROM bookings WHERE id=?', e.booking_id);
    return { id: e.id, status: e.status, close_reason: e.close_reason, created_at: e.created_at, closed_at: e.closed_at, message: e.message, party_size: e.party_size,
      week: { id: w.id, year: w.year, week_no: w.week_no, start_date: w.start_date, end_date: w.end_date, season: w.season, school_holiday: w.school_holiday, price: priceOf(w) }, booking: b || null };
  });
});
route('POST', '/api/friend-enquiries/:id/withdraw', ({ user, params }) => {
  const e = q1("SELECT * FROM friend_enquiries WHERE id=? AND status='open'", params.id) || fail(404, 'This enquiry is already closed');
  need(user, e.user_id === user.id);
  run("UPDATE friend_enquiries SET status='withdrawn', closed_at=datetime('now') WHERE id=?", e.id);
  const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id);
  notify(familyAdmins(w.family_id), `${user.name} withdrew their booking enquiry for your ${weekLabel(w)}.`, '#/enquiries');
  return { ok: true };
});
// the holding family's admin answers: accept = release the week and reserve it for the friend at the friend price
route('POST', '/api/friend-enquiries/:id/answer', ({ user, params, body }) => {
  const e = q1("SELECT * FROM friend_enquiries WHERE id=? AND status='open'", params.id) || fail(404, 'This enquiry is closed');
  const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id), friend = q1('SELECT * FROM users WHERE id=?', e.user_id), s = settings();
  need(user, isAdminOf(user, w.family_id), 'Only your family admin can answer booking enquiries');
  if (!body.accept) {
    run("UPDATE friend_enquiries SET status='declined', answered_by=?, closed_at=datetime('now') WHERE id=?", user.id, e.id);
    notify([e.user_id], `Sorry, ${weekLabel(w)} isn't available to book this time.`, '#/bookings');
    audit(user.id, 'friend_enquiry.decline', { id: e.id }); return { status: 'declined' };
  }
  if (w.in_use || ['pending', 'booked'].includes(w.status) || w.start_date < today()) fail(400, 'This week can no longer be let');
  if (!friend || !friend.active) fail(400, 'That trusted friend no longer has a login');
  const price = priceOf(w, s);
  const b = tx(() => {
    run("UPDATE friend_enquiries SET status='accepted', answered_by=?, closed_at=datetime('now') WHERE id=?", user.id, e.id);
    run("UPDATE weeks SET status='offered', offer_friends=1, in_use=0, enquiry_until=NULL, released_at=COALESCE(released_at, datetime('now')) WHERE id=?", w.id);
    const bk = createBooking(friend, q1('SELECT * FROM weeks WHERE id=?', w.id), { method: 'bank', guest_name: e.guest_name, party_size: e.party_size, notes: `Let by ${user.name} after a booking enquiry` }, price);
    run('UPDATE friend_enquiries SET booking_id=? WHERE id=?', bk.id, e.id);
    return bk;
  });
  notify([e.user_id], `Good news: you can have ${weekLabel(w)}. It's reserved for you at ${s.currency}${price}. Please pay ${s.bank_account_name} by bank transfer within ${s.hold_days} days, reference ${b.reference}.`, '#/bookings');
  audit(user.id, 'friend_enquiry.accept', { id: e.id, booking: b.id }); return { status: 'accepted', booking: b.id };
});
route('GET', '/api/enquiries', ({ user }) => {
  need(user, isFamily(user), 'Enquiries are for syndicate families');
  expireHolds(); resolveFirstRefusal();
  const fid = user.family_id, s = settings(), now = nowSql();
  const view = e => {
    const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id), queue = openEnquiries(w.id);
    const windowOpen = w.status === 'offered' && w.enquiry_until && w.enquiry_until > now, ours = e.family_id === fid;
    const free = e.status === 'open' && !w.in_use && !['pending', 'booked', 'offered'].includes(w.status);
    return { id: e.id, status: e.status, close_reason: e.close_reason, message: e.message, created_at: e.created_at, claim: e.claim,
      family: famName(e.family_id), user: q1('SELECT name FROM users WHERE id=?', e.user_id).name, mine: ours,
      week: { ...weekBrief(w), family_name: famName(w.family_id), plan: planOf(w), state: w.status, price: priceOf(w, s), first_refusal_until: windowOpen ? w.enquiry_until : null },
      position: e.status === 'open' ? queue.findIndex(x => x.id === e.id) + 1 : null, queue: queue.length,
      can_claim: ours && e.status === 'open' && windowOpen, can_withdraw: ours && e.status === 'open' && (e.user_id === user.id || isAdminOf(user, fid)),
      reply: e.reply, can_reply: free && isAdminOf(user, w.family_id) && e.reply !== 'unsure',
      given: e.status === 'won' && !!q1("SELECT 1 FROM bookings WHERE week_id=? AND buyer_family_id=? AND gift=1 AND status='confirmed'", w.id, e.family_id),
      can_give: e.status === 'open' && !w.in_use && !['pending', 'booked'].includes(w.status) && w.start_date >= today() && isAdminOf(user, w.family_id) };
  };
  const incoming = q(`SELECT e.* FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE w.family_id=? AND e.family_id<>?
    AND (e.status='open' OR e.closed_at > datetime('now','-60 days')) ORDER BY w.start_date, e.created_at, e.id`, fid, fid);
  const outgoing = q(`SELECT * FROM enquiries WHERE family_id=? AND (status='open' OR closed_at > datetime('now','-60 days')) ORDER BY status<>'open', created_at DESC`, fid);
  const admin = isAdminOf(user, fid), price = w => priceOf(w, s);
  const friends = q(`SELECT f.* FROM friend_enquiries f JOIN weeks w ON w.id=f.week_id WHERE w.family_id=? AND (f.status='open' OR f.closed_at > datetime('now','-30 days')) ORDER BY w.start_date, f.created_at`, fid).map(f => {
    const w = q1('SELECT * FROM weeks WHERE id=?', f.week_id), fr = q1('SELECT name, email, phone, family_id FROM users WHERE id=?', f.user_id), free = !w.in_use && !['pending', 'booked'].includes(w.status) && w.start_date >= today();
    return { id: f.id, status: f.status, close_reason: f.close_reason, created_at: f.created_at, message: f.message, guest_name: f.guest_name, party_size: f.party_size,
      friend: fr.name, friend_of: famName(fr.family_id), contact: admin ? { email: fr.email, phone: fr.phone } : null, price: price(w), members_asked: openEnquiries(w.id).length,
      week: { ...weekBrief(w), family_name: famName(w.family_id), plan: planOf(w), state: w.status, price: priceOf(w, s), first_refusal_until: null },
      can_answer: admin && f.status === 'open' && free };
  });
  const qw = x => { const w = q1('SELECT * FROM weeks WHERE id=?', x.week_id); return { ...questionView(x), week: { ...weekBrief(w), family_name: famName(w.family_id), plan: planOf(w), state: w.status, first_refusal_until: null }, can_reply: !x.reply && w.family_id === fid }; };
  const questions_in = q(`SELECT x.* FROM week_questions x JOIN weeks w ON w.id=x.week_id WHERE w.family_id=? AND (x.reply IS NULL OR x.replied_at > datetime('now','-60 days')) ORDER BY w.start_date, x.id`, fid).map(qw);
  const questions_out = q(`SELECT * FROM week_questions WHERE family_id=? AND (reply IS NULL OR replied_at > datetime('now','-60 days')) ORDER BY id DESC`, fid).map(qw);
  return { incoming: incoming.map(view), outgoing: outgoing.map(view), friends, questions_in, questions_out };
});
route('POST', '/api/enquiries/:id/claim', ({ user, params, body }) => {
  const e = q1("SELECT * FROM enquiries WHERE id=? AND status='open'", params.id) || fail(404, 'This enquiry is closed');
  need(user, isFamily(user) && user.family_id === e.family_id, 'Only the family that enquired can answer');
  const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id), s = settings();
  if (!(w.status === 'offered' && w.enquiry_until && w.enquiry_until > nowSql())) fail(400, 'First refusal isn’t open for this week');
  if (body.want) {
    const method = body.method === 'account' ? 'account' : 'bank';
    if (method === 'account' && !(user.role === 'family_admin' || s.allow_member_account_charge === '1')) fail(403, 'Paying from the family account is not allowed for your login');
    if (method === 'account' && creditAvailable(e.family_id) + 0.005 < priceOf(w, s)) fail(400, `Your household’s credit doesn’t cover ${s.currency}${priceOf(w, s)}. Top up from the Account page, or pay by bank transfer.`);
    run("UPDATE enquiries SET claim='yes', claim_method=?, claim_guest=?, claim_party=?, claimed_at=datetime('now'), user_id=? WHERE id=?", method, body.guest_name || user.name, Number(body.party_size) || null, user.id, e.id);
  } else run("UPDATE enquiries SET claim='no', claimed_at=datetime('now') WHERE id=?", e.id);
  resolveFirstRefusal();
  const after = q1('SELECT * FROM enquiries WHERE id=?', e.id);
  audit(user.id, 'enquiry.claim', { id: e.id, want: !!body.want });
  return { status: after.status, claim: after.claim, waiting: after.status === 'open' };
});
route('POST', '/api/enquiries/:id/withdraw', ({ user, params }) => {
  const e = q1("SELECT * FROM enquiries WHERE id=? AND status='open'", params.id) || fail(404, 'This enquiry is already closed');
  need(user, e.user_id === user.id || isAdminOf(user, e.family_id));
  run("UPDATE enquiries SET status='withdrawn', closed_at=datetime('now') WHERE id=?", e.id);
  resolveFirstRefusal();
  return { ok: true };
});

// --- "View as" (site admin only, for testing): see the portal exactly as another login sees it. Actions are real.
const viewAsOn = () => settings().view_as_enabled !== '0';
const realAdmin = user => !user ? null : user.is_site_admin ? user : user.viewer ? q1('SELECT * FROM users WHERE id=? AND is_site_admin=1 AND active=1', user.viewer) : null;
route('POST', '/api/view-as', ({ user, body }) => {
  const admin = realAdmin(user); need(user, !!admin, 'Only the site admin can view as another login');
  if (!viewAsOn()) fail(400, 'View as is switched off in Settings');
  const t = q1('SELECT * FROM users WHERE id=? AND active=1', body.user_id) || fail(404, 'No such login');
  if (t.is_site_admin) fail(400, 'Choose a household login');
  run('UPDATE sessions SET user_id=?, viewer_id=? WHERE token=?', t.id, admin.id, user.sid);
  audit(admin.id, 'view_as.start', { as: t.name }); return { ok: true };
});
route('POST', '/api/view-as/stop', ({ user }) => {
  need(user, !!(user && user.viewer), 'You are not viewing as anyone');
  run('UPDATE sessions SET user_id=viewer_id, viewer_id=NULL WHERE token=?', user.sid);
  return { ok: true };
});

// --- Start afresh: remove the demo logins and all test activity, keeping families, allocations, budgets and settings.
// Service charges are reissued from the budgets: 2026 marked paid in full, 2027 left unpaid. Preview first (GET).
const RESET_PAID_YEAR = 2026, RESET_UNPAID_YEAR = 2027;
// Start afresh clears test activity. Every login is kept, the demo ones (@example.com) included.
function resetPlan(user) {
  const n = t => q1(`SELECT COUNT(*) n FROM ${t}`).n;
  const charge = y => { const b = budgetSummary(y); return { year: y, label: b.label, budget: b.total, charges: b.total ? b.raised : 0 }; };
  return {
    demo_logins: n("users WHERE lower(email) LIKE '%@example.com'"), costs: n('costs'), share_offers: n('share_offers'), maintenance: n('maintenance_issues'),
    bookings: n('bookings'), enquiries: n('enquiries') + n('friend_enquiries') + n('week_questions'), topups: n('topups'), bank_balances: n('bank_balances'), notifications: n('notifications'),
    ledger_lines: n('ledger'),
    weeks_reset: q1("SELECT COUNT(*) n FROM weeks WHERE family_id IS NOT NULL AND (status<>'own_use' OR offer_friends=1 OR in_use=1 OR price_override IS NOT NULL OR note IS NOT NULL OR released_at IS NOT NULL)").n,
    paid: charge(RESET_PAID_YEAR), unpaid: charge(RESET_UNPAID_YEAR), signed_off: signedOff(RESET_UNPAID_YEAR) && RESET_UNPAID_YEAR > thisYear(),
  };
}
route('GET', '/api/admin/reset', ({ user }) => { needAdmin(user); return resetPlan(user); });
route('POST', '/api/admin/reset', ({ user, body }) => {
  needAdmin(user); if (body.confirm !== 'RESET') fail(400, 'Type RESET to confirm');
  const plan = resetPlan(user), cur = settings().currency;
  tx(() => {
    for (const t of ['bookings', 'enquiries', 'friend_enquiries', 'topups', 'bank_balances', 'notifications', 'ledger', 'costs', 'share_offers', 'share_interests', 'maintenance_issues', 'week_questions', 'audit']) run(`DELETE FROM ${t}`);
    run("UPDATE weeks SET status=CASE WHEN family_id IS NULL THEN 'syndicate' ELSE 'own_use' END, offer_friends=0, in_use=0, released_at=NULL, enquiry_until=NULL, price_override=NULL, note=NULL, sale_to='all', residence=NULL, residence_by=NULL, residence_at=NULL");
    for (const [year, paid] of [[RESET_PAID_YEAR, true], [RESET_UNPAID_YEAR, false]]) {
      const b = budgetSummary(year); if (!b.total) continue;
      for (const f of b.split) {
        run("INSERT INTO ledger (family_id,year,type,description,amount,created_by) VALUES (?,?,'service_charge',?,?,?)",
          f.id, year, `${b.label || year} service charge: ${f.share_units} weeks × ${cur}${b.rate.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`, f.charge, user.id);
        if (paid) run("INSERT INTO ledger (family_id,year,type,description,amount,created_by) VALUES (?,?,'payment',?,?,?)", f.id, year, `${b.label || year} service charge paid in full`, -f.charge, user.id);
      }
    }
    run('DELETE FROM year_status WHERE year=?', RESET_UNPAID_YEAR);
  });
  audit(user.id, 'reset', { paid_year: RESET_PAID_YEAR, unpaid_year: RESET_UNPAID_YEAR });
  return { ok: true };
});

// --- allocation sign-off: the site admin marks next year's allocation as agreed (and can reopen a future year)
route('POST', '/api/admin/years/:year/signoff', ({ user, params, body }) => {
  needAdmin(user); const year = Number(params.year);
  if (!q1('SELECT 1 FROM weeks WHERE year=?', year)) fail(404, 'No weeks for that year');
  if (body.undo) {
    if (year <= thisYear()) fail(400, 'This year has started, so its allocation stays signed off');
    run('DELETE FROM year_status WHERE year=?', year); audit(user.id, 'year.reopen', { year }); return { ok: true };
  }
  if (signedOff(year)) fail(400, `The ${year} allocation is already signed off`);
  run("INSERT INTO year_status (year,signed_off_at,signed_off_by) VALUES (?,datetime('now'),?) ON CONFLICT(year) DO UPDATE SET signed_off_at=excluded.signed_off_at, signed_off_by=excluded.signed_off_by", year, user.id);
  notify(q("SELECT id FROM users WHERE active=1 AND role IN ('family_admin','family_member')").map(r => r.id),
    `The ${year} allocation has been signed off. From now on, ${year} weeks are bought and sold: release a week you won’t use, and book weeks other families release.`, '#/calendar');
  audit(user.id, 'year.signoff', { year }); return { ok: true };
});

// --- top-ups: a household pays money in to build up credit, which can then pay for weeks
const famCode = fid => famName(fid).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
route('POST', '/api/topups', ({ user, body }) => {
  need(user, isFamily(user), 'Top-ups are for syndicate households');
  const amount = round2(Number(body.amount)); if (!(amount > 0) || amount > 100000) fail(400, 'Enter the amount you are sending');
  const id = run('INSERT INTO topups (family_id,user_id,amount) VALUES (?,?,?)', user.family_id, user.id, amount).lastInsertRowid, ref = `${famCode(user.family_id)}-TU${id}`;
  run('UPDATE topups SET reference=? WHERE id=?', ref, id);
  notify(siteAdmins(), `Top-up expected: ${settings().currency}${amount} from ${famName(user.family_id)} (${user.name}), reference ${ref}.`, '#/admin/overview');
  audit(user.id, 'topup.create', { id, amount }); return { id, reference: ref, amount };
});
route('GET', '/api/topups', ({ user }) => {
  need(user, isFamily(user));
  return q("SELECT * FROM topups WHERE family_id=? AND (status='pending' OR created_at > datetime('now','-90 days')) ORDER BY id DESC", user.family_id);
});
route('POST', '/api/topups/:id/cancel', ({ user, params }) => {
  const t = q1("SELECT * FROM topups WHERE id=? AND status='pending'", params.id) || fail(404, 'No pending top-up');
  need(user, user.is_site_admin || (isFamily(user) && user.family_id === t.family_id));
  run("UPDATE topups SET status='cancelled' WHERE id=?", t.id); return { ok: true };
});
route('POST', '/api/admin/topups/:id/confirm', ({ user, params, body }) => {
  needAdmin(user); const t = q1("SELECT * FROM topups WHERE id=? AND status='pending'", params.id) || fail(404, 'No pending top-up');
  const amount = body.amount != null && Number(body.amount) > 0 ? round2(Number(body.amount)) : t.amount, cur = settings().currency;
  tx(() => {
    run("UPDATE topups SET status='confirmed', amount=?, confirmed_at=datetime('now'), confirmed_by=? WHERE id=?", amount, user.id, t.id);
    run("INSERT INTO ledger (family_id,year,type,description,amount,created_by) VALUES (?,?,'payment',?,?,?)", t.family_id, thisYear(), `Top-up received (${t.reference})`, -amount, user.id);
  });
  notify([...new Set([t.user_id, ...familyAdmins(t.family_id)])], `Your top-up of ${cur}${amount} has arrived. Your household now has ${cur}${creditAvailable(t.family_id)} in credit to spend on weeks.`, '#/account');
  audit(user.id, 'topup.confirm', { id: t.id, amount }); return { ok: true };
});

// --- people (family members + trusted friends)
route('GET', '/api/people', ({ user, query }) => {
  need(user, true);
  if (user.role === 'friend') return [publicUser(user)];
  const fid = user.is_site_admin && query.family_id ? Number(query.family_id) : user.family_id;
  const rows = user.is_site_admin && query.all ? q('SELECT * FROM users ORDER BY family_id, role, name') : q('SELECT * FROM users WHERE family_id=? ORDER BY role, name', fid);
  return rows.map(u => ({ ...publicUser(u), family_name: famName(u.family_id), invite_link: canManageFamily(user, u.family_id) && u.invite_token ? `${BASE_URL}/#/invite/${u.invite_token}` : undefined }));
});
route('POST', '/api/people', ({ user, body }) => {
  need(user, true);
  const role = ['site_admin', 'family_admin', 'family_member', 'friend'].includes(body.role) ? body.role : 'friend';
  if (role === 'site_admin') need(user, user.is_site_admin, 'Only a site admin can add another site admin');
  const fid = role === 'site_admin' ? null : user.is_site_admin && body.family_id ? Number(body.family_id) : user.family_id;
  if (role !== 'site_admin' && !fid) fail(400, 'Choose which family this person belongs to');
  if (!canManageFamily(user, fid)) need(user, isFamily(user) && fid === user.family_id && role === 'friend', 'Family members can add trusted friends; only a family admin can add family members');
  if (!body.name) fail(400, 'Name is required');
  const email = (body.email || '').trim() || null;
  if (email && q1('SELECT 1 FROM users WHERE lower(email)=lower(?)', email)) fail(400, 'Someone with that email already has a login');
  const inv = email ? token(18) : null;
  const id = Number(run('INSERT INTO users (family_id,name,email,phone,relationship,notes,role,is_site_admin,invite_token,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
    fid, body.name, email, body.phone || null, body.relationship || null, body.notes || null, role, role === 'site_admin' ? 1 : 0, inv, user.id).lastInsertRowid);
  if (email) deliver(email, `You're invited to ${settings().site_name}`, `${user.name} has added you to the ${settings().site_name} owners' portal.\n\nChoose a password to get started: ${BASE_URL}/#/invite/${inv}`);
  if (role === 'friend' && user.role !== 'family_admin') notify(familyAdmins(fid), `${user.name} added ${body.name} as a trusted friend.`, '#/people');
  audit(user.id, 'person.add', { id, role });
  return { id, invite_link: inv ? `${BASE_URL}/#/invite/${inv}` : null };
});
route('PUT', '/api/people/:id', ({ user, params, body }) => {
  const p = q1('SELECT * FROM users WHERE id=?', params.id) || fail(404, 'Not found');
  const self = p.id === user.id;
  need(user, self || canManageFamily(user, p.family_id) || (p.role === 'friend' && p.created_by === user.id));
  const manage = canManageFamily(user, p.family_id);
  let role = p.role, familyId = p.family_id;
  if (manage && body.role && ['family_admin', 'family_member', 'friend'].includes(body.role)) role = body.role;
  if (user.is_site_admin && body.role === 'site_admin') role = 'site_admin';
  if (role === 'site_admin') familyId = null;
  else if (user.is_site_admin && body.family_id) familyId = Number(body.family_id);
  if (role !== 'site_admin' && !familyId) fail(400, 'Choose which family this person belongs to');
  if (p.role === 'site_admin' && role !== 'site_admin') {
    if (self) fail(400, 'You can’t remove your own site admin access. Ask another site admin.');
    if (q1("SELECT COUNT(*) n FROM users WHERE role='site_admin' AND active=1").n < 2) fail(400, 'There must always be at least one site admin');
  }
  if (p.role === 'family_admin' && (role !== 'family_admin' || familyId !== p.family_id) && q1("SELECT COUNT(*) n FROM users WHERE family_id=? AND role='family_admin' AND active=1", p.family_id).n < 2) fail(400, 'Each family needs at least one family admin');
  const email = body.email !== undefined ? (body.email || '').trim() || null : p.email;
  if (email && q1('SELECT 1 FROM users WHERE lower(email)=lower(?) AND id<>?', email, p.id)) fail(400, 'That email is already used');
  run('UPDATE users SET name=?, email=?, phone=?, relationship=?, notes=?, role=?, is_site_admin=?, family_id=? WHERE id=?',
    body.name ?? p.name, email, body.phone ?? p.phone, body.relationship ?? p.relationship, body.notes ?? p.notes, role, role === 'site_admin' ? 1 : 0, familyId, p.id);
  if (email && !p.password_hash && !p.invite_token) run('UPDATE users SET invite_token=? WHERE id=?', token(18), p.id);
  return { ok: true };
});
route('POST', '/api/people/:id/reinvite', ({ user, params }) => {
  const p = q1('SELECT * FROM users WHERE id=?', params.id) || fail(404, 'Not found');
  need(user, canManageFamily(user, p.family_id)); if (!p.email) fail(400, 'Add an email address first');
  const inv = token(18); run('UPDATE users SET invite_token=? WHERE id=?', inv, p.id); // also serves as password reset
  return { invite_link: `${BASE_URL}/#/invite/${inv}` };
});
route('DELETE', '/api/people/:id', ({ user, params }) => {
  const p = q1('SELECT * FROM users WHERE id=?', params.id) || fail(404, 'Not found');
  need(user, canManageFamily(user, p.family_id) || (p.role === 'friend' && p.created_by === user.id));
  if (p.id === user.id) fail(400, 'You cannot remove yourself');
  if (p.role === 'site_admin' && q1("SELECT COUNT(*) n FROM users WHERE role='site_admin' AND active=1").n < 2) fail(400, 'There must always be at least one site admin');
  if (p.role === 'family_admin' && q1("SELECT COUNT(*) n FROM users WHERE family_id=? AND role='family_admin' AND active=1", p.family_id).n < 2) fail(400, 'Each family needs at least one family admin');
  run('UPDATE users SET active=0, invite_token=NULL WHERE id=?', p.id); run('DELETE FROM sessions WHERE user_id=?', p.id);
  audit(user.id, 'person.remove', { id: p.id }); return { ok: true };
});

// --- family account
route('GET', '/api/account', ({ user, query }) => {
  need(user, isFamily(user) || user.is_site_admin, 'Accounts are for family members');
  const fid = user.is_site_admin && query.family_id ? Number(query.family_id) : user.family_id;
  const rows = q('SELECT * FROM ledger WHERE family_id=? ORDER BY year, created_at, id', fid);
  let bal = 0; const lines = rows.map(r => ({ ...r, running: round2(bal += r.amount) }));
  const byYear = q('SELECT year, SUM(amount) total FROM ledger WHERE family_id=? GROUP BY year ORDER BY year', fid);
  const fam = q1('SELECT * FROM families WHERE id=?', fid);
  const weeks = q('SELECT year, COUNT(*) n FROM weeks WHERE family_id=? GROUP BY year', fid);
  return { family: fam, lines, balance: round2(bal), byYear, weeks };
});

// --- notifications
route('GET', '/api/notifications', ({ user }) => { need(user, true); return q('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', user.id); });
route('POST', '/api/notifications/read', ({ user }) => { need(user, true); run('UPDATE notifications SET read=1 WHERE user_id=?', user.id); return { ok: true }; });

// --- site admin
route('GET', '/api/admin/settings', ({ user }) => { needAdmin(user); return settings(); });
// Optional panoramic photograph for the Overview and login pages. Stored next to the database (on the volume).
const HERO_FILE = path.join(path.dirname(DB_FILE), 'hero.jpg');
route('POST', '/api/admin/hero', ({ user, body }) => {
  needAdmin(user);
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || '')); if (!m) fail(400, 'Please choose a JPEG, PNG or WebP image');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 4e6) fail(413, 'That image is too large. Please use one under 4 MB.');
  fs.writeFileSync(HERO_FILE, buf);
  run("INSERT INTO settings VALUES ('hero_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(Date.now()));
  audit(user.id, 'settings.photo', 'Overview photograph updated'); return { ok: true };
});
route('DELETE', '/api/admin/hero', ({ user }) => {
  needAdmin(user); try { fs.unlinkSync(HERO_FILE); } catch { }
  run("INSERT INTO settings VALUES ('hero_version','') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  audit(user.id, 'settings.photo', 'Overview photograph removed'); return { ok: true };
});
route('PUT', '/api/admin/settings', ({ user, body }) => {
  needAdmin(user);
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (body[k] !== undefined) run('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(body[k]));
  audit(user.id, 'settings.update', body); return { ok: true };
});
route('GET', '/api/admin/overview', ({ user }) => {
  needAdmin(user); expireHolds();
  const pending = q("SELECT b.*, u.name booker FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.status='pending' ORDER BY b.id").map(b => ({ ...b, week: q1('SELECT year,week_no,start_date FROM weeks WHERE id=?', b.week_id), seller: famName(b.seller_family_id) }));
  const topups = q("SELECT t.*, u.name person FROM topups t JOIN users u ON u.id=t.user_id WHERE t.status='pending' ORDER BY t.id").map(t => ({ ...t, family: famName(t.family_id) }));
  return { balances: balances(), pending, topups };
});
route('GET', '/api/admin/families', ({ user, query }) => {
  needAdmin(user); const year = Number(query.year) || null;
  return q('SELECT * FROM families ORDER BY name').map(f => ({ ...f, shares: year ? sharesFor(f.id, year) : f.share_units, allocated: year ? q1('SELECT COUNT(*) n FROM weeks WHERE year=? AND original_family_id=?', year, f.id).n : null, weeks: Object.fromEntries(q('SELECT year, COUNT(*) n FROM weeks WHERE original_family_id=? GROUP BY year', f.id).map(r => [r.year, r.n])),
    admins: q("SELECT name FROM users WHERE family_id=? AND role='family_admin' AND active=1", f.id).map(r => r.name) }));
});
route('POST', '/api/admin/families', ({ user, body }) => {
  needAdmin(user); if (!body.name) fail(400, 'Name required');
  const id = Number(run('INSERT INTO families (name,share_units,color) VALUES (?,?,?)', body.name.trim(), Math.max(0, Math.round(Number(body.share_units) || 0)), body.color || '#6b8f71').lastInsertRowid);
  return { id };
});
// save the Families page for one year: names, colours, active, and that year's shares (active families must total 52)
const TOTAL_SHARES = 52;
route('POST', '/api/admin/families/save', ({ user, body }) => {
  needAdmin(user); const year = Number(body.year), rows = Array.isArray(body.rows) ? body.rows : [];
  if (!year) fail(400, 'Year required');
  const clean = rows.map(r => ({ id: Number(r.id), name: String(r.name || '').trim(), color: r.color, units: Number(r.share_units) }))
    .filter(r => (q1('SELECT active FROM families WHERE id=?', r.id) || {}).active);   // the page lists the syndicate's (active) families
  if (clean.some(r => !r.name)) fail(400, 'Every family needs a name');
  if (clean.some(r => !(r.units >= 0) || !Number.isInteger(r.units))) fail(400, 'Shares must be whole numbers');
  const total = clean.reduce((a, r) => a + r.units, 0);
  if (total !== TOTAL_SHARES) fail(400, `The ${year} shares must total ${TOTAL_SHARES} (they total ${total})`);
  tx(() => {
    for (const r of clean) {
      const f = q1('SELECT * FROM families WHERE id=?', r.id) || fail(404, 'Family not found');
      run('UPDATE families SET name=?, color=? WHERE id=?', r.name, r.color || f.color, f.id);
      setShares(f.id, year, r.units);
    }
  });
  audit(user.id, 'family.save', { year, shares: Object.fromEntries(clean.map(r => [r.name, r.units])) }); return { ok: true };
});
route('POST', '/api/admin/years', ({ user, body }) => { needAdmin(user); return { weeks: generateYear(Number(body.year)) }; });
route('PUT', '/api/admin/weeks/:id', ({ user, params, body }) => {
  needAdmin(user); const w = q1('SELECT * FROM weeks WHERE id=?', params.id) || fail(404, 'Not found');
  if (body.school_holiday !== undefined) { run('UPDATE weeks SET school_holiday=? WHERE id=?', body.school_holiday ? 1 : 0, w.id); if (Object.keys(body).length === 1) return { ok: true }; }
  const fid = body.family_id === '' || body.family_id === null ? null : body.family_id !== undefined ? Number(body.family_id) : w.family_id;
  const season = ['summer', 'shoulder', 'winter'].includes(body.season) ? body.season : w.season;
  const status = fid == null ? 'syndicate' : (w.status === 'syndicate' ? 'own_use' : w.status);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(body.start_date || '') ? body.start_date : w.start_date;
  tx(() => {
    run('UPDATE weeks SET family_id=?, original_family_id=?, season=?, status=?, start_date=?, comment=? WHERE id=?', fid, body.family_id !== undefined ? fid : w.original_family_id, season, status, start,
      body.comment !== undefined ? (body.comment || null) : w.comment, w.id);
    if (start !== w.start_date) recomputeEnds(w.year);
  });
  return { ok: true };
});
route('POST', '/api/admin/allocation/import', ({ user, body }) => {
  needAdmin(user); const year = Number(body.year); const rows = body.rows || [];
  if (!q1('SELECT 1 FROM weeks WHERE year=?', year)) generateYear(year);
  const fams = q('SELECT id,name FROM families'); const unknown = new Set(); let n = 0;
  const findFam = name => { const k = String(name).trim().toLowerCase(); return fams.find(f => f.name.toLowerCase() === k) || fams.find(f => k && (f.name.toLowerCase().includes(k) || k.includes(f.name.toLowerCase()))); };
  tx(() => {
    for (const r of rows) {
      const w = q1('SELECT * FROM weeks WHERE year=? AND week_no=?', year, Number(r.week)); if (!w) continue;
      if (['pending', 'booked'].includes(w.status)) continue;
      const f = r.family ? findFam(r.family) : null;
      if (r.family && !f) { if (body.create_families) { const id = Number(run('INSERT INTO families (name,color) VALUES (?,?)', String(r.family).trim(), palette[fams.length % palette.length]).lastInsertRowid); fams.push({ id, name: String(r.family).trim() }); run("UPDATE weeks SET family_id=?, original_family_id=?, status='own_use' WHERE id=?", id, id, w.id); n++; } else unknown.add(r.family); continue; }
      run('UPDATE weeks SET family_id=?, original_family_id=?, status=? , offer_friends=0 WHERE id=?', f ? f.id : null, f ? f.id : null, f ? 'own_use' : 'syndicate', w.id);
      if (r.season && ['summer', 'shoulder', 'winter'].includes(String(r.season).toLowerCase())) run('UPDATE weeks SET season=? WHERE id=?', String(r.season).toLowerCase(), w.id);
      n++;
    }
    for (const r of rows) {
      const w = q1('SELECT * FROM weeks WHERE year=? AND week_no=?', year, Number(r.week)); if (!w) continue;
      if (r.comment !== undefined) run('UPDATE weeks SET comment=? WHERE id=?', String(r.comment || '').trim() || null, w.id);
      if (/^\d{4}-\d{2}-\d{2}$/.test(r.start_date || '')) run('UPDATE weeks SET start_date=?, season=? WHERE id=?', r.start_date, seasonForDate(r.start_date), w.id);
    }
    recomputeEnds(year);
  });
  audit(user.id, 'allocation.import', { year, n }); return { updated: n, unknown: [...unknown] };
});
route('POST', '/api/admin/allocation/rotate', ({ user, body }) => {
  needAdmin(user); const from = Number(body.from), to = Number(body.to), shift = Number(body.shift) || 0;
  if (!q1('SELECT 1 FROM weeks WHERE year=?', to)) generateYear(to);
  const src = q('SELECT week_no, original_family_id f FROM weeks WHERE year=? ORDER BY week_no', from); if (!src.length) fail(400, `No allocation for ${from}`);
  const N = src.length;
  tx(() => { for (const w of q('SELECT * FROM weeks WHERE year=?', to)) { if (['pending', 'booked'].includes(w.status)) continue;
    const s = src[((w.week_no - 1 - shift) % N + N) % N]; const f = w.week_no > N ? null : s.f;
    run("UPDATE weeks SET family_id=?, original_family_id=?, status=?, offer_friends=0 WHERE id=?", f, f, f ? 'own_use' : 'syndicate', w.id); } });
  return { ok: true };
});

// budget. Service charge = charge per week × each family's weeks (shares). By default the charge per week is
// budget ÷ total weeks; the admin can set a rounded figure, and the shortfall/surplus against the budget is shown.
// the latest bank balance recorded on the Payments page
const latestBank = () => q1('SELECT as_of, amount FROM bank_balances ORDER BY as_of DESC, id DESC LIMIT 1') || null;
// a year's lines paid from the bank balance can't total more than the latest bank balance (call inside the tx that changed them)
function checkBankLines(year) {
  const t = round2(q1("SELECT COALESCE(SUM(amount),0) n FROM budget_items WHERE year=? AND funding='bank'", year).n); if (t <= 0.005) return;
  const b = latestBank(), cur = settings().currency;
  if (!b) fail(400, 'Record the bank balance on the Payments page before paying for anything from it');
  const m = n => cur + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (t > b.amount + 0.005) fail(400, `The ${year} lines paid from the bank balance would total ${m(t)}, more than the ${m(b.amount)} bank balance on ${fmtDate(b.as_of)}`);
}
function budgetSummary(year) {
  const items = q('SELECT * FROM budget_items WHERE year=? ORDER BY sort, id', year);
  const total = round2(items.reduce((a, b) => a + b.amount, 0)), bank_total = round2(items.filter(i => i.funding === 'bank').reduce((a, b) => a + b.amount, 0));
  const charge_total = round2(total - bank_total);   // what the service charge has to raise
  const fams = q('SELECT * FROM families WHERE active=1 ORDER BY name').map(f => ({ ...f, share_units: sharesFor(f.id, year) })); const units = fams.reduce((a, f) => a + f.share_units, 0) || 1;
  const by = q1('SELECT * FROM budget_years WHERE year=?', year) || {};
  const calc = round2(charge_total / units); const rate = by.rate_per_week != null ? by.rate_per_week : calc;
  const charged = Object.fromEntries(q("SELECT family_id, SUM(amount) a FROM ledger WHERE year=? AND type='service_charge' GROUP BY family_id", year).map(r => [r.family_id, round2(r.a)]));
  const split = fams.map(f => ({ id: f.id, name: f.name, color: f.color, share_units: f.share_units, pct: f.share_units / units * 100, charge: round2(rate * f.share_units), charged: charged[f.id] ?? null }));
  const raised = round2(split.reduce((a, f) => a + f.charge, 0));
  return { year, items, total, charge_total, bank_total, bank: latestBank(), units, label: by.label || '', rate_calc: calc, rate_per_week: by.rate_per_week ?? null, rate, raised, difference: round2(raised - charge_total), split, generated: Object.keys(charged).length > 0 };
}
route('GET', '/api/admin/budget', ({ user, query }) => {
  needAdmin(user);
  const years = q('SELECT DISTINCT year FROM budget_items UNION SELECT DISTINCT year FROM weeks UNION SELECT year FROM budget_years ORDER BY 1').map(r => r.year);
  const b = budgetSummary(Number(query.year));
  return { ...b, items: b.items.map(i => ({ ...i, cost: lineCost(i.id, user) })), years };
});
route('PUT', '/api/admin/budget-year/:year', ({ user, params, body }) => {
  needAdmin(user); const year = Number(params.year); const cur = q1('SELECT * FROM budget_years WHERE year=?', year) || {};
  const rate = body.rate_per_week === undefined ? cur.rate_per_week ?? null : body.rate_per_week === '' || body.rate_per_week === null ? null : Number(body.rate_per_week);
  if (rate != null && (isNaN(rate) || rate < 0)) fail(400, 'Charge per week must be a positive number');
  run('INSERT INTO budget_years (year,label,rate_per_week) VALUES (?,?,?) ON CONFLICT(year) DO UPDATE SET label=excluded.label, rate_per_week=excluded.rate_per_week', year, body.label !== undefined ? body.label : cur.label ?? null, rate);
  return { ok: true };
});
route('POST', '/api/admin/budget', ({ user, body }) => {
  needAdmin(user); if (!body.description) fail(400, 'Description required');
  const year = Number(body.year);
  const id = tx(() => {
    const id = Number(run('INSERT INTO budget_items (year,category,description,amount,sort,notes,funding) VALUES (?,?,?,?,?,?,?)', year, body.category || null, body.description,
      Number(body.amount) || 0, Number(body.sort) || 999, body.notes || null, body.funding === 'bank' ? 'bank' : 'charge').lastInsertRowid);
    checkBankLines(year); return id;
  });
  return { id };
});
route('PUT', '/api/admin/budget/:id', ({ user, params, body }) => {
  needAdmin(user); const it = q1('SELECT * FROM budget_items WHERE id=?', params.id) || fail(404, 'Not found');
  tx(() => {
    run('UPDATE budget_items SET category=?, description=?, amount=?, notes=?, funding=? WHERE id=?', body.category ?? it.category, body.description ?? it.description,
      body.amount != null ? Number(body.amount) || 0 : it.amount, body.notes ?? it.notes, body.funding === undefined ? it.funding : body.funding === 'bank' ? 'bank' : 'charge', it.id);
    checkBankLines(it.year);
    // an adopted cost follows its line (what it's called, the amount, and whether it's on the service charge or the bank balance)
    const now = q1('SELECT * FROM budget_items WHERE id=?', it.id);
    run("UPDATE costs SET title=?, amount=?, funding=?, updated_at=datetime('now') WHERE budget_item_id=? AND status='adopted'", now.description, now.amount, now.funding, it.id);
  });
  return { ok: true };
});
route('DELETE', '/api/admin/budget/:id', ({ user, params }) => {
  needAdmin(user); const it = q1('SELECT * FROM budget_items WHERE id=?', params.id) || fail(404, 'Not found');
  tx(() => { run('DELETE FROM budget_items WHERE id=?', it.id); unlinkCosts([it.id], user, `Its line was removed from the ${it.year} budget`); });
  return { ok: true };
});
// lines removed from a budget: an adopted cost on one goes back to the waiting list
function unlinkCosts(ids, user, why) {
  for (const c of ids.length ? q(`SELECT * FROM costs WHERE status='adopted' AND budget_item_id IN (${ids.map(() => '?').join(',')})`, ...ids) : [])
    run("UPDATE costs SET status='waiting', year=NULL, funding=NULL, budget_item_id=NULL, updated_at=datetime('now'), history=? WHERE id=?", withHistory(c, user, `${why}: waiting again`), c.id);
}
route('POST', '/api/admin/budget/copy', ({ user, body }) => {
  needAdmin(user); const from = Number(body.from), to = Number(body.to), up = 1 + (Number(body.uplift_pct) || 0) / 100;
  if (q1('SELECT 1 FROM budget_items WHERE year=?', to)) fail(400, `${to} already has budget lines — delete them first or edit directly`);
  // one-off lines (adopted upgrades and maintenance, works) aren't yearly costs, so they stay in the year they were for
  const adopted = new Set(q("SELECT budget_item_id i FROM costs WHERE status='adopted' AND budget_item_id IS NOT NULL").map(r => r.i));
  const all = q('SELECT * FROM budget_items WHERE year=?', from), lines = all.filter(it => !adopted.has(it.id) && !/^one[- ]?off$/i.test(String(it.category || '').trim()));
  tx(() => { for (const it of lines) run('INSERT INTO budget_items (year,category,description,amount,sort,notes,funding) VALUES (?,?,?,?,?,?,?)', to, it.category, it.description, round2(it.amount * up), it.sort, it.notes, it.funding || 'charge'); checkBankLines(to); });
  return { ok: true, copied: lines.length, skipped: all.length - lines.length };
});
route('POST', '/api/admin/budget/import', ({ user, body }) => {
  needAdmin(user); const year = Number(body.year); const items = (body.items || []).filter(i => i.description && !isNaN(Number(i.amount)));
  tx(() => { if (body.replace) { unlinkCosts(q('SELECT id FROM budget_items WHERE year=?', year).map(r => r.id), user, `The ${year} budget was re-imported`); run('DELETE FROM budget_items WHERE year=?', year); }
    items.forEach((i, k) => run('INSERT INTO budget_items (year,category,description,amount,sort,notes) VALUES (?,?,?,?,?,?)', year, i.category || null, String(i.description), Number(i.amount), k, i.notes || null));
    if (body.label || body.rate_per_week) run('INSERT INTO budget_years (year,label,rate_per_week) VALUES (?,?,?) ON CONFLICT(year) DO UPDATE SET label=COALESCE(excluded.label,label), rate_per_week=COALESCE(excluded.rate_per_week,rate_per_week)', year, body.label || null, body.rate_per_week ? Number(body.rate_per_week) : null); });
  return { imported: items.length };
});
route('POST', '/api/admin/budget/generate', ({ user, body }) => {
  needAdmin(user); const year = Number(body.year); const b = budgetSummary(year); const cur = settings().currency;
  if (!b.total) fail(400, 'Budget is empty');
  tx(() => {
    run("DELETE FROM ledger WHERE year=? AND type='service_charge'", year);
    for (const f of b.split) run("INSERT INTO ledger (family_id,year,type,description,amount,created_by) VALUES (?,?,'service_charge',?,?,?)",
      f.id, year, `${b.label || year} service charge: ${f.share_units} weeks × ${cur}${b.rate.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`, f.charge, user.id);
  });
  for (const f of b.split) notify(familyAdmins(f.id), `${b.label || year} service charges have been issued. View your family account for details.`, '#/account');
  audit(user.id, 'budget.generate', { year, total: b.total, rate: b.rate }); return { ok: true };
});
// --- questions about a week
const questionView = x => ({ id: x.id, message: x.message, reply: x.reply, created_at: x.created_at, replied_at: x.replied_at, family: famName(x.family_id),
  by: (q1('SELECT name FROM users WHERE id=?', x.user_id) || {}).name || '', replied_by: x.replied_by ? (q1('SELECT name FROM users WHERE id=?', x.replied_by) || {}).name : null });
route('POST', '/api/questions', ({ user, body }) => {
  need(user, isFamily(user), 'Questions about weeks are for syndicate families');
  const w = q1('SELECT * FROM weeks WHERE id=?', body.week_id) || fail(404, 'Week not found'), message = String(body.message || '').trim().slice(0, 1000);
  if (!w.family_id || w.family_id === user.family_id) fail(400, 'Ask about another family’s week');
  if ((w.end_date || w.start_date) < today()) fail(400, 'That week is over');
  if (!message) fail(400, 'Write your question');
  const id = Number(run('INSERT INTO week_questions (week_id,family_id,user_id,message) VALUES (?,?,?,?)', w.id, user.family_id, user.id, message).lastInsertRowid);
  notify(q("SELECT id FROM users WHERE family_id=? AND active=1 AND role IN ('family_admin','family_member')", w.family_id).map(r => r.id),
    `${user.name} (${famName(user.family_id)}) asked about your ${weekLabel(w)}: “${message.slice(0, 160)}${message.length > 160 ? '…' : ''}” Reply on the Enquiries page.`, '#/enquiries');
  audit(user.id, 'question.ask', { id, week: w.id }); return { id };
});
route('POST', '/api/questions/:id/reply', ({ user, params, body }) => {
  const x = q1('SELECT * FROM week_questions WHERE id=?', params.id) || fail(404, 'Not found'), w = q1('SELECT * FROM weeks WHERE id=?', x.week_id);
  need(user, isFamily(user) && user.family_id === w.family_id, 'Only the family whose week it is can reply');
  const reply = String(body.reply || '').trim().slice(0, 1000); if (!reply) fail(400, 'Write your reply');
  run("UPDATE week_questions SET reply=?, replied_by=?, replied_at=datetime('now') WHERE id=?", reply, user.id, x.id);
  notify([x.user_id], `${user.name} (${famName(w.family_id)}) replied about ${weekLabel(w)}: “${reply.slice(0, 200)}${reply.length > 200 ? '…' : ''}”`, '#/enquiries');
  audit(user.id, 'question.reply', { id: x.id }); return { ok: true };
});
// ---------------------------------------------------------------- costs: upgrades and maintenance quotes
// A one-off cost is an upgrade the families suggest (Upgrades page) or a quote for a maintenance issue (Maintenance page). It
// waits on the Service charge page until the site admin adopts it: now, paid from the bank balance, or put forward for a year's
// service charge (a line in that year's budget, which the AGM agrees before the charges are issued). Left alone, it just waits.
// When something more urgent comes up, an adopted cost can be bumped back to the waiting list or to another year, or cancelled.
const isIssued = y => !!q1("SELECT 1 FROM ledger WHERE year=? AND type='service_charge'", y);
const firstUnissued = () => { for (let y = thisYear(); y < thisYear() + 5; y++) if (!isIssued(y)) return y; return thisYear() + 1; };
const costYears = () => [...new Set([...q('SELECT DISTINCT year FROM budget_items WHERE year >= ? UNION SELECT year FROM budget_years WHERE year >= ?', thisYear(), thisYear()).map(r => r.year),
  thisYear(), thisYear() + 1, thisYear() + 2])].sort();
const costYear = v => { const y = Number(v); if (!Number.isInteger(y) || y < thisYear() - 1 || y > thisYear() + 5) fail(400, 'Choose this year or a coming year'); return y; };
const costHistory = c => { try { return JSON.parse(c.history || '[]'); } catch { return []; } };
const withHistory = (c, user, text) => JSON.stringify([...costHistory(c), { at: nowSql(), by: user ? user.name : '', text }]);
const moneyText = n => settings().currency + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function costLabel(c) {
  if (c.status === 'waiting') return ['Waiting to be adopted', 'amber'];
  if (c.status === 'cancelled') return ['Cancelled', ''];
  if (c.status === 'withdrawn') return ['Withdrawn', ''];
  if (c.funding === 'bank') return [`Adopted: paid from the bank balance in ${c.year}`, 'green'];
  if (c.funding === 'levy') return [`Charged to households by shares (${c.year})`, 'green'];
  return isIssued(c.year) ? [`In the ${c.year} service charge`, 'green'] : [`Put forward for the ${c.year} service charge`, 'blue'];
}
function costView(c, user) {
  const admin = !!user.is_site_admin, waiting = c.status === 'waiting', mine = c.user_id === user.id, [label, tone] = costLabel(c), live = c.status === 'adopted' && c.funding !== 'levy';
  const issue = c.issue_id ? q1('SELECT id, title, area, status FROM maintenance_issues WHERE id=?', c.issue_id) || null : null;
  return { id: c.id, kind: c.kind, title: c.title, amount: c.amount, quote_from: c.quote_from, details: c.details, status: c.status, year: c.year, funding: c.funding,
    label, tone, issue, family: c.family_id ? famName(c.family_id) : null, by: nameOf(c.user_id), created_at: c.created_at, history: costHistory(c),
    can_edit: admin ? waiting || live : waiting && mine, can_withdraw: waiting && mine && !admin,
    can_adopt: admin && waiting, can_bump: admin && live, can_cancel: admin && (waiting || live), can_reinstate: admin && c.status === 'cancelled' };
}
const getCost = id => q1('SELECT * FROM costs WHERE id=?', id) || fail(404, 'That cost has been removed');
const costText = (body, was = {}) => { const v = { title: was.title, amount: was.amount, quote_from: was.quote_from, details: was.details, ...body };
  const title = String(v.title || '').trim(), amount = v.amount === '' || v.amount == null ? null : Number(v.amount);
  if (!title) fail(400, 'Say what it is'); if (amount != null && (isNaN(amount) || amount < 0)) fail(400, 'Enter the cost in pounds, or leave it blank');
  return { title: title.slice(0, 200), amount: amount == null ? null : round2(amount), quote_from: String(v.quote_from || '').trim().slice(0, 200) || null, details: String(v.details || '').trim().slice(0, 3000) || null }; };
// a cost's line in a year's budget: its type is One-off, so copying the year leaves it behind
function costLine(c, year, funding, amount) {
  const sort = ((q1('SELECT MAX(sort) m FROM budget_items WHERE year=?', year) || {}).m || 0) + 1;
  const notes = c.kind === 'maintenance' ? `Maintenance${c.quote_from ? `: quote from ${c.quote_from}` : ''}` : `Upgrade suggested by ${c.family_id ? `the ${famName(c.family_id)} family` : nameOf(c.user_id)}`;
  return Number(run('INSERT INTO budget_items (year,category,description,amount,sort,notes,funding) VALUES (?,?,?,?,?,?,?)', year, 'One-off', c.title, amount, sort, notes, funding).lastInsertRowid);
}
// who to tell about a cost: whoever suggested it or added the quote, and whoever reported the maintenance issue
const costPeople = c => [c.user_id, ...(c.issue_id ? [(q1('SELECT user_id FROM maintenance_issues WHERE id=?', c.issue_id) || {}).user_id] : [])].filter(Boolean);
const tellAboutCost = (c, user, text) => notify(costPeople(c).filter(i => i !== user.id), text, c.kind === 'maintenance' ? '#/maintenance' : '#/upgrades');
// the years whose issued charges no longer match their budget after a change: the site admin is offered a re-issue, with the
// charge per week the budget now works out at (and the rounded one set on Payments, if there is one)
const reissueYears = (...ys) => [...new Set(ys.filter(y => y && isIssued(y)))].map(y => { const b = budgetSummary(y); return { year: y, fixed: b.rate_per_week, calc: b.rate_calc }; });

route('GET', '/api/costs', ({ user }) => {
  need(user, user && (isFamily(user) || user.is_site_admin), 'Costs are for the syndicate families');
  const rows = q(`SELECT * FROM costs WHERE status='waiting' OR (status='adopted' AND COALESCE(year,0) >= ?) OR COALESCE(updated_at, created_at) >= date('now','-12 months')
    ORDER BY CASE status WHEN 'waiting' THEN 0 WHEN 'adopted' THEN 1 ELSE 2 END, created_at DESC, id DESC`, thisYear() - 1);
  return { costs: rows.map(c => costView(c, user)), years: costYears(), now_year: thisYear(), forward_year: firstUnissued(), issued: costYears().filter(isIssued),
    bank: latestBank(), can_suggest: isFamily(user) || !!user.is_site_admin, can_adopt: !!user.is_site_admin };
});
// anyone in the families suggests an upgrade; the site admin can also add a maintenance cost directly (from a works list, say)
route('POST', '/api/costs', ({ user, body }) => {
  need(user, user && (isFamily(user) || user.is_site_admin), 'Only the syndicate families can suggest upgrades');
  const t = costText(body), kind = user.is_site_admin && body.kind === 'maintenance' ? 'maintenance' : 'upgrade';
  const id = Number(run('INSERT INTO costs (kind,family_id,user_id,title,amount,quote_from,details) VALUES (?,?,?,?,?,?,?)', kind, isFamily(user) ? user.family_id : null, user.id, t.title, t.amount, t.quote_from, t.details).lastInsertRowid);
  if (!user.is_site_admin) notify(siteAdmins(), `${user.name} (${famName(user.family_id)}) suggested an upgrade: ${t.title}${t.amount != null ? ` (about ${moneyText(t.amount)})` : ''}. It’s waiting on the Service charge page.`, '#/admin/service-charge');
  audit(user.id, 'cost.add', { id, kind, title: t.title, amount: t.amount }); return { id };
});
// edit: whoever suggested it, while it waits; the site admin, while it waits or is adopted (its budget line follows)
route('PUT', '/api/costs/:id', ({ user, params, body }) => {
  const c = getCost(params.id); need(user, user && costView(c, user).can_edit, 'Only whoever suggested it can change it, while it’s waiting');
  const t = costText(body, c);
  if (c.status === 'adopted' && !(t.amount > 0)) fail(400, 'An adopted cost needs an amount');
  tx(() => {
    run("UPDATE costs SET title=?, amount=?, quote_from=?, details=?, updated_at=datetime('now'), history=? WHERE id=?", t.title, t.amount, t.quote_from, t.details,
      t.amount !== c.amount ? withHistory(c, user, c.amount == null ? `Cost set at ${moneyText(t.amount)}` : t.amount == null ? 'Cost cleared' : `Cost changed from ${moneyText(c.amount)} to ${moneyText(t.amount)}`) : c.history, c.id);
    if (c.status === 'adopted' && c.budget_item_id) { run('UPDATE budget_items SET description=?, amount=? WHERE id=?', t.title, t.amount, c.budget_item_id); checkBankLines(c.year); }
  });
  audit(user.id, 'cost.edit', { id: c.id, title: t.title, amount: t.amount });
  return { ok: true, reissue: c.status === 'adopted' && c.funding === 'charge' && t.amount !== c.amount ? reissueYears(c.year) : [] };
});
route('POST', '/api/costs/:id/withdraw', ({ user, params }) => {
  const c = getCost(params.id); need(user, user && costView(c, user).can_withdraw, 'Only whoever suggested it can withdraw it, while it’s waiting');
  run("UPDATE costs SET status='withdrawn', updated_at=datetime('now'), history=? WHERE id=?", withHistory(c, user, 'Withdrawn'), c.id);
  audit(user.id, 'cost.withdraw', { id: c.id }); return { ok: true };
});
// adopt: now, paid from the bank balance (within it), or put forward for a year's service charge
route('POST', '/api/admin/costs/:id/adopt', ({ user, params, body }) => {
  needAdmin(user); const c = getCost(params.id); if (c.status !== 'waiting') fail(400, 'Only a cost that’s waiting can be adopted');
  const funding = body.how === 'bank' ? 'bank' : 'charge', year = costYear(body.year || (funding === 'bank' ? thisYear() : firstUnissued()));
  const amount = body.amount === '' || body.amount == null ? c.amount : round2(Number(body.amount)); if (!(amount > 0)) fail(400, 'Enter the amount to adopt');
  const note = String(body.note || '').trim().slice(0, 300);
  const what = funding === 'bank' ? `Adopted: paid from the bank balance in ${year}` : `Put forward for the ${year} service charge`;
  tx(() => {
    const line = costLine({ ...c, amount }, year, funding, amount); if (funding === 'bank') checkBankLines(year);
    run("UPDATE costs SET status='adopted', year=?, funding=?, amount=?, budget_item_id=?, updated_at=datetime('now'), history=? WHERE id=?", year, funding, amount, line,
      withHistory(c, user, `${what} (${moneyText(amount)})${note ? `. ${note}` : ''}`), c.id);
  });
  tellAboutCost(c, user, `“${c.title}” has been adopted (${moneyText(amount)}): ${funding === 'bank' ? `paid from the bank balance in ${year}` : `put forward for the ${year} service charge`}.${note ? ` ${note}` : ''}`);
  audit(user.id, 'cost.adopt', { id: c.id, year, funding, amount }); return { ok: true, reissue: funding === 'charge' ? reissueYears(year) : [] };
});
// bump: back to the waiting list (its line comes out of the budget), or moved to another year
route('POST', '/api/admin/costs/:id/bump', ({ user, params, body }) => {
  needAdmin(user); const c = getCost(params.id); if (c.status !== 'adopted' || c.funding === 'levy') fail(400, 'Only an adopted cost can be bumped');
  const to = body.to === '' || body.to == null ? null : costYear(body.to), note = String(body.note || '').trim().slice(0, 300);
  if (to === c.year) fail(400, `It’s already in ${to}`);
  const where = c.funding === 'bank' ? `the bank balance in ${c.year}` : `the ${c.year} service charge`;
  tx(() => {
    if (to) {
      const sort = ((q1('SELECT MAX(sort) m FROM budget_items WHERE year=?', to) || {}).m || 0) + 1;
      if (c.budget_item_id) run('UPDATE budget_items SET year=?, sort=? WHERE id=?', to, sort, c.budget_item_id); if (c.funding === 'bank') checkBankLines(to);
      run("UPDATE costs SET year=?, updated_at=datetime('now'), history=? WHERE id=?", to, withHistory(c, user, `Moved from ${c.year} to ${to}${note ? `. ${note}` : ''}`), c.id);
    } else {
      if (c.budget_item_id) run('DELETE FROM budget_items WHERE id=?', c.budget_item_id);
      run("UPDATE costs SET status='waiting', year=NULL, funding=NULL, budget_item_id=NULL, updated_at=datetime('now'), history=? WHERE id=?",
        withHistory(c, user, `Bumped from ${where} back to the waiting list${note ? `. ${note}` : ''}`), c.id);
    }
  });
  tellAboutCost(c, user, to ? `“${c.title}” has been moved from ${c.year} to ${to}.${note ? ` ${note}` : ''}` : `“${c.title}” has been bumped from ${where} and is waiting again.${note ? ` ${note}` : ''}`);
  audit(user.id, 'cost.bump', { id: c.id, from: c.year, to }); return { ok: true, reissue: c.funding === 'charge' ? reissueYears(c.year, to) : [] };
});
route('POST', '/api/admin/costs/:id/cancel', ({ user, params, body }) => {
  needAdmin(user); const c = getCost(params.id); if (!costView(c, user).can_cancel) fail(400, 'This cost can’t be cancelled');
  const note = String(body.note || '').trim().slice(0, 300), was = c.status === 'adopted' ? c.year : null;
  tx(() => { if (c.budget_item_id) run('DELETE FROM budget_items WHERE id=?', c.budget_item_id);
    run("UPDATE costs SET status='cancelled', year=NULL, funding=NULL, budget_item_id=NULL, updated_at=datetime('now'), history=? WHERE id=?",
      withHistory(c, user, `Cancelled${was ? ` (it was in ${c.funding === 'bank' ? `the bank balance in ${was}` : `the ${was} service charge`})` : ''}${note ? `. ${note}` : ''}`), c.id); });
  tellAboutCost(c, user, `“${c.title}” has been cancelled.${note ? ` ${note}` : ''}`);
  audit(user.id, 'cost.cancel', { id: c.id }); return { ok: true, reissue: c.funding === 'charge' ? reissueYears(was) : [] };
});
route('POST', '/api/admin/costs/:id/reinstate', ({ user, params }) => {
  needAdmin(user); const c = getCost(params.id); if (c.status !== 'cancelled') fail(400, 'Only a cancelled cost can be reinstated');
  run("UPDATE costs SET status='waiting', updated_at=datetime('now'), history=? WHERE id=?", withHistory(c, user, 'Reinstated: waiting again'), c.id);
  audit(user.id, 'cost.reinstate', { id: c.id }); return { ok: true };
});
// a year's service charge for the families to read: its lines, with where each one-off cost came from
const lineCost = (id, user) => { const c = q1("SELECT * FROM costs WHERE budget_item_id=? AND status='adopted'", id); return c ? costView(c, user) : null; };
route('GET', '/api/service-charge', ({ user, query }) => {
  need(user, user && (isFamily(user) || user.is_site_admin), 'The service charge is for the syndicate families');
  const b = budgetSummary(Number(query.year) || thisYear());
  return { year: b.year, label: b.label, total: b.total, charge_total: b.charge_total, bank_total: b.bank_total, units: b.units, rate: b.rate, generated: b.generated,
    items: b.items.map(i => ({ id: i.id, description: i.description, amount: i.amount, category: i.category, notes: i.notes, funding: i.funding, cost: lineCost(i.id, user) })) };
});

// ---------------------------------------------------------------- shares: offers, interest and the register
// A family admin offers some of the family's shares to the other syndicate families, from a year, at an asking price (the agreed
// price per share by default). Other family admins register interest until the closing date. If more shares are wanted than
// offered, they're shared out in proportion to holdings. The sale itself is completed outside the portal (under the syndicate's
// articles and any shareholders' agreement); the site admin then records it, and the shares (and with them the weeks and the
// service charge) move from the year it takes effect. The site admin can also record a transfer directly, e.g. a holding split
// between the next generation's households.
const shareYears = () => [thisYear(), thisYear() + 1, thisYear() + 2, thisYear() + 3];
const addDaysIso = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const wholeShares = (v, max, what = 'shares') => { const n = Number(v); if (!Number.isInteger(n) || n < 1) fail(400, `Enter a whole number of ${what}`); if (max != null && n > max) fail(400, `That’s more than the ${max} available`); return n; };
const lastShareYear = y => Math.max(y, (q1('SELECT MAX(year) y FROM family_shares') || {}).y || y, (q1('SELECT MAX(year) y FROM weeks') || {}).y || y);
// the fewest shares a family holds from a year onwards (what it could sell from then)
const sharesFrom = (fid, year) => { let m = Infinity; for (let y = year; y <= lastShareYear(year); y++) m = Math.min(m, sharesFor(fid, y)); return m === Infinity ? 0 : m; };
// move shares between families from a year: earlier years are fixed as they were, that year and later ones change
function transferShares(from, to, n, year) {
  const last = lastShareYear(year), ys = []; for (let y = year; y <= last; y++) ys.push(y);
  const fixed = []; for (let y = thisYear(); y < year; y++) for (const f of [from, to]) fixed.push([f, y, sharesFor(f, y)]);
  const before = ys.map(y => [sharesFor(from, y), sharesFor(to, y)]);
  if (before.some(([a]) => a < n)) fail(400, `${famName(from)} doesn’t hold ${n} share${n > 1 ? 's' : ''} in every year from ${year}`);
  for (const [f, y, u] of fixed) run('INSERT OR IGNORE INTO family_shares (family_id,year,units) VALUES (?,?,?)', f, y, u);
  ys.forEach((y, i) => { setShares(from, y, before[i][0] - n); setShares(to, y, before[i][1] + n); });
}
// shared out in proportion to holdings when more are wanted than offered: one share at a time to the family with the most
// shares per share it would get (the d'Hondt method), up to what each asked for; earlier interest first on a tie
function proRata(n, rows) {
  const a = rows.map(r => ({ ...r, n: 0 }));
  for (let k = 0; k < n; k++) { const c = a.filter(r => r.n < r.shares); if (!c.length) break;
    c.sort((x, y) => y.holding / (y.n + 1) - x.holding / (x.n + 1) || x.created_at.localeCompare(y.created_at)); c[0].n++; }
  return Object.fromEntries(a.map(r => [r.family_id, r.n]));
}
function offerView(o, user) {
  const admin = !!user.is_site_admin, mineFam = isFamily(user) && user.family_id === o.family_id, famAdmin = isFamily(user) && user.role === 'family_admin';
  const open = o.status === 'open', taking = open && o.closes_on >= today();
  const ints = q("SELECT * FROM share_interests WHERE offer_id=? AND status<>'withdrawn' ORDER BY created_at, id", o.id)
    .map(i => ({ id: i.id, family_id: i.family_id, family: famName(i.family_id), shares: i.shares, note: i.note, status: i.status, allotted: i.allotted, created_at: i.created_at, by: nameOf(i.user_id), holding: sharesFor(i.family_id, thisYear()) }));
  const live = ints.filter(i => i.status === 'open'), wanted = live.reduce((t, i) => t + i.shares, 0), mine = isFamily(user) ? live.find(i => i.family_id === user.family_id) : null;
  return { id: o.id, family_id: o.family_id, family: famName(o.family_id), by: nameOf(o.user_id), shares: o.shares, price: o.price, from_year: o.from_year, closes_on: o.closes_on,
    note: o.note, status: o.status, outcome: o.outcome, created_at: o.created_at, taking, interests: ints, wanted, oversubscribed: wanted > o.shares,
    suggestion: admin && open ? proRata(o.shares, live) : null, my_interest: mine || null,
    can_withdraw: open && ((mineFam && famAdmin) || admin), can_interest: taking && famAdmin && !mineFam, can_record: admin && open, can_close: admin && open };
}
const getOffer = id => q1('SELECT * FROM share_offers WHERE id=?', id) || fail(404, 'That offer has been removed');
const otherAdmins = fid => q("SELECT u.id FROM users u JOIN families f ON f.id=u.family_id WHERE u.role='family_admin' AND u.active=1 AND f.active=1 AND u.family_id<>?", fid).map(r => r.id);
const sharesText = n => `${n} share${n === 1 ? '' : 's'}`;
route('GET', '/api/shares', ({ user, query }) => {
  need(user, user && (isFamily(user) || user.is_site_admin), 'Shares are for the syndicate families');
  const year = Number(query.year) || thisYear();
  const fams = q('SELECT id, name, color FROM families WHERE active=1 ORDER BY name').map(f => ({ ...f, shares: sharesFor(f.id, year) })), total = fams.reduce((a, f) => a + f.shares, 0) || 1;
  const offers = q(`SELECT * FROM share_offers WHERE status='open' OR COALESCE(updated_at, created_at) >= date('now','-12 months') ORDER BY status<>'open', created_at DESC, id DESC`).map(o => offerView(o, user));
  const transfers = q('SELECT * FROM share_transfers ORDER BY created_at DESC, id DESC LIMIT 50').map(t => ({ ...t, from: famName(t.from_family_id), to: famName(t.to_family_id), by: nameOf(t.created_by) }));
  const mineNow = isFamily(user) ? sharesFrom(user.family_id, thisYear() + 1) : 0, s = settings();
  return { year, register: fams.map(f => ({ ...f, pct: f.shares / total * 100, mine: isFamily(user) && f.id === user.family_id })), total: fams.reduce((a, f) => a + f.shares, 0),
    price: Number(s.share_price) || null, offer_days: Number(s.share_offer_days) || 28, years: shareYears(), offers, transfers,
    can_offer: isFamily(user) && user.role === 'family_admin' && mineNow > 0 && !q1("SELECT 1 FROM share_offers WHERE family_id=? AND status='open'", user.family_id),
    my_shares: isFamily(user) ? mineNow : null, can_record: !!user.is_site_admin, families: user.is_site_admin ? q('SELECT id, name FROM families WHERE active=1 ORDER BY name') : [] };
});
route('POST', '/api/shares/offers', ({ user, body }) => {
  need(user, user && isFamily(user) && user.role === 'family_admin', 'Only a family admin can offer the family’s shares');
  if (q1("SELECT 1 FROM share_offers WHERE family_id=? AND status='open'", user.family_id)) fail(400, 'Your family already has shares on offer');
  const year = Number(body.from_year); if (!shareYears().includes(year)) fail(400, 'Choose the year the sale would take effect from');
  const n = wholeShares(body.shares, sharesFrom(user.family_id, year)), price = body.price === '' || body.price == null ? Number(settings().share_price) || null : round2(Number(body.price));
  if (price != null && (isNaN(price) || price < 0)) fail(400, 'Enter the asking price per share');
  const closes = /^\d{4}-\d{2}-\d{2}$/.test(String(body.closes_on || '')) ? body.closes_on : addDaysIso(today(), Number(settings().share_offer_days) || 28);
  if (closes < today()) fail(400, 'The closing date has to be today or later');
  const note = String(body.note || '').trim().slice(0, 1000) || null, fam = famName(user.family_id);
  const id = Number(run('INSERT INTO share_offers (family_id,user_id,shares,price,from_year,closes_on,note) VALUES (?,?,?,?,?,?,?)', user.family_id, user.id, n, price, year, closes, note).lastInsertRowid);
  notify([...otherAdmins(user.family_id), ...siteAdmins()], `The ${fam} family is offering ${sharesText(n)} for sale${price != null ? ` at ${moneyText(price)} a share` : ''}, from ${year}. Register interest on the Shares page by ${fmtDate(closes)}.`, '#/shares');
  audit(user.id, 'shares.offer', { id, shares: n, price, from_year: year }); return { id };
});
route('POST', '/api/shares/offers/:id/withdraw', ({ user, params }) => {
  const o = getOffer(params.id); need(user, user && offerView(o, user).can_withdraw, 'Only the family offering them can withdraw the offer');
  run("UPDATE share_offers SET status='withdrawn', updated_at=datetime('now') WHERE id=?", o.id);
  const ints = q("SELECT DISTINCT family_id FROM share_interests WHERE offer_id=? AND status='open'", o.id).map(r => r.family_id);
  notify(ints.flatMap(f => familyAdmins(f)), `The ${famName(o.family_id)} family has withdrawn its offer of ${sharesText(o.shares)}.`, '#/shares');
  audit(user.id, 'shares.offer_withdraw', { id: o.id }); return { ok: true };
});
// another family's admin: how many shares the family would like (asking again changes it)
route('POST', '/api/shares/offers/:id/interest', ({ user, params, body }) => {
  const o = getOffer(params.id); need(user, user && offerView(o, user).can_interest, o.closes_on < today() ? 'This offer has closed for interest' : 'Only another family’s admin can register interest');
  const n = wholeShares(body.shares, o.shares), note = String(body.note || '').trim().slice(0, 1000) || null;
  const was = q1("SELECT * FROM share_interests WHERE offer_id=? AND family_id=? AND status='open'", o.id, user.family_id);
  if (was) run('UPDATE share_interests SET shares=?, note=?, user_id=? WHERE id=?', n, note, user.id, was.id);
  else run('INSERT INTO share_interests (offer_id,family_id,user_id,shares,note) VALUES (?,?,?,?,?)', o.id, user.family_id, user.id, n, note);
  notify([...familyAdmins(o.family_id), ...siteAdmins()], `The ${famName(user.family_id)} family would like ${sharesText(n)} of the ${famName(o.family_id)} family’s shares on offer.${note ? ` “${note}”` : ''}`, '#/shares');
  audit(user.id, 'shares.interest', { offer: o.id, shares: n }); return { ok: true };
});
route('POST', '/api/shares/interests/:id/withdraw', ({ user, params }) => {
  const i = q1("SELECT * FROM share_interests WHERE id=? AND status='open'", params.id) || fail(404, 'That interest has already been dealt with');
  need(user, user && isFamily(user) && user.role === 'family_admin' && user.family_id === i.family_id, 'Only the family that registered it can withdraw it');
  run("UPDATE share_interests SET status='withdrawn' WHERE id=?", i.id); audit(user.id, 'shares.interest_withdraw', { id: i.id }); return { ok: true };
});
// the site admin records the sale once it's complete: who gets how many, at what price, from which year
route('POST', '/api/admin/shares/offers/:id/record', ({ user, params, body }) => {
  needAdmin(user); const o = getOffer(params.id); if (o.status !== 'open') fail(400, 'This offer is no longer open');
  const year = Number(body.from_year) || o.from_year; if (!shareYears().includes(year)) fail(400, 'Choose the year the sale takes effect from');
  const allot = Object.entries(body.allot || {}).map(([f, n]) => [Number(f), Number(n) || 0]).filter(([f, n]) => n > 0);
  if (!allot.length) fail(400, 'Say which families get the shares');
  const total = allot.reduce((t, [, n]) => t + n, 0); if (allot.some(([, n]) => !Number.isInteger(n))) fail(400, 'Shares are whole numbers'); if (total > o.shares) fail(400, `That’s ${total} shares; ${sharesText(o.shares)} were offered`);
  if (allot.some(([f]) => f === o.family_id || !q1('SELECT 1 FROM families WHERE id=? AND active=1', f))) fail(400, 'Choose another syndicate family for each buyer');
  const price = body.price === '' || body.price == null ? o.price : round2(Number(body.price)), note = String(body.note || '').trim().slice(0, 500) || null;
  const outcome = `${allot.map(([f, n]) => `${n} to ${famName(f)}`).join(', ')}${price != null ? ` at ${moneyText(price)} a share` : ''}, from ${year}`;
  tx(() => {
    for (const [f, n] of allot) { transferShares(o.family_id, f, n, year); run('INSERT INTO share_transfers (from_family_id,to_family_id,shares,price,from_year,offer_id,note,created_by) VALUES (?,?,?,?,?,?,?,?)', o.family_id, f, n, price, year, o.id, note, user.id); }
    for (const i of q("SELECT * FROM share_interests WHERE offer_id=? AND status='open'", o.id)) { const got = (allot.find(([f]) => f === i.family_id) || [])[1] || 0;
      run('UPDATE share_interests SET status=?, allotted=? WHERE id=?', got ? 'accepted' : 'declined', got || null, i.id); }
    run("UPDATE share_offers SET status='sold', outcome=?, updated_at=datetime('now') WHERE id=?", outcome, o.id);
  });
  const who = [o.family_id, ...allot.map(([f]) => f), ...q("SELECT family_id f FROM share_interests WHERE offer_id=? AND status='declined'", o.id).map(r => r.f)];
  notify([...new Set(who)].flatMap(f => familyAdmins(f)), `The sale of the ${famName(o.family_id)} family’s shares has been recorded: ${outcome}. Weeks and the service charge follow the shares from ${year}.`, '#/shares');
  audit(user.id, 'shares.record', { offer: o.id, allot, price, year });
  return { ok: true, reissue: reissueYears(...shareYears().filter(y => y >= year)) };
});
route('POST', '/api/admin/shares/offers/:id/close', ({ user, params, body }) => {
  needAdmin(user); const o = getOffer(params.id); if (o.status !== 'open') fail(400, 'This offer is no longer open');
  const note = String(body.note || '').trim().slice(0, 300) || null;
  run("UPDATE share_offers SET status='closed', outcome=?, updated_at=datetime('now') WHERE id=?", note || 'Closed without a sale', o.id);
  run("UPDATE share_interests SET status='declined' WHERE offer_id=? AND status='open'", o.id);
  const who = [o.family_id, ...q('SELECT DISTINCT family_id f FROM share_interests WHERE offer_id=?', o.id).map(r => r.f)];
  notify([...new Set(who)].flatMap(f => familyAdmins(f)), `The ${famName(o.family_id)} family’s offer of ${sharesText(o.shares)} has been closed without a sale.${note ? ` ${note}` : ''}`, '#/shares');
  audit(user.id, 'shares.close', { offer: o.id }); return { ok: true };
});
// a transfer with no offer: a holding split between households, a gift, or a sale agreed another way
route('POST', '/api/admin/shares/transfers', ({ user, body }) => {
  needAdmin(user); const from = Number(body.from_family_id), to = Number(body.to_family_id), year = Number(body.from_year);
  if (!from || !to || from === to || !q1('SELECT 1 FROM families WHERE id=?', from) || !q1('SELECT 1 FROM families WHERE id=? AND active=1', to)) fail(400, 'Choose two different families');
  if (!shareYears().includes(year)) fail(400, 'Choose the year it takes effect from');
  const n = wholeShares(body.shares), price = body.price === '' || body.price == null ? null : round2(Number(body.price)), note = String(body.note || '').trim().slice(0, 500) || null;
  tx(() => { transferShares(from, to, n, year); run('INSERT INTO share_transfers (from_family_id,to_family_id,shares,price,from_year,note,created_by) VALUES (?,?,?,?,?,?,?)', from, to, n, price, year, note, user.id); });
  notify([...familyAdmins(from), ...familyAdmins(to)], `${sharesText(n)} recorded as moving from the ${famName(from)} family to the ${famName(to)} family, from ${year}. Weeks and the service charge follow the shares.`, '#/shares');
  audit(user.id, 'shares.transfer', { from, to, shares: n, price, year }); return { ok: true, reissue: reissueYears(...shareYears().filter(y => y >= year)) };
});

// ---------------------------------------------------------------- the manifesto
// "Nab Camas 2.0": the proposal for how the syndicate runs, as a page the families read, comment on and suggest wording for. Its text
// is Markdown, first loaded from content/manifesto.md; the site admin edits it (the text before each edit is kept), accepts or
// declines suggestions and resolves comments. Family members and admins comment, suggest and reply.
const MANIFESTO_FILE = path.join(__dirname, 'content', 'manifesto.md');
if (!q1("SELECT 1 FROM documents WHERE slug='manifesto'") && fs.existsSync(MANIFESTO_FILE))
  run("INSERT INTO documents (slug,title,body,updated_at) VALUES ('manifesto','Nab Camas 2.0 Manifesto',?,datetime('now'))", fs.readFileSync(MANIFESTO_FILE, 'utf8'));
// the text as blocks: headings, paragraphs, list items (each its own block) and tables, with the lines each came from
function mdBlocks(md) {
  const L = md.replace(/\r/g, '').split('\n'), out = [], item = /^(\s*)([-*]|\d+\.)\s+(\[[ xX]\]\s+)?(.*)$/, special = l => /^#{1,3}\s/.test(l) || /^\s*\|/.test(l) || /^\s*([-*]|\d+\.)\s+/.test(l);
  for (let i = 0; i < L.length;) {
    const l = L[i]; let m;
    if (!l.trim()) { i++; continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { out.push({ type: 'h' + m[1].length, text: m[2].trim(), start: i, end: i + 1, prefix: m[1] + ' ' }); i++; continue; }
    if (/^\s*\|/.test(l)) { const s = i; while (i < L.length && /^\s*\|/.test(L[i])) i++; out.push({ type: 'table', text: L.slice(s, i).join('\n'), start: s, end: i, prefix: '' }); continue; }
    if ((m = item.exec(l))) { const s = i; let text = m[4]; i++; while (i < L.length && L[i].trim() && !special(L[i])) text += ' ' + L[i++].trim();
      out.push({ type: /\d/.test(m[2]) ? 'ol' : 'ul', level: m[1].length >= 2 ? 2 : 1, num: /\d/.test(m[2]) ? parseInt(m[2]) : null, text, start: s, end: i, prefix: `${m[1]}${m[2]} ` }); continue; }
    const s = i; let text = l.trim(); i++; while (i < L.length && L[i].trim() && !special(L[i])) text += ' ' + L[i++].trim();
    out.push({ type: 'p', text, start: s, end: i, prefix: '' });
  }
  return out.map((b, k) => ({ ...b, i: k }));
}
const getDoc = () => q1("SELECT * FROM documents WHERE slug='manifesto'") || fail(404, 'The manifesto hasn’t been loaded yet');
const canComment = u => !!u && (isFamily(u) || !!u.is_site_admin);
// a block by its wording, nearest to where it was if the same wording appears twice
const findBlock = (blocks, text, near) => blocks.filter(b => b.text === text).sort((x, y) => Math.abs(x.i - near) - Math.abs(y.i - near))[0] || null;
function saveDoc(user, body) {
  const d = getDoc(); if (body === d.body) return;
  run('INSERT INTO document_versions (slug,body,edited_by,edited_at) VALUES (?,?,?,?)', 'manifesto', d.body, d.updated_by, d.updated_at);
  run("UPDATE documents SET body=?, updated_by=?, updated_at=datetime('now') WHERE slug='manifesto'", body, user.id);
}
route('GET', '/api/manifesto', ({ user }) => {
  need(user, canComment(user), 'The manifesto is for the syndicate families');
  const d = getDoc(), blocks = mdBlocks(d.body), admin = !!user.is_site_admin;
  const rows = q("SELECT * FROM document_comments WHERE slug='manifesto' ORDER BY created_at, id");
  const view = c => ({ id: c.id, kind: c.kind, text: c.text, suggestion: c.suggestion, status: c.status, block_text: c.block_text, by: nameOf(c.user_id), family: c.family_id ? famName(c.family_id) : null,
    created_at: c.created_at, resolved_by: nameOf(c.resolved_by), resolved_at: c.resolved_at, can_delete: admin || (c.user_id === user.id && c.status === 'open'), replies: [] });
  const top = rows.filter(c => !c.parent_id).map(view), byId = Object.fromEntries(top.map(c => [c.id, c]));
  for (const r of rows.filter(c => c.parent_id)) if (byId[r.parent_id]) byId[r.parent_id].replies.push(view(r));
  const on = blocks.map(() => []), general = [], orphans = [];
  for (const c of top) { const raw = rows.find(r => r.id === c.id);
    if (raw.block_index === -1 || raw.block_text == null) { general.push(c); continue; }
    const b = findBlock(blocks, raw.block_text, raw.block_index); (b ? on[b.i] : orphans).push(c); }
  return { title: d.title, updated_at: d.updated_at, updated_by: nameOf(d.updated_by), blocks: blocks.map(b => ({ i: b.i, type: b.type, level: b.level, num: b.num, text: b.text, comments: on[b.i] })),
    general, orphans, open: top.filter(c => c.status === 'open').length, can_comment: canComment(user), can_manage: admin };
});
route('POST', '/api/manifesto/comments', ({ user, body }) => {
  need(user, canComment(user), 'Only the syndicate families can comment on the manifesto');
  const text = String(body.text || '').trim().slice(0, 3000) || null, who = `${user.name}${isFamily(user) ? ` (${famName(user.family_id)})` : ''}`;
  if (body.parent_id) {   // a reply: everyone in the thread, and the site admin, is told
    const p = q1("SELECT * FROM document_comments WHERE id=? AND parent_id IS NULL AND slug='manifesto'", body.parent_id) || fail(404, 'That comment has been removed'); if (!text) fail(400, 'Write your reply');
    const id = Number(run("INSERT INTO document_comments (slug,parent_id,kind,text,user_id,family_id) VALUES ('manifesto',?,'reply',?,?,?)", p.id, text, user.id, isFamily(user) ? user.family_id : null).lastInsertRowid);
    const people = [p.user_id, ...q('SELECT user_id FROM document_comments WHERE parent_id=?', p.id).map(r => r.user_id), ...siteAdmins()];
    notify([...new Set(people)].filter(i => i !== user.id), `${who} replied on the Manifesto: “${text.slice(0, 160)}${text.length > 160 ? '…' : ''}”`, '#/manifesto');
    audit(user.id, 'manifesto.reply', { id, parent: p.id }); return { id };
  }
  const blocks = mdBlocks(getDoc().body), at = Number(body.block), b = at === -1 ? null : blocks[at] || fail(400, 'That part of the manifesto has changed: reload the page');
  const kind = body.kind === 'suggestion' ? 'suggestion' : 'comment', suggestion = kind === 'suggestion' ? String(body.suggestion || '').trim().slice(0, 5000) : null;
  if (kind === 'suggestion') { if (!b || b.type === 'table') fail(400, 'Suggest wording for a heading, paragraph or point'); if (!suggestion || suggestion === b.text) fail(400, 'Change the wording to suggest something different'); }
  else if (!text) fail(400, 'Write your comment');
  const id = Number(run("INSERT INTO document_comments (slug,block_text,block_index,kind,text,suggestion,user_id,family_id) VALUES ('manifesto',?,?,?,?,?,?,?)",
    b ? b.text : null, b ? b.i : -1, kind, text, suggestion, user.id, isFamily(user) ? user.family_id : null).lastInsertRowid);
  notify(siteAdmins().filter(i => i !== user.id), `${who} ${kind === 'suggestion' ? 'suggested new wording for' : 'commented on'} the Manifesto${b ? `: “${b.text.replace(/\*\*/g, '').slice(0, 80)}…”` : ''}.`, '#/manifesto');
  audit(user.id, 'manifesto.' + kind, { id, block: b ? b.i : -1 }); return { id };
});
route('DELETE', '/api/manifesto/comments/:id', ({ user, params }) => {
  const c = q1("SELECT * FROM document_comments WHERE id=? AND slug='manifesto'", params.id) || fail(404, 'That comment has already gone');
  need(user, user && (user.is_site_admin || (c.user_id === user.id && c.status === 'open')), 'Only whoever wrote it can delete it, while it’s open');
  run('DELETE FROM document_comments WHERE id=? OR parent_id=?', c.id, c.id); audit(user.id, 'manifesto.delete', { id: c.id }); return { ok: true };
});
// the site admin: accept a suggestion (its wording goes into the text), decline it, resolve a comment, or reopen
route('POST', '/api/manifesto/comments/:id/resolve', ({ user, params, body }) => {
  needAdmin(user); const c = q1("SELECT * FROM document_comments WHERE id=? AND parent_id IS NULL AND slug='manifesto'", params.id) || fail(404, 'That comment has been removed');
  const action = String(body.action || ''), who = nameOf(c.user_id);
  if (action === 'reopen') { run('UPDATE document_comments SET status=?, resolved_by=NULL, resolved_at=NULL WHERE id=?', 'open', c.id); return { ok: true }; }
  if (c.status !== 'open') fail(400, 'This has already been dealt with');
  if (action === 'accept') {
    if (c.kind !== 'suggestion') fail(400, 'Only a suggestion can be accepted');
    const d = getDoc(), blocks = mdBlocks(d.body), b = findBlock(blocks, c.block_text, c.block_index);
    if (!b) fail(400, 'That wording has changed since the suggestion was made. Edit the text instead, then resolve it');
    const lines = d.body.replace(/\r/g, '').split('\n'); lines.splice(b.start, b.end - b.start, b.prefix + c.suggestion.replace(/\s*\n\s*/g, ' '));
    tx(() => { saveDoc(user, lines.join('\n')); run("UPDATE document_comments SET status='accepted', block_text=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?", c.suggestion.replace(/\s*\n\s*/g, ' '), user.id, c.id); });
  } else if (action === 'decline' || action === 'resolve') {
    if (action === 'decline' && c.kind !== 'suggestion') fail(400, 'Mark a comment as resolved instead');
    run("UPDATE document_comments SET status=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?", action === 'decline' ? 'declined' : 'resolved', user.id, c.id);
  } else fail(400, 'Choose what to do with it');
  const note = String(body.note || '').trim().slice(0, 1000);
  if (note) run("INSERT INTO document_comments (slug,parent_id,kind,text,user_id) VALUES ('manifesto',?,'reply',?,?)", c.id, note, user.id);
  if (c.user_id !== user.id) notify([c.user_id], { accept: 'Your suggestion on the Manifesto was accepted, and the wording has been changed.', decline: 'Your suggestion on the Manifesto wasn’t taken up this time.', resolve: 'Your comment on the Manifesto has been marked as resolved.' }[action] + (note ? ` ${note}` : ''), '#/manifesto');
  audit(user.id, 'manifesto.' + action, { id: c.id, by: who }); return { ok: true };
});
route('PUT', '/api/manifesto', ({ user, body }) => {
  needAdmin(user); const text = String(body.body || '').replace(/\r/g, ''); if (text.trim().length < 20) fail(400, 'The text looks empty');
  saveDoc(user, text); audit(user.id, 'manifesto.edit', { length: text.length }); return { ok: true };
});
route('GET', '/api/manifesto/text', ({ user }) => { needAdmin(user); const d = getDoc(); return { body: d.body }; });
route('GET', '/api/manifesto/versions', ({ user }) => { needAdmin(user); return q("SELECT v.id, v.body, v.edited_at, u.name edited_by FROM document_versions v LEFT JOIN users u ON u.id=v.edited_by WHERE v.slug='manifesto' ORDER BY v.id DESC LIMIT 30"); });

// ---------------------------------------------------------------- maintenance
// Anyone who logs in can report a problem at the house. Families see every report (so nothing is reported twice); trusted friends
// see their own. The site admin keeps each one up to date. A quote for the work is a cost, waiting on the Service charge page.
const AREAS = ['Kitchen', 'Bathrooms', 'Bedrooms', 'Living areas', 'Heating and hot water', 'Water and drainage', 'Electrics and Wi-Fi', 'Roof, walls and windows', 'Outside, garden and drive', 'Safety (alarms, extinguishers)', 'Other'];
const URGENCY = { urgent: 'Urgent', soon: 'Needs fixing soon', whenever: 'When convenient' };
const ISSUE_STATUS = { open: 'Reported', in_hand: 'In hand', fixed: 'Fixed', closed: 'Closed' };
const canSeeIssue = (user, i) => !!user && (isFamily(user) || user.is_site_admin || i.user_id === user.id);
const issuePhoto = v => { if (v == null || v === '') return null;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(v)); if (!m) fail(400, 'Please choose a JPEG, PNG or WebP photo');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 3e6) fail(413, 'That photo is too large'); return { buf, type: 'image/' + m[1] }; };
const issueText = (body, was = {}) => { const v = { title: was.title, area: was.area, urgency: was.urgency || 'soon', details: was.details, ...body };
  const title = String(v.title || '').trim(); if (!title) fail(400, 'Say what the problem is');
  return { title: title.slice(0, 200), area: AREAS.includes(v.area) ? v.area : 'Other', urgency: URGENCY[v.urgency] ? v.urgency : 'soon', details: String(v.details || '').trim().slice(0, 3000) || null }; };
function issueView(i, user) {
  const by = q1('SELECT name, role FROM users WHERE id=?', i.user_id) || {}, mine = i.user_id === user.id, open = i.status === 'open';
  const c = q1("SELECT * FROM costs WHERE issue_id=? AND status<>'withdrawn' ORDER BY status='cancelled', id DESC LIMIT 1", i.id), cost = c ? costView(c, user) : null;
  const quoter = user.is_site_admin || (isFamily(user) && user.role === 'family_admin');
  return { id: i.id, title: i.title, area: i.area, urgency: i.urgency, details: i.details, status: i.status, update_note: i.update_note, updated_at: i.updated_at, created_at: i.created_at,
    by: by.name || '', by_friend: by.role === 'friend', family: i.family_id ? famName(i.family_id) : null, photo: i.photo_type ? `/media/maintenance/${i.id}?v=${i.photo ? i.photo.length : 0}` : null,
    updated_by: i.updated_by ? (q1('SELECT name FROM users WHERE id=?', i.updated_by) || {}).name : null, cost,
    can_edit: (mine && open) || !!user.is_site_admin, can_withdraw: mine && open && !user.is_site_admin, can_update: !!user.is_site_admin,
    can_quote: quoter && i.status !== 'closed' && (!cost || cost.status === 'waiting' || cost.status === 'cancelled') };
}
route('GET', '/api/maintenance', ({ user }) => {
  need(user, true);
  const rows = q(`SELECT * FROM maintenance_issues WHERE (status IN ('open','in_hand') OR COALESCE(updated_at, created_at) >= date('now','-12 months'))
    ORDER BY status NOT IN ('open','in_hand'), CASE urgency WHEN 'urgent' THEN 0 WHEN 'soon' THEN 1 ELSE 2 END, created_at DESC, id DESC`).filter(i => canSeeIssue(user, i));
  return { issues: rows.map(i => issueView(i, user)), areas: AREAS, urgency: URGENCY, statuses: ISSUE_STATUS, all_reports: isFamily(user) || !!user.is_site_admin };
});
route('POST', '/api/maintenance', ({ user, body }) => {
  need(user, true); const t = issueText(body), ph = issuePhoto(body.photo);
  const id = Number(run('INSERT INTO maintenance_issues (user_id,family_id,title,area,urgency,details,photo,photo_type) VALUES (?,?,?,?,?,?,?,?)',
    user.id, isFamily(user) ? user.family_id : null, t.title, t.area, t.urgency, t.details, ph ? ph.buf : null, ph ? ph.type : null).lastInsertRowid);
  notify(siteAdmins().filter(i => i !== user.id), `${t.urgency === 'urgent' ? 'URGENT: ' : ''}${user.name}${isFamily(user) ? ` (${famName(user.family_id)})` : ''} reported a maintenance issue: ${t.title} (${t.area}).`, '#/maintenance');
  audit(user.id, 'maintenance.report', { id, title: t.title, urgency: t.urgency }); return { id };
});
route('PUT', '/api/maintenance/:id', ({ user, params, body }) => {
  const i = q1('SELECT * FROM maintenance_issues WHERE id=?', params.id) || fail(404, 'Report not found');
  need(user, issueView(i, user).can_edit, 'Only the person who reported it can change it, while it’s waiting');
  const t = issueText(body, i), ph = 'photo' in body ? issuePhoto(body.photo) : undefined;
  run('UPDATE maintenance_issues SET title=?, area=?, urgency=?, details=? WHERE id=?', t.title, t.area, t.urgency, t.details, i.id);
  if (ph !== undefined) run('UPDATE maintenance_issues SET photo=?, photo_type=? WHERE id=?', ph ? ph.buf : null, ph ? ph.type : null, i.id);
  audit(user.id, 'maintenance.edit', { id: i.id, title: t.title }); return { ok: true };
});
route('DELETE', '/api/maintenance/:id', ({ user, params }) => {
  const i = q1('SELECT * FROM maintenance_issues WHERE id=?', params.id) || fail(404, 'Report not found');
  need(user, user && (user.is_site_admin || issueView(i, user).can_withdraw), 'Only the person who reported it can withdraw it, while it’s waiting');
  run('DELETE FROM maintenance_issues WHERE id=?', i.id); audit(user.id, 'maintenance.delete', { id: i.id, title: i.title }); return { ok: true };
});
// the site admin: In hand, Fixed or Closed, with a note the person who reported it is sent
route('POST', '/api/maintenance/:id/status', ({ user, params, body }) => {
  needAdmin(user); const i = q1('SELECT * FROM maintenance_issues WHERE id=?', params.id) || fail(404, 'Report not found');
  const status = ISSUE_STATUS[body.status] ? body.status : fail(400, 'Choose a status'), note = String(body.note || '').trim().slice(0, 1000) || null;
  run("UPDATE maintenance_issues SET status=?, update_note=?, updated_by=?, updated_at=datetime('now') WHERE id=?", status, note, user.id, i.id);
  if (i.user_id !== user.id && (status !== i.status || note !== i.update_note)) notify([i.user_id], `Maintenance: “${i.title}” is ${ISSUE_STATUS[status].toLowerCase()}.${note ? ` ${note}` : ''}`, '#/maintenance');
  audit(user.id, 'maintenance.status', { id: i.id, status, note }); return { ok: true };
});
// a quote for the work, added by a family admin or the site admin: it becomes a cost waiting to be adopted on the Service charge
// page. A new quote while it's still waiting replaces the old one; after a cancellation it starts a new cost.
route('POST', '/api/maintenance/:id/quote', ({ user, params, body }) => {
  const i = q1('SELECT * FROM maintenance_issues WHERE id=?', params.id) || fail(404, 'Report not found');
  need(user, user && canSeeIssue(user, i) && issueView(i, user).can_quote, 'Only a family admin or the site admin can add a quote');
  const t = costText({ title: i.title, ...body }); if (!(t.amount > 0)) fail(400, 'Enter the amount quoted');
  const c = q1("SELECT * FROM costs WHERE issue_id=? AND status='waiting' ORDER BY id DESC LIMIT 1", i.id);
  let id;
  if (c) { id = c.id; run("UPDATE costs SET title=?, amount=?, quote_from=?, details=?, updated_at=datetime('now'), history=? WHERE id=?", t.title, t.amount, t.quote_from, t.details,
    withHistory(c, user, `New quote: ${moneyText(t.amount)}${t.quote_from ? ` from ${t.quote_from}` : ''}${c.amount != null ? ` (was ${moneyText(c.amount)})` : ''}`), c.id); }
  else id = Number(run('INSERT INTO costs (kind,family_id,user_id,issue_id,title,amount,quote_from,details,history) VALUES (?,?,?,?,?,?,?,?,?)', 'maintenance', isFamily(user) ? user.family_id : null, user.id, i.id,
    t.title, t.amount, t.quote_from, t.details, withHistory({}, user, `Quote: ${moneyText(t.amount)}${t.quote_from ? ` from ${t.quote_from}` : ''}`)).lastInsertRowid);
  if (!user.is_site_admin) notify(siteAdmins(), `${user.name} (${famName(user.family_id)}) added a quote for “${i.title}”: ${moneyText(t.amount)}${t.quote_from ? ` from ${t.quote_from}` : ''}. It’s waiting on the Service charge page.`, '#/admin/service-charge');
  audit(user.id, 'maintenance.quote', { id: i.id, cost: id, amount: t.amount }); return { id };
});
// ---------------------------------------------------------------- checking in
// During the week itself, the family whose week it is (or who was given it) says whether they're at the house: Check in, or Not in
// residence. Everyone sees it on the Overview's In residence card. Checking in on an undecided week marks it Using it.
route('POST', '/api/weeks/:id/residence', ({ user, params, body }) => {
  need(user, user && isFamily(user), 'Only the family whose week it is can check in');
  const w = q1('SELECT * FROM weeks WHERE id=?', params.id) || fail(404, 'Week not found'), t = today();
  if (!(w.start_date <= t && w.end_date > t)) fail(400, 'You can only check in during the week itself');
  const b = q1("SELECT * FROM bookings WHERE week_id=? AND status IN ('pending','confirmed')", w.id);
  if (b && !b.gift) fail(400, 'This week is let to guests');
  need(user, (b ? b.buyer_family_id : w.family_id) === user.family_id, 'Only the family whose week it is can check in');
  const state = body.state === 'in' || body.state === 'away' ? body.state : null;
  tx(() => { run("UPDATE weeks SET residence=?, residence_by=?, residence_at=CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END WHERE id=?", state, state ? user.id : null, state, w.id);
    if (state === 'in' && !b && !w.in_use && !w.offer_friends) run('UPDATE weeks SET in_use=1 WHERE id=?', w.id); });
  audit(user.id, 'week.residence', { week: w.id, state }); return { ok: true };
});

// ---------------------------------------------------------------- house guide
// Everyone who logs in can read it and report something wrong or out of date. Anyone in the families can add a guide; family
// admins, the site admin and a guide's author can edit it (the text before each edit is kept) and mark reports as sorted.
const GUIDE_SECTIONS = ['Arriving and leaving', 'Heating and hot water', 'Water and drainage', 'Electrics and Wi-Fi', 'Kitchen and appliances', 'Rubbish and recycling',
  'Safety and emergencies', 'Outside and the garden', 'Local area', 'Other'];
const canAddGuide = u => !!u && (isFamily(u) || !!u.is_site_admin);
const canEditGuide = (u, g) => !!u && (!!u.is_site_admin || u.role === 'family_admin' || (isFamily(u) && g.created_by === u.id));
const nameOf = id => id ? (q1('SELECT name FROM users WHERE id=?', id) || {}).name || '' : '';
const guideText = (body, was = {}) => { const v = { section: was.section, title: was.title, body: was.body, ...body };
  const title = String(v.title || '').trim(), text = String(v.body || '').trim();
  if (!title) fail(400, 'Give the guide a title'); if (!text) fail(400, 'Write the guidance');
  return { section: GUIDE_SECTIONS.includes(v.section) ? v.section : 'Other', title: title.slice(0, 200), body: text.slice(0, 20000) }; };
function guideView(g, user) {
  const edit = canEditGuide(user, g);
  return { id: g.id, section: g.section, title: g.title, body: g.body, photo: g.photo_type ? `/media/guide/${g.id}?v=${g.photo ? g.photo.length : 0}` : null,
    created_by: nameOf(g.created_by), created_at: g.created_at, updated_by: nameOf(g.updated_by), updated_at: g.updated_at,
    versions: q1('SELECT COUNT(*) n FROM guide_versions WHERE guide_id=?', g.id).n, can_edit: edit,
    reports: edit ? q("SELECT r.id, r.note, r.created_at, u.name by_name FROM guide_reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.guide_id=? AND r.status='open' ORDER BY r.id", g.id) : [],
    reported: !!q1("SELECT 1 FROM guide_reports WHERE guide_id=? AND user_id=? AND status='open'", g.id, user.id) };
}
const getGuide = id => q1('SELECT * FROM guides WHERE id=?', id) || fail(404, 'That guide has been removed');
route('GET', '/api/guide', ({ user }) => {
  need(user, true);
  const order = s => { const k = GUIDE_SECTIONS.indexOf(s); return k < 0 ? 99 : k; };
  const guides = q('SELECT * FROM guides').sort((a, b) => order(a.section) - order(b.section) || a.title.localeCompare(b.title)).map(g => guideView(g, user));
  return { sections: GUIDE_SECTIONS, guides, can_add: canAddGuide(user) };
});
route('POST', '/api/guide', ({ user, body }) => {
  need(user, canAddGuide(user), 'Only the families can add to the house guide');
  const t = guideText(body), ph = issuePhoto(body.photo);
  const id = Number(run('INSERT INTO guides (section,title,body,photo,photo_type,created_by) VALUES (?,?,?,?,?,?)', t.section, t.title, t.body, ph ? ph.buf : null, ph ? ph.type : null, user.id).lastInsertRowid);
  audit(user.id, 'guide.add', { id, title: t.title }); return { id };
});
route('PUT', '/api/guide/:id', ({ user, params, body }) => {
  const g = getGuide(params.id); need(user, canEditGuide(user, g), 'Only a family admin, or whoever wrote it, can edit a guide. You can report an inaccuracy instead.');
  const t = guideText(body, g), ph = 'photo' in body ? issuePhoto(body.photo) : undefined;
  tx(() => {
    if (t.section !== g.section || t.title !== g.title || t.body !== g.body)
      run('INSERT INTO guide_versions (guide_id,section,title,body,edited_by,edited_at) VALUES (?,?,?,?,?,?)', g.id, g.section, g.title, g.body, g.updated_by || g.created_by, g.updated_at || g.created_at);
    run("UPDATE guides SET section=?, title=?, body=?, updated_by=?, updated_at=datetime('now') WHERE id=?", t.section, t.title, t.body, user.id, g.id);
    if (ph !== undefined) run('UPDATE guides SET photo=?, photo_type=? WHERE id=?', ph ? ph.buf : null, ph ? ph.type : null, g.id);
  });
  audit(user.id, 'guide.edit', { id: g.id, title: t.title }); return { ok: true };
});
route('GET', '/api/guide/:id/versions', ({ user, params }) => {
  const g = getGuide(params.id); need(user, canEditGuide(user, g), 'Only a family admin can see earlier versions');
  return q('SELECT v.*, u.name edited_by_name FROM guide_versions v LEFT JOIN users u ON u.id=v.edited_by WHERE v.guide_id=? ORDER BY v.id DESC', g.id);
});
route('DELETE', '/api/guide/:id', ({ user, params }) => {
  const g = getGuide(params.id); need(user, canEditGuide(user, g), 'Only a family admin, or whoever wrote it, can remove a guide');
  tx(() => { for (const t of ['guide_versions', 'guide_reports']) run(`DELETE FROM ${t} WHERE guide_id=?`, g.id); run('DELETE FROM guides WHERE id=?', g.id); });
  audit(user.id, 'guide.delete', { id: g.id, title: g.title }); return { ok: true };
});
// anyone who reads it can say something's wrong or out of date; family admins see it on their Overview and on the guide
route('POST', '/api/guide/:id/report', ({ user, params, body }) => {
  need(user, true); const g = getGuide(params.id), note = String(body.note || '').trim().slice(0, 2000);
  if (!note) fail(400, 'Say what’s wrong or out of date');
  const id = Number(run('INSERT INTO guide_reports (guide_id,user_id,note) VALUES (?,?,?)', g.id, user.id, note).lastInsertRowid);
  const who = `${user.name}${isFamily(user) ? ` (${famName(user.family_id)})` : ''}`;
  notify([...siteAdmins(), ...(g.created_by && q1("SELECT 1 FROM users WHERE id=? AND active=1 AND role IN ('family_admin','family_member')", g.created_by) ? [g.created_by] : [])].filter(i => i !== user.id),
    `${who} reported an inaccuracy in the house guide, “${g.title}”: ${note}`, '#/guide');
  audit(user.id, 'guide.report', { id, guide: g.id }); return { id };
});
route('POST', '/api/guide/reports/:id/sorted', ({ user, params }) => {
  const r = q1("SELECT * FROM guide_reports WHERE id=? AND status='open'", params.id) || fail(404, 'That report has already been sorted');
  const g = getGuide(r.guide_id); need(user, canEditGuide(user, g), 'Only a family admin can mark a report as sorted');
  run("UPDATE guide_reports SET status='sorted', sorted_by=?, sorted_at=datetime('now') WHERE id=?", user.id, r.id);
  if (r.user_id !== user.id) notify([r.user_id], `Thank you: the house guide, “${g.title}”, has been checked and your report marked as sorted.`, '#/guide');
  audit(user.id, 'guide.report_sorted', { id: r.id, guide: g.id }); return { ok: true };
});
route('GET', '/api/lets', ({ user, query }) => {
  need(user, isFamily(user) || user.is_site_admin, 'Lets are for syndicate families');
  return letsSummary(Number(query.year) || workingYear());
});
// the site admin removes a payment or adjustment recorded by mistake. Lines that belong to a booking are reversed by
// cancelling the booking, and service charges by re-issuing them, so neither can be removed here.
route('DELETE', '/api/admin/ledger/:id', ({ user, params }) => {
  needAdmin(user); const l = q1('SELECT * FROM ledger WHERE id=?', params.id) || fail(404, 'That line has already gone');
  if (l.booking_id) fail(400, 'This line belongs to a booking: cancel the booking on the Lets page instead');
  if (!['payment', 'adjustment'].includes(l.type)) fail(400, 'Service charges are changed by re-issuing them on the Payments page');
  const ref = (l.description.match(/^Top-up received \((.+)\)$/) || [])[1], cur = settings().currency;
  tx(() => {
    run('DELETE FROM ledger WHERE id=?', l.id);
    if (ref) run("UPDATE topups SET status='pending', confirmed_at=NULL, confirmed_by=NULL WHERE reference=? AND status='confirmed'", ref);   // expected again
  });
  notify(familyAdmins(l.family_id), `The site admin removed ${l.type === 'payment' ? `a payment of ${cur}${Math.abs(l.amount)}` : `an adjustment of ${l.amount < 0 ? '−' : ''}${cur}${Math.abs(l.amount)}`} from your ${l.year} account: “${l.description}”.`, '#/account');
  audit(user.id, 'ledger.remove', { id: l.id, family: l.family_id, type: l.type, amount: l.amount, year: l.year, description: l.description });
  return { ok: true, topup: !!ref };
});
route('POST', '/api/admin/ledger', ({ user, body }) => {
  needAdmin(user); const amt = round2(Number(body.amount)); if (!amt) fail(400, 'Amount required');
  const type = body.type === 'payment' ? 'payment' : 'adjustment';
  const fid = Number(body.family_id), year = Number(body.year); if (!q1('SELECT 1 FROM families WHERE id=?', fid)) fail(404, 'No such family'); if (!year) fail(400, 'Year required');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : today(), cur = settings().currency;
  const desc = body.description || (type === 'payment' ? `Payment received ${fmtDate(date)} ${date.slice(0, 4)}, thank you` : 'Adjustment');
  run('INSERT INTO ledger (family_id,year,type,description,amount,created_by,entry_date) VALUES (?,?,?,?,?,?,?)', fid, year, type, desc, type === 'payment' ? -Math.abs(amt) : amt, user.id, date);
  if (type === 'payment') notify(familyAdmins(fid), `Thank you: a payment of ${cur}${Math.abs(amt).toLocaleString('en-GB')} towards your ${year} service charge has been recorded.`, '#/account');
  audit(user.id, 'ledger.' + type, { family: famName(fid), year, amount: amt, date }); return { ok: true };
});
// service charges by year: for each family, the charge, payments, other credits and what's outstanding
route('GET', '/api/admin/charges', ({ user, query }) => {
  needAdmin(user);
  const years = [...new Set([...q("SELECT DISTINCT year FROM ledger WHERE type='service_charge'").map(r => r.year), ...q('SELECT year FROM budget_years UNION SELECT DISTINCT year FROM budget_items UNION SELECT DISTINCT year FROM weeks').map(r => r.year)])].sort();
  const year = Number(query.year) || years.filter(y => q1("SELECT 1 FROM ledger WHERE type='service_charge' AND year=?", y)).pop() || years.pop() || new Date().getFullYear();
  const by = (fid, where) => round2(q1(`SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE family_id=? AND year=? AND ${where}`, fid, year).n);
  const rows = q('SELECT * FROM families WHERE active=1 ORDER BY name').map(f => {
    const charge = by(f.id, "type='service_charge'"), paid = -by(f.id, "type='payment'"), other = by(f.id, "type NOT IN ('service_charge','payment')");
    const last = q1("SELECT COALESCE(entry_date, date(created_at)) d, -amount a FROM ledger WHERE family_id=? AND year=? AND type='payment' ORDER BY COALESCE(entry_date, created_at) DESC, id DESC LIMIT 1", f.id, year);
    return { id: f.id, name: f.name, color: f.color, shares: sharesFor(f.id, year), charge, paid, other, outstanding: round2(charge - paid + other), last_payment: last || null,
      balance: familyBalance(f.id) };
  });
  const by_year = q1('SELECT * FROM budget_years WHERE year=?', year);
  return { year, years: [...new Set([...years, year])].sort(), label: by_year && by_year.label, rate: by_year && by_year.rate_per_week, rows,
    totals: ['charge', 'paid', 'other', 'outstanding'].reduce((t, k) => (t[k] = round2(rows.reduce((a, r) => a + r[k], 0)), t), {}) };
});
// the syndicate's bank balance by date
route('GET', '/api/admin/bank-balances', ({ user }) => { needAdmin(user); return q('SELECT b.*, u.name by_name FROM bank_balances b LEFT JOIN users u ON u.id=b.created_by ORDER BY as_of DESC, id DESC LIMIT 50'); });
route('POST', '/api/admin/bank-balances', ({ user, body }) => {
  needAdmin(user); const amount = Number(body.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.as_of || '')) fail(400, 'Choose the date of the balance'); if (body.amount === '' || body.amount == null || isNaN(amount)) fail(400, 'Enter the balance');
  const id = run('INSERT INTO bank_balances (as_of,amount,note,created_by) VALUES (?,?,?,?)', body.as_of, round2(amount), body.note || null, user.id).lastInsertRowid;
  audit(user.id, 'bank_balance.add', { as_of: body.as_of, amount }); return { id };
});
route('DELETE', '/api/admin/bank-balances/:id', ({ user, params }) => { needAdmin(user); run('DELETE FROM bank_balances WHERE id=?', params.id); audit(user.id, 'bank_balance.delete', { id: params.id }); return { ok: true }; });
route('GET', '/api/admin/audit', ({ user }) => { needAdmin(user); return q('SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200'); });

// ---------------------------------------------------------------- server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/media/hero') {
    if (!fs.existsSync(HERO_FILE)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(HERO_FILE).pipe(res);
  }
  const mp = /^\/media\/maintenance\/(\d+)$/.exec(url.pathname);
  if (mp) {   // a maintenance report's photo, for whoever can see the report
    const u = currentUser(req), i = q1('SELECT user_id, photo, photo_type FROM maintenance_issues WHERE id=?', mp[1]);
    if (!i || !i.photo_type || !canSeeIssue(u, i)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': i.photo_type, 'Cache-Control': 'private, max-age=86400' }); return res.end(Buffer.from(i.photo));
  }
  const gp = /^\/media\/guide\/(\d+)$/.exec(url.pathname);
  if (gp) {   // a house guide photo, for anyone logged in
    const g = currentUser(req) && q1('SELECT photo, photo_type FROM guides WHERE id=?', gp[1]);
    if (!g || !g.photo_type) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': g.photo_type, 'Cache-Control': 'private, max-age=86400' }); return res.end(Buffer.from(g.photo));
  }
  if (url.pathname === '/api/admin/backup') {   // a copy of the whole database, for the site admin to keep
    const u = currentUser(req); if (!u || !u.is_site_admin) { res.writeHead(403); return res.end('Site admin only'); }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="nabcamas-backup-${today()}.db"` });
    return fs.createReadStream(DB_FILE).pipe(res);
  }
  if (!url.pathname.startsWith('/api/')) {
    let p = path.normalize(path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname));
    if (!p.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(__dirname, 'public', 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(p).pipe(res);
  }
  try {
    let body = {};
    if (req.method !== 'GET') {
      if (!(req.headers['content-type'] || '').includes('application/json')) fail(415, 'JSON required'); // also blocks cross-site form posts
      const chunks = []; let size = 0; for await (const c of req) { size += c.length; if (size > 5e6) fail(413, 'Too large'); chunks.push(c); }
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    }
    contactMemo = new Map();
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname)); if (!r) fail(404, 'Not found');
    const params = url.pathname.match(r.re).groups || {};
    const user = currentUser(req); actingAdmin = user && user.viewer || null;
    const pending = r.handler({ req, res, body, params, query: Object.fromEntries(url.searchParams), user }); actingAdmin = null;
    const out = await pending;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out ?? {}));
  } catch (e) {
    if (!e.status) console.error(e);
    res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.status ? e.message : 'Server error' }));
  }
});

// ---------------------------------------------------------------- demo seed (first run only)
// Assumed English school holidays for the demo years; the site admin checks and adjusts them under Weeks.
const SCHOOL_HOLIDAYS = { 2026: [8, 14, 15, 22, 31, 32, 33, 34, 35, 36, 44, 52, 53], 2027: [7, 13, 14, 22, 30, 31, 32, 33, 34, 35, 43, 51, 52] };
const palette = ['#2f7d6d', '#c0603f', '#4a6fa5', '#b08a2e', '#7b5ea7', '#3e8e9e', '#a0485e', '#6b8f3a'];
if (!q1('SELECT 1 FROM families')) {
  console.log('First run: loading syndicate families, the 2026 & 2027 allocations, the 2026 budget and demo logins…');
  // From "Draft allocation 2027 draft 1A". Share units = weeks held.
  const ALLOC_2027 = [[1, "Lunt/Hall", ""], [2, "Ekserdjian", ""], [3, "Bonar", ""], [4, "Howarth", ""], [5, "Mackay", ""], [6, "Ekserdjian", ""], [7, "White", "School Half-term"], [8, "White", ""], [9, "Ekserdjian", ""], [10, "Ekserdjian", ""], [11, "Mackay", ""], [12, "Mackay", "Switch to Sat changeover"], [13, "Bonar", "Easter Day March 28"], [14, "Howarth", ""], [15, "Mackay", ""], [16, "Mackay", ""], [17, "Bonar", ""], [18, "Lunt/Hall", "May Bank Holiday May 3"], [19, "Bonar", ""], [20, "Bonar", ""], [21, "Howarth", ""], [22, "Howarth", "School Half-term Spring BH"], [23, "Lunt/Hall", ""], [24, "Lunt/Hall", ""], [25, "Mackay", ""], [26, "Mackay", ""], [27, "Ekserdjian", ""], [28, "Ekserdjian", ""], [29, "Lunt/Hall", ""], [30, "Bonar", ""], [31, "Bonar", ""], [32, "Howarth", ""], [33, "Howarth", ""], [34, "Mackay", ""], [35, "Mackay", ""], [36, "Ekserdjian", "August Bank Holiday"], [37, "Ekserdjian", ""], [38, "Lunt/Hall", ""], [39, "Lunt/Hall", ""], [40, "Mackay", ""], [41, "Mackay", ""], [42, "Howarth", ""], [43, "Howarth", "Half term for most schools; Switch to Friday changeover"], [44, "Ekserdjian", ""], [45, "Howarth", ""], [46, "Lunt/Hall", ""], [47, "Bonar", ""], [48, "Mackay", ""], [49, "Ekserdjian", ""], [50, "Howarth", ""], [51, "Howarth", ""], [52, "Lunt/Hall", ""]];
  const names = [...new Set(ALLOC_2027.map(r => r[1]))].sort();
  tx(() => names.forEach((n, i) => run('INSERT INTO families (name,share_units,color) VALUES (?,?,?)', n, ALLOC_2027.filter(r => r[1] === n).length, palette[i % palette.length])));
  const fid = n => q1('SELECT id FROM families WHERE name=?', n).id;
  // 2026 uses the 2025 allocation ("Final Allocation of weeks 2025") by week number. 2026 has 53 weeks; week 53 (25 Dec – 1 Jan) goes to Lunt/Hall.
  const ALLOC_2026 = [[1, "Lunt/Hall"], [2, "Ekserdjian"], [3, "Bonar"], [4, "Howarth"], [5, "Mackay"], [6, "Ekserdjian"], [7, "White"], [8, "White"], [9, "Ekserdjian"], [10, "Ekserdjian"], [11, "Mackay"], [12, "Mackay"], [13, "Bonar"], [14, "Bonar"], [15, "Mackay"], [16, "Mackay"], [17, "Lunt/Hall"], [18, "Howarth"], [19, "Bonar"], [20, "Bonar"], [21, "Lunt/Hall"], [22, "Lunt/Hall"], [23, "Howarth"], [24, "Howarth"], [25, "Mackay"], [26, "Mackay"], [27, "Ekserdjian"], [28, "Ekserdjian"], [29, "Lunt/Hall"], [30, "Lunt/Hall"], [31, "Bonar"], [32, "Bonar"], [33, "Howarth"], [34, "Howarth"], [35, "Mackay"], [36, "Mackay"], [37, "Ekserdjian"], [38, "Ekserdjian"], [39, "Lunt/Hall"], [40, "Lunt/Hall"], [41, "Mackay"], [42, "Mackay"], [43, "Howarth"], [44, "Howarth"], [45, "Ekserdjian"], [46, "Howarth"], [47, "Lunt/Hall"], [48, "Bonar"], [49, "Mackay"], [50, "Ekserdjian"], [51, "Howarth"], [52, "Howarth"], [53, "Lunt/Hall"]];
  generateYear(2026);
  tx(() => { for (const [wk, fam] of ALLOC_2026) run("UPDATE weeks SET family_id=?, original_family_id=?, status='own_use' WHERE year=2026 AND week_no=?", fid(fam), fid(fam), wk); });
  generateYear(2027);
  for (const [y, ws] of Object.entries(SCHOOL_HOLIDAYS)) for (const n of ws) run('UPDATE weeks SET school_holiday=1 WHERE year=? AND week_no=?', Number(y), n);
  tx(() => { for (const [wk, fam, comment] of ALLOC_2027) run("UPDATE weeks SET family_id=?, original_family_id=?, status='own_use', comment=? WHERE year=2027 AND week_no=?", fid(fam), fid(fam), comment || null, wk); });
  // LIVE mode (ADMIN_EMAIL set): create only the real site admin, who sets a password via the invite link printed in the log.
  // Otherwise create demo logins for trying the site out.
  if (process.env.ADMIN_EMAIL) {
    run("INSERT INTO users (family_id,name,email,role,is_site_admin,invite_token) VALUES (NULL,?,?,'site_admin',1,?)", process.env.ADMIN_NAME || 'Site admin', process.env.ADMIN_EMAIL.trim(), token(18));
  } else {
  const pw = hashPw('demo1234');
  const add = (f, name, email, role, admin = 0, rel = null) => run('INSERT INTO users (family_id,name,email,role,is_site_admin,password_hash,relationship) VALUES (?,?,?,?,?,?,?)', f ? fid(f) : null, name, email, role, admin, pw, rel);
  add(null, 'Site admin (demo)', 'admin@example.com', 'site_admin', 1);
  add('White', 'White admin (demo)', 'white@example.com', 'family_admin');
  add('White', 'Demo family member', 'member@example.com', 'family_member', 0, 'Family');
  add('White', 'Demo trusted friend', 'friend@example.com', 'friend', 0, 'Friend');
  for (const n of names.filter(n => n !== 'White')) add(n, `${n} admin (demo)`, `${n.toLowerCase().replace(/[^a-z]/g, '')}@example.com`, 'family_admin');
  // a few released weeks, weeks in use and enquiries so there's something to see
  const plan = (n, f) => run(`UPDATE weeks SET ${f} WHERE year=2027 AND week_no=?`, n);
  for (const n of [19, 33, 37, 52]) plan(n, "status='offered', offer_friends=1, released_at=datetime('now','-8 days')"); // released
  plan(25, "status='offered', offer_friends=1, released_at=datetime('now','-2 days')");              // released (members-only window)
  for (const n of [7, 26, 34, 35]) plan(n, 'in_use=1');                                             // using it
  const enq = (wk, fam, email, msg, ago) => run("INSERT INTO enquiries (week_id,family_id,user_id,message,created_at) VALUES ((SELECT id FROM weeks WHERE year=2027 AND week_no=?),?,(SELECT id FROM users WHERE email=?),?,datetime('now',?))", wk, fid(fam), email, msg, ago);
  enq(15, 'White', 'member@example.com', 'We might be free around Easter. Any chance of this one?', '-3 days');
  enq(15, 'Bonar', 'bonar@example.com', null, '-1 days');
  enq(32, 'Ekserdjian', 'ekserdjian@example.com', 'We would love an August week this year.', '-2 days');
  }
  // 2026 budget from "Nab Camas 2026 Budget.xlsx" (July 2025 – June 2026, revised at AGM): £19,332 ÷ 52 weeks, levied at £370/week
  const BUDGET_2026 = [['Council Tax & Water', 4122, 'Regular', 'Currently £335pcm'], ['BT phone', 240, 'Regular', 'Includes limited calls'],
    ['Electricity', 2500, 'Regular', 'Need Eon update after a meter reading'], ['Garden', 1320, 'Regular', 'Same rate as last year for 11 cuts'],
    ['Accountancy fees', 600, 'Regular', '£540 last year'], ['CH Filing & AGM', 100, 'Regular', ''], ['CMNet Broadband', 150, 'Regular', 'CMN confirm continues'],
    ['Insurance', 1550, 'Regular', '24/25 premium £1490'], ['Winter custodian', 500, 'Regular', 'K Hopper confirmed'], ['Deep cleans', 400, 'Regular', 'No current contract'],
    ['Septic tank', 350, 'Regular', 'Iffluent annual pump mainenance'], ['Driveplumbing electrics', 1500, 'Regular', 'Estimated annual repairs and maintenance'],
    ['Provision for tree felling,external redec', 0, 'Postpone', ''], ['Provision for new hot water tank', 1000, '', ''],
    ['Annual reserve towards drive', 1000, 'Regular', 'Agreed in 2022'], ['Provision for new electric heaters', 4000, '', 'Agreed for Summer 2026']];
  BUDGET_2026.forEach(([d, a, c, n], k) => run('INSERT INTO budget_items (year,category,description,amount,sort,notes) VALUES (2026,?,?,?,?,?)', c || null, d, a, k, n || null));
  run("INSERT INTO budget_years (year,label,rate_per_week) VALUES (2026,'July 2025 – June 2026',370)");
  for (const f of q('SELECT id, share_units FROM families')) for (const y of [2026, 2027]) run('INSERT OR IGNORE INTO family_shares (family_id,year,units) VALUES (?,?,?)', f.id, y, f.share_units);
}
// Until the site admin has set a password, print their set-up link on every start (visible in the host's logs).
for (const u of q("SELECT name, invite_token FROM users WHERE is_site_admin=1 AND invite_token IS NOT NULL AND password_hash IS NULL")) console.log(`Site admin set-up link for ${u.name}: ${BASE_URL}/#/invite/${u.invite_token}`);

server.listen(PORT, () => console.log(`Nab Camas portal running at ${BASE_URL} (database: ${DB_FILE}${VOLUME ? `, volume: ${VOLUME}` : ''})`));
setTimeout(() => { try { runReminders(); } catch (e) { console.error('reminders', e); } }, 5000);
setInterval(() => { try { runReminders(); } catch (e) { console.error('reminders', e); } }, 6 * 3600 * 1000).unref();
