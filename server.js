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
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, share_units REAL NOT NULL DEFAULT 1,
  color TEXT NOT NULL DEFAULT '#888', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, family_id INTEGER REFERENCES families(id), name TEXT NOT NULL,
  email TEXT UNIQUE, phone TEXT, relationship TEXT, notes TEXT,
  role TEXT NOT NULL CHECK (role IN ('site_admin','family_admin','family_member','friend')),
  is_site_admin INTEGER NOT NULL DEFAULT 0, password_hash TEXT, invite_token TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY, year INTEGER NOT NULL, week_no INTEGER NOT NULL, start_date TEXT NOT NULL,
  season TEXT NOT NULL CHECK (season IN ('summer','shoulder','winter')),
  family_id INTEGER REFERENCES families(id), original_family_id INTEGER REFERENCES families(id),
  status TEXT NOT NULL DEFAULT 'own_use' CHECK (status IN ('own_use','offered','pending','booked','syndicate')),
  offer_friends INTEGER NOT NULL DEFAULT 0, offer_swap INTEGER NOT NULL DEFAULT 0, in_use INTEGER NOT NULL DEFAULT 0,
  friend_scope TEXT NOT NULL DEFAULT 'all' CHECK (friend_scope IN ('all','own')), sale_to TEXT NOT NULL DEFAULT 'all',
  price_override REAL, note TEXT, end_date TEXT, comment TEXT, UNIQUE(year, week_no));
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, week_id INTEGER NOT NULL REFERENCES weeks(id), user_id INTEGER NOT NULL REFERENCES users(id),
  seller_family_id INTEGER NOT NULL REFERENCES families(id), buyer_family_id INTEGER REFERENCES families(id),
  amount REAL NOT NULL, method TEXT NOT NULL CHECK (method IN ('bank','account')),
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','cancelled','expired')),
  reference TEXT NOT NULL, guest_name TEXT, party_size INTEGER, notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, confirmed_at TEXT, confirmed_by INTEGER);
CREATE TABLE IF NOT EXISTS swaps (
  id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id),
  from_family_id INTEGER NOT NULL, offered_week_id INTEGER REFERENCES weeks(id),
  to_family_id INTEGER NOT NULL, target_week_id INTEGER NOT NULL REFERENCES weeks(id),
  message TEXT, status TEXT NOT NULL CHECK (status IN ('pending','proposed','accepted','declined','cancelled','void')),
  responded_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, responded_at TEXT,
  decline_reason TEXT, proposed_by INTEGER, proposed_at TEXT, reply_note TEXT);
CREATE TABLE IF NOT EXISTS budget_items (
  id INTEGER PRIMARY KEY, year INTEGER NOT NULL, category TEXT, description TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, sort INTEGER DEFAULT 0, notes TEXT);
-- per budget year: the period it covers and the charge per week actually levied (the syndicate rounds it, e.g. £371.77 → £370)
CREATE TABLE IF NOT EXISTS budget_years (year INTEGER PRIMARY KEY, label TEXT, rate_per_week REAL);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), year INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('service_charge','rental_credit','purchase','payment','adjustment')),
  description TEXT NOT NULL, amount REAL NOT NULL, booking_id INTEGER, created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, text TEXT NOT NULL, link TEXT,
  read INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
for (const col of ['end_date TEXT', 'comment TEXT']) { try { db.exec('ALTER TABLE weeks ADD COLUMN ' + col); } catch { } }
try { db.exec('ALTER TABLE budget_items ADD COLUMN notes TEXT'); } catch { }
// Swaps: every family week can receive swap requests unless its family marks it "in use".
try { db.exec('ALTER TABLE weeks ADD COLUMN in_use INTEGER NOT NULL DEFAULT 0'); db.exec("UPDATE weeks SET status='own_use' WHERE status='offered' AND offer_friends=0"); } catch { }
try { db.exec('ALTER TABLE swaps ADD COLUMN decline_reason TEXT'); } catch { }
// Week settings: Undecided / Using it / Willing to swap / For sale / Swap or sell (stored as in_use, offer_swap, offer_friends).
// sale_to = who may buy a sale week: 'members' (other syndicate families), 'all' (+ any family's trusted friends), 'own' (+ our own friends).
try { db.exec("ALTER TABLE weeks ADD COLUMN sale_to TEXT NOT NULL DEFAULT 'all'"); db.exec('UPDATE weeks SET sale_to=friend_scope'); } catch { }
// Swaps v3: the requester only names the week they want; the receiving family picks one of the requester's "willing to swap"
// weeks (offered_week_id), and the requesting family confirms. Older databases need the column made optional.
if (db.prepare("SELECT \"notnull\" nn FROM pragma_table_info('swaps') WHERE name='offered_week_id'").get().nn) {
  db.exec(`BEGIN;
    CREATE TABLE swaps_v3 (id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id), from_family_id INTEGER NOT NULL,
      offered_week_id INTEGER REFERENCES weeks(id), to_family_id INTEGER NOT NULL, target_week_id INTEGER NOT NULL REFERENCES weeks(id),
      message TEXT, status TEXT NOT NULL CHECK (status IN ('pending','proposed','accepted','declined','cancelled','void')),
      responded_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, responded_at TEXT, decline_reason TEXT, proposed_by INTEGER, proposed_at TEXT, reply_note TEXT);
    INSERT INTO swaps_v3 (id,requester_id,from_family_id,offered_week_id,to_family_id,target_week_id,message,status,responded_by,created_at,responded_at,decline_reason)
      SELECT id,requester_id,from_family_id,CASE WHEN status='pending' THEN NULL ELSE offered_week_id END,to_family_id,target_week_id,message,status,responded_by,created_at,responded_at,decline_reason FROM swaps;
    DROP TABLE swaps; ALTER TABLE swaps_v3 RENAME TO swaps; COMMIT;`);
}

