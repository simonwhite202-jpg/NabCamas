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
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'camas.db');
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
  role TEXT NOT NULL CHECK (role IN ('family_admin','family_member','friend')),
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
};
function settings() { const s = { ...DEFAULT_SETTINGS }; for (const r of q('SELECT key,value FROM settings')) s[r.key] = r.value; return s; }
const rateFor = (season, s = settings()) => Number(s['rate_' + season]) || 0;
const priceOf = (w, s = settings()) => w.price_override != null ? w.price_override : rateFor(w.season, s);

function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); }
function checkPw(pw, h) { if (!h) return false; const [salt, hex] = h.split(':'); const a = Buffer.from(hex, 'hex'); const b = crypto.scryptSync(pw, salt, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); }
const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

function notify(userIds, text, link) { for (const id of new Set(userIds)) { run('INSERT INTO notifications (user_id,text,link) VALUES (?,?,?)', id, text, link || null); } sendEmail(userIds, text); }
function sendEmail(userIds, text) {
  // Hook for real email (SMTP / Resend / SES). For now logs to console.
  for (const id of new Set(userIds)) { const u = q1('SELECT email FROM users WHERE id=?', id); if (u && u.email) console.log(`[email → ${u.email}] ${text}`); }
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
  const v = { ...w, family_name: w.family_id ? famName(w.family_id) : 'Syndicate', price: priceOf(w, s) };
  v.family_color = w.family_id ? q1('SELECT color FROM families WHERE id=?', w.family_id).color : '#9aa1a9';
  const mine = u.family_id === w.family_id && isFamily(u);
  const b = q1("SELECT * FROM bookings WHERE week_id=? AND status IN ('pending','confirmed') ORDER BY id DESC", w.id);
  if (b) {
    const seeGuest = u.is_site_admin || b.user_id === u.id || (isFamily(u) && (u.family_id === w.family_id || u.family_id === b.buyer_family_id));
    v.booking = { id: b.id, status: b.status, mine: b.user_id === u.id, guest: seeGuest ? (b.guest_name || q1('SELECT name FROM users WHERE id=?', b.user_id).name) : null, reference: seeGuest ? b.reference : null, expires_at: b.expires_at };
  }
  // what this user can do
  const friendVisible = w.offer_friends && (w.sale_to === 'all' || (w.sale_to === 'own' && u.family_id === w.family_id));
  v.can_book = w.status === 'offered' && !!w.offer_friends && !mine && w.start_date >= today() && ((u.role === 'friend' && friendVisible) || isFamily(u));
  v.plan = planOf(w);
  v.can_request_swap = isFamily(u) && !mine && swappable(w);
  v.swappable = swappable(w);
  v.can_manage = canManageFamily(u, w.family_id) && w.family_id != null;
  v.is_mine = mine;
  if (u.role === 'friend' && !friendVisible && w.status === 'offered') v.status = 'own_use'; // friends only see what's offered to them
  if (u.role === 'friend') { v.offer_swap = 0; v.in_use = 0; v.plan = null; }
  v.pending_swaps = isFamily(u) ? q1("SELECT COUNT(*) n FROM swaps WHERE status IN ('pending','proposed') AND target_week_id=?", w.id).n : 0;
  return v;
}
const today = () => new Date().toISOString().slice(0, 10);
// A week can be asked for (or offered) in a swap if a family holds it, it isn't let/reserved, its family hasn't marked it in use, and it's in the future.
const swappable = w => w.family_id != null && !w.in_use && !['pending', 'booked', 'syndicate'].includes(w.status) && w.start_date >= today();
const PLANS = ['undecided', 'using', 'swap', 'sell', 'swap_sell'];
const planOf = w => w.in_use ? 'using' : w.offer_swap && w.offer_friends ? 'swap_sell' : w.offer_swap ? 'swap' : w.offer_friends ? 'sell' : 'undecided';
// weeks a family has marked "willing to swap" that can still be exchanged
const willingWeeks = fid => q("SELECT * FROM weeks WHERE family_id=? AND offer_swap=1 ORDER BY start_date", fid).filter(swappable);
const swapWeekView = w => w && { id: w.id, year: w.year, week_no: w.week_no, start_date: w.start_date, end_date: w.end_date, season: w.season, comment: w.comment };