// Site admins are a separate kind of user with no family. Older databases only allowed family roles, so rebuild users.
if (!db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql.includes("'site_admin'")) {
  const cols = 'id,family_id,name,email,phone,relationship,notes,role,is_site_admin,password_hash,invite_token,active,created_by,created_at';
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE users_v2 (
      id INTEGER PRIMARY KEY, family_id INTEGER REFERENCES families(id), name TEXT NOT NULL,
      email TEXT UNIQUE, phone TEXT, relationship TEXT, notes TEXT,
      role TEXT NOT NULL CHECK (role IN ('site_admin','family_admin','family_member','friend')),
      is_site_admin INTEGER NOT NULL DEFAULT 0, password_hash TEXT, invite_token TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users_v2 (${cols}) SELECT ${cols} FROM users;
    DROP TABLE users; ALTER TABLE users_v2 RENAME TO users;
    UPDATE users SET role='site_admin', family_id=NULL WHERE is_site_admin=1;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
}
db.exec("UPDATE users SET is_site_admin = CASE WHEN role='site_admin' THEN 1 ELSE 0 END WHERE is_site_admin <> (role='site_admin')");

// Phase 1 (credits): school-holiday weeks, when a week was released, reminder bookkeeping, pot distributions, carried credits.
// Assumed English school holidays — the site admin should check and adjust these under Site admin → Weeks.
const SCHOOL_HOLIDAYS = { 2026: [8, 14, 15, 22, 31, 32, 33, 34, 35, 36, 44, 52, 53], 2027: [7, 13, 14, 22, 30, 31, 32, 33, 34, 35, 43, 51, 52] };
try {
  db.exec('ALTER TABLE weeks ADD COLUMN school_holiday INTEGER NOT NULL DEFAULT 0');
  for (const [y, ws] of Object.entries(SCHOOL_HOLIDAYS)) for (const n of ws) db.prepare('UPDATE weeks SET school_holiday=1 WHERE year=? AND week_no=?').run(Number(y), n);
} catch { }
try { db.exec('ALTER TABLE weeks ADD COLUMN released_at TEXT'); db.exec("UPDATE weeks SET released_at=datetime('now') WHERE offer_friends=1"); } catch { }
try { db.exec('ALTER TABLE weeks ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0'); } catch { }
try { db.exec('ALTER TABLE ledger ADD COLUMN pot_year INTEGER'); } catch { }
// Enquiries: a family's place in the queue for another family's week. If the holder releases the week, enquirers get
// first refusal (enquiry_hours), first come first served; a swap offer can be attached to an enquiry.
db.exec(`CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY, week_id INTEGER NOT NULL REFERENCES weeks(id), family_id INTEGER NOT NULL REFERENCES families(id), user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','closed','withdrawn')), close_reason TEXT,
  claim TEXT CHECK (claim IN ('yes','no')), claim_method TEXT, claim_guest TEXT, claim_party INTEGER, claimed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT);`);
try { db.exec('ALTER TABLE weeks ADD COLUMN enquiry_until TEXT'); } catch { }
try {
  db.exec('ALTER TABLE swaps ADD COLUMN enquiry_id INTEGER');
  // earlier swap requests become enquiries; any that already named a week to give become swap offers on them
  for (const sw of db.prepare("SELECT * FROM swaps WHERE status IN ('pending','proposed')").all()) {
    const id = db.prepare('INSERT INTO enquiries (week_id,family_id,user_id,message,created_at) VALUES (?,?,?,?,?)').run(sw.target_week_id, sw.from_family_id, sw.requester_id, sw.message, sw.created_at).lastInsertRowid;
    if (sw.offered_week_id) db.prepare("UPDATE swaps SET enquiry_id=?, status='pending' WHERE id=?").run(id, sw.id);
    else db.prepare("UPDATE swaps SET status='cancelled' WHERE id=?").run(sw.id);
  }
} catch { }
db.exec(`CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id), year INTEGER NOT NULL, amount REAL NOT NULL,
  description TEXT NOT NULL, swap_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);

// ---------------------------------------------------------------- helpers
const q = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
function tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };
const round2 = n => Math.round(n * 100) / 100;

const DEFAULT_SETTINGS = {
  site_name: 'Nab Camas', currency: '£', rate_summer: '1200', rate_shoulder: '800', rate_winter: '500',
  commission_pct: '0', hold_days: '3', winter_changeover_day: '5', summer_changeover_day: '6', summer_changeover_from: '12', summer_changeover_to: '43',
  bank_name: 'Syndicate bank account', bank_account_name: 'Nab Camas Syndicate', bank_sort_code: '00-00-00', bank_account_no: '00000000', bank_iban: '',
  summer_months: '6,7,8', shoulder_months: '4,5,9,10', allow_member_account_charge: '1',
  // prices: rate_* are trusted-friend prices per week; members pay member_rate_pct of that
  rate_school: '1400', member_rate_pct: '75', members_first_days: '7',
  // credits: each share = credits_per_share a year; week values are scaled from these weights so a year adds up exactly
  credits_per_share: '100', credit_school: '170', credit_summer: '130', credit_shoulder: '100', credit_winter: '45',
  // let-income pot: releases this many weeks ahead count in full, later ones count late_release_weight
  early_release_weeks: '8', late_release_weight: '0.5', reminder_weeks: '16,8', enquiry_hours: '48',
};
function settings() { const s = { ...DEFAULT_SETTINGS }; for (const r of q('SELECT key,value FROM settings')) s[r.key] = r.value; return s; }
const bandOf = w => w.school_holiday ? 'school' : w.season;            // school | summer | shoulder | winter
const rateFor = (band, s = settings()) => Number(s['rate_' + band]) || 0;
const priceOf = (w, s = settings()) => w.price_override != null ? w.price_override : rateFor(bandOf(w), s);   // trusted-friend price
const memberPriceOf = (w, s = settings()) => Math.round(priceOf(w, s) * (Number(s.member_rate_pct) || 100) / 100);

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
const audit = (uid, action, detail) => run('INSERT INTO audit (user_id,action,detail) VALUES (?,?,?)', uid, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
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
  return q1('SELECT * FROM users WHERE id=? AND active=1', s.user_id) || null;
}
const isFamily = u => u.role === 'family_admin' || u.role === 'family_member';
const need = (u, cond, msg = 'Not allowed') => { if (!u) fail(401, 'Please log in'); if (!cond) fail(403, msg); };
const needAdmin = u => need(u, u && u.is_site_admin, 'Site admin only');
const canManageFamily = (u, fid) => u && (u.is_site_admin || (u.role === 'family_admin' && u.family_id === fid));
function publicUser(u) { const { password_hash, invite_token, ...rest } = u; return { ...rest, has_password: !!password_hash }; }
function sessionCookie(tok, maxAge) { return `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${BASE_URL.startsWith('https') ? '; Secure' : ''}`; }

// ---------------------------------------------------------------- week view model
function weekView(w, u, s) {
  const v = { ...w, family_name: w.family_id ? famName(w.family_id) : 'Syndicate', price: isFamily(u) || u.is_site_admin ? memberPriceOf(w, s) : priceOf(w, s) };
  if (u.role !== 'friend') Object.assign(v, { friend_price: priceOf(w, s), member_price: memberPriceOf(w, s), credits: creditValue(w, s), band: bandOf(w), friends_from: friendsFrom(w, s), release_weight: releaseWeight(w, s) });
  v.family_color = w.family_id ? q1('SELECT color FROM families WHERE id=?', w.family_id).color : '#9aa1a9';
  const mine = u.family_id === w.family_id && isFamily(u);
  const b = q1("SELECT * FROM bookings WHERE week_id=? AND status IN ('pending','confirmed') ORDER BY id DESC", w.id);
  if (b) {
    const seeGuest = u.is_site_admin || b.user_id === u.id || (isFamily(u) && (u.family_id === w.family_id || u.family_id === b.buyer_family_id));
    v.booking = { id: b.id, status: b.status, mine: b.user_id === u.id, guest: seeGuest ? (b.guest_name || q1('SELECT name FROM users WHERE id=?', b.user_id).name) : null, reference: seeGuest ? b.reference : null, expires_at: b.expires_at };
  }
  // what this user can do
  const friendVisible = w.offer_friends && (w.sale_to === 'all' || (w.sale_to === 'own' && u.family_id === w.family_id)) && (friendsFrom(w, s) || '9') <= today();
  v.first_refusal_until = w.offer_friends && w.status === 'offered' && w.enquiry_until && w.enquiry_until > nowSql() && q1("SELECT 1 FROM enquiries WHERE week_id=? AND status='open'", w.id) ? w.enquiry_until : null;
  v.can_book = w.status === 'offered' && !!w.offer_friends && !mine && w.start_date >= today() && !v.first_refusal_until && ((u.role === 'friend' && friendVisible) || isFamily(u));
  v.plan = planOf(w);
  v.can_offer_swap = isFamily(u) && !mine && swappable(w);
  if (isFamily(u) || u.is_site_admin) {
    const queue = openEnquiries(w.id), i = queue.findIndex(e => e.family_id === u.family_id);
    v.enquiries = queue.length;
    v.my_enquiry = i >= 0 ? { id: queue[i].id, position: i + 1, claim: queue[i].claim, created_at: queue[i].created_at } : null;
  }
  // enquire = join the queue for another family's week that isn't marked Using it, let or released
  v.can_enquire = isFamily(u) && !mine && w.family_id != null && !w.in_use && w.status === 'own_use' && w.start_date >= today() && !v.my_enquiry;
  v.swappable = swappable(w);
  v.can_manage = canManageFamily(u, w.family_id) && w.family_id != null;
  v.is_mine = mine;
  if (u.role === 'friend' && !friendVisible && w.status === 'offered') v.status = 'own_use'; // friends only see what's offered to them
  if (u.role === 'friend') { v.offer_swap = 0; v.in_use = 0; v.plan = null; v.enquiry_until = null; }
  v.pending_swaps = isFamily(u) ? q1("SELECT COUNT(*) n FROM swaps WHERE status IN ('pending','proposed') AND target_week_id=?", w.id).n : 0;
  return v;
}
const today = () => new Date().toISOString().slice(0, 10);
// A week can be asked for (or offered) in a swap if a family holds it, it isn't let/reserved, its family hasn't marked it in use, and it's in the future.
const swappable = w => w.family_id != null && !w.in_use && !['pending', 'booked', 'syndicate'].includes(w.status) && w.start_date >= today();
// Each week's setting: undecided | using | swap (willing to give it in a swap) | released (others can book it; income → pot)
const PLANS = ['undecided', 'using', 'swap', 'released'];
const planOf = w => w.in_use ? 'using' : w.offer_friends ? 'released' : w.offer_swap ? 'swap' : 'undecided';
// weeks a family is willing to give in exchange: "willing to swap" or released, and still swappable
const willingWeeks = fid => q("SELECT * FROM weeks WHERE family_id=? AND (offer_swap=1 OR offer_friends=1) ORDER BY start_date", fid).filter(swappable);
const swapWeekView = w => w && { id: w.id, year: w.year, week_no: w.week_no, start_date: w.start_date, end_date: w.end_date, season: w.season, comment: w.comment, school_holiday: w.school_holiday, credits: creditValue(w) };

// ---------------------------------------------------------------- credits & let-income pot
// Every week has a credit value from its band (school holiday / summer / shoulder / winter). The weights are scaled so that
// a year's weeks add up to total shares × credits_per_share (5,200 for 52 shares, give or take rounding), whatever the number of weeks.
let creditMemo = new Map();     // per-request cache of each year's scale factor
const totalShares = () => q1('SELECT COALESCE(SUM(share_units),0) n FROM families WHERE active=1').n;
function yearScale(year, s = settings()) {
  if (creditMemo.has(year)) return creditMemo.get(year);
  const raw = q('SELECT season, school_holiday FROM weeks WHERE year=?', year).reduce((a, w) => a + (Number(s['credit_' + bandOf(w)]) || 0), 0);
  const k = raw ? totalShares() * Number(s.credits_per_share || 100) / raw : 0;
  creditMemo.set(year, k); return k;
}
const creditValue = (w, s = settings()) => Math.round((Number(s['credit_' + bandOf(w)]) || 0) * yearScale(w.year, s));
const daysBetween = (fromIso, toDate) => (Date.parse(toDate + 'T00:00:00Z') - Date.parse(fromIso.replace(' ', 'T') + (fromIso.length > 10 ? 'Z' : 'T00:00:00Z'))) / 864e5;
// a release counts in full if made early_release_weeks or more before arrival, otherwise late_release_weight
const releaseWeight = (w, s = settings()) => !w.released_at ? 0 : daysBetween(w.released_at, w.start_date) >= 7 * Number(s.early_release_weeks || 8) ? 1 : Number(s.late_release_weight ?? 0.5);
// released weeks are for members only for members_first_days, then trusted friends too (but always from 3 weeks before arrival)
function friendsFrom(w, s = settings()) {
  if (!w.released_at) return null;
  const from = w.enquiry_until && w.enquiry_until > w.released_at ? w.enquiry_until : w.released_at;   // members' week starts after enquirers' first refusal
  const a = new Date(from.replace(' ', 'T') + 'Z'); a.setUTCDate(a.getUTCDate() + Number(s.members_first_days || 0));
  const b = new Date(w.start_date + 'T00:00:00Z'); b.setUTCDate(b.getUTCDate() - 21);
  return (a < b ? a : b).toISOString().slice(0, 10);
}
// Let income for a year's weeks: confirmed bookings (older bookings already credited directly to a family are left out).
function potTotal(year, s = settings()) {
  const g = q1(`SELECT COALESCE(SUM(b.amount),0) n, COUNT(*) c FROM bookings b JOIN weeks w ON w.id=b.week_id WHERE b.status='confirmed' AND w.year=?
    AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.booking_id=b.id AND l.type='rental_credit')`, year);
  const commission = round2(g.n * (Number(s.commission_pct) || 0) / 100);
  return { gross: round2(g.n), lets: g.c, commission, net: round2(g.n - commission) };
}
function creditSummary(year, s = settings()) {
  const per = Number(s.credits_per_share || 100), weeks = q('SELECT * FROM weeks WHERE year=?', year), pot = potTotal(year, s);
  const rows = q('SELECT * FROM families WHERE active=1 ORDER BY name').map(f => {
    const held = weeks.filter(w => w.family_id === f.id);
    const carried = q1('SELECT COALESCE(SUM(amount),0) n FROM credit_ledger WHERE family_id=? AND year=?', f.id, year).n;
    const released = held.filter(w => w.offer_friends && w.released_at);
    const value = held.reduce((a, w) => a + creditValue(w, s), 0), entitlement = f.share_units * per + carried;
    // differences from this year's uneven swaps are already settled by credits carried into next year
    const settled = q1(`SELECT COALESCE(SUM(c.amount),0) n FROM credit_ledger c JOIN swaps sw ON sw.id=c.swap_id JOIN weeks t ON t.id=sw.target_week_id
      WHERE c.family_id=? AND c.year=? AND t.year=?`, f.id, year + 1, year).n;
    return { id: f.id, name: f.name, color: f.color, shares: f.share_units, carried, entitlement, weeks: held.length, value, settled, diff: value - entitlement + settled,
      school_weeks: held.filter(w => w.school_holiday).length, released_weeks: released.length,
      release_points: Math.round(released.reduce((a, w) => a + creditValue(w, s) * releaseWeight(w, s), 0) * 10) / 10 };
  });
  const totalPoints = rows.reduce((a, r) => a + r.release_points, 0);
  rows.forEach(r => r.pot_share = totalPoints ? round2(pot.net * r.release_points / totalPoints) : 0);
  const bands = Object.fromEntries(['school', 'summer', 'shoulder', 'winter'].map(b => [b, { credits: Math.round(Number(s['credit_' + b]) * yearScale(year, s)), weeks: weeks.filter(w => bandOf(w) === b).length }]));
  return { year, per, bands, rows, pot: { ...pot, total_points: Math.round(totalPoints * 10) / 10, distributed: !!q1('SELECT 1 FROM ledger WHERE pot_year=? LIMIT 1', year) } };
}

// Reminders: weeks still "undecided" get a nudge to their family admins at each reminder point (default 16 and 8 weeks before).
function runReminders() {
  const s = settings(); const points = String(s.reminder_weeks || '').split(',').map(Number).filter(n => n > 0).sort((a, b) => b - a);
  if (!points.length) return;
  const due = {};
  for (const w of q("SELECT * FROM weeks WHERE family_id IS NOT NULL AND in_use=0 AND offer_friends=0 AND offer_swap=0 AND status='own_use' AND start_date > date('now') AND start_date <= date('now', ?)", `+${points[0] * 7} days`)) {
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
    `Still undecided: ${ws.map(w => `week ${w.week_no} (${fmtDate(w.start_date)}${asked(w)})`).join('; ')}. Please mark ${ws.length > 1 ? 'them' : 'it'} Using it, Willing to swap or Released. Releasing ${s.early_release_weeks}+ weeks ahead earns a full share of the let-income pot.`, '#/weeks');
}

// Called whenever a week stops being available, so swap offers that depend on it don't hang around:
//  - offers FOR the week are declined ('in_use') or voided (let / reserved / swapped)
//  - offers that would GIVE the week in exchange are voided
function releaseSwaps(w, why, byUser, exceptId = 0) {
  for (const sw of q("SELECT * FROM swaps WHERE status IN ('pending','proposed') AND target_week_id=? AND id<>?", w.id, exceptId)) {
    if (why === 'in_use') {
      run("UPDATE swaps SET status='declined', decline_reason='in_use', responded_by=?, responded_at=datetime('now') WHERE id=?", byUser ? byUser.id : null, sw.id);
      notify([sw.requester_id, ...familyAdmins(sw.from_family_id)], `${famName(w.family_id)} are using ${weekLabel(w)}, so your swap offer for it was declined.`, '#/enquiries');
    } else {
      run("UPDATE swaps SET status='void' WHERE id=?", sw.id);
      notify([sw.requester_id], `Your swap offer for ${weekLabel(w)} lapsed because that week has been ${why}.`, '#/enquiries');
    }
  }
  for (const sw of q("SELECT * FROM swaps WHERE status IN ('pending','proposed') AND offered_week_id=? AND id<>?", w.id, exceptId)) {
    run("UPDATE swaps SET status='void' WHERE id=?", sw.id);
    notify([sw.requester_id, ...familyAdmins(sw.to_family_id)], `A swap offer of ${weekLabel(w)} lapsed because that week is no longer available.`, '#/enquiries');
  }
}

// ---------------------------------------------------------------- enquiries & first refusal
const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const openEnquiries = weekId => q("SELECT * FROM enquiries WHERE week_id=? AND status='open' ORDER BY created_at, id", weekId);
const CLOSED_WHY = { using: 'they are using it', taken: 'it has been taken', swapped: 'it has been swapped' };
// close the queue for a week; the winning family's enquiry (if any) is marked won
function closeEnquiries(w, reason, winnerFamily = null) {
  for (const e of openEnquiries(w.id)) {
    const won = winnerFamily != null && e.family_id === winnerFamily;
    run("UPDATE enquiries SET status=?, close_reason=?, closed_at=datetime('now') WHERE id=?", won ? 'won' : 'closed', won ? null : reason, e.id);
    if (!won) notify([e.user_id], `Your enquiry about ${weekLabel(w)} is closed: ${reason === 'using' ? `${famName(w.family_id)} are using it` : CLOSED_WHY[reason] || reason}.`, '#/enquiries');
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
        const b = createBooking(u, w, { method: winner.claim_method, guest_name: winner.claim_guest, party_size: winner.claim_party }, memberPriceOf(w));
        notify([winner.user_id, ...familyAdmins(winner.family_id)].filter((x, i, a) => a.indexOf(x) === i), b.status === 'confirmed'
          ? `Your family has ${weekLabel(w)}: it's booked and charged to your family account.`
          : `Your family has ${weekLabel(w)}. Please pay ${settings().currency}${b.amount} by bank transfer within ${settings().hold_days} days, reference ${b.reference}.`, '#/bookings');
      } catch (err) { console.error('first refusal award failed', err.message); }
    } else if (!waiting) {
      run("UPDATE weeks SET enquiry_until=MIN(enquiry_until, datetime('now')) WHERE id=?", w.id);
      for (const e of queue) run("UPDATE enquiries SET status='closed', close_reason=?, closed_at=datetime('now') WHERE id=?", e.claim === 'no' ? 'passed' : 'no_reply', e.id);
      notify(familyAdmins(w.family_id), `Nobody who enquired took ${weekLabel(w)}, so it is now open to all members.`, '#/weeks');
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
  const commission = round2(b.amount * (Number(s.commission_pct) || 0) / 100);
  const credit = round2(b.amount - commission);
  const buyer = q1('SELECT * FROM users WHERE id=?', b.user_id);
  run("UPDATE bookings SET status='confirmed', confirmed_at=datetime('now'), confirmed_by=? WHERE id=?", byUser.id, b.id);
  run("UPDATE weeks SET status='booked' WHERE id=?", w.id);
  if (b.method === 'account') run("INSERT INTO ledger (family_id,year,type,description,amount,booking_id,created_by) VALUES (?,?,?,?,?,?,?)",
    b.buyer_family_id, w.year, 'purchase', `Bought week ${w.week_no} ${w.year} from ${famName(b.seller_family_id)}`, b.amount, b.id, byUser.id);
  releaseSwaps(w, 'let', byUser);
  notify([b.user_id], `Confirmed: ${weekLabel(w)} is booked. Reference ${b.reference}.`, '#/bookings');
  notify(familyAdmins(b.seller_family_id), `${weekLabel(w)} has been let to ${b.guest_name || buyer.name}. The ${s.currency}${credit} goes into the ${w.year} let-income pot, shared by the families who released weeks.`, '#/weeks');
}

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('POST', '/api/login', ({ body, res }) => {
  const u = q1('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1', String(body.email || '').trim());
  if (!u || !checkPw(String(body.password || ''), u.password_hash)) fail(401, 'Email or password is incorrect');
  const t = token(); run("INSERT INTO sessions VALUES (?,?,datetime('now','+30 days'))", t, u.id);
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
  const t = token(); run("INSERT INTO sessions VALUES (?,?,datetime('now','+30 days'))", t, u.id);
  res.setHeader('Set-Cookie', sessionCookie(t, 2592000)); return { ok: true };
});

route('GET', '/api/me', ({ user }) => {
  need(user, true); resolveFirstRefusal(); const s = settings();
  const unread = q1('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', user.id).n;
  const years = q('SELECT DISTINCT year FROM weeks ORDER BY year').map(r => r.year);
  const pub = { site_name: s.site_name, currency: s.currency, rate_summer: +s.rate_summer, rate_shoulder: +s.rate_shoulder, rate_winter: +s.rate_winter, rate_school: +s.rate_school, hold_days: +s.hold_days,
    member_rate_pct: +s.member_rate_pct, members_first_days: +s.members_first_days, enquiry_hours: +s.enquiry_hours, early_release_weeks: +s.early_release_weeks, late_release_weight: +s.late_release_weight, credits_per_share: +s.credits_per_share,
    bank: { name: s.bank_name, account_name: s.bank_account_name, sort_code: s.bank_sort_code, account_no: s.bank_account_no, iban: s.bank_iban }, allow_member_account_charge: s.allow_member_account_charge === '1' };
  const fam = user.family_id ? q1('SELECT * FROM families WHERE id=?', user.family_id) : null;
  // things waiting for this person: swap offers to answer or confirm (admins), first refusals to take or pass (any family member)
  const pendingSwaps = !isFamily(user) ? 0 : (user.role === 'family_admin' ? q1("SELECT COUNT(*) n FROM swaps WHERE (status='pending' AND to_family_id=?) OR (status='proposed' AND from_family_id=?)", user.family_id, user.family_id).n : 0)
    + q1("SELECT COUNT(*) n FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE e.family_id=? AND e.status='open' AND e.claim IS NULL AND w.status='offered' AND w.enquiry_until > datetime('now')", user.family_id).n;
  const families = q('SELECT id,name,color FROM families WHERE active=1 ORDER BY name');
  return { user: publicUser(user), family: fam, settings: pub, unread, years, pendingSwaps, families };
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
  if (fam) {
    // first refusal on released weeks the family enquired about
    for (const e of q(`SELECT e.* FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE e.family_id=? AND e.status='open' AND w.status='offered' AND w.enquiry_until > ? ORDER BY w.enquiry_until`, fid, now)) {
      const w = W(e.week_id), pos = openEnquiries(w.id).findIndex(x => x.id === e.id) + 1;
      attention.push(e.claim === 'yes'
        ? { tone: 'info', title: `You've said yes to ${weekLabel(w)}`, detail: `Families who enquired before you have until ${when(w.enquiry_until)} to answer. If none of them take it, it's yours.`, link: '#/enquiries', cta: 'View' }
        : { tone: 'urgent', title: `You have first refusal on ${weekLabel(w)}`, detail: `${famName(w.family_id)} have released it. You're ${ordinal(pos)} in the queue. Take it at ${money(memberPriceOf(w, s))} or pass before ${when(w.enquiry_until)}.`, link: '#/enquiries', cta: 'Take it or pass' });
    }
    if (admin) {
      const offered = new Set();   // weeks with a swap offer are listed once, as the offer
      for (const sw of q("SELECT * FROM swaps WHERE status='pending' AND to_family_id=? ORDER BY created_at", fid)) offered.add(sw.target_week_id) && attention.push({ tone: 'action',
        title: `${famName(sw.from_family_id)} offer a swap for your ${weekLabel(W(sw.target_week_id))}`, detail: `They'd give you their ${weekLabel(W(sw.offered_week_id))} in exchange.`, link: '#/enquiries', cta: 'Review offer' });
      for (const sw of q("SELECT * FROM swaps WHERE status='proposed' AND from_family_id=? ORDER BY proposed_at", fid)) attention.push({ tone: 'action',
        title: `Confirm a swap with ${famName(sw.to_family_id)}`, detail: `They accepted ${q1('SELECT name FROM users WHERE id=?', sw.requester_id).name}'s offer of your ${weekLabel(W(sw.offered_week_id))} for their ${weekLabel(W(sw.target_week_id))}.`, link: '#/enquiries', cta: 'Confirm or withdraw' });
      for (const r of q(`SELECT w.*, COUNT(e.id) n FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE w.family_id=? AND e.status='open' AND w.status='own_use' AND w.in_use=0 GROUP BY w.id ORDER BY w.start_date`, fid)) if (!offered.has(r.id)) attention.push({ tone: 'action',
        title: `${r.n} famil${r.n > 1 ? 'ies have' : 'y has'} enquired about your ${weekLabel(r)}`, detail: 'Release it, mark it Willing to swap, or say you are using it.', link: '#/enquiries', cta: 'Decide' });
      const horizon = Math.max(...String(s.reminder_weeks || '16').split(',').map(Number).filter(n => n > 0), 0) * 7;
      const undecided = q("SELECT * FROM weeks WHERE family_id=? AND in_use=0 AND offer_friends=0 AND offer_swap=0 AND status='own_use' AND start_date >= ? AND start_date <= date(?, ?) ORDER BY start_date", fid, t, t, `+${horizon} days`);
      if (undecided.length) attention.push({ tone: 'action', title: `${undecided.length} of your weeks in the next ${horizon / 7} weeks ${undecided.length > 1 ? 'are' : 'is'} still undecided`,
        detail: `${undecided.slice(0, 5).map(w => `week ${w.week_no} (${fmtDate(w.start_date)})`).join(', ')}${undecided.length > 5 ? '…' : ''}. Releasing ${s.early_release_weeks}+ weeks ahead earns a full share of the let-income pot.`, link: '#/weeks', cta: 'Set in My weeks' });
      const bal = round2(q1('SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE family_id=?', fid).n);
      if (bal > 0.005) attention.push({ tone: 'action', title: `Balance to pay: ${money(bal)}`, detail: `Pay ${s.bank_account_name} using reference ${famName(fid).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}-SC.`, link: '#/account', cta: 'View account' });
      const invited = q("SELECT name FROM users WHERE family_id=? AND active=1 AND email IS NOT NULL AND password_hash IS NULL", fid).map(r => r.name);
      if (invited.length) attention.push({ tone: 'info', title: `${invited.length} ${invited.length > 1 ? 'people haven’t' : 'person hasn’t'} set up their login yet`, detail: `${invited.join(', ')}. You can send a fresh invitation link from Family & friends.`, link: '#/people', cta: 'Family & friends' });
    }
  }
  // what's coming up for this person or family
  const upcoming = [];
  if (fam) for (const w of q("SELECT * FROM weeks WHERE family_id=? AND start_date >= ? ORDER BY start_date LIMIT 5", fid, t)) {
    const b = q1("SELECT * FROM bookings WHERE week_id=? AND status IN ('pending','confirmed')", w.id);
    upcoming.push({ start: w.start_date, title: weekLabel(w), detail: b ? `Let to ${b.guest_name || q1('SELECT name FROM users WHERE id=?', b.user_id).name}` : planOf(w) === 'using' ? 'Your family is using it' : planOf(w) === 'released' ? 'Released' : planOf(w) === 'swap' ? 'Willing to swap' : 'Undecided', week_id: w.id, year: w.year, plan: b ? 'let' : planOf(w) });
  }
  const trips = q(`SELECT b.*, w.start_date, w.week_no, w.year, w.end_date FROM bookings b JOIN weeks w ON w.id=b.week_id
    WHERE (b.user_id=? OR (? AND b.buyer_family_id=?)) AND b.status IN ('pending','confirmed') AND w.start_date >= ? ORDER BY w.start_date LIMIT 5`,
    user.id, fam ? 1 : 0, fid ?? 0, t).map(b => ({ start: b.start_date, title: weekLabel(b), detail: `${b.status === 'confirmed' ? 'Booked' : 'Reserved, awaiting payment'} · ${b.guest_name || ''} · from ${famName(b.seller_family_id)}`, week_id: b.week_id, year: b.year, plan: b.status === 'confirmed' ? 'booked' : 'reserved' }));
  // weeks this person can book now
  const available = q("SELECT * FROM weeks WHERE status='offered' AND offer_friends=1 AND start_date >= ? ORDER BY start_date LIMIT 40", t).map(w => weekView(w, user, s)).filter(v => v.can_book).slice(0, 6)
    .map(v => ({ week_id: v.id, year: v.year, title: weekLabel(v), price: v.price, band: bandOf(v), family: user.role === 'friend' ? null : v.family_name }));
  const myEnquiries = fam ? q("SELECT * FROM enquiries WHERE family_id=? AND status='open' ORDER BY created_at", fid).map(e => { const w = W(e.week_id), qn = openEnquiries(w.id);
    return { title: weekLabel(w), holder: famName(w.family_id), position: qn.findIndex(x => x.id === e.id) + 1, queue: qn.length, plan: planOf(w), week_id: w.id, year: w.year }; }) : [];
  // family snapshot: credits and the let-income pot for the current year
  let family = null;
  if (fam) {
    const year = q1('SELECT 1 FROM weeks WHERE year=?', new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0)) ? new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0) : new Date().getFullYear();
    const c = creditSummary(year, s), r = c.rows.find(x => x.id === fid);
    family = { name: famName(fid), year, credits: r && { value: r.value, entitlement: r.entitlement, diff: r.diff, released: r.released_weeks, points: r.release_points, pot_share: r.pot_share }, pot: c.pot.net,
      balance: admin ? round2(q1('SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE family_id=?', fid).n) : null };
  }
  // site admin: syndicate-wide jobs and system health
  const syndicate = [];
  if (user.is_site_admin) {
    const pend = q("SELECT * FROM bookings WHERE status='pending' AND method='bank'");
    if (pend.length) syndicate.push({ tone: 'action', title: `${pend.length} payment${pend.length > 1 ? 's' : ''} to confirm (${money(pend.reduce((a, b) => a + b.amount, 0))})`, detail: 'Check the bank statement for each reference, then mark it paid.', link: '#/admin/overview', cta: 'Payments' });
    const owing = balances().filter(b => b.balance > 0.005);
    if (owing.length) syndicate.push({ tone: 'info', title: `${owing.length} famil${owing.length > 1 ? 'ies owe' : 'y owes'} ${money(owing.reduce((a, b) => a + b.balance, 0))} in total`, detail: owing.map(b => `${b.name} ${money(b.balance)}`).join(' · '), link: '#/admin/overview', cta: 'Balances' });
    const noAdmin = q("SELECT name FROM families f WHERE active=1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.family_id=f.id AND u.role='family_admin' AND u.active=1)").map(r => r.name);
    if (noAdmin.length) syndicate.push({ tone: 'urgent', title: `${noAdmin.join(', ')} ${noAdmin.length > 1 ? 'have' : 'has'} no family admin`, detail: 'Nobody can manage their weeks or answer enquiries.', link: '#/admin/users', cta: 'All users' });
    for (const { year } of q('SELECT DISTINCT year FROM budget_items ORDER BY year')) { const b = budgetSummary(year); if (b.total && !b.generated) syndicate.push({ tone: 'action', title: `${b.label || year} service charges not issued yet`, detail: `Budget ${money(b.total)} at ${money(b.rate)} a share.`, link: '#/admin/budget', cta: 'Budget & charges' }); }
    for (const { year } of q('SELECT DISTINCT year FROM weeks WHERE year < ? ORDER BY year', new Date().getFullYear())) { const c = creditSummary(year, s); if (c.pot.net > 0 && !c.pot.distributed) syndicate.push({ tone: 'action', title: `The ${year} let-income pot (${money(c.pot.net)}) hasn't been shared out`, detail: 'Distribute it to credit each family against next year’s service charge.', link: '#/admin/credits', cta: 'Credits & pot' }); }
    const ny = new Date().getFullYear() + 1; if (!q1('SELECT 1 FROM weeks WHERE year=?', ny)) syndicate.push({ tone: 'action', title: `No weeks set up for ${ny} yet`, detail: 'Create the year and import its allocation.', link: '#/admin/weeks', cta: 'Weeks & allocation' });
    const demo = q1("SELECT COUNT(*) n FROM users WHERE active=1 AND email LIKE '%@example.com'").n;
    if (demo) syndicate.push({ tone: 'urgent', title: `${demo} demo logins are still active`, detail: 'Anyone who knows the demo password can log in. Add the real family admins, then remove the demo users, before families start using the site.', link: '#/admin/users', cta: 'All users' });
    if (ON_RAILWAY && !VOLUME) syndicate.push({ tone: 'urgent', title: 'No storage volume attached: data is lost on every update', detail: 'In Railway, add a volume to this service (mount path /data). The site will then keep its database there automatically.', link: '#/home', cta: '' });
    else if (VOLUME && !DB_FILE.startsWith(VOLUME)) syndicate.push({ tone: 'urgent', title: 'The database isn’t on the storage volume: data is lost on every update', detail: `It’s at ${DB_FILE}, but the volume is mounted at ${VOLUME}. In Railway, change the DB_FILE variable to ${path.join(VOLUME, 'camas.db')} (or delete it).`, link: '#/home', cta: '' });
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) syndicate.push({ tone: 'info', title: 'Emails aren’t being sent', detail: 'Reminders, invitations and notifications only appear in the bell. Set RESEND_API_KEY and EMAIL_FROM on the server to send them by email.', link: '#/home', cta: '' });
  }
  const notes = q('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 6', user.id);
  const since = q1('SELECT MIN(created_at) d FROM users').d;
  if (user.role === 'site_admin') {
    const year = q1('SELECT 1 FROM weeks WHERE year=?', new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0)) ? new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0) : new Date().getFullYear();
    const c = creditSummary(year, s);
    const activity = q('SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 8');
    const counts = { families: q1('SELECT COUNT(*) n FROM families WHERE active=1').n, logins: q1('SELECT COUNT(*) n FROM users WHERE active=1').n,
      released: q1("SELECT COUNT(*) n FROM weeks WHERE year=? AND offer_friends=1", year).n, enquiries: q1("SELECT COUNT(*) n FROM enquiries WHERE status='open'").n };
    return { admin_home: true, attention: syndicate, balances: balances(), credits: { year, rows: c.rows, pot: c.pot }, activity, counts, notifications: notes,
      system: { database: DB_FILE, volume: VOLUME || null, on_railway: ON_RAILWAY, data_since: since, email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) } };
  }
  return { attention, upcoming: [...trips, ...upcoming].sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6), available, enquiries: myEnquiries, family, syndicate, notifications: notes,
    system: user.is_site_admin ? { database: DB_FILE, volume: VOLUME || null, on_railway: ON_RAILWAY, data_since: since, email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) } : null };
});
route('GET', '/api/weeks', ({ user, query }) => {
  need(user, true); expireHolds(); const s = settings();
  const year = Number(query.year) || new Date().getFullYear(); resolveFirstRefusal();
  return q('SELECT * FROM weeks WHERE year=? ORDER BY week_no', year).map(w => weekView(w, user, s));
});
route('PUT', '/api/weeks/:id', ({ user, params, body }) => {
  const w = q1('SELECT * FROM weeks WHERE id=?', params.id) || fail(404, 'Week not found');
  need(user, canManageFamily(user, w.family_id), 'Only this week’s family admin can change it');
  if (['pending', 'booked'].includes(w.status)) fail(400, 'This week has a booking. Cancel the booking first.');
  let plan = body.plan !== undefined ? body.plan : planOf(w);
  if (plan === 'sell' || plan === 'swap_sell') plan = 'released';
  if (!PLANS.includes(plan)) fail(400, 'Unknown setting');
  const using = plan === 'using', swap = plan === 'swap', sell = plan === 'released';
  const price = body.price_override === undefined ? w.price_override : body.price_override === '' || body.price_override == null ? null : Number(body.price_override);
  if (price != null && (isNaN(price) || price < 0)) fail(400, 'Price must be a positive number');
  const saleTo = ['members', 'all', 'own'].includes(body.sale_to) ? body.sale_to : w.sale_to;
  tx(() => {
    run(`UPDATE weeks SET status=?, offer_friends=?, offer_swap=?, in_use=?, sale_to=?, price_override=?, note=?,
      released_at=${sell ? (w.offer_friends ? 'released_at' : "datetime('now')") : 'NULL'} WHERE id=?`,
      sell ? 'offered' : 'own_use', sell ? 1 : 0, swap ? 1 : 0, using ? 1 : 0, saleTo, price, body.note !== undefined ? body.note || null : w.note, w.id);
    const now = q1('SELECT * FROM weeks WHERE id=?', w.id);
    if (sell && !w.offer_friends) {
      const s = settings(), enquirers = startFirstRefusal(now, s), rel = q1('SELECT * FROM weeks WHERE id=?', w.id);
      const skip = new Set(openEnquiries(w.id).map(e => e.family_id));
      notify(q("SELECT id, family_id FROM users WHERE active=1 AND role IN ('family_admin','family_member') AND family_id<>?", w.family_id).filter(r => !skip.has(r.family_id)).map(r => r.id),
        `${famName(w.family_id)} have released ${weekLabel(rel)}. Members can book it at ${s.currency}${memberPriceOf(rel, s)}${enquirers ? ` once the families who enquired have had first refusal (until ${fmtDate(rel.enquiry_until.slice(0, 10))})` : ''}${friendsFrom(rel, s) > today() ? `, before it opens to trusted friends on ${fmtDate(friendsFrom(rel, s))}` : ''}.`, '#/calendar');
    }
    if (!sell && w.offer_friends) {   // un-released: any first-refusal window stops, the queue stays
      run('UPDATE weeks SET enquiry_until=NULL WHERE id=?', w.id);
      run("UPDATE enquiries SET claim=NULL, claim_method=NULL, claim_guest=NULL, claim_party=NULL, claimed_at=NULL WHERE week_id=? AND status='open'", w.id);
    }
    if (using && !w.in_use) { releaseSwaps(now, 'in_use', user); closeEnquiries(now, 'using'); }
    if (swap && !w.offer_swap) for (const e of openEnquiries(w.id)) notify([e.user_id],
      `${famName(w.family_id)} would swap ${weekLabel(now)}, which your family enquired about. You can offer one of your weeks in exchange on the Enquiries page.`, '#/enquiries');
  });
  audit(user.id, 'week.update', { week: w.id, ...body });
  return { ok: true };
});