// Called whenever a week stops being available, so swap requests that depend on it don't hang around.
//  - requests FOR the week are declined ('in_use') or voided (let / reserved / swapped)
//  - proposals that would GIVE the week in exchange go back to "pending" so the other family can choose again
function releaseSwaps(w, why, byUser, exceptId = 0) {
  for (const sw of q("SELECT * FROM swaps WHERE status IN ('pending','proposed') AND target_week_id=? AND id<>?", w.id, exceptId)) {
    if (why === 'in_use') {
      run("UPDATE swaps SET status='declined', decline_reason='in_use', responded_by=?, responded_at=datetime('now') WHERE id=?", byUser ? byUser.id : null, sw.id);
      notify([sw.requester_id, ...familyAdmins(sw.from_family_id)], `${famName(w.family_id)} are using ${weekLabel(w)}, so the swap request for it was declined.`, '#/swaps');
    } else {
      run("UPDATE swaps SET status='void' WHERE id=?", sw.id);
      notify([sw.requester_id], `The swap request for ${weekLabel(w)} is no longer possible because that week has been ${why}.`, '#/swaps');
    }
  }
  for (const sw of q("SELECT * FROM swaps WHERE status='proposed' AND offered_week_id=? AND id<>?", w.id, exceptId)) {
    run("UPDATE swaps SET status='pending', offered_week_id=NULL, proposed_by=NULL, proposed_at=NULL, reply_note=? WHERE id=?", `${weekLabel(w)} is no longer available to swap`, sw.id);
    notify(familyAdmins(sw.to_family_id), `${weekLabel(w)}, which you chose in a swap, is no longer available. Please choose another week or decline the request.`, '#/swaps');
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
  run("INSERT INTO ledger (family_id,year,type,description,amount,booking_id,created_by) VALUES (?,?,?,?,?,?,?)",
    b.seller_family_id, w.year + 1, 'rental_credit',
    `Week ${w.week_no} ${w.year} let to ${b.guest_name || buyer.name}${commission ? ` (less ${s.commission_pct}% syndicate commission)` : ''}`, -credit, b.id, byUser.id);
  if (b.method === 'account') run("INSERT INTO ledger (family_id,year,type,description,amount,booking_id,created_by) VALUES (?,?,?,?,?,?,?)",
    b.buyer_family_id, w.year, 'purchase', `Bought week ${w.week_no} ${w.year} from ${famName(b.seller_family_id)}`, b.amount, b.id, byUser.id);
  releaseSwaps(w, 'let', byUser);
  notify([b.user_id], `Confirmed: ${weekLabel(w)} is booked. Reference ${b.reference}.`, '#/bookings');
  notify(familyAdmins(b.seller_family_id), `${weekLabel(w)} has been let to ${b.guest_name || buyer.name}. ${s.currency}${credit} credited to your account against ${w.year + 1} service charges.`, '#/account');
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
  need(user, true); const s = settings();
  const unread = q1('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', user.id).n;
  const years = q('SELECT DISTINCT year FROM weeks ORDER BY year').map(r => r.year);
  const pub = { site_name: s.site_name, currency: s.currency, rate_summer: +s.rate_summer, rate_shoulder: +s.rate_shoulder, rate_winter: +s.rate_winter, hold_days: +s.hold_days,
    bank: { name: s.bank_name, account_name: s.bank_account_name, sort_code: s.bank_sort_code, account_no: s.bank_account_no, iban: s.bank_iban }, allow_member_account_charge: s.allow_member_account_charge === '1' };
  const fam = user.family_id ? q1('SELECT * FROM families WHERE id=?', user.family_id) : null;
  const pendingSwaps = user.role === 'family_admin' ? q1("SELECT COUNT(*) n FROM swaps WHERE (status='pending' AND to_family_id=?) OR (status='proposed' AND from_family_id=?)", user.family_id, user.family_id).n : 0;
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
route('GET', '/api/weeks', ({ user, query }) => {
  need(user, true); expireHolds(); const s = settings();
  const year = Number(query.year) || new Date().getFullYear();
  return q('SELECT * FROM weeks WHERE year=? ORDER BY week_no', year).map(w => weekView(w, user, s));
});
route('PUT', '/api/weeks/:id', ({ user, params, body }) => {
  const w = q1('SELECT * FROM weeks WHERE id=?', params.id) || fail(404, 'Week not found');
  need(user, canManageFamily(user, w.family_id), 'Only this week’s family admin can change it');
  if (['pending', 'booked'].includes(w.status)) fail(400, 'This week has a booking. Cancel the booking first.');
  const plan = body.plan !== undefined ? body.plan : planOf(w);
  if (!PLANS.includes(plan)) fail(400, 'Unknown setting');
  const using = plan === 'using', swap = plan === 'swap' || plan === 'swap_sell', sell = plan === 'sell' || plan === 'swap_sell';
  const price = body.price_override === undefined ? w.price_override : body.price_override === '' || body.price_override == null ? null : Number(body.price_override);
  if (price != null && (isNaN(price) || price < 0)) fail(400, 'Price must be a positive number');
  const saleTo = ['members', 'all', 'own'].includes(body.sale_to) ? body.sale_to : w.sale_to;
  tx(() => {
    run('UPDATE weeks SET status=?, offer_friends=?, offer_swap=?, in_use=?, sale_to=?, price_override=?, note=? WHERE id=?',
      sell ? 'offered' : 'own_use', sell ? 1 : 0, swap ? 1 : 0, using ? 1 : 0, saleTo, price, body.note !== undefined ? body.note || null : w.note, w.id);
    const now = q1('SELECT * FROM weeks WHERE id=?', w.id);
    if (using && !w.in_use) releaseSwaps(now, 'in_use', user);
    else if (!swap && w.offer_swap) for (const sw of q("SELECT * FROM swaps WHERE status='proposed' AND offered_week_id=?", w.id)) {
      run("UPDATE swaps SET status='pending', offered_week_id=NULL, proposed_by=NULL, proposed_at=NULL, reply_note=? WHERE id=?", `${weekLabel(w)} is no longer marked willing to swap`, sw.id);
      notify(familyAdmins(sw.to_family_id), `${weekLabel(w)}, which you chose in a swap, is no longer marked willing to swap. Please choose another week or decline.`, '#/swaps');
    }
  });
  audit(user.id, 'week.update', { week: w.id, ...body });
  return { ok: true };
});

// --- bookings
route('POST', '/api/weeks/:id/book', ({ user, params, body }) => {
  need(user, true); expireHolds(); const s = settings();
  const w = q1('SELECT * FROM weeks WHERE id=?', params.id) || fail(404, 'Week not found');
  const v = weekView(w, user, s); if (!v.can_book) fail(400, 'This week is not available for you to book');
  const method = body.method === 'account' ? 'account' : 'bank';
  if (method === 'account' && !(isFamily(user) && (user.role === 'family_admin' || s.allow_member_account_charge === '1'))) fail(403, 'Charging to a family account is not allowed for your login');
  const ref = `NC${String(w.year).slice(2)}W${String(w.week_no).padStart(2, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const id = tx(() => {
    const r = run("UPDATE weeks SET status='pending' WHERE id=? AND status='offered'", w.id); if (!r.changes) fail(409, 'Sorry — someone else has just booked this week');
    const ins = run("INSERT INTO bookings (week_id,user_id,seller_family_id,buyer_family_id,amount,method,status,reference,guest_name,party_size,notes,expires_at) VALUES (?,?,?,?,?,?,'pending',?,?,?,?,datetime('now', ?))",
      w.id, user.id, w.family_id, isFamily(user) ? user.family_id : null, v.price, method, ref, body.guest_name || null, Number(body.party_size) || null, body.notes || null, `+${Number(s.hold_days) || 3} days`);
    releaseSwaps(w, 'reserved by someone buying it', user);
    return Number(ins.lastInsertRowid);
  });
  const b = q1('SELECT * FROM bookings WHERE id=?', id);
  if (method === 'account') tx(() => confirmBooking(b, user));
  else {
    notify(familyAdmins(w.family_id), `${user.name} has reserved ${weekLabel(w)} and is paying ${s.currency}${v.price} by bank transfer (ref ${ref}).`, '#/calendar');
    notify(siteAdmins(), `Payment expected: ${s.currency}${v.price} from ${user.name} for ${weekLabel(w)}, reference ${ref}.`, '#/admin/payments');
  }
  if (method === 'account') notify(familyAdmins(user.family_id).filter(i => i !== user.id), `${user.name} bought ${weekLabel(w)} from ${famName(w.family_id)} for ${s.currency}${v.price}, charged to your family account.`, '#/account');
  audit(user.id, 'booking.create', { booking: id, method });
  return q1('SELECT * FROM bookings WHERE id=?', id);
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

// --- swaps
// 1. A family member asks for another family's week (anything not marked "using it"). Their family must have at least one
//    week marked "willing to swap".   status: pending
// 2. The owning family's admin chooses one of the requester family's willing-to-swap weeks   → proposed
//    …or declines: "we're using it" (week becomes Using it) or "not sure yet"                → declined
// 3. The requesting family's admin confirms (weeks change hands)                               → accepted
//    …or turns that week down, and the owning family can choose again                         → pending
// Swap decisions belong to the families' own admins (a site admin acts only for their own family here).
const isAdminOf = (u, fid) => u && u.role === 'family_admin' && u.family_id === fid;
const swapAction = sw => sw.status === 'pending' ? 'receiver' : sw.status === 'proposed' ? 'requester' : null;
route('POST', '/api/swaps', ({ user, body }) => {
  need(user, isFamily(user), 'Only family members can request swaps');
  const target = q1('SELECT * FROM weeks WHERE id=?', body.target_week_id) || fail(404, 'Week not found');
  if (target.family_id === user.family_id) fail(400, 'That week already belongs to your family');
  if (!swappable(target)) fail(400, target.in_use ? `${famName(target.family_id)} are using this week` : 'That week can’t be swapped (it may be let, reserved or in the past)');
  if (!willingWeeks(user.family_id).length) fail(400, user.role === 'family_admin'
    ? 'Your family has no weeks marked “willing to swap”. Mark at least one under My weeks first, so the other family can choose what they get in exchange.'
    : 'Your family has no weeks marked “willing to swap”. Ask your family admin to mark some under My weeks first.');
  if (q1("SELECT 1 FROM swaps WHERE status IN ('pending','proposed') AND target_week_id=? AND from_family_id=?", target.id, user.family_id)) fail(400, 'Your family has already asked for this week');
  const id = Number(run("INSERT INTO swaps (requester_id,from_family_id,to_family_id,target_week_id,message,status) VALUES (?,?,?,?,?,'pending')",
    user.id, user.family_id, target.family_id, target.id, body.message || null).lastInsertRowid);
  notify(familyAdmins(target.family_id), `Swap request from ${user.name} (${famName(user.family_id)}) for your ${weekLabel(target)}. Choose one of their weeks in exchange, or decline.`, '#/swaps');
  notify(familyAdmins(user.family_id).filter(i => i !== user.id), `${user.name} asked ${famName(target.family_id)} to swap for their ${weekLabel(target)}. They may choose one of your “willing to swap” weeks; you’ll be asked to confirm.`, '#/swaps');
  audit(user.id, 'swap.create', { id }); return { id };
});
route('GET', '/api/swaps', ({ user }) => {
  need(user, isFamily(user) || user.is_site_admin, 'Swaps are for family members');
  const rows = user.is_site_admin && !isFamily(user) ? q('SELECT * FROM swaps ORDER BY id DESC') : q('SELECT * FROM swaps WHERE from_family_id=? OR to_family_id=? ORDER BY id DESC', user.family_id, user.family_id);
  return rows.map(sw => {
    const open = ['pending', 'proposed'].includes(sw.status);
    const canChoose = sw.status === 'pending' && isAdminOf(user, sw.to_family_id);
    return { ...sw, target: swapWeekView(q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id)), offered: swapWeekView(sw.offered_week_id && q1('SELECT * FROM weeks WHERE id=?', sw.offered_week_id)),
      from_family: famName(sw.from_family_id), to_family: famName(sw.to_family_id), requester: q1('SELECT name FROM users WHERE id=?', sw.requester_id).name,
      proposer: sw.proposed_by ? q1('SELECT name FROM users WHERE id=?', sw.proposed_by).name : null,
      incoming: sw.to_family_id === user.family_id, waiting_on: swapAction(sw),
      options: canChoose || (sw.status === 'pending' && sw.to_family_id === user.family_id) ? willingWeeks(sw.from_family_id).map(swapWeekView) : undefined,
      can_choose: canChoose, can_decline: open && isAdminOf(user, sw.to_family_id),
      can_confirm: sw.status === 'proposed' && isAdminOf(user, sw.from_family_id),
      can_cancel: open && (sw.requester_id === user.id || isAdminOf(user, sw.from_family_id)) };
  });
});
route('POST', '/api/swaps/:id/choose', ({ user, params, body }) => {
  const sw = q1("SELECT * FROM swaps WHERE id=? AND status='pending'", params.id) || fail(404, 'This request is no longer waiting for a choice');
  need(user, isAdminOf(user, sw.to_family_id), 'Only the family admin can choose a week');
  const target = q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id);
  const pick = q1('SELECT * FROM weeks WHERE id=?', body.week_id) || fail(404, 'Week not found');
  if (pick.family_id !== sw.from_family_id || !pick.offer_swap || !swappable(pick)) fail(400, 'That week isn’t one of their “willing to swap” weeks any more');
  if (target.family_id !== sw.to_family_id || !swappable(target)) fail(409, 'Your week has changed since the request was made');
  run("UPDATE swaps SET status='proposed', offered_week_id=?, proposed_by=?, proposed_at=datetime('now'), reply_note=? WHERE id=?", pick.id, user.id, body.note || null, sw.id);
  notify([...familyAdmins(sw.from_family_id), sw.requester_id], `${famName(sw.to_family_id)} will swap their ${weekLabel(target)} for your ${weekLabel(pick)}. Your family admin needs to confirm.`, '#/swaps');
  audit(user.id, 'swap.choose', { id: sw.id, week: pick.id }); return { ok: true };
});
route('POST', '/api/swaps/:id/respond', ({ user, params, body }) => {
  // receiving family declines: 'in_use' (we're using it → week becomes Using it) or 'unsure' (not sure yet; can be asked again later)
  const sw = q1("SELECT * FROM swaps WHERE id=? AND status IN ('pending','proposed')", params.id) || fail(404, 'No open swap request');
  need(user, isAdminOf(user, sw.to_family_id), 'Only the receiving family’s admin can respond');
  const target = q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id);
  const reason = body.reason === 'in_use' ? 'in_use' : 'unsure';
  tx(() => {
    run("UPDATE swaps SET status='declined', decline_reason=?, responded_by=?, responded_at=datetime('now') WHERE id=?", reason, user.id, sw.id);
    if (reason === 'in_use' && !['pending', 'booked'].includes(target.status)) {
      run("UPDATE weeks SET in_use=1, offer_swap=0, offer_friends=0, status='own_use' WHERE id=?", target.id);
      releaseSwaps(q1('SELECT * FROM weeks WHERE id=?', target.id), 'in_use', user, sw.id);
    }
  });
  notify([sw.requester_id, ...familyAdmins(sw.from_family_id)], reason === 'in_use'
    ? `${famName(sw.to_family_id)} declined the swap request for ${weekLabel(target)}: they are using that week.`
    : `${famName(sw.to_family_id)} declined the swap request for ${weekLabel(target)} for now: they aren’t sure of their plans yet. You can ask again later.`, '#/swaps');
  audit(user.id, 'swap.decline', { id: sw.id, reason }); return { ok: true };
});
route('POST', '/api/swaps/:id/confirm', ({ user, params, body }) => {
  const sw = q1("SELECT * FROM swaps WHERE id=? AND status='proposed'", params.id) || fail(404, 'Nothing to confirm');
  need(user, isAdminOf(user, sw.from_family_id), 'Only your family admin can confirm a swap');
  const a = q1('SELECT * FROM weeks WHERE id=?', sw.offered_week_id), b = q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id);
  if (!body.accept) {
    run("UPDATE swaps SET status='pending', offered_week_id=NULL, proposed_by=NULL, proposed_at=NULL, reply_note=? WHERE id=?", `${famName(sw.from_family_id)} would rather not give ${weekLabel(a)}${body.note ? `: ${body.note}` : ''}`, sw.id);
    notify(familyAdmins(sw.to_family_id), `${famName(sw.from_family_id)} would rather not give ${weekLabel(a)} for your ${weekLabel(b)}. You can choose a different week or decline.`, '#/swaps');
    return { ok: true };
  }
  tx(() => {
    if (a.family_id !== sw.from_family_id || b.family_id !== sw.to_family_id || !swappable(a) || ['pending', 'booked'].includes(b.status)) fail(409, 'One of the weeks has changed since this was proposed');
    // Holders change for this year only; next year's allocation is unaffected. Both families now plan to use their new weeks.
    run("UPDATE weeks SET family_id=?, status='own_use', offer_friends=0, offer_swap=0, in_use=1, price_override=NULL, note=? WHERE id=?", sw.to_family_id, `Swapped from ${famName(sw.from_family_id)}`, a.id);
    run("UPDATE weeks SET family_id=?, status='own_use', offer_friends=0, offer_swap=0, in_use=1, price_override=NULL, note=? WHERE id=?", sw.from_family_id, `Swapped from ${famName(sw.to_family_id)}`, b.id);
    run("UPDATE swaps SET status='accepted', responded_by=?, responded_at=datetime('now') WHERE id=?", user.id, sw.id);
    releaseSwaps(a, 'swapped', user, sw.id); releaseSwaps(b, 'swapped', user, sw.id);
  });
  notify([sw.requester_id, ...familyAdmins(sw.from_family_id), ...familyAdmins(sw.to_family_id)].filter(i => i !== user.id),
    `Swap agreed! ${famName(sw.from_family_id)} now has ${weekLabel(b)} and ${famName(sw.to_family_id)} has ${weekLabel(a)}.`, '#/swaps');
  audit(user.id, 'swap.accept', { id: sw.id }); return { ok: true };
});
route('POST', '/api/swaps/:id/cancel', ({ user, params }) => {
  const sw = q1("SELECT * FROM swaps WHERE id=? AND status IN ('pending','proposed')", params.id) || fail(404, 'No open swap request');
  need(user, sw.requester_id === user.id || isAdminOf(user, sw.from_family_id));
  run("UPDATE swaps SET status='cancelled' WHERE id=?", sw.id);
  notify(familyAdmins(sw.to_family_id), `${famName(sw.from_family_id)} withdrew their swap request for ${weekLabel(q1('SELECT * FROM weeks WHERE id=?', sw.target_week_id))}.`, '#/swaps');
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
  const fid = user.is_site_admin && body.family_id ? Number(body.family_id) : user.family_id;
  const role = ['family_admin', 'family_member', 'friend'].includes(body.role) ? body.role : 'friend';
  if (!canManageFamily(user, fid)) need(user, isFamily(user) && fid === user.family_id && role === 'friend', 'Family members can add trusted friends; only a family admin can add family members');
  if (!body.name) fail(400, 'Name is required');
  const email = (body.email || '').trim() || null;
  if (email && q1('SELECT 1 FROM users WHERE lower(email)=lower(?)', email)) fail(400, 'Someone with that email already has a login');
  const inv = email ? token(18) : null;
  const id = Number(run('INSERT INTO users (family_id,name,email,phone,relationship,notes,role,invite_token,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    fid, body.name, email, body.phone || null, body.relationship || null, body.notes || null, role, inv, user.id).lastInsertRowid);
  if (email) console.log(`[email → ${email}] You've been invited to ${settings().site_name}: ${BASE_URL}/#/invite/${inv}`);
  if (role === 'friend' && user.role !== 'family_admin') notify(familyAdmins(fid), `${user.name} added ${body.name} as a trusted friend.`, '#/people');
  audit(user.id, 'person.add', { id, role });
  return { id, invite_link: inv ? `${BASE_URL}/#/invite/${inv}` : null };
});
route('PUT', '/api/people/:id', ({ user, params, body }) => {
  const p = q1('SELECT * FROM users WHERE id=?', params.id) || fail(404, 'Not found');
  const self = p.id === user.id;
  need(user, self || canManageFamily(user, p.family_id) || (p.role === 'friend' && p.created_by === user.id));
  const manage = canManageFamily(user, p.family_id);
  let role = p.role;
  if (manage && body.role && ['family_admin', 'family_member', 'friend'].includes(body.role)) role = body.role;
  if (p.role === 'family_admin' && role !== 'family_admin' && q1("SELECT COUNT(*) n FROM users WHERE family_id=? AND role='family_admin' AND active=1", p.family_id).n < 2) fail(400, 'Each family needs at least one family admin');
  const email = body.email !== undefined ? (body.email || '').trim() || null : p.email;
  if (email && q1('SELECT 1 FROM users WHERE lower(email)=lower(?) AND id<>?', email, p.id)) fail(400, 'That email is already used');
  run('UPDATE users SET name=?, email=?, phone=?, relationship=?, notes=?, role=?, is_site_admin=?, family_id=? WHERE id=?',
    body.name ?? p.name, email, body.phone ?? p.phone, body.relationship ?? p.relationship, body.notes ?? p.notes, role,
    user.is_site_admin && body.is_site_admin !== undefined ? (body.is_site_admin ? 1 : 0) : p.is_site_admin,
    user.is_site_admin && body.family_id ? Number(body.family_id) : p.family_id, p.id);
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
  tx(() => { for (const [wk, fam, comment] of ALLOC_2027) run("UPDATE weeks SET family_id=?, original_family_id=?, status='own_use', comment=? WHERE year=2027 AND week_no=?", fid(fam), fid(fam), comment || null, wk); });
  // LIVE mode (ADMIN_EMAIL set): create only the real site admin, who sets a password via the invite link printed in the log.
  // Otherwise create demo logins for trying the site out.
  if (process.env.ADMIN_EMAIL) {
    run("INSERT INTO users (family_id,name,email,role,is_site_admin,invite_token) VALUES (?,?,?,'family_admin',1,?)", fid(process.env.ADMIN_FAMILY || 'White'), process.env.ADMIN_NAME || 'Site admin', process.env.ADMIN_EMAIL.trim(), token(18));
  } else {
  const pw = hashPw('demo1234');
  const add = (f, name, email, role, admin = 0, rel = null) => run('INSERT INTO users (family_id,name,email,role,is_site_admin,password_hash,relationship) VALUES (?,?,?,?,?,?,?)', fid(f), name, email, role, admin, pw, rel);
  add('White', 'Site Admin (White)', 'admin@example.com', 'family_admin', 1);
  add('White', 'Demo family member', 'member@example.com', 'family_member', 0, 'Family');
  add('White', 'Demo trusted friend', 'friend@example.com', 'friend', 0, 'Friend');
  for (const n of names.filter(n => n !== 'White')) add(n, `${n} admin (demo)`, `${n.toLowerCase().replace(/[^a-z]/g, '')}@example.com`, 'family_admin');
  // a few demo offers so the letting and swap features have something to show
  const plan = (n, f) => run(`UPDATE weeks SET ${f} WHERE year=2027 AND week_no=?`, n);
  for (const n of [19, 33, 37, 52]) plan(n, "status='offered', offer_friends=1");                 // for sale
  for (const n of [8, 21, 30, 44]) plan(n, 'offer_swap=1');                                         // willing to swap
  plan(25, "status='offered', offer_friends=1, offer_swap=1");                                      // swap or sell
  for (const n of [7, 26, 34, 35]) plan(n, 'in_use=1');                                             // using it
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

server.listen(PORT, () => console.log(`Nab Camas portal running at ${BASE_URL}`));