// --- bookings
function createBooking(user, w, body, price) {
  const s = settings();
  const method = body.method === 'account' ? 'account' : 'bank';
  if (method === 'account' && !(isFamily(user) && (user.role === 'family_admin' || s.allow_member_account_charge === '1'))) fail(403, 'Charging to a family account is not allowed for your login');
  const ref = `NC${String(w.year).slice(2)}W${String(w.week_no).padStart(2, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const id = tx(() => {
    const r = run("UPDATE weeks SET status='pending', enquiry_until=CASE WHEN enquiry_until > datetime('now') THEN datetime('now') ELSE enquiry_until END WHERE id=? AND status='offered'", w.id);
    if (!r.changes) fail(409, 'Sorry — someone else has just booked this week');
    const ins = run("INSERT INTO bookings (week_id,user_id,seller_family_id,buyer_family_id,amount,method,status,reference,guest_name,party_size,notes,expires_at) VALUES (?,?,?,?,?,?,'pending',?,?,?,?,datetime('now', ?))",
      w.id, user.id, w.family_id, isFamily(user) ? user.family_id : null, price, method, ref, body.guest_name || null, Number(body.party_size) || null, body.notes || null, `+${Number(s.hold_days) || 3} days`);
    releaseSwaps(w, 'reserved by someone buying it', user);
    closeEnquiries(w, 'taken', isFamily(user) ? user.family_id : null);
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
    return { ...b, week: { year: w.year, week_no: w.week_no, start_date: w.start_date, season: w.season }, seller: famName(b.seller_family_id), booker: bu.name, booker_contact: (user.is_site_admin || canManageFamily(user, b.seller_family_id)) ? bu : null, mine: b.user_id === user.id }; });
});
route('POST', '/api/bookings/:id/cancel', ({ user, params }) => {
  need(user, true); const b = q1('SELECT * FROM bookings WHERE id=?', params.id) || fail(404, 'Not found');
  const w = q1('SELECT * FROM weeks WHERE id=?', b.week_id);
  if (b.status === 'pending') need(user, b.user_id === user.id || user.is_site_admin || canManageFamily(user, b.seller_family_id));
  else if (b.status === 'confirmed') need(user, user.is_site_admin, 'Only the site admin can cancel a confirmed (paid) booking — contact them to arrange a refund');
  else fail(400, 'Booking already closed');
  tx(() => {
    if (b.status === 'confirmed') {
      for (const l of q('SELECT * FROM ledger WHERE booking_id=?', b.id))
        run("INSERT INTO ledger (family_id,year,type,description,amount,booking_id,created_by) VALUES (?,?,'adjustment',?,?,?,?)", l.family_id, l.year, 'Reversal: ' + l.description, -l.amount, b.id, user.id);
    }
    run("UPDATE bookings SET status='cancelled' WHERE id=?", b.id);
    run("UPDATE weeks SET status='offered' WHERE id=?", w.id);
  });
  notify([b.user_id, ...familyAdmins(b.seller_family_id)].filter(i => i !== user.id), `Booking ${b.reference} for ${weekLabel(w)} was cancelled by ${user.name}.`, '#/bookings');
  audit(user.id, 'booking.cancel', { booking: b.id }); return { ok: true };
});
route('POST', '/api/admin/bookings/:id/confirm', ({ user, params }) => {
  needAdmin(user); const b = q1("SELECT * FROM bookings WHERE id=? AND status='pending'", params.id) || fail(404, 'No pending booking');
  tx(() => confirmBooking(b, user)); audit(user.id, 'booking.confirm', { booking: b.id }); return { ok: true };
});

// --- enquiries & swap offers
// 1. A family member enquires about another family's week (not Using it, not let). Their family joins the queue.
// 2. Optionally the enquiry carries a swap offer: one of their own weeks in exchange.
// 3. If the holder releases the week, enquirers get first refusal (enquiry_hours), first come first served.
//    Using it → the queue closes. Willing to swap → enquirers are told so they can make an offer.
// 4. The holder's admin accepts or declines swap offers. An offer made by a family member (not their admin) needs
//    their own admin to confirm before the weeks change hands.
const isAdminOf = (u, fid) => u && u.role === 'family_admin' && u.family_id === fid;
function doSwap(sw, user) {
  const a = q1('SELECT * FROM weeks WHERE id=?', sw.offered_week_id), b = q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id);
  if (a.family_id !== sw.from_family_id || b.family_id !== sw.to_family_id || !swappable(a) || ['pending', 'booked'].includes(b.status)) fail(409, 'One of the weeks has changed since this offer was made');
  // Holders change for this year only; next year's allocation is unaffected. Both families now plan to use their new weeks.
  run("UPDATE weeks SET family_id=?, status='own_use', offer_friends=0, offer_swap=0, in_use=1, released_at=NULL, enquiry_until=NULL, price_override=NULL, note=? WHERE id=?", sw.to_family_id, `Swapped from ${famName(sw.from_family_id)}`, a.id);
  run("UPDATE weeks SET family_id=?, status='own_use', offer_friends=0, offer_swap=0, in_use=1, released_at=NULL, enquiry_until=NULL, price_override=NULL, note=? WHERE id=?", sw.from_family_id, `Swapped from ${famName(sw.to_family_id)}`, b.id);
  // Uneven swap: the family that received the more valuable week has the difference taken off next year's credits, and the other gains it.
  const diff = creditValue(b) - creditValue(a), cy = Math.max(a.year, b.year) + 1;
  if (diff) {
    const [gainer, payer] = diff > 0 ? [sw.to_family_id, sw.from_family_id] : [sw.from_family_id, sw.to_family_id];
    const desc = `Swap of week ${a.week_no} ${a.year} (${creditValue(a)} credits) for week ${b.week_no} ${b.year} (${creditValue(b)} credits)`;
    run('INSERT INTO credit_ledger (family_id,year,amount,description,swap_id,created_by) VALUES (?,?,?,?,?,?)', gainer, cy, Math.abs(diff), desc, sw.id, user.id);
    run('INSERT INTO credit_ledger (family_id,year,amount,description,swap_id,created_by) VALUES (?,?,?,?,?,?)', payer, cy, -Math.abs(diff), desc, sw.id, user.id);
  }
  run("UPDATE swaps SET status='accepted', responded_by=?, responded_at=datetime('now') WHERE id=?", user.id, sw.id);
  releaseSwaps(a, 'swapped', user, sw.id); releaseSwaps(b, 'swapped', user, sw.id);
  closeEnquiries({ ...b, family_id: sw.from_family_id }, 'swapped', sw.from_family_id); closeEnquiries({ ...a, family_id: sw.to_family_id }, 'swapped');
  notify([sw.requester_id, ...familyAdmins(sw.from_family_id), ...familyAdmins(sw.to_family_id)].filter(i => i !== user.id),
    `Swap agreed! ${famName(sw.from_family_id)} now has ${weekLabel(b)} and ${famName(sw.to_family_id)} has ${weekLabel(a)}.`, '#/enquiries');
  audit(user.id, 'swap.accept', { id: sw.id });
}
route('POST', '/api/enquiries', ({ user, body }) => {
  need(user, isFamily(user), 'Only family members can enquire about weeks');
  resolveFirstRefusal();
  const w = q1('SELECT * FROM weeks WHERE id=?', body.week_id) || fail(404, 'Week not found');
  if (w.family_id === user.family_id) fail(400, 'That week is already your family’s');
  if (w.family_id == null || w.start_date < today()) fail(400, 'You can’t enquire about that week');
  if (w.in_use) fail(400, `${famName(w.family_id)} are using this week`);
  if (['pending', 'booked'].includes(w.status)) fail(400, 'That week has already been taken');
  let e = q1("SELECT * FROM enquiries WHERE week_id=? AND family_id=? AND status='open'", w.id, user.family_id);
  if (w.status === 'offered' && !e && !body.offered_week_id) fail(400, 'This week has been released, so you can book it straight away');
  if (e && !body.offered_week_id) fail(400, 'Your family has already enquired about this week');
  const isNew = !e; let off = null;
  tx(() => {
    if (!e) e = q1('SELECT * FROM enquiries WHERE id=?', run('INSERT INTO enquiries (week_id,family_id,user_id,message) VALUES (?,?,?,?)', w.id, user.family_id, user.id, body.message || null).lastInsertRowid);
    if (body.offered_week_id) {
      off = q1('SELECT * FROM weeks WHERE id=?', body.offered_week_id) || fail(404, 'Week not found');
      if (off.family_id !== user.family_id) fail(400, 'You can only offer one of your own family’s weeks');
      if (!swappable(off)) fail(400, 'That week can’t be offered (it’s marked Using it, let, or already past)');
      if (q1("SELECT 1 FROM swaps WHERE enquiry_id=? AND status IN ('pending','proposed')", e.id)) fail(400, 'Your family already has a swap offer on this week. Withdraw it first to offer a different week.');
      run("INSERT INTO swaps (requester_id,from_family_id,offered_week_id,to_family_id,target_week_id,message,status,enquiry_id) VALUES (?,?,?,?,?,?,'pending',?)", user.id, user.family_id, off.id, w.family_id, w.id, body.message || null, e.id);
    }
  });
  const queue = openEnquiries(w.id), pos = queue.findIndex(x => x.id === e.id) + 1;
  const who = `${user.name} (${famName(user.family_id)})`;
  notify(familyAdmins(w.family_id), isNew
    ? `${who} enquired about your ${weekLabel(w)}${off ? ` and offers their ${weekLabel(off)} in exchange` : ''}.${queue.length > 1 ? ` ${queue.length} families are now in the queue.` : ''}`
    : `${who} offers their ${weekLabel(off)} in exchange for your ${weekLabel(w)}.`, '#/enquiries');
  if (off && !isAdminOf(user, user.family_id)) notify(familyAdmins(user.family_id), `${user.name} offered your family’s ${weekLabel(off)} in exchange for ${famName(w.family_id)}’s ${weekLabel(w)}. If they accept, you’ll be asked to confirm.`, '#/enquiries');
  audit(user.id, 'enquiry.create', { id: e.id, offer: off && off.id }); return { id: e.id, position: pos, queue: queue.length };
});
route('GET', '/api/enquiries', ({ user }) => {
  need(user, isFamily(user), 'Enquiries are for syndicate families');
  expireHolds(); resolveFirstRefusal();
  const fid = user.family_id, s = settings(), now = nowSql();
  const view = e => {
    const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id), queue = openEnquiries(w.id);
    const offer = q1('SELECT * FROM swaps WHERE enquiry_id=? ORDER BY id DESC', e.id), ofw = offer && q1('SELECT * FROM weeks WHERE id=?', offer.offered_week_id);
    const windowOpen = w.status === 'offered' && w.enquiry_until && w.enquiry_until > now, ours = e.family_id === fid, live = offer && ['pending', 'proposed'].includes(offer.status);
    return { id: e.id, status: e.status, close_reason: e.close_reason, message: e.message, created_at: e.created_at, claim: e.claim,
      family: famName(e.family_id), user: q1('SELECT name FROM users WHERE id=?', e.user_id).name, mine: ours,
      week: { ...swapWeekView(w), family_name: famName(w.family_id), plan: planOf(w), state: w.status, member_price: memberPriceOf(w, s), first_refusal_until: windowOpen ? w.enquiry_until : null },
      position: e.status === 'open' ? queue.findIndex(x => x.id === e.id) + 1 : null, queue: queue.length,
      can_claim: ours && e.status === 'open' && windowOpen, can_withdraw: ours && e.status === 'open' && (e.user_id === user.id || isAdminOf(user, fid)),
      can_offer: ours && e.status === 'open' && !live && w.status !== 'offered',
      offer: offer && { id: offer.id, status: offer.status, decline_reason: offer.decline_reason, offered: swapWeekView(ofw), by: q1('SELECT name FROM users WHERE id=?', offer.requester_id).name,
        can_accept: offer.status === 'pending' && isAdminOf(user, offer.to_family_id), can_decline: live && isAdminOf(user, offer.to_family_id),
        can_confirm: offer.status === 'proposed' && isAdminOf(user, offer.from_family_id), can_cancel: live && (offer.requester_id === user.id || isAdminOf(user, offer.from_family_id)) } };
  };
  const incoming = q(`SELECT e.* FROM enquiries e JOIN weeks w ON w.id=e.week_id WHERE w.family_id=? AND e.family_id<>?
    AND (e.status='open' OR e.closed_at > datetime('now','-60 days')) ORDER BY w.start_date, e.created_at, e.id`, fid, fid);
  const outgoing = q(`SELECT * FROM enquiries WHERE family_id=? AND (status='open' OR closed_at > datetime('now','-60 days')) ORDER BY status<>'open', created_at DESC`, fid);
  const swaps = q("SELECT * FROM swaps WHERE status='accepted' AND (from_family_id=? OR to_family_id=?) ORDER BY responded_at DESC LIMIT 10", fid, fid).map(sw => ({
    id: sw.id, from_family: famName(sw.from_family_id), to_family: famName(sw.to_family_id), at: sw.responded_at,
    offered: swapWeekView(q1('SELECT * FROM weeks WHERE id=?', sw.offered_week_id)), target: swapWeekView(q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id)) }));
  return { incoming: incoming.map(view), outgoing: outgoing.map(view), swaps };
});
route('POST', '/api/enquiries/:id/claim', ({ user, params, body }) => {
  const e = q1("SELECT * FROM enquiries WHERE id=? AND status='open'", params.id) || fail(404, 'This enquiry is closed');
  need(user, isFamily(user) && user.family_id === e.family_id, 'Only the family that enquired can answer');
  const w = q1('SELECT * FROM weeks WHERE id=?', e.week_id), s = settings();
  if (!(w.status === 'offered' && w.enquiry_until && w.enquiry_until > nowSql())) fail(400, 'First refusal isn’t open for this week');
  if (body.want) {
    const method = body.method === 'account' ? 'account' : 'bank';
    if (method === 'account' && !(user.role === 'family_admin' || s.allow_member_account_charge === '1')) fail(403, 'Charging to a family account is not allowed for your login');
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
  tx(() => {
    run("UPDATE enquiries SET status='withdrawn', closed_at=datetime('now') WHERE id=?", e.id);
    run("UPDATE swaps SET status='cancelled' WHERE enquiry_id=? AND status IN ('pending','proposed')", e.id);
  });
  resolveFirstRefusal();
  return { ok: true };
});
route('POST', '/api/swaps/:id/accept', ({ user, params }) => {
  const sw = q1("SELECT * FROM swaps WHERE id=? AND status='pending'", params.id) || fail(404, 'This swap offer is no longer open');
  need(user, isAdminOf(user, sw.to_family_id), 'Only the family admin can accept a swap offer');
  const by = q1('SELECT * FROM users WHERE id=?', sw.requester_id);
  if (isAdminOf(by, sw.from_family_id)) { tx(() => doSwap(sw, user)); return { status: 'accepted' }; }
  run("UPDATE swaps SET status='proposed', proposed_by=?, proposed_at=datetime('now') WHERE id=?", user.id, sw.id);
  const w = q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id), off = q1('SELECT * FROM weeks WHERE id=?', sw.offered_week_id);
  notify([...familyAdmins(sw.from_family_id), sw.requester_id], `${famName(sw.to_family_id)} have accepted ${by.name}’s offer of your ${weekLabel(off)} for their ${weekLabel(w)}. Your family admin needs to confirm.`, '#/enquiries');
  return { status: 'proposed' };
});
route('POST', '/api/swaps/:id/respond', ({ user, params, body }) => {
  // holder declines a swap offer: 'in_use' (we're using it → the week becomes Using it, the queue closes) or 'unsure' (the enquiry stays in the queue)
  const sw = q1("SELECT * FROM swaps WHERE id=? AND status IN ('pending','proposed')", params.id) || fail(404, 'This swap offer is no longer open');
  need(user, isAdminOf(user, sw.to_family_id), 'Only the family admin can decline a swap offer');
  const target = q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id), reason = body.reason === 'in_use' ? 'in_use' : 'unsure';
  tx(() => {
    run("UPDATE swaps SET status='declined', decline_reason=?, responded_by=?, responded_at=datetime('now') WHERE id=?", reason, user.id, sw.id);
    if (reason === 'in_use' && !['pending', 'booked'].includes(target.status)) {
      run("UPDATE weeks SET in_use=1, offer_swap=0, offer_friends=0, status='own_use', released_at=NULL, enquiry_until=NULL WHERE id=?", target.id);
      const now = q1('SELECT * FROM weeks WHERE id=?', target.id); releaseSwaps(now, 'in_use', user, sw.id); closeEnquiries(now, 'using');
    }
  });
  notify([sw.requester_id, ...familyAdmins(sw.from_family_id)], reason === 'in_use'
    ? `${famName(sw.to_family_id)} declined the swap offer for ${weekLabel(target)}: they are using that week.`
    : `${famName(sw.to_family_id)} declined the swap offer for ${weekLabel(target)} for now. Your family stays in the queue for it.`, '#/enquiries');
  audit(user.id, 'swap.decline', { id: sw.id, reason }); return { ok: true };
});
route('POST', '/api/swaps/:id/confirm', ({ user, params, body }) => {
  const sw = q1("SELECT * FROM swaps WHERE id=? AND status='proposed'", params.id) || fail(404, 'Nothing to confirm');
  need(user, isAdminOf(user, sw.from_family_id), 'Only your family admin can confirm a swap');
  if (!body.accept) {
    run("UPDATE swaps SET status='cancelled' WHERE id=?", sw.id);
    notify(familyAdmins(sw.to_family_id), `${famName(sw.from_family_id)} have withdrawn their swap offer for ${weekLabel(q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id))}.`, '#/enquiries');
    return { ok: true };
  }
  tx(() => doSwap(sw, user)); return { ok: true };
});
route('POST', '/api/swaps/:id/cancel', ({ user, params }) => {
  const sw = q1("SELECT * FROM swaps WHERE id=? AND status IN ('pending','proposed')", params.id) || fail(404, 'This swap offer is no longer open');
  need(user, sw.requester_id === user.id || isAdminOf(user, sw.from_family_id));
  run("UPDATE swaps SET status='cancelled' WHERE id=?", sw.id);
  notify(familyAdmins(sw.to_family_id), `${famName(sw.from_family_id)} withdrew their swap offer for ${weekLabel(q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id))}.`, '#/enquiries');
  return { ok: true };
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
route('PUT', '/api/admin/settings', ({ user, body }) => {
  needAdmin(user);
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (body[k] !== undefined) run('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(body[k]));
  audit(user.id, 'settings.update', body); return { ok: true };
});
route('GET', '/api/admin/overview', ({ user }) => {
  needAdmin(user); expireHolds();
  const pending = q("SELECT b.*, u.name booker FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.status='pending' ORDER BY b.id").map(b => ({ ...b, week: q1('SELECT year,week_no,start_date FROM weeks WHERE id=?', b.week_id), seller: famName(b.seller_family_id) }));
  return { balances: balances(), pending };
});
route('GET', '/api/admin/families', ({ user }) => {
  needAdmin(user);
  return q('SELECT * FROM families ORDER BY name').map(f => ({ ...f, weeks: Object.fromEntries(q('SELECT year, COUNT(*) n FROM weeks WHERE original_family_id=? GROUP BY year', f.id).map(r => [r.year, r.n])),
    admins: q("SELECT name FROM users WHERE family_id=? AND role='family_admin' AND active=1", f.id).map(r => r.name) }));
});
route('POST', '/api/admin/families', ({ user, body }) => {
  needAdmin(user); if (!body.name) fail(400, 'Name required');
  const id = Number(run('INSERT INTO families (name,share_units,color) VALUES (?,?,?)', body.name.trim(), Number(body.share_units) || 1, body.color || '#6b8f71').lastInsertRowid);
  return { id };
});
route('PUT', '/api/admin/families/:id', ({ user, params, body }) => {
  needAdmin(user); const f = q1('SELECT * FROM families WHERE id=?', params.id) || fail(404, 'Not found');
  run('UPDATE families SET name=?, share_units=?, color=?, active=? WHERE id=?', body.name ?? f.name, body.share_units != null ? Number(body.share_units) : f.share_units, body.color ?? f.color, body.active != null ? (body.active ? 1 : 0) : f.active, f.id);
  return { ok: true };
});
route('POST', '/api/admin/families/shares-from-weeks', ({ user, body }) => {
  needAdmin(user); const y = Number(body.year);
  const rows = q('SELECT original_family_id fid, COUNT(*) n FROM weeks WHERE year=? AND original_family_id IS NOT NULL GROUP BY original_family_id', y);
  if (!rows.length) fail(400, `No week allocation for ${y}`);
  tx(() => { for (const r of rows) run('UPDATE families SET share_units=? WHERE id=?', r.n, r.fid); }); return { ok: true };
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
      run('UPDATE weeks SET family_id=?, original_family_id=?, status=? , offer_friends=0, offer_swap=0 WHERE id=?', f ? f.id : null, f ? f.id : null, f ? 'own_use' : 'syndicate', w.id);
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
    run("UPDATE weeks SET family_id=?, original_family_id=?, status=?, offer_friends=0, offer_swap=0 WHERE id=?", f, f, f ? 'own_use' : 'syndicate', w.id); } });
  return { ok: true };
});

// budget. Service charge = charge per week × each family's weeks (shares). By default the charge per week is
// budget ÷ total weeks; the admin can set a rounded figure, and the shortfall/surplus against the budget is shown.
function budgetSummary(year) {
  const items = q('SELECT * FROM budget_items WHERE year=? ORDER BY sort, id', year);
  const total = round2(items.reduce((a, b) => a + b.amount, 0));
  const fams = q('SELECT * FROM families WHERE active=1 ORDER BY name'); const units = fams.reduce((a, f) => a + f.share_units, 0) || 1;
  const by = q1('SELECT * FROM budget_years WHERE year=?', year) || {};
  const calc = round2(total / units); const rate = by.rate_per_week != null ? by.rate_per_week : calc;
  const charged = Object.fromEntries(q("SELECT family_id, SUM(amount) a FROM ledger WHERE year=? AND type='service_charge' GROUP BY family_id", year).map(r => [r.family_id, round2(r.a)]));
  const split = fams.map(f => ({ id: f.id, name: f.name, color: f.color, share_units: f.share_units, pct: f.share_units / units * 100, charge: round2(rate * f.share_units), charged: charged[f.id] ?? null }));
  const raised = round2(split.reduce((a, f) => a + f.charge, 0));
  return { year, items, total, units, label: by.label || '', rate_calc: calc, rate_per_week: by.rate_per_week ?? null, rate, raised, difference: round2(raised - total), split, generated: Object.keys(charged).length > 0 };
}
route('GET', '/api/admin/budget', ({ user, query }) => {
  needAdmin(user);
  const years = q('SELECT DISTINCT year FROM budget_items UNION SELECT DISTINCT year FROM weeks UNION SELECT year FROM budget_years ORDER BY 1').map(r => r.year);
  return { ...budgetSummary(Number(query.year)), years };
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
  const id = Number(run('INSERT INTO budget_items (year,category,description,amount,sort,notes) VALUES (?,?,?,?,?,?)', Number(body.year), body.category || null, body.description, Number(body.amount) || 0, Number(body.sort) || 999, body.notes || null).lastInsertRowid);
  return { id };
});
route('PUT', '/api/admin/budget/:id', ({ user, params, body }) => {
  needAdmin(user); const it = q1('SELECT * FROM budget_items WHERE id=?', params.id) || fail(404, 'Not found');
  run('UPDATE budget_items SET category=?, description=?, amount=?, notes=? WHERE id=?', body.category ?? it.category, body.description ?? it.description, body.amount != null ? Number(body.amount) || 0 : it.amount, body.notes ?? it.notes, it.id); return { ok: true };
});
route('DELETE', '/api/admin/budget/:id', ({ user, params }) => { needAdmin(user); run('DELETE FROM budget_items WHERE id=?', params.id); return { ok: true }; });
route('POST', '/api/admin/budget/copy', ({ user, body }) => {
  needAdmin(user); const from = Number(body.from), to = Number(body.to), up = 1 + (Number(body.uplift_pct) || 0) / 100;
  if (q1('SELECT 1 FROM budget_items WHERE year=?', to)) fail(400, `${to} already has budget lines — delete them first or edit directly`);
  tx(() => { for (const it of q('SELECT * FROM budget_items WHERE year=?', from)) run('INSERT INTO budget_items (year,category,description,amount,sort,notes) VALUES (?,?,?,?,?,?)', to, it.category, it.description, round2(it.amount * up), it.sort, it.notes); });
  return { ok: true };
});
route('POST', '/api/admin/budget/import', ({ user, body }) => {
  needAdmin(user); const year = Number(body.year); const items = (body.items || []).filter(i => i.description && !isNaN(Number(i.amount)));
  tx(() => { if (body.replace) run('DELETE FROM budget_items WHERE year=?', year);
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
route('GET', '/api/credits', ({ user, query }) => {
  need(user, isFamily(user) || user.is_site_admin, 'Credits are for syndicate families');
  return creditSummary(Number(query.year) || new Date().getFullYear());
});
route('GET', '/api/credits/history', ({ user, query }) => {
  need(user, isFamily(user) || user.is_site_admin);
  const fid = user.is_site_admin && query.family_id ? Number(query.family_id) : user.family_id;
  return q('SELECT * FROM credit_ledger WHERE family_id=? ORDER BY year DESC, id DESC', fid);
});
route('POST', '/api/admin/credits', ({ user, body }) => {
  needAdmin(user); const amt = Math.round(Number(body.amount)); if (!amt) fail(400, 'Amount required');
  run('INSERT INTO credit_ledger (family_id,year,amount,description,created_by) VALUES (?,?,?,?,?)', Number(body.family_id), Number(body.year), amt, body.description || 'Adjustment by site admin', user.id);
  audit(user.id, 'credits.adjust', body); return { ok: true };
});
route('POST', '/api/admin/pot/distribute', ({ user, body }) => {
  needAdmin(user); const year = Number(body.year); const c = creditSummary(year); const cur = settings().currency;
  if (!c.pot.net) fail(400, `No let income for ${year} yet`);
  if (!c.pot.total_points) fail(400, `No family released weeks in ${year}`);
  tx(() => {
    run('DELETE FROM ledger WHERE pot_year=?', year);
    for (const r of c.rows) if (r.pot_share) run("INSERT INTO ledger (family_id,year,type,description,amount,created_by,pot_year) VALUES (?,?,'rental_credit',?,?,?,?)",
      r.id, year + 1, `${year} let-income pot: ${r.release_points} of ${c.pot.total_points} release points (pot ${cur}${c.pot.net.toLocaleString('en-GB')})`, -r.pot_share, user.id, year);
  });
  for (const r of c.rows) if (r.pot_share) notify(familyAdmins(r.id), `Your share of the ${year} let-income pot, ${cur}${r.pot_share.toLocaleString('en-GB')}, has been credited against your ${year + 1} service charge.`, '#/account');
  audit(user.id, 'pot.distribute', { year, net: c.pot.net }); return { ok: true };
});
route('POST', '/api/admin/ledger', ({ user, body }) => {
  needAdmin(user); const amt = Number(body.amount); if (!amt) fail(400, 'Amount required');
  const type = body.type === 'payment' ? 'payment' : 'adjustment';
  run('INSERT INTO ledger (family_id,year,type,description,amount,created_by) VALUES (?,?,?,?,?,?)', Number(body.family_id), Number(body.year), type,
    body.description || (type === 'payment' ? 'Payment received – thank you' : 'Adjustment'), type === 'payment' ? -Math.abs(amt) : amt, user.id);
  return { ok: true };
});
route('GET', '/api/admin/audit', ({ user }) => { needAdmin(user); return q('SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200'); });

// ---------------------------------------------------------------- server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
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
    creditMemo = new Map();
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname)); if (!r) fail(404, 'Not found');
    const params = url.pathname.match(r.re).groups || {};
    const out = await r.handler({ req, res, body, params, query: Object.fromEntries(url.searchParams), user: currentUser(req) });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out ?? {}));
  } catch (e) {
    if (!e.status) console.error(e);
    res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.status ? e.message : 'Server error' }));
  }
});

// ---------------------------------------------------------------- demo seed (first run only)
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
  // a few demo offers so the letting and swap features have something to show
  const plan = (n, f) => run(`UPDATE weeks SET ${f} WHERE year=2027 AND week_no=?`, n);
  for (const n of [19, 33, 37, 52]) plan(n, "status='offered', offer_friends=1, released_at=datetime('now','-8 days')"); // released
  for (const n of [8, 21, 30, 44]) plan(n, 'offer_swap=1');                                         // willing to swap
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
}
// Until the site admin has set a password, print their set-up link on every start (visible in the host's logs).
for (const u of q("SELECT name, invite_token FROM users WHERE is_site_admin=1 AND invite_token IS NOT NULL AND password_hash IS NULL")) console.log(`Site admin set-up link for ${u.name}: ${BASE_URL}/#/invite/${u.invite_token}`);

server.listen(PORT, () => console.log(`Nab Camas portal running at ${BASE_URL} (database: ${DB_FILE}${VOLUME ? `, volume: ${VOLUME}` : ''})`));
setTimeout(() => { try { runReminders(); } catch (e) { console.error('reminders', e); } }, 5000);
setInterval(() => { try { runReminders(); } catch (e) { console.error('reminders', e); } }, 6 * 3600 * 1000).unref();
