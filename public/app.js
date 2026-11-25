'use strict';
// ------------------------------------------------------------ utilities
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { me: null, year: null, filter: 'all', weeks: [] };
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { S.me = null; renderLogin(); throw new Error('Please log in'); }
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function toast(msg, err) { const d = document.createElement('div'); d.textContent = msg; if (err) d.className = 'err'; $('#toast').append(d); setTimeout(() => d.remove(), err ? 6000 : 3500); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const money = (n, dp) => S.me.settings.currency + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: dp ?? (n % 1 ? 2 : 0), maximumFractionDigits: 2 });
const dfmt = (d, o = { day: 'numeric', month: 'short' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const endOf = w => w.end_date || addDays(w.start_date, 7);
const nights = w => Math.round((new Date(endOf(w)) - new Date(w.start_date)) / 864e5);
const range = w => `${dfmt(w.start_date)} – ${dfmt(endOf(w))}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const roleName = r => ({ site_admin: 'Site admin', family_admin: 'Family admin', family_member: 'Family member', friend: 'Trusted friend' }[r] || r);
const isFam = () => ['family_admin', 'family_member'].includes(S.me.user.role);
const isFamAdmin = () => S.me.user.role === 'family_admin';
const isSite = () => !!S.me.user.is_site_admin;
const formData = f => Object.fromEntries([...new FormData(f).entries()]);
// ------------------------------------------------------------ boot / routing
async function boot() {
  const hash = location.hash;
  if (hash.startsWith('#/invite/')) return renderInvite(hash.split('/')[2]);
  try { S.me = await api('/me'); } catch { return renderLogin(); }
  if (!S.filterSet) { S.filter = S.me.user.role === 'friend' ? 'book' : 'all'; S.filterSet = true; }
  if (!S.year) S.year = S.me.years.includes(new Date().getFullYear() + 1) && new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : (S.me.years.includes(new Date().getFullYear()) ? new Date().getFullYear() : S.me.years.at(-1));
  route();
}
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/invite/')) return boot(); if (S.me) route(); });
async function refreshMe() { S.me = await api('/me'); renderShell(currentTab()); }
function currentTab() { return (location.hash.replace('#/', '').split('/')[0]) || 'home'; }
async function route() {
  closeOverlay(); const tab = currentTab();
  if (tab === 'weeks') { S.filter = isFam() ? 'mine' : S.filter; location.replace('#/calendar'); return; }   // My weeks is retired: its links open the calendar
  const allowed = new Set(navTabs().map(t => t[0].split('/')[0])); if (allowed.has('enquiries')) allowed.add('swaps');
  if (!allowed.has(tab)) { if (location.hash !== '#/home') location.hash = '#/home'; else renderShell('home'); return; }
  renderShell(tab); const main = $('main');
  const views = { home: viewHome, calendar: viewCalendar, enquiries: viewEnquiries, swaps: viewEnquiries, bookings: viewBookings, account: viewAccount, people: viewPeople, admin: viewAdmin };
  try { await (views[tab] || viewHome)(main); } catch (e) { main.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}

// ------------------------------------------------------------ login / invite
function loginLayout(inner) {
  $('#app').innerHTML = `<div class="login"><div class="login-art" id="loginArt"><span class="wordmark">Nab Camas</span>
    <div><h2>A private retreat on Loch Carron</h2><p>The owners’ portal for the households of Nab Camas and their trusted friends.</p></div></div>
    <div class="login-form">${inner}</div></div>`;
  const img = new Image(); img.onload = () => { const a = $('#loginArt'); if (a) a.style.backgroundImage = 'url(/media/hero)'; }; img.src = '/media/hero';
}
function renderLogin(msg) {
  loginLayout(`<form id="lf"><span class="eyebrow">Owners’ portal</span><h1>Sign in</h1><p class="muted" style="margin:0 0 24px">Welcome back. Sign in with the email address your invitation was sent to.</p>
    ${msg ? `<div class="notice" style="margin-bottom:16px">${esc(msg)}</div>` : ''}
    <div class="field"><label for="lf-email">Email</label><input id="lf-email" name="email" type="email" autocomplete="username" required autofocus></div>
    <div class="field"><label for="lf-pw">Password</label><input id="lf-pw" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn primary block" style="margin-top:8px">Sign in</button>
    <p class="muted small" style="margin:24px 0 0">New here? Your household’s admin will send you an invitation. Forgotten your password? Ask them to send a new link.</p></form>`);
  $('#lf').onsubmit = guard(async e => { e.preventDefault(); await api('/login', { body: formData(e.target) }); location.hash = '#/home'; boot(); });
}
async function renderInvite(tok) {
  let inv; try { inv = await api('/invite/' + tok); } catch (e) { return renderLogin(e.message); }
  loginLayout(`<form id="inf"><span class="eyebrow">Welcome</span><h1>Hello, ${esc(inv.name.split(' ')[0])}</h1><p class="muted" style="margin:0 0 24px">Choose a password to finish setting up your login for <b>${esc(inv.email)}</b>.</p>
    <div class="field"><label for="inf-pw">New password (8 or more characters)</label><input id="inf-pw" name="password" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="btn primary block" style="margin-top:8px">Set password and continue</button></form>`);
  $('#inf').onsubmit = guard(async e => { e.preventDefault(); await api('/invite/' + tok, { body: formData(e.target) }); location.hash = '#/home'; boot(); });
}

// ------------------------------------------------------------ shell
// which nav item is lit: admin pages match on their sub-page (a family's account opened from Payments lights Payments)
function navOn(k, tab) {
  if (!k.includes('/')) return tab === k;
  const here = location.hash.replace('#/', '') || 'home';
  return here.startsWith(k) || (k === 'admin/overview' && (here === 'admin' || here.startsWith('admin/account')));
}
// Navigation per role:
//   trusted friend → Home, Available weeks, My bookings, My details
//   family member  → Home, Calendar, Enquiries, Bookings, Family & friends
//   family admin   → the same plus Account (and setting plans for the family's weeks from the calendar, managing people)
//   site admin     → a separate login with no family: Home, Calendar and the admin pages
const ADMIN_PAGES = [['admin/overview', 'Payments'], ['admin/budget', 'Budget'], ['admin/weeks', 'Weeks'], ['admin/credits', 'Lets'], ['admin/families', 'Families'], ['admin/users', 'Users'], ['admin/settings', 'Settings'], ['admin/audit', 'Activity']];
const isSiteRole = () => S.me.user.role === 'site_admin';
// Who is logged in: name, role and household (site admins have no household). Escaped, ready for HTML.
function whoAmI() {
  const u = S.me.user, fam = S.me.family, role = roleName(u.role);
  const house = u.role !== 'site_admin' && fam ? fam.name + ' family' : '';
  const nameIsRole = u.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase() === role.toLowerCase();
  return { name: esc(u.name), role: esc(role), house: esc(house), nameIsRole };
}
const NAV_ICON = { home: 'house', calendar: 'calendar-days', weeks: 'calendar-range', enquiries: 'messages-square', bookings: 'bed-double', account: 'wallet', people: 'users', admin: 'settings',
  'admin/overview': 'banknote', 'admin/budget': 'calculator', 'admin/weeks': 'calendar-range', 'admin/credits': 'coins', 'admin/families': 'users-round', 'admin/users': 'user-cog', 'admin/settings': 'settings', 'admin/audit': 'history' };
function navTabs() {
  if (isSiteRole()) return [['home', 'Overview'], ['calendar', 'Calendar'], ...ADMIN_PAGES];
  const friend = S.me.user.role === 'friend', fam = isFam();
  return [['home', 'Overview'], ['calendar', friend ? 'Available weeks' : 'Calendar'], fam && ['enquiries', 'Enquiries', S.me.pendingSwaps],
    ['bookings', friend ? 'My bookings' : 'Bookings'], isFamAdmin() && ['account', 'Account'], ['people', friend ? 'My details' : 'Family & friends'], isSite() && ['admin', 'Site admin']].filter(Boolean);
}
function renderShell(tab) {
  const u = S.me.user, tabs = navTabs(), site = esc(S.me.settings.site_name);
  if (!$('main')) $('#app').innerHTML = '<div class="shell"><aside class="sidebar" aria-label="Main menu"></aside><div class="menu-scrim"></div><header class="mobilebar"></header><main id="main"></main></div>';
  const initials = esc((u.name.match(/\b[A-Za-z]/g) || ['?']).join('').slice(0, 2).toUpperCase());
  const unread = S.me.unread ? `<span class="count">${S.me.unread}</span>` : '';
  $('.sidebar').innerHTML = `<a class="wordmark" href="#/home">${site}</a><span class="place">${esc(S.me.settings.place_line || '')}</span>
    <div class="whoami" role="status" aria-label="Logged in as ${esc(u.name)}"><span class="whoami-label">Logged in as</span>
      <div class="whoami-row"><span class="avatar">${initials}</span><span class="who"><b>${esc(u.name)}</b></span></div></div>
    ${viewAsPicker(u)}
    <nav class="side-nav">${tabs.map(([k, l, n]) => { const on = navOn(k, tab); return `<a href="#/${k}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(NAV_ICON[k] || 'chevron-right')}<span>${l}</span>${n ? `<span class="count">${n}</span>` : ''}</a>`; }).join('')}</nav>
    <div class="side-foot">
      <div class="side-actions"><button class="side-btn" data-notes>${icon('bell')}Notices${unread}</button><button class="side-btn" data-logout>${icon('log-out')}Sign out</button></div></div>`;
  $('.mobilebar').innerHTML = `<div class="mb-row"><button class="iconbtn" data-menu aria-label="Open menu">${icon('menu')}</button><a class="wordmark" href="#/home">${site}</a><button class="iconbtn" data-notes aria-label="Notifications">${icon('bell')}${unread}</button></div>
    <div class="mb-who">Logged in as <b>${esc(u.name)}</b></div>`;
  viewAsBar();
  document.querySelectorAll('[data-notes]').forEach(b => b.onclick = guard(showNotifications));
  $('[data-logout]').onclick = guard(async () => { await api('/logout', { body: {} }); S.me = null; document.body.classList.remove('menu-open'); $('#app').innerHTML = ''; renderLogin(); });
  $('[data-menu]').onclick = () => document.body.classList.toggle('menu-open');
  $('.menu-scrim').onclick = () => document.body.classList.remove('menu-open');
  $('.sidebar').querySelectorAll('a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('menu-open')));
}
// "View as" (site admin only, for testing): the dropdown in the sidebar and the banner shown while viewing as someone
function viewAsPicker(u) {
  if (!S.me.view_as || !S.me.view_as.length) return '';
  const byFamily = S.me.view_as.reduce((g, x) => ((g[x.family] ||= []).push(x), g), {});
  return `<label class="viewas"><span class="whoami-label">${icon('eye')} View as</span><select id="viewAs" aria-label="View the portal as another login">
    <option value="">${S.me.viewing_as ? 'Switch to another login…' : 'Choose a login…'}</option>
    ${Object.entries(byFamily).map(([f, xs]) => `<optgroup label="${esc(f)}">${xs.map(x => `<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>${esc(x.name)} · ${esc(roleName(x.role))}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
}
function viewAsBar() {
  let bar = $('.viewas-bar');
  if (!bar) { bar = document.createElement('div'); bar.className = 'viewas-bar'; bar.setAttribute('role', 'status'); $('.shell').insertBefore(bar, $('main')); }
  if (S.me.viewing_as) {
    const me = whoAmI();
    bar.hidden = false;
    bar.innerHTML = `${icon('eye')}<span class="grow">Viewing as <b>${me.name}</b> · ${me.role}${me.house ? ', ' + me.house : ''}. Anything you do here really happens, as them.</span><button class="btn sm" data-viewas-stop>Back to site admin</button>`;
    $('[data-viewas-stop]', bar).onclick = guard(async () => { await api('/view-as/stop', { body: {} }); location.hash = '#/home'; location.reload(); });
  } else { bar.hidden = true; bar.innerHTML = ''; }
  const sel = $('#viewAs');
  if (sel) sel.onchange = guard(async () => { if (!sel.value) return; await api('/view-as', { body: { user_id: Number(sel.value) } }); location.hash = '#/home'; location.reload(); });
}
async function showNotifications() {
  document.body.classList.remove('menu-open');
  const list = await api('/notifications');
  const body = openDrawer('<h2 style="margin:0">Notices</h2>', 'Updates about your weeks, enquiries and bookings',
    list.length ? `<div class="note-list">${list.map(n => `<a href="${esc(n.link || '#/home')}" class="${n.read ? '' : 'unread'}">${esc(n.text)}<div class="tiny muted" style="margin-top:4px">${new Date(n.created_at + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div></a>`).join('')}</div>` : '<p class="muted">Nothing yet. Notices about your weeks, enquiries and bookings will appear here.</p>');
  body.querySelectorAll('a').forEach(a => a.addEventListener('click', closeOverlay));
  if (S.me.unread) { await api('/notifications/read', { body: {} }); S.me.unread = 0; renderShell(currentTab()); }
}

// ------------------------------------------------------------ overlays
function closeOverlay() { $('#drawer-root').innerHTML = ''; }
function openDrawer(title, sub, bodyHtml) {
  $('#drawer-root').innerHTML = `<div class="scrim"></div><aside class="drawer" role="dialog"><header><div class="grow">${title}${sub ? `<div class="muted small">${sub}</div>` : ''}</div><button class="iconbtn" data-close aria-label="Close">${icon('x')}</button></header><div class="body">${bodyHtml}</div></aside>`;
  $('.scrim').onclick = closeOverlay; $('[data-close]').onclick = closeOverlay; return $('.drawer .body');
}
function openModal(html, wide) {
  $('#drawer-root').innerHTML = `<div class="scrim"></div><div class="modal ${wide ? 'wide' : ''}" role="dialog">${html}</div>`;
  $('.scrim').onclick = closeOverlay; $('#drawer-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeOverlay); return $('.modal');
}

// ------------------------------------------------------------ home
// shared overview pieces
const ATT_ICON = { urgent: 'circle-alert', action: 'clock', info: 'info' };
const todoItem = a => `<div class="todo ${a.tone}"><span class="todo-ico">${icon(ATT_ICON[a.tone] || 'info')}</span><div class="grow" style="min-width:0"><div class="todo-title">${esc(a.title)}</div><div class="small muted">${esc(a.detail)}</div></div>${a.cta ? `<a class="btn sm ${a.tone === 'urgent' ? 'primary' : ''}" href="${a.link}">${esc(a.cta)}</a>` : ''}</div>`;
const panelCard = (ico, title, body, foot) => `<div class="card panel"><h3>${icon(ico)}${title}</h3>${body}${foot ? `<div class="panel-foot">${foot}</div>` : ''}</div>`;
const quiet = t => `<p class="small muted" style="margin:0">${t}</p>`;
const stamp = t => new Date(t.replace(' ', 'T') + (t.length > 10 ? 'Z' : '')).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
function welcomeHeader(greet) {
  const s = S.me.settings, me = whoAmI();
  return `<header class="welcome"><span class="eyebrow">${esc(s.place_line || '')}</span><h1>Welcome to Camas</h1>
      <p>${greet}, ${isFam() && me.house ? me.house : me.name}. It’s ${dfmt(todayStr(), { weekday: 'long', day: 'numeric', month: 'long' })}.</p></header>
    ${s.hero ? `<img class="hero-img" src="/media/hero?v=${esc(s.hero)}" alt="Nab Camas on Loch Carron">` : ''}`;
}
const STAY_TAG = { 'Booked': 'booked', 'Your stay': 'booked', 'Reserved': 'pending', 'Released': 'available', 'Available': 'available', 'Using it': 'yours' };
// a WhatsApp chat link from a phone number as typed; UK numbers starting 0 become +44
function waLink(phone) {
  if (!phone) return null;
  let d = String(phone).trim().replace(/[^\d+]/g, '');
  d = d.startsWith('+') ? d.slice(1) : d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '44' + d.slice(1) : d;
  return /^\d{10,15}$/.test(d) ? `https://wa.me/${d}` : null;
}
function contactButtons(c) {
  if (!c) return '';
  const wa = waLink(c.phone);
  return `<span class="contact-btns">${c.email ? `<a class="btn sm" href="mailto:${esc(c.email)}" title="Email ${esc(c.name)}" aria-label="Email ${esc(c.name)}">${icon('mail')}Email</a>` : ''}${wa ? `<a class="btn sm" href="${wa}" target="_blank" rel="noopener" title="WhatsApp ${esc(c.name)}" aria-label="WhatsApp ${esc(c.name)}">${icon('message-circle')}WhatsApp</a>` : ''}</span>`;
}
function residenceStrip(h, nextStay) {
  const r = h.residence || {};
  const show = (label, x, none) => `<div class="card"><span class="eyebrow">${label}</span>${x ? `<div class="who">${esc(x.mine ? `${x.household} (you)` : x.household || x.status)}</div>
      <div class="when">${dfmt(x.start)} – ${dfmt(x.end)} · week ${x.week_no}${x.detail ? ` · ${esc(x.detail)}` : ''}</div>${x.contact ? `<div class="tiny muted">Contact: ${esc(x.contact.name)}</div>` : ''}
      <div class="res-foot"><span class="tag ${x.mine ? 'yours' : STAY_TAG[x.status] || ''}">${esc(x.status)}</span>${contactButtons(x.contact)}</div>` : `<div class="when">${none}</div>`}</div>`;
  const arriving = (r.next || []).find(Boolean);
  return `<section class="residence">${show('In residence this week', r.now, 'No week is set up for today.')}${show('Arriving next', arriving, 'No arrivals set up yet.')}
    ${nextStay !== undefined ? `<div class="card"><span class="eyebrow">Your next stay</span>${nextStay ? `<div class="who">${esc(nextStay.title)}</div><div class="when">${esc(nextStay.detail || '')}</div>` : '<div class="when">Nothing booked yet. Browse the calendar to plan a stay.</div>'}</div>` : ''}</section>`;
}
async function viewHome(main) {
  const h = await api('/home'), u = S.me.user, friend = u.role === 'friend', hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  if (h.admin_home) return adminHome(main, h, greet);
  const weekRow = (x, right) => `<button class="list-row" data-open-week="${x.week_id}" data-year="${x.year}"><span class="grow" style="min-width:0"><b>${esc(x.title)}</b><div class="tiny muted">${esc(x.detail || '')}</div></span>${right || ''}</button>`;
  const links = friend ? [['#/calendar', 'Browse available weeks'], ['#/bookings', 'My bookings'], ['#/people', 'Update my details']]
    : [['#/calendar', 'Browse the calendar'], ['#/weeks', isFamAdmin() ? 'Set your household’s weeks' : 'Your household’s weeks'], ['#/enquiries', 'Enquiries'], ['#/people', isFamAdmin() ? 'Add family or friends' : 'Add a trusted friend'], ...(isFamAdmin() ? [['#/account', 'Household account']] : [])];
  const f = h.family, c = f && f.credits;
  const going = h.upcoming.find(x => ['using', 'booked', 'reserved'].includes(x.plan)) || null;
  const upTag = x => x.plan === 'using' || x.plan === 'booked' ? '<span class="tag booked">Going</span>' : x.plan === 'reserved' ? '<span class="tag pending">Awaiting payment</span>' : x.plan === 'let' ? '<span class="tag booked">Let</span>' : x.plan === 'released' ? '<span class="tag available">Released</span>' : x.plan === 'swap' ? '<span class="tag outline">Will swap</span>' : '<span class="tag">Undecided</span>';
  main.innerHTML = `${welcomeHeader(greet)}${residenceStrip(h, going)}
    <section class="stack" style="margin-bottom:var(--sp-6)"><div class="section-title"><h2>Outstanding actions</h2>${h.attention.length ? `<span class="muted small">${h.attention.length} to look at</span>` : ''}</div>
      ${h.attention.length ? h.attention.map(todoItem).join('') : todoItem({ tone: 'info', title: 'All clear', detail: 'Nothing needs your attention right now.' })}</section>
    <div class="home-grid">
      ${panelCard('calendar-clock', 'Upcoming stays', h.upcoming.length ? h.upcoming.map(x => weekRow(x, upTag(x))).join('') : quiet(friend ? 'You have no upcoming stays yet.' : 'Nothing coming up.'), friend ? '' : '<a href="#/weeks">All your household’s weeks →</a>')}
      ${panelCard('key-round', friend ? 'Weeks you can book' : 'Weeks available to book', h.available.length ? h.available.map(x => weekRow({ ...x, detail: x.family ? `From ${x.family}` : '' }, `<span class="tag available">${money(x.price)}</span>`)).join('')
        : quiet('Nothing is available right now. You’ll get a notice when a week is released.'), `<a href="#/calendar">${friend ? 'All available weeks' : 'Open the calendar'} →</a>`)}
      ${friend || !S.me.settings.member_requests ? '' : panelCard('messages-square', 'Your enquiries', h.enquiries.length ? h.enquiries.map(x => weekRow({ ...x, detail: `${x.holder} · ${PLAN[x.plan] ? PLAN[x.plan].label : ''}` }, `<span class="tag pending">${ordinal(x.position)} of ${x.queue}</span>`)).join('')
        : quiet('Open any other household’s week on the calendar to enquire about it. If they release it, you get first refusal.'), '<a href="#/enquiries">All enquiries →</a>')}
      ${f ? panelCard('coins', `${esc(f.name)} at a glance · ${f.year}`, `<dl class="kv" style="grid-template-columns:1fr auto">
          ${c ? `<dt>Weeks released</dt><dd class="num">${c.released}</dd>
          <dt>Let income credited</dt><dd class="num">${money(c.let_income, 2)} <span class="muted small">(${c.lets} let${c.lets === 1 ? '' : 's'})</span></dd>` : ''}
          ${f.balance != null ? `<dt>Account balance</dt><dd class="num">${f.balance > 0.005 ? money(f.balance, 2) + ' to pay' : f.balance < -0.005 ? money(-f.balance, 2) + ' in credit' : 'Settled'}</dd>` : ''}</dl>`, '<a href="#/weeks">Your household’s weeks →</a>') : ''}
      ${panelCard('bell', 'Recent notices', h.notifications.length ? h.notifications.map(n => `<a class="list-row ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/home')}"><span class="grow small">${esc(n.text)}<div class="tiny muted">${stamp(n.created_at)}</div></span></a>`).join('') : quiet('No notices yet.'))}
      ${panelCard('arrow-right', 'Quick links', `<div class="quick">${links.map(([href, l]) => `<a class="btn sm" href="${href}">${l}</a>`).join('')}</div>`)}
    </div>`;
  main.querySelectorAll('[data-open-week]').forEach(b => b.onclick = () => { S.year = Number(b.dataset.year); S.openWeek = Number(b.dataset.openWeek); location.hash = '#/calendar'; });
}

function adminHome(main, h, greet) {
  const owing = h.balances.filter(b => Math.abs(b.balance) > 0.005);
  main.innerHTML = `${welcomeHeader(greet)}${residenceStrip(h)}
    <div class="grid-3" style="margin-bottom:var(--sp-6)">
      <div class="card"><span class="eyebrow">Households · logins</span><div class="stat num">${h.counts.families} <span class="small muted">· ${h.counts.logins}</span></div></div>
      <div class="card"><span class="eyebrow">Weeks released in ${h.credits.year}</span><div class="stat num">${h.counts.released}</div><div class="small muted">${h.counts.enquiries} open enquir${h.counts.enquiries === 1 ? 'y' : 'ies'}</div></div>
      <div class="card"><span class="eyebrow">${h.credits.year} lets</span><div class="stat num credit">${money(h.credits.income.credited, 2)}</div><div class="small muted">credited to households from ${h.credits.income.lets} let${h.credits.income.lets === 1 ? '' : 's'} · ${money(h.credits.income.fund, 2)} to the maintenance fund</div></div></div>
    <section class="stack" style="margin-bottom:var(--sp-6)"><div class="section-title"><h2>Outstanding actions</h2>${h.attention.length ? `<span class="muted small">${h.attention.length} to look at</span>` : ''}</div>
      ${h.attention.length ? h.attention.map(todoItem).join('') : todoItem({ tone: 'info', title: 'All clear', detail: 'No syndicate jobs waiting.' })}</section>
    <div class="home-grid">
      ${panelCard('wallet', 'Household balances', owing.length ? `<table><tbody>${owing.map(b => `<tr><td><a href="#/admin/account-${b.id}">${esc(b.name)}</a></td><td class="r num">${b.balance > 0 ? money(b.balance, 2) + ' owed' : money(-b.balance, 2) + ' credit'}</td></tr>`).join('')}</tbody></table>` : quiet('Every household is settled.'), '<a href="#/admin/overview">Payments and balances →</a>')}
      ${panelCard('coins', `Lets ${h.credits.year}`, h.credits.rows.some(r => r.lets) ? `<table><tbody>${h.credits.rows.filter(r => r.lets).map(r => `<tr><td>${esc(r.name)}</td><td class="r num">${r.lets} let${r.lets === 1 ? '' : 's'}</td><td class="r num">${money(r.let_income, 2)}</td></tr>`).join('')}</tbody></table>` : quiet('No weeks let yet this year.'), '<a href="#/admin/credits">Lets →</a>')}
      ${panelCard('history', 'Recent activity', h.activity.length ? h.activity.map(a => `<div class="list-row" style="cursor:default"><span class="grow small"><b>${esc(a.name || 'System')}</b> ${esc(a.action.replace('.', ' '))}<div class="tiny muted">${stamp(a.created_at)}</div></span></div>`).join('') : quiet('Nothing yet.'), '<a href="#/admin/audit">Activity log →</a>')}
      ${panelCard('bell', 'Recent notices', h.notifications.length ? h.notifications.map(n => `<a class="list-row ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/home')}"><span class="grow small">${esc(n.text)}<div class="tiny muted">${stamp(n.created_at)}</div></span></a>`).join('') : quiet('No notices yet.'))}
      ${panelCard('arrow-right', 'Quick links', `<div class="quick">${ADMIN_PAGES.map(([k, l]) => `<a class="btn sm" href="#/${k}">${l}</a>`).join('')}<a class="btn sm" href="#/calendar">Calendar</a></div>`)}
    </div>
    <p class="tiny muted" style="margin-top:var(--sp-6)">Database: ${esc(h.system.database)}${h.system.volume ? ` · storage volume: ${esc(h.system.volume)}` : h.system.on_railway ? ' · no storage volume' : ''} · data since ${h.system.data_since ? dfmt(h.system.data_since.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} · email ${h.system.email ? 'on' : 'off'}</p>`;
}

// ------------------------------------------------------------ calendar
const PLAN = {
  undecided: { label: 'Undecided', hint: 'Not decided yet. You’ll get reminders as it gets closer, and trusted friends can ask to book it.' },
  using: { label: 'Using it', hint: 'Definitely being used. No enquiries.' },
  released: { label: 'Released', hint: 'You won’t use it. Members can book it, then trusted friends. If it lets, the payment is credited to your household’s account, less the letting cost for the maintenance fund.' },
};
const BAND = { school: 'School holidays', summer: 'Summer', shoulder: 'Shoulder', winter: 'Winter' };
const SALE_TO = { members: 'Other syndicate members only', all: 'Members + any family’s trusted friends', own: 'Members + our own trusted friends' };
function statusBadge(w) {
  if (w.status === 'syndicate') return '<span class="badge">Syndicate</span>';
  if (w.status === 'booked') return `<span class="badge blue">${w.booking?.mine ? 'Your booking' : 'Let'}</span>`;
  if (w.status === 'pending') return `<span class="badge amber">${w.booking?.mine ? 'Awaiting your payment' : 'Reserved'}</span>`;
  if (S.me.user.role === 'friend') return w.can_book ? `<span class="badge green">${money(w.price)}</span>` : '';
  const b = [];
  if (w.plan === 'using') b.push('<span class="badge accent">In use</span>');
  if (w.plan === 'released') b.push(`<span class="badge green">${money(w.price)}</span>`);
  return b.join(' ');
}
// What a week means to the person looking: one of five muted states, always with a text label.
function weekState(w) {
  const friend = S.me.user.role === 'friend', fam = esc(w.family_name);
  if (w.booking?.mine) return w.booking.status === 'confirmed' ? { k: 'booked', who: 'Your booking', label: 'Booked' } : { k: 'pending', who: 'Your booking', label: 'Awaiting payment' };
  if (friend) return w.can_book ? { k: 'available', who: 'Available', label: `Available · ${money(w.price)}` }
    : w.my_friend_enquiry ? { k: 'pending', who: 'Enquiry sent', label: 'Enquired' }
    : w.can_friend_enquire ? { k: 'other', who: 'Undecided', label: 'Open to enquiries' } : { k: 'other', who: 'Not available', label: 'Not available' };
  if (w.status === 'syndicate') return { k: 'other', who: 'Syndicate', label: 'Syndicate week' };
  if (w.status === 'booked') return { k: 'booked', who: w.is_mine ? 'Your week' : fam, label: w.is_mine ? 'Let to guests' : 'Booked' };
  if (w.status === 'pending') return { k: 'pending', who: w.is_mine ? 'Your week' : fam, label: 'Reserved' };
  if (w.my_enquiry) return { k: 'pending', who: fam, label: w.first_refusal_until ? 'First refusal' : `Requested · ${ordinal(w.my_enquiry.position)}` };
  if (w.is_mine) return { k: 'yours', who: 'Your week', label: { using: 'Yours · using', released: 'Yours · released' }[w.plan] || 'Yours · undecided' };
  if (w.can_book) return { k: 'available', who: fam, label: `Available · ${money(w.price)}` };
  if (w.plan === 'released' || w.first_refusal_until) return { k: 'available', who: fam, label: 'Released' };
  if (w.plan === 'using') return { k: 'other', who: fam, label: 'In use' };
  return { k: 'other', who: fam, label: 'Allocated' };
}
function filterMatch(w) {
  switch (S.filter) {
    case 'book': return w.can_book;
    case 'swap': return w.can_enquire || !!w.my_enquiry;
    case 'enquire': return w.can_friend_enquire || !!w.my_friend_enquiry;
    case 'mine': return w.is_mine || w.booking?.mine;
    // released weeks to buy, and other families' weeks they haven't decided about yet
    case 'open': return !w.is_mine && !!w.family_id && w.start_date >= todayStr() && !['pending', 'booked'].includes(w.status) && (w.plan === 'released' || w.plan === 'undecided');
    case 'offered': return w.status === 'offered';
    default: return true;
  }
}
async function viewCalendar(main) {
  const years = S.me.years;
  if (!years.length) { main.innerHTML = '<div class="card empty">No weeks have been set up yet. The site admin can create a year under Site admin → Weeks.</div>'; return; }
  S.weeks = await api('/weeks?year=' + S.year);
  const role = S.me.user.role;
  const filters = isFam() ? [['all', 'All weeks'], ['mine', 'Our weeks'], ['open', 'Available for enquiry']]
    : [['all', 'All weeks'], ['book', role === 'friend' ? 'Available to book' : 'Available to buy'], role === 'friend' && ['enquire', 'Open to enquiries'], role === 'friend' && ['mine', 'My bookings']].filter(Boolean);
  if (!filters.filter(Boolean).some(([k]) => k === S.filter)) S.filter = 'all';
  const intro = isSiteRole() ? 'Every household’s weeks. Open a week to see it, or to change its settings on the household’s behalf.' : role === 'friend' ? 'Weeks the households have made available to trusted friends: open one to book it. Weeks marked <b>Open to enquiries</b> haven’t been decided yet, so you can ask the household whether you could book them.'
    : (S.me.settings.member_requests ? 'Open any other household’s week to enquire about it, or to book it if it’s been released. ' : 'Open a week to see it, or to book it if it’s been released. ') + 'Open one of your own weeks to set your plans for it.';
  const byMonth = {};
  for (const w of S.weeks) (byMonth[w.start_date.slice(0, 7)] ||= []).push(w);
  const visible = S.weeks.filter(filterMatch).length;
  const band = w => w.school_holiday ? 'School holidays' : { summer: 'Summer', shoulder: 'Shoulder', winter: 'Winter' }[w.season];
  main.innerHTML = `
    <div class="page-head row between" style="align-items:flex-end"><div class="grow" style="min-width:280px"><h1>${role === 'friend' ? 'Available weeks' : 'Calendar'} ${S.year}</h1><p>${intro}${isFam() && S.weeks.length && S.weeks[0].year_open ? ` The ${S.year} allocation is still a draft until the site admin signs it off; ask the site admin about any changes.` : ''}</p></div>
      <div class="seg" aria-label="Year">${years.map(y => `<button data-year="${y}" class="${y === S.year ? 'on' : ''}">${y}</button>`).join('')}</div></div>
    <div class="cal-toolbar"><div class="seg" aria-label="Show">${filters.map(([k, l]) => `<button data-filter="${k}" class="${S.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="muted small">${visible} week${visible === 1 ? '' : 's'}</span></div>
    <div class="months">${Object.entries(byMonth).map(([m, ws]) => `<section class="month"><h3>${dfmt(m + '-01', { month: 'long' })}<span class="tiny muted">${m.slice(0, 4) != S.year ? m.slice(0, 4) : ''}</span></h3>
      ${ws.map(w => { const x = weekState(w); return `<button class="week st-${x.k} ${filterMatch(w) ? '' : 'dim'} ${w.start_date < todayStr() ? 'past' : ''}" data-week="${w.id}" aria-label="Week ${w.week_no}, ${range(w)}: ${x.who}, ${x.label}">
        <span class="no">Week<b>${w.week_no}</b></span>
        <span style="min-width:0"><div class="who">${x.who}</div><div class="when">${range(w)} · ${band(w)}${w.enquiries && !w.my_enquiry ? ` · ${w.enquiries} enquir${w.enquiries > 1 ? 'ies' : 'y'}` : ''}</div>${w.comment ? `<div class="cmt">${esc(w.comment)}</div>` : ''}</span>
        <span class="tag ${x.k}">${x.label}</span></button>`; }).join('')}</section>`).join('')}</div>`;
  main.querySelectorAll('[data-year]').forEach(b => b.onclick = () => { S.year = Number(b.dataset.year); viewCalendar(main); });
  main.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { S.filter = b.dataset.filter; viewCalendar(main); });
  main.querySelectorAll('[data-week]').forEach(b => b.onclick = () => openWeek(S.weeks.find(w => w.id == b.dataset.week)));
  if (S.openWeek) { const w = S.weeks.find(x => x.id == S.openWeek); S.openWeek = null; if (w) openWeek(w); }
}

async function openWeek(w) {
  const s = S.me.settings; const role = S.me.user.role;
  const seasonName = { summer: 'Summer', shoulder: 'Shoulder', winter: 'Winter' }[w.season];
  const relNote = w.is_mine && w.plan === 'released' && w.released_at ? `<div class="section notice small">Released on ${dfmt(w.released_at.slice(0, 10))}. If it lets, the payment is credited to your household’s account, less the ${money(s.letting_cost || 0)} letting cost for the maintenance fund.</div>` : '';
  let html = `<dl class="kv"><dt>Dates</dt><dd>${dfmt(w.start_date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })} → ${dfmt(endOf(w), { weekday: 'short', day: 'numeric', month: 'long' })}${nights(w) !== 7 ? `<div class="tiny muted">${nights(w)} nights (changeover day switches this week)</div>` : ''}</dd>
    ${w.comment ? `<dt>Calendar note</dt><dd>${esc(w.comment)}</dd>` : ''}
    <dt>Season</dt><dd><i class="season ${w.school_holiday ? 'school' : w.season}"></i> ${seasonName}${w.school_holiday ? ' · <b>school holidays</b>' : ''}</dd>
    ${role !== 'friend' ? `<dt>Holder</dt><dd><i class="swatch" style="background:${w.family_color}"></i> ${esc(w.family_name)}${w.original_family_id && w.original_family_id !== w.family_id ? ' <span class="muted small">(swapped)</span>' : ''}</dd>` : ''}
    ${w.status === 'offered' && w.offer_friends && (w.can_book || role !== 'friend') ? (role === 'friend' ? `<dt>Price</dt><dd><b>${money(w.price)}</b></dd>`
      : `<dt>Price</dt><dd><b>${money(w.member_price)}</b> for members · ${money(w.friend_price)} for trusted friends${w.price_override != null ? ' <span class="muted small">(set by family)</span>' : ''}
        <div class="tiny muted">${w.sale_to === 'members' ? 'Members only' : (w.friends_from > todayStr() ? `Members only until ${dfmt(w.friends_from)}, then ` : 'Open to ') + (w.sale_to === 'own' ? `${esc(w.family_name)}’s trusted friends` : 'trusted friends')}</div></dd>`) : ''}
    ${w.note && role !== 'friend' ? `<dt>Note</dt><dd>${esc(w.note)}</dd>` : ''}
    ${w.booking?.guest ? `<dt>Booking</dt><dd>${esc(w.booking.guest)} · <span class="badge ${w.booking.status === 'confirmed' ? 'blue' : 'amber'}">${w.booking.status === 'confirmed' ? 'Paid' : 'Awaiting payment'}</span><div class="tiny muted">Ref ${esc(w.booking.reference)}</div></dd>` : ''}</dl>`;
  const past = w.start_date < todayStr();
  if (w.status === 'syndicate') html += '<div class="section notice">This week is held by the syndicate (e.g. maintenance or the extra 53rd week) and isn’t allocated to a family.</div>';

  html += relNote;
  if (w.is_mine && w.gained_by_request && w.income_cap != null) html += `<div class="section notice small">This week came to your household through a change request. If you let it, your credit is capped at ${money(w.income_cap)} (the service charge per share); anything above that goes to the maintenance fund.</div>`;
  if (w.can_manage && !['pending', 'booked'].includes(w.status) && !past) {
    html += `<form class="section" id="offerForm"><div class="row between"><h3 style="margin:0">${w.is_mine ? 'Your family’s plans for this week' : `${esc(w.family_name)}’s plans for this week (as site admin)`}</h3></div>
      <div style="margin-top:10px">${planFields(w, s)}</div>
      <div class="field" style="margin-top:12px"><label>Note for other families (optional)</label><input name="note" value="${esc(w.note || '')}" placeholder="e.g. Probably free: ask us"></div>
      <button class="btn primary">Save</button></form>`;
  } else if (w.can_manage && w.status === 'pending' && w.booking) {
    html += `<div class="section notice warn">This week is reserved and the syndicate is waiting for payment. If the payment isn’t confirmed in ${s.hold_days} days the hold lapses automatically.</div>`;
  }

  if (w.can_book && !past) {
    const allowAcct = isFam() && (isFamAdmin() || s.allow_member_account_charge);
    html += `<form class="section" id="bookForm"><h3>Book this week · ${money(w.price)}</h3>
      ${isFam() ? `<p class="muted small" style="margin-top:0">${esc(w.family_name)} have released this week. You pay the member price, which is credited to their household’s account.</p>` : ''}
      <div class="grid-2" style="gap:12px"><div class="field"><label>Lead guest name</label><input name="guest_name" value="${esc(S.me.user.name)}" required></div>
      <div class="field"><label>Number in party</label><input name="party_size" type="number" min="1" max="20" value="2"></div></div>
      ${allowAcct ? `<div class="field"><label>How will you pay?</label>
        <label class="check"><input type="radio" name="method" value="bank" checked><span><b>Bank transfer</b>Pay the syndicate account within ${s.hold_days} days.</span></label>
        <label class="check" style="margin-top:8px"><input type="radio" name="method" value="account" ${(S.me.family.credit_available || 0) + 0.005 < w.price ? 'disabled' : ''}><span><b>Pay from ${esc(S.me.family.name)}’s credit (${money(S.me.family.credit_available || 0, 2)} available)</b>${(S.me.family.credit_available || 0) + 0.005 < w.price ? 'Not enough credit for this week. You can top up from the <a href="#/account">Account</a> page.' : 'Taken from your household’s credit and confirmed straight away.'}</span></label></div>` : `<input type="hidden" name="method" value="bank">
        <p class="small muted">After you book, you’ll get the syndicate’s bank details and a payment reference. The week is held for you for <b>${s.hold_days} days</b> while the transfer arrives.</p>`}
      <div class="field"><label>Anything the family should know? (optional)</label><textarea name="notes" rows="2"></textarea></div>
      <button class="btn green">Reserve week</button></form>`;
  }

  if (isFam() && S.me.settings.member_requests && !w.is_mine && !past && w.family_id) html += await enquirySection(w, s);
  else if (isFam() && !w.is_mine && !past && w.plan === 'undecided' && w.holder_contact) html += `<div class="section"><h3>Ask about this week</h3>
    <p class="muted small" style="margin-top:0">${esc(w.family_name)} haven’t decided about this week yet. If you’d like it, ask them directly${w.holder_contact.name ? ` (${esc(w.holder_contact.name)})` : ''}.</p>${contactButtons(w.holder_contact)}</div>`;
  if (w.booking?.mine && w.booking.status === 'pending') html += `<div class="section">${payBox(w.booking.reference, w.price)}</div>`;
  if (role === 'friend' && !w.can_book && !w.booking?.mine) {
    if (w.my_friend_enquiry) html += `<div class="section"><h3>You’ve enquired about this week</h3><p class="small" style="margin:0">Sent on ${asked(w.my_friend_enquiry.created_at)}. The household that holds it will let you know. If they agree, it’s reserved for you at ${money(w.price)}.</p>
      <div class="row" style="margin-top:10px"><button class="btn sm danger" data-fe-withdraw="${w.my_friend_enquiry.id}">Withdraw enquiry</button></div></div>`;
    else if (w.can_friend_enquire && !past) html += `<form class="section" id="feForm"><h3>Enquire about this week · ${money(w.price)}</h3>
      <p class="muted small" style="margin-top:0">The household that holds this week hasn’t decided yet whether they’ll use it. Your enquiry goes to them. If they agree, the week is reserved for you at ${money(w.price)} and you pay the syndicate by bank transfer within ${s.hold_days} days.</p>
      <div class="grid-2" style="gap:12px"><div class="field"><label>Lead guest name</label><input name="guest_name" value="${esc(S.me.user.name)}" required></div>
      <div class="field"><label>Number in party</label><input name="party_size" type="number" min="1" max="20" value="2"></div></div>
      <div class="field"><label>Message to the household (optional)</label><textarea name="message" rows="2" placeholder="e.g. We’d love to bring the family for half-term."></textarea></div>
      <button class="btn primary">Send booking enquiry</button></form>`;
    else html += '<div class="section muted small">This week isn’t available to book.</div>';
  }

  const x = weekState(w);
  const body = openDrawer(`<span class="eyebrow">${w.year}</span><h2 style="margin:2px 0 6px">Week ${w.week_no} · ${range(w)}</h2><span class="tag ${x.k}">${x.label}</span>`, '', html);
  const of = $('#offerForm', body);
  if (of) {
    bindPlanFields(of);
    of.onsubmit = guard(async e => { e.preventDefault(); const d = formData(of);
      if (d.plan === 'using' && (w.pending_swaps || w.enquiries || w.friend_enquiries) && !confirm('Marking this week “Using it” closes the enquiries waiting for it. Continue?')) return;
      if (d.plan === 'released' && w.plan !== 'released' && w.enquiries && !confirm(`Release week ${w.week_no}? The ${w.enquiries} famil${w.enquiries > 1 ? 'ies' : 'y'} who enquired get first refusal for ${s.enquiry_hours || 48} hours, in queue order.`)) return;
      await api('/weeks/' + w.id, { method: 'PUT', body: d }); toast('Week updated'); closeOverlay(); viewCalendar($('main')); refreshMe(); });
  }
  const bf = $('#bookForm', body);
  if (bf) bf.onsubmit = guard(async e => { e.preventDefault(); const b = await api(`/weeks/${w.id}/book`, { body: formData(bf) });
    if (b.status === 'confirmed') { toast('Booked and charged to your family account'); closeOverlay(); }
    else openModal(`<h2>Week reserved</h2><p>Please pay within <b>${s.hold_days} days</b> to secure the week. You’ll be notified when the payment is confirmed.</p>${payBox(b.reference, b.amount)}<div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`);
    viewCalendar($('main')); await refreshMe(); });
  const ff = $('#feForm', body);
  if (ff) ff.onsubmit = guard(async e => { e.preventDefault(); await api('/friend-enquiries', { body: { ...formData(ff), week_id: w.id } }); toast('Enquiry sent. The household will let you know'); closeOverlay(); viewCalendar($('main')); });
  const fw = $('[data-fe-withdraw]', body);
  if (fw) fw.onclick = guard(async () => { if (!confirm('Withdraw your enquiry about this week?')) return; await api(`/friend-enquiries/${fw.dataset.feWithdraw}/withdraw`, { body: {} }); toast('Enquiry withdrawn'); closeOverlay(); viewCalendar($('main')); });
  const ef = $('#enqForm', body);
  if (ef) ef.onsubmit = guard(async e => { e.preventDefault();
    const r = await api('/enquiries', { body: { ...formData(ef), week_id: w.id } }); toast(`Enquiry sent. You’re ${ordinal(r.position)} in the queue`); closeOverlay(); viewCalendar($('main')); });
  bindEnquiryActions(body, () => { closeOverlay(); viewCalendar($('main')); refreshMe(); });
}
// your family's future weeks for this year and later
async function myWeeks() {
  const ys = S.me.years.filter(y => y >= new Date().getFullYear());
  return (await Promise.all(ys.map(y => y === S.year && S.weeks.length ? S.weeks : api('/weeks?year=' + y)))).flat().filter(x => x.is_mine && x.start_date >= todayStr());
}
function planFields(w, s, compact) {
  const band = w.school_holiday ? 'school' : w.season;
  return `<select name="plan" class="plan-sel">${Object.entries(PLAN).map(([k, p]) => `<option value="${k}" ${w.plan === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
    ${compact ? '' : `<div class="tiny muted plan-hint" style="margin-top:4px"></div>`}
    <div class="sale-opts" style="margin-top:10px"><div class="${compact ? 'row' : 'grid-2'}" style="gap:10px">
      <div class="field" style="margin:0"><label>Friend price <span class="muted">(members pay ${s.member_rate_pct}%)</span></label><input name="price_override" type="number" min="0" step="1" placeholder="${money(s['rate_' + band])} default" value="${w.price_override ?? ''}"></div>
      <div class="field" style="margin:0"><label>Who can book</label><select name="sale_to">${Object.entries(SALE_TO).map(([k, l]) => `<option value="${k}" ${w.sale_to === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div></div>`;
}
function bindPlanFields(root) {
  const sel = $('[name=plan]', root);
  const sync = () => { $('.sale-opts', root).style.display = sel.value === 'released' ? '' : 'none'; const h = $('.plan-hint', root); if (h) h.textContent = PLAN[sel.value].hint; };
  sel.addEventListener('change', sync); sync();
}
const CR_ST = { open: '<span class="badge amber">With the site admin</span>', approved: '<span class="badge green">Approved</span>', declined: '<span class="badge">Declined</span>', withdrawn: '<span class="badge">Withdrawn</span>', lapsed: '<span class="badge">Lapsed</span>' };
async function changeRequestsBox(box, year, reload) {
  const list = await api('/change-requests?year=' + year);
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<h2 style="margin-top:32px">Change requests for ${year}</h2><div class="stack">${list.map(r => `<div class="card flat" style="padding:14px 16px"><div class="row between"><div class="small">Your ${swapWeek(r.give)} for ${esc(r.want.asked_of || r.want.holder)}’s ${swapWeek(r.want)}</div>${CR_ST[r.status]}</div>
    ${r.note ? `<div class="small muted" style="margin-top:4px">“${esc(r.note)}”</div>` : ''}${r.admin_note ? `<div class="small" style="margin-top:4px">Site admin: “${esc(r.admin_note)}”</div>` : ''}
    ${r.can_withdraw ? `<div class="row" style="margin-top:8px"><button class="btn sm danger" data-crw="${r.id}">Withdraw</button></div>` : ''}</div>`).join('')}</div>`;
  box.querySelectorAll('[data-crw]').forEach(b => b.onclick = guard(async () => { if (!confirm('Withdraw this request?')) return; await api(`/change-requests/${b.dataset.crw}/withdraw`, { body: {} }); toast('Request withdrawn'); reload(); }));
}
async function adminChangeBox(box, year, reload) {
  const open = (S.me.open_years || []).includes(year), list = await api('/change-requests?year=' + year), waiting = list.filter(r => r.status === 'open').length;
  const reopen = !open && year > new Date().getFullYear();
  box.innerHTML = `<div class="card" style="margin-bottom:18px"><div class="row between" style="align-items:flex-start"><div class="grow" style="min-width:260px"><h3 style="margin:0">${year} allocation · ${open ? 'draft, not yet signed off' : 'signed off'}</h3>
      <p class="small muted" style="margin:4px 0 0;max-width:70ch">${open ? 'Families ask you directly for any changes. Make them in the table below (“Allocated to”), then sign off when the allocation is agreed. After that, families buy and sell weeks rather than swap them.' : 'Families now buy and sell these weeks rather than swap them.'}</p></div>
      ${open ? `<button class="btn primary" id="signoff">Sign off ${year} allocation</button>` : reopen ? '<button class="btn" id="reopen">Reopen for changes</button>' : ''}</div>
    ${list.length ? `<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Household</th><th>Gives</th><th>Wants</th><th>Status</th><th></th></tr></thead><tbody>${list.map(r => `<tr>
      <td><b>${esc(r.family)}</b><div class="tiny muted">${esc(r.by)} · ${asked(r.created_at)}</div>${r.note ? `<div class="tiny">“${esc(r.note)}”</div>` : ''}</td>
      <td class="small">${swapWeek(r.give)}</td><td class="small">${swapWeek(r.want)}<div class="tiny muted">held by ${esc(r.want.holder)}</div></td>
      <td>${CR_ST[r.status]}${r.admin_note ? `<div class="tiny muted">${esc(r.admin_note)}</div>` : ''}</td>
      <td class="r" style="white-space:nowrap">${r.can_decide ? `<button class="btn sm green" data-cra="${r.id}">Approve</button> <button class="btn sm" data-crd="${r.id}">Decline</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : ''}</div>`;
  box.querySelectorAll('[data-cra]').forEach(b => b.onclick = guard(async () => { const r = list.find(x => x.id == b.dataset.cra);
    if (!confirm(`Approve? ${r.family} get week ${r.want.week_no} and ${r.want.holder} get week ${r.give.week_no} in the ${year} allocation. Both weeks start afresh as Undecided.`)) return;
    await api(`/admin/change-requests/${r.id}/decide`, { body: { approve: true } }); toast('Approved and reallocated'); reload(); }));
  box.querySelectorAll('[data-crd]').forEach(b => b.onclick = guard(async () => { const note = prompt('Reason, if you’d like to give one (shown to the household):', ''); if (note === null) return;
    await api(`/admin/change-requests/${b.dataset.crd}/decide`, { body: { approve: false, note } }); toast('Declined'); reload(); }));
  const so = $('#signoff', box); if (so) so.onclick = guard(async () => {
    if (!confirm(`Sign off the ${year} allocation?${waiting ? ` The ${waiting} request${waiting > 1 ? 's' : ''} still waiting will be declined.` : ''} Every family is told that ${year} weeks are now bought and sold rather than swapped.`)) return;
    await api(`/admin/years/${year}/signoff`, { body: {} }); await refreshMe(); toast(`${year} allocation signed off`); reload(); });
  const ro = $('#reopen', box); if (ro) ro.onclick = guard(async () => { if (!confirm(`Reopen the ${year} allocation for change requests?`)) return; await api(`/admin/years/${year}/signoff`, { body: { undo: true } }); await refreshMe(); toast('Reopened'); reload(); });
}
async function topupBox(box, credit, reload) {
  const list = await api('/topups'), pend = list.filter(t => t.status === 'pending');
  box.innerHTML = `<div class="card" style="margin-bottom:28px"><div class="row between" style="align-items:flex-start"><div class="grow" style="min-width:260px"><h3 style="margin:0">Credit for buying weeks: ${money(credit, 2)}</h3>
      <p class="small muted" style="margin:4px 0 0;max-width:62ch">Income from weeks you let, and any top-ups, build up credit once your charges are paid. You can spend it on weeks other households release, or keep it against future charges.</p></div>
      <form id="tuf" class="row" style="gap:8px;flex-wrap:nowrap"><input name="amount" type="number" min="1" step="1" placeholder="Amount (£)" style="max-width:150px" required><button class="btn primary">Top up</button></form></div>
    ${pend.map(t => `<div class="row between" style="padding:10px 0 0;margin-top:10px;border-top:1px solid var(--line)"><span class="small">Top-up of <b>${money(t.amount, 2)}</b>, reference <code>${esc(t.reference)}</code>: waiting for the transfer to arrive</span>
      <span class="row" style="gap:6px"><button class="btn sm" data-tupay="${t.id}">Bank details</button><button class="btn sm danger" data-tucancel="${t.id}">Cancel</button></span></div>`).join('')}</div>`;
  const show = t => openModal(`<h2>Top up ${money(t.amount, 2)}</h2><p class="small muted">Send this from your bank. When the site admin sees it arrive, it’s added to your household’s credit.</p>${payBox(t.reference, t.amount)}<div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Close</button></div>`);
  $('#tuf', box).onsubmit = guard(async e => { e.preventDefault(); const r = await api('/topups', { body: formData(e.target) }); show(r); reload(); });
  box.querySelectorAll('[data-tupay]').forEach(b => b.onclick = () => show(pend.find(t => t.id == b.dataset.tupay)));
  box.querySelectorAll('[data-tucancel]').forEach(b => b.onclick = guard(async () => { if (!confirm('Cancel this top-up?')) return; await api(`/topups/${b.dataset.tucancel}/cancel`, { body: {} }); toast('Top-up cancelled'); reload(); }));
}
function payBox(ref, amount) {
  const b = S.me.settings.bank;
  return `<div class="pay-box"><div style="margin-bottom:8px;font-weight:600">Pay by bank transfer</div><dl class="kv">
    <dt>Amount</dt><dd><code>${money(amount, 2)}</code></dd><dt>Reference</dt><dd><code>${esc(ref)}</code></dd>
    <dt>Account name</dt><dd>${esc(b.account_name)}</dd><dt>Bank</dt><dd>${esc(b.name)}</dd>
    ${b.sort_code ? `<dt>Sort code</dt><dd>${esc(b.sort_code)}</dd>` : ''}${b.account_no ? `<dt>Account no.</dt><dd>${esc(b.account_no)}</dd>` : ''}${b.iban ? `<dt>IBAN</dt><dd>${esc(b.iban)}</dd>` : ''}</dl>
    <div class="tiny muted" style="margin-top:8px">Always use the reference so the treasurer can match your payment.</div></div>`;
}

// ------------------------------------------------------------ swaps
const swapWeek = w => `<b>Week ${w.week_no}</b> ${w.year} <span class="muted">· ${range(w)}</span> <i class="season ${w.school_holiday ? 'school' : w.season}"></i>`;
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const whenTime = t => new Date(t.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const asked = t => dfmt(t.slice(0, 10));
const CLOSED = { using: 'Closed: they’re using it', taken: 'Closed: taken by someone else', swapped: 'Closed: swapped', passed: 'You passed', no_reply: 'Closed: no answer in time' };
function enquiryStatus(e) {
  if (e.status === 'won') return `<span class="badge green">${e.mine ? 'Your family got it' : 'Got it'}</span>`;
  if (e.status === 'withdrawn') return '<span class="badge">Withdrawn</span>';
  if (e.status === 'closed') return `<span class="badge">${CLOSED[e.close_reason] || 'Closed'}</span>`;
  return e.week.first_refusal_until ? `<span class="badge amber">First refusal until ${whenTime(e.week.first_refusal_until)}</span>` : `<span class="badge amber">${ordinal(e.position)} of ${e.queue} in the queue</span>`;
}
// the claim form for a family with first refusal (week panel and Enquiries page)
function claimForm(id, price, claim, until) {
  const s = S.me.settings, acct = isFamAdmin() || s.allow_member_account_charge;
  if (claim === 'yes') return `<div class="notice small" style="margin-top:10px">You’ve said yes. Families who enquired before you have until ${whenTime(until)} to answer; if none of them take it, it’s yours. <button class="btn sm" data-pass="${id}">Pass instead</button></div>`;
  return `<div class="claim" data-claim="${id}" style="margin-top:10px"><div class="grid-2" style="gap:10px"><div class="field" style="margin:0"><label>Lead guest</label><input name="guest_name" value="${esc(S.me.user.name)}"></div>
    <div class="field" style="margin:0"><label>Party size</label><input name="party_size" type="number" min="1" max="20" value="2"></div></div>
    ${acct ? `<div class="field" style="margin:10px 0 0"><label>Pay by</label><select name="method"><option value="bank">Bank transfer within ${s.hold_days} days</option><option value="account" ${(S.me.family.credit_available || 0) + 0.005 < price ? 'disabled' : ''}>Pay from ${esc(S.me.family.name)}’s credit (${money(S.me.family.credit_available || 0, 2)} available)</option></select></div>` : '<input type="hidden" name="method" value="bank">'}
    <div class="row" style="margin-top:10px"><button class="btn green sm" data-take="${id}">Take it · ${money(price)}</button><button class="btn sm" data-pass="${id}">Not this time</button></div></div>`;
}
async function enquirySection(w, s) {
  const q = w.enquiries || 0;
  if (w.first_refusal_until) return w.my_enquiry
    ? `<div class="section"><h3>Your family has first refusal</h3><p class="small" style="margin:0">${esc(w.family_name)} have released this week. You’re ${ordinal(w.my_enquiry.position)} of ${q} who enquired; whoever enquired first and says yes gets it. First refusal ends ${whenTime(w.first_refusal_until)}.</p>${claimForm(w.my_enquiry.id, w.member_price, w.my_enquiry.claim, w.first_refusal_until)}</div>`
    : `<div class="section notice small">The families who enquired about this week have first refusal until ${whenTime(w.first_refusal_until)}. After that, any member can book it.</div>`;
  if (w.my_enquiry) return `<div class="section"><h3>Your family has enquired</h3><p class="small" style="margin:0">Asked on ${asked(w.my_enquiry.created_at)}. You’re <b>${ordinal(w.my_enquiry.position)} of ${q}</b> in the queue.
    If ${esc(w.family_name)} release it, you’ll get first refusal for ${s.enquiry_hours || 48} hours, in queue order.</p><p class="small" style="margin:8px 0 0"><a href="#/enquiries">See it on the Enquiries page →</a></p></div>`;
  if (w.can_enquire) return `<form class="section" id="enqForm"><h3>Enquire about this week</h3>
      <p class="muted small" style="margin-top:0">${esc(w.family_name)} will see your enquiry. If they release the week, families who enquired get first refusal for ${s.enquiry_hours || 48} hours at the member price (${money(w.member_price)}), first come first served.${q ? ` <b>${q} famil${q > 1 ? 'ies have' : 'y has'} already enquired.</b>` : ''}</p>
      <div class="field"><label>Message (optional)</label><textarea name="message" rows="2" placeholder="e.g. We’d love this week if your plans change."></textarea></div>
      <button class="btn primary">Enquire</button></form>`;
  if (w.in_use) return `<div class="section notice small">${esc(w.family_name)} are using this week, so it isn’t open to enquiries.</div>`;
  return '';
}
function offerBox(e) {
  const o = e.offer; if (!o) return '';
  const st = { pending: `<span class="badge amber">Waiting for ${e.mine ? esc(e.week.family_name) : 'you'}</span>`, proposed: `<span class="badge amber">${o.picked ? 'Waiting' : 'Accepted; waiting'} for ${e.mine ? (isFamAdmin() ? 'you' : 'your family admin') : esc(e.family)} to confirm</span>`,
    accepted: '<span class="badge green">Swapped</span>', declined: `<span class="badge">${o.decline_reason === 'in_use' ? 'Declined: in use' : 'Declined for now'}</span>`, cancelled: '<span class="badge">Withdrawn</span>', void: '<span class="badge">Lapsed</span>' }[o.status];
  const btns = o.picked
    ? [o.can_decline && `<button class="btn sm" data-dec-unsure="${o.id}">Withdraw</button>`, o.can_confirm && `<button class="btn green sm" data-confirm="${o.id}">Confirm swap</button><button class="btn sm" data-reject="${o.id}">Decline</button>`].filter(Boolean)
    : [o.can_accept && `<button class="btn green sm" data-accept="${o.id}">Accept swap</button>`, o.can_decline && `<button class="btn sm" data-dec-inuse="${o.id}">Decline: we’re using it</button><button class="btn sm" data-dec-unsure="${o.id}">Decline: not sure yet</button>`,
      o.can_confirm && `<button class="btn green sm" data-confirm="${o.id}">Confirm swap</button><button class="btn sm" data-reject="${o.id}">Withdraw offer</button>`, o.can_cancel && !o.can_confirm && `<button class="btn sm danger" data-cancel-offer="${o.id}">Withdraw offer</button>`].filter(Boolean);
  const head = o.picked ? (e.mine ? `${esc(e.week.family_name)} picked your ${swapWeek(o.offered)} in exchange` : `You picked their ${swapWeek(o.offered)} in exchange`)
    : `${e.mine ? 'You offer' : 'They offer'} ${swapWeek(o.offered)} <span class="tiny muted">by ${esc(o.by)}</span>`;
  return `<div class="offer"><div class="row between"><div class="small">${head}</div>${st}</div>
    ${btns.length ? `<div class="row" style="margin-top:8px;gap:8px">${btns.join('')}</div>` : ''}</div>`;
}
function incomingCard(g) {
  const w = g.week, open = g.items.filter(e => e.status === 'open'), fopen = g.friends.filter(f => f.status === 'open'), admin = isFamAdmin(), free = !['pending', 'booked'].includes(w.state);
  const planBtns = admin && free && (open.length || fopen.length) ? [['released', 'Release it'], ['using', 'We’re using it']].filter(([k]) => k !== w.plan)
    .map(([k, l]) => `<button class="btn sm" data-plan-week="${w.id}" data-plan="${k}">${l}</button>`).join('') : '';
  return `<div class="card flat" style="padding:16px"><div class="row between"><div>${swapWeek(w)}</div><span class="badge">${PLAN[w.plan].label}</span></div>
    ${w.first_refusal_until ? `<p class="small" style="margin:8px 0 0">Released. The families who enquired have first refusal until ${whenTime(w.first_refusal_until)}.</p>` : ''}
    ${g.items.length ? `<ol class="queue">${g.items.map(e => `<li class="${e.status === 'open' ? '' : 'done'}"><div class="row between"><div><b>${esc(e.family)}</b> <span class="muted small">${esc(e.user)} · asked ${asked(e.created_at)}</span></div>${e.status === 'open' ? (e.claim === 'yes' ? '<span class="badge green">Said yes</span>' : e.claim === 'no' ? '<span class="badge">Passed</span>' : '') : enquiryStatus(e)}</div>
      ${e.message ? `<div class="small" style="margin-top:4px">“${esc(e.message)}”</div>` : ''}${offerBox(e)}${pickBox(e)}</li>`).join('')}</ol>` : ''}
    ${g.friends.length ? `<div class="small muted" style="margin:12px 0 0">Booking enquiries from trusted friends</div>${g.friends.map(friendEnquiry).join('')}` : ''}
    ${planBtns ? `<div class="row" style="margin-top:10px;gap:8px"><span class="tiny muted">Your plans for this week:</span>${planBtns}</div>` : ''}
    ${!admin && (open.length || fopen.length) ? '<p class="tiny muted" style="margin:8px 0 0">Your family admin answers these: releasing the week, letting it to a friend, or saying you’re using it.</p>' : ''}</div>`;
}
// a trusted friend's booking enquiry, on the holding family's side
const FE_CLOSED = { using: 'Closed: you’re using it', taken: 'Closed: booked by someone else', swapped: 'Closed: swapped', released: 'Closed: week released' };
function friendEnquiry(f) {
  const st = { open: `<span class="badge amber">Waiting for ${isFamAdmin() ? 'you' : 'your family admin'}</span>`, accepted: '<span class="badge green">Let to them</span>', declined: '<span class="badge">Declined</span>', withdrawn: '<span class="badge">Withdrawn</span>' }[f.status] || `<span class="badge">${FE_CLOSED[f.close_reason] || 'Closed'}</span>`;
  const info = [f.guest_name && f.guest_name !== f.friend ? `lead guest ${esc(f.guest_name)}` : '', f.party_size ? `party of ${f.party_size}` : '',
    f.contact?.email ? `<a href="mailto:${esc(f.contact.email)}">${esc(f.contact.email)}</a>` : '', f.contact?.phone ? `<a href="tel:${esc(f.contact.phone)}">${esc(f.contact.phone)}</a>` : ''].filter(Boolean).join(' · ');
  return `<div class="offer"><div class="row between"><div class="small"><b>${esc(f.friend)}</b> <span class="muted">· trusted friend of the ${esc(f.friend_of)} family · asked ${asked(f.created_at)}</span></div>${st}</div>
    ${info ? `<div class="tiny muted" style="margin-top:4px">${info}</div>` : ''}${f.message ? `<div class="small" style="margin-top:4px">“${esc(f.message)}”</div>` : ''}
    ${f.can_answer ? `<div class="row" style="margin-top:8px;gap:8px"><button class="btn green sm" data-fe-accept="${f.id}" data-fe-name="${esc(f.friend)}" data-fe-price="${f.price}" data-fe-week="${f.week.week_no}" data-fe-members="${f.members_asked}">Let it to them · ${money(f.price)}</button><button class="btn sm" data-fe-decline="${f.id}">Decline</button></div>` : ''}</div>`;
}
// on the holder's side of an enquiry: tell them you're not sure yet (they keep their place in the queue)
function pickBox(e) {
  if (e.status !== 'open' || (e.offer && ['pending', 'proposed'].includes(e.offer.status))) return '';
  if (e.reply === 'unsure') return '<div class="row" style="margin-top:6px"><span class="badge">You replied: not sure yet</span></div>';
  return e.can_reply ? `<div class="row" style="margin-top:6px"><button class="btn sm" data-unsure="${e.id}">Not sure yet</button><span class="tiny muted">They stay in the queue.</span></div>` : '';
}
function outgoingCard(e) {
  return `<div class="card flat" style="padding:16px"><div class="row between"><div>${swapWeek(e.week)} <span class="muted small">· ${esc(e.week.family_name)}</span></div>${enquiryStatus(e)}</div>
    <p class="tiny muted" style="margin:6px 0 0">${esc(e.user)} asked on ${asked(e.created_at)}${e.status === 'open' ? ` · they’ve marked it <b>${PLAN[e.week.plan].label}</b>` : ''}</p>
    ${e.message ? `<div class="small" style="margin-top:4px">“${esc(e.message)}”</div>` : ''}
    ${e.can_claim ? claimForm(e.id, e.week.member_price, e.claim, e.week.first_refusal_until) : ''}
    ${offerBox(e)}
    ${e.status === 'open' && e.reply === 'unsure' && !e.week.first_refusal_until ? `<p class="tiny muted" style="margin:8px 0 0"><b>${esc(e.week.family_name)} replied: not sure yet.</b> You stay in the queue.</p>` : ''}
    ${e.can_withdraw ? `<div class="row" style="margin-top:10px"><button class="btn sm danger" data-withdraw="${e.id}">Withdraw enquiry</button></div>` : ''}</div>`;
}
function bindEnquiryActions(root, reload) {
  const act = (sel, fn) => root.querySelectorAll(sel).forEach(b => b.onclick = guard(async ev => { ev.preventDefault(); if (await fn(b) === false) return; reload(); refreshMe(); }));
  act('[data-take]', async b => { const box = b.closest('[data-claim]'); const d = Object.fromEntries([...box.querySelectorAll('input, select')].map(i => [i.name, i.value]));
    const r = await api(`/enquiries/${b.dataset.take}/claim`, { body: { ...d, want: true } }); toast(r.status === 'won' ? 'It’s yours! See Bookings for payment details' : 'Noted. If nobody ahead of you takes it, it’s yours'); });
  act('[data-pass]', async b => { if (!confirm('Pass on this week? The next family in the queue gets the chance.')) return false; await api(`/enquiries/${b.dataset.pass}/claim`, { body: { want: false } }); toast('Passed'); });
  act('[data-withdraw]', async b => { if (!confirm('Withdraw your enquiry? Your family loses its place in the queue.')) return false; await api(`/enquiries/${b.dataset.withdraw}/withdraw`, { body: {} }); toast('Enquiry withdrawn'); });
  act('[data-fe-accept]', async b => { const d = b.dataset, n = Number(d.feMembers);
    if (!confirm(`Let week ${d.feWeek} to ${d.feName} at ${money(Number(d.fePrice))}?\n\nThe week is released and reserved for them. They pay the syndicate within ${S.me.settings.hold_days} days, and the payment is credited to your household’s account, less the ${money(S.me.settings.letting_cost || 0)} letting cost.${n ? `\n\n${n} member famil${n > 1 ? 'ies have' : 'y has'} also asked for this week and will be told it has been taken.` : ''}`)) return false;
    await api(`/friend-enquiries/${d.feAccept}/answer`, { body: { accept: true } }); toast('Reserved for them. They’ve been sent the payment details'); });
  act('[data-fe-decline]', async b => { if (!confirm('Decline this booking enquiry? They’ll be told the week isn’t available.')) return false; await api(`/friend-enquiries/${b.dataset.feDecline}/answer`, { body: { accept: false } }); toast('Declined'); });
  act('[data-unsure]', async b => { await api(`/enquiries/${b.dataset.unsure}/reply`, { body: { reply: 'unsure' } }); toast('They’ve been told you’re not sure yet'); });
  act('[data-accept]', async b => { if (!confirm('Accept this swap?')) return false; const r = await api(`/swaps/${b.dataset.accept}/accept`, { body: {} }); toast(r.status === 'accepted' ? 'Swap agreed' : 'Accepted. Their family admin now confirms'); });
  act('[data-confirm]', async b => { if (!confirm('Confirm this swap? The two weeks change hands now, and both are marked “Using it”.')) return false; await api(`/swaps/${b.dataset.confirm}/confirm`, { body: { accept: true } }); toast('Swap agreed'); });
  act('[data-reject]', async b => { if (!confirm('Decline this swap? Your family stays in the queue for the week.')) return false; await api(`/swaps/${b.dataset.reject}/confirm`, { body: { accept: false } }); toast('Swap declined'); });
  act('[data-cancel-offer]', async b => { await api(`/swaps/${b.dataset.cancelOffer}/cancel`, { body: {} }); toast('Offer withdrawn'); });
  act('[data-dec-inuse]', async b => { await api(`/swaps/${b.dataset.decInuse}/respond`, { body: { reason: 'in_use' } }); toast('Declined, and the week is now marked “Using it”'); });
  act('[data-dec-unsure]', async b => { await api(`/swaps/${b.dataset.decUnsure}/respond`, { body: { reason: 'unsure' } }); toast('Withdrawn. They stay in the queue'); });
  act('[data-plan-week]', async b => { const plan = b.dataset.plan;
    if (plan === 'using' && !confirm('Mark this week “Using it”? The enquiries for it will close.')) return false;
    if (plan === 'released' && !confirm('Release this week? The families who enquired get first refusal, in queue order, then all members.')) return false;
    await api('/weeks/' + b.dataset.planWeek, { method: 'PUT', body: { plan } }); toast('Week updated'); });
}
function enquiryLists(d, opts = {}) {
  const groups = {}, group = wk => (groups[wk.id] ||= { week: wk, items: [], friends: [] });
  d.incoming.filter(e => !opts.openOnly || e.status === 'open').forEach(e => group(e.week).items.push(e));
  (d.friends || []).filter(f => !opts.openOnly || f.status === 'open').forEach(f => group(f.week).friends.push(f));
  const out = d.outgoing.filter(e => !opts.openOnly || e.status === 'open'), mine = S.me.settings.member_requests;
  const about = Object.values(groups).sort((a, b) => a.week.start_date.localeCompare(b.week.start_date)).map(incomingCard).join('') || `<div class="card flat empty small">${mine ? 'No enquiries about your weeks' : 'No booking enquiries from trusted friends at the moment'}</div>`;
  if (!mine) return `<section class="stack" style="max-width:760px">${about}</section>`;
  return `<div class="grid-2"><section class="stack"><h3 style="margin-bottom:0">About your family’s weeks</h3>${about}</section>
    <section class="stack"><h3 style="margin-bottom:0">Your family’s enquiries</h3>${out.map(outgoingCard).join('') || '<div class="card flat empty small">None yet. Click another family’s week on the calendar to enquire.</div>'}</section></div>`;
}
async function viewEnquiries(main) {
  const d = await api('/enquiries'), s = S.me.settings;
  main.innerHTML = `<h1>Enquiries</h1>${s.member_requests ? `<p class="muted">Enquire about any other family’s week that isn’t marked <b>Using it</b> by clicking it on the calendar. If they release it, those who enquired get first refusal for ${s.enquiry_hours || 48} hours at the member price, first come first served; then it opens to all members, then trusted friends. Trusted friends can also ask to book your weeks that are still <b>Undecided</b>: you can let the week to them at the friend price, or decline. For changes to next year’s allocation, ask the site admin.</p>` : `<p class="muted">Trusted friends can ask to book your household’s weeks that are still <b>Undecided</b>. You can let the week to them at the friend price, or decline. (Members asking for other families’ weeks is switched off for now.)</p>`}
    ${enquiryLists(d)}
    ${d.swaps.length ? `<h2 style="margin-top:32px">Recent swaps</h2><div class="table-wrap"><table><tbody>${d.swaps.map(x => `<tr><td class="small">${asked(x.at)}</td><td>${esc(x.from_family)} gave ${swapWeek(x.offered)}</td><td>${esc(x.to_family)} gave ${swapWeek(x.target)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  bindEnquiryActions(main, () => viewEnquiries(main));
}

// ------------------------------------------------------------ bookings
async function viewBookings(main) {
  const [list, fe] = await Promise.all([api('/bookings'), S.me.user.role === 'friend' ? api('/friend-enquiries') : []]);
  const FE_ST = { open: '<span class="badge amber">Waiting for the household</span>', accepted: '<span class="badge green">Accepted: see your booking</span>', declined: '<span class="badge">Not available this time</span>', withdrawn: '<span class="badge">Withdrawn</span>' };
  const FE_WHY = { using: 'Not available: in use', taken: 'Booked by someone else', swapped: 'No longer available', released: 'Released: see Available weeks' };
  const feTable = fe.length ? `<section class="stack" style="margin-top:32px"><h2>Your enquiries</h2><p class="muted small" style="margin:0">Weeks you’ve asked about before their household decided. If they agree, the week is reserved for you and appears above.</p>
    <div class="table-wrap"><table><thead><tr><th>Week</th><th>Dates</th><th class="r">Price</th><th>Asked</th><th>Status</th><th></th></tr></thead><tbody>${fe.map(e => `<tr><td><b>${e.week.week_no}</b> <span class="muted">${e.week.year}</span></td><td>${range(e.week)}</td><td class="r num">${money(e.week.price)}</td>
      <td class="small">${asked(e.created_at)}</td><td>${FE_ST[e.status] || `<span class="badge">${FE_WHY[e.close_reason] || 'Closed'}</span>`}</td><td class="r">${e.status === 'open' ? `<button class="btn sm danger" data-fe-withdraw="${e.id}">Withdraw</button>` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : '';
  const st = b => ({ pending: '<span class="badge amber">Awaiting payment</span>', confirmed: '<span class="badge green">Confirmed</span>', cancelled: '<span class="badge">Cancelled</span>', expired: '<span class="badge red">Hold expired</span>' }[b.status]);
  const mine = list.filter(b => b.mine), lets = list.filter(b => !b.mine);
  const table = (rows, showBooker) => rows.length ? `<div class="table-wrap"><table><thead><tr><th>Week</th><th>Dates</th>${showBooker ? '<th>Booked by</th>' : '<th>From</th>'}<th>Guest</th><th class="r">Amount</th><th>Ref</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(b => `<tr><td><b>${b.week.week_no}</b> <span class="muted">${b.week.year}</span></td><td>${range(b.week)}</td>
      <td>${showBooker ? esc(b.booker) + (b.booker_contact ? `<div class="tiny muted">${esc(b.booker_contact.email || '')} ${esc(b.booker_contact.phone || '')}</div>` : '') : esc(b.seller)}</td>
      <td>${esc(b.guest_name || '')}${b.party_size ? ` <span class="muted small">(${b.party_size})</span>` : ''}</td><td class="r num">${money(b.amount)}${b.method === 'account' ? '<div class="tiny muted">on account</div>' : ''}</td>
      <td class="small"><code>${esc(b.reference)}</code></td><td>${st(b)}</td>
      <td class="r">${b.status === 'pending' && b.mine ? `<button class="btn sm" data-pay="${b.id}">Pay</button> ` : ''}${b.status === 'pending' ? `<button class="btn sm danger" data-cancel="${b.id}">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
  main.innerHTML = `<h1>Bookings</h1>
    <section class="stack"><h2>Weeks you’ve booked</h2>${table(mine) || `<div class="card flat empty small">You haven’t booked any weeks. Look for green prices on the calendar${S.me.user.role === 'friend' ? ', or enquire about a week marked Open to enquiries' : ''}.</div>`}</section>
    ${feTable}
    ${isFam() ? `<section class="stack" style="margin-top:32px"><h2>Your family’s weeks let to others</h2>${table(lets, true) || '<div class="card flat empty small">None yet. Family admins can offer weeks for letting from the calendar.</div>'}</section>` : ''}`;
  main.querySelectorAll('[data-fe-withdraw]').forEach(b => b.onclick = guard(async () => { if (!confirm('Withdraw your enquiry about this week?')) return; await api(`/friend-enquiries/${b.dataset.feWithdraw}/withdraw`, { body: {} }); toast('Enquiry withdrawn'); viewBookings(main); }));
  main.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => { const x = list.find(r => r.id == b.dataset.pay); openModal(`<h2>Payment details</h2>${payBox(x.reference, x.amount)}<div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Close</button></div>`); });
  main.querySelectorAll('[data-cancel]').forEach(b => b.onclick = guard(async () => { if (!confirm('Cancel this reservation? The week will become available again.')) return; await api(`/bookings/${b.dataset.cancel}/cancel`, { body: {} }); toast('Cancelled'); viewBookings(main); }));
}

// ------------------------------------------------------------ family account
async function viewAccount(main, familyId) {
  const year = S.myYear || S.year, s = S.me.settings;
  const [a, enq, cs] = await Promise.all([api('/account' + (familyId ? '?family_id=' + familyId : '')), familyId ? null : api('/enquiries'), api('/credits?year=' + year)]);
  const me = cs.rows.find(r => r.id === (familyId ? Number(familyId) : S.me.user.family_id)) || { value: 0, entitlement: 0, diff: 0, lets: 0, let_income: 0, released_weeks: 0, carried: 0 };
  const typeName = { service_charge: 'Service charge', rental_credit: 'Letting income', purchase: 'Week purchase', payment: 'Payment', adjustment: 'Adjustment' };
  const owes = a.balance > 0.005;
  main.innerHTML = `<div class="row between"><h1>${esc(a.family.name)} account</h1>${familyId ? '<a class="btn sm" href="#/admin/overview">← Back to overview</a>' : ''}</div>
    <div class="grid-3" style="margin-bottom:24px">
      <div class="card"><div class="muted small">${owes ? 'Balance to pay' : a.balance < -0.005 ? 'In credit' : 'Balance'}</div><div class="stat ${owes ? 'owes' : a.balance < -0.005 ? 'credit' : ''} num">${money(Math.abs(a.balance), 2)}</div>
        ${owes ? `<div class="small muted" style="margin-top:6px">Pay to ${esc(S.me.settings.bank.account_name)} using reference <b>${esc(a.family.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}-SC</b></div>` : ''}</div>
      <div class="card"><div class="muted small">Ownership share</div><div class="stat num">${a.family.share_units} <span class="small muted">weeks</span></div>
        <div class="small muted" style="margin-top:6px">${a.weeks.map(w => `${w.n} weeks held in ${w.year}`).join(' · ')}</div></div>
      <div class="card"><div class="muted small">By year</div>${a.byYear.map(y => `<div class="row between small"><span>${y.year}</span><span class="num">${Math.abs(y.total) < 0.005 ? 'Settled' : y.total > 0 ? money(y.total, 2) + ' due' : money(-y.total, 2) + ' credit'}</span></div>`).join('') || '<div class="small muted">No entries yet</div>'}</div></div>
    <h2 style="margin-bottom:12px">${year} weeks</h2>
    <div class="grid-2" style="margin-bottom:24px">
      <div class="card"><div class="muted small">Released this year</div><div class="stat num">${me.released_weeks} <span class="small muted">week${me.released_weeks === 1 ? '' : 's'}</span></div>
        <div class="small muted" style="margin-top:6px">Releasing early gives a week longer to find a guest. Members get the first chance, then trusted friends.</div></div>
      <div class="card"><div class="muted small">Let income credited for ${year}</div><div class="stat num credit">${money(me.let_income, 2)}</div>
        <div class="small muted" style="margin-top:6px">From ${me.lets} let${me.lets === 1 ? '' : 's'}, after the ${money(s.letting_cost || 0)} letting cost on each. It comes off your service charge, and any extra carries forward.</div></div></div>
    ${!familyId ? `<div id="topupBox"></div><div id="acctSwaps"></div>` : ''}
    <h2>Statement</h2><p class="muted small">When one of your released weeks lets, the payment is credited here as soon as it arrives, less the ${money(S.me.settings.letting_cost || 0)} letting cost for the maintenance fund. Any credit carries forward against future charges. Charges are positive; credits and payments are negative.</p>
    ${a.lines.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Year</th><th>Type</th><th>Description</th><th class="r">Amount</th><th class="r">Balance</th></tr></thead><tbody>
    ${a.lines.map(l => `<tr><td class="small">${new Date(l.created_at + 'Z').toLocaleDateString('en-GB')}</td><td>${l.year}</td><td><span class="badge ${l.amount < 0 ? 'green' : 'accent'}">${typeName[l.type]}</span></td><td>${esc(l.description)}</td>
      <td class="r num">${l.amount < 0 ? '−' : ''}${money(Math.abs(l.amount), 2)}</td><td class="r num">${money(l.running, 2)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">No charges or credits yet.</div>'}`;
  const tb = $('#topupBox', main); if (tb) topupBox(tb, Math.max(0, -a.balance), () => viewAccount(main));
  const box = $('#acctSwaps', main);
  if (box) {
    box.innerHTML = `<div class="row between" style="margin-bottom:10px"><h2 style="margin:0">Open enquiries</h2><a class="btn sm" href="#/enquiries">All enquiries →</a></div>
      <div style="margin-bottom:28px">${enquiryLists(enq, { openOnly: true })}</div>`;
    bindEnquiryActions(box, () => viewAccount(main));
  }
}

// ------------------------------------------------------------ people
async function viewPeople(main) {
  const u = S.me.user;
  if (u.role === 'friend') { main.innerHTML = `<h1>My details</h1><div class="grid-2">${profileCard()}</div>`; bindProfile(main); return; }
  const people = await api('/people');
  const fam = people.filter(p => p.role !== 'friend' && p.active), friends = people.filter(p => p.role === 'friend' && p.active);
  const canEdit = p => isFamAdmin() || p.id === u.id || (p.role === 'friend' && p.created_by === u.id);
  const row = p => `<tr><td><b>${esc(p.name)}</b>${p.id === u.id ? ' <span class="badge">You</span>' : ''}${p.relationship ? `<div class="tiny muted">${esc(p.relationship)}</div>` : ''}</td>
    <td class="small">${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '<span class="muted">—</span>'}</td><td class="small">${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : '<span class="muted">—</span>'}</td>
    <td>${p.role === 'friend' ? '' : `<span class="badge ${p.role === 'family_admin' ? 'accent' : ''}">${roleName(p.role)}</span>`} ${p.has_password ? '' : p.email ? '<span class="badge amber">Invited</span>' : '<span class="badge">No login</span>'}</td>
    <td class="r">${canEdit(p) ? `<button class="btn sm" data-edit="${p.id}">Edit</button>` : ''}</td></tr>`;
  const tbl = (rows, empty) => rows.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Access</th><th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>` : `<div class="card flat empty small">${empty}</div>`;
  main.innerHTML = `<div class="row between"><h1 style="margin:0">${esc(S.me.family.name)}</h1><div class="row">${isFamAdmin() ? '<button class="btn" data-add="family_member">Add family member</button>' : ''}<button class="btn primary" data-add="friend">Add trusted friend</button></div></div>
    <p class="muted">Everyone with an email address gets their own login. ${isFamAdmin() ? 'Family admins can release weeks, answer enquiries and manage people.' : 'Only your family admin can add family members or change access.'}</p>
    <section class="stack"><h2>Family</h2>${tbl(fam, 'No family members yet')}</section>
    <section class="stack" style="margin-top:28px"><h2>Trusted friends</h2><p class="muted small" style="margin:0">Trusted friends can log in, see weeks offered for letting and book them. They can’t see other families’ details or request swaps.</p>${tbl(friends, 'No trusted friends added yet')}</section>
    <section style="margin-top:28px"><h2>My login</h2><div class="grid-2">${profileCard()}</div></section>`;
  bindProfile(main);
  main.querySelectorAll('[data-add]').forEach(b => b.onclick = () => personForm({ role: b.dataset.add }));
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => personForm(people.find(p => p.id == b.dataset.edit)));
}
function personForm(p, opts = {}) {
  const isNew = !p.id; const u = S.me.user; const manage = isFamAdmin() || isSite();
  const m = openModal(`<form id="pf"><h2>${isNew ? (p.role === 'friend' ? 'Add trusted friend' : 'Add family member') : 'Edit ' + esc(p.name)}</h2>
    <div class="grid-2" style="gap:12px"><div class="field"><label>Full name</label><input name="name" value="${esc(p.name || '')}" required></div>
    <div class="field"><label>${p.role === 'friend' ? 'How do you know them?' : 'Relationship'}</label><input name="relationship" value="${esc(p.relationship || '')}" placeholder="${p.role === 'friend' ? 'e.g. Neighbour, work friend' : 'e.g. Daughter'}"></div>
    <div class="field"><label>Email ${isNew ? '(needed for a login)' : ''}</label><input name="email" type="email" value="${esc(p.email || '')}"></div>
    <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(p.phone || '')}"></div></div>
    ${opts.admin && p.id !== u.id ? roleFields(p.role, p.family_id)
      : manage && p.role !== 'friend' && p.role !== 'site_admin' && p.id !== u.id ? `<div class="field"><label>Access level</label><select name="role"><option value="family_member" ${p.role === 'family_member' ? 'selected' : ''}>Family member — view, enquire, book weeks</option><option value="family_admin" ${p.role === 'family_admin' ? 'selected' : ''}>Family admin — also sets the family’s weeks, answers enquiries, manages people</option></select></div>` : `<input type="hidden" name="role" value="${p.role}">`}
    <div class="field"><label>Notes (only your family sees these)</label><textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></div>
    ${isNew ? '<p class="tiny muted">By adding someone you confirm they’re happy for their contact details to be held by the syndicate.</p>' : ''}
    ${p.invite_link ? `<div class="notice small" style="margin-bottom:12px">Invitation link (not yet used):<br><input readonly value="${esc(p.invite_link)}" onclick="this.select()" style="margin-top:6px"></div>` : ''}
    <div class="row between"><div class="row">${!isNew && p.id !== u.id ? '<button type="button" class="btn danger" id="rm">Remove</button>' : ''}${!isNew && manage && p.email && p.id !== u.id ? `<button type="button" class="btn" id="reinv">${p.has_password ? 'Reset password link' : 'New invite link'}</button>` : ''}</div>
    <div class="row"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${isNew ? 'Add' : 'Save'}</button></div></div></form>`);
  const done = () => { closeOverlay(); route(); };
  bindRoleFields(m);
  $('#pf', m).onsubmit = guard(async e => {
    e.preventDefault(); const d = formData(e.target);
    if (isNew) { const r = await api('/people', { body: d }); if (r.invite_link) return showInvite(d.name, r.invite_link); toast('Added (no email, so no login)'); }
    else { await api('/people/' + p.id, { method: 'PUT', body: d }); toast('Saved'); }
    done();
  });
  $('#rm', m) && ($('#rm', m).onclick = guard(async () => { if (!confirm(`Remove ${p.name}? They will no longer be able to log in.`)) return; await api('/people/' + p.id, { method: 'DELETE' }); toast('Removed'); done(); }));
  $('#reinv', m) && ($('#reinv', m).onclick = guard(async () => { const r = await api(`/people/${p.id}/reinvite`, { body: {} }); showInvite(p.name, r.invite_link); }));
}
// role + family pickers for the site admin (a site admin has no family)
function roleFields(role, familyId) {
  return `<div class="grid-2" style="gap:12px"><div class="field"><label>Role</label><select name="role">${['family_admin', 'family_member', 'friend', 'site_admin'].map(r => `<option value="${r}" ${r === role ? 'selected' : ''}>${roleName(r)}${r === 'site_admin' ? ' (no family)' : ''}</option>`).join('')}</select></div>
    <div class="field fam-field"><label>Family</label><select name="family_id">${S.me.families.map(f => `<option value="${f.id}" ${f.id === familyId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div></div>`;
}
function bindRoleFields(root) {
  const sel = $('select[name=role]', root), fam = $('.fam-field', root); if (!sel || !fam) return;
  const sync = () => { fam.style.visibility = sel.value === 'site_admin' ? 'hidden' : ''; }; sel.addEventListener('change', sync); sync();
}
function showInvite(name, link) {
  openModal(`<h2>Invitation ready</h2><p>Send this link to <b>${esc(name)}</b> so they can choose a password. ${'Once email sending is configured it will be sent automatically.'}</p>
    <input readonly value="${esc(link)}" id="invl"><div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" id="cp">Copy link</button><button class="btn primary" data-close>Done</button></div>`);
  $('#invl').select(); $('#cp').onclick = () => { navigator.clipboard?.writeText(link); toast('Copied'); };
  $('#drawer-root [data-close]').onclick = () => { closeOverlay(); route(); };
}
function profileCard() {
  const u = S.me.user;
  return `<form class="card" id="prof"><h3>Contact details</h3><div class="field"><label>Name</label><input name="name" value="${esc(u.name)}"></div>
    <div class="field"><label>Email (your login)</label><input name="email" type="email" value="${esc(u.email || '')}"></div><div class="field"><label>Phone</label><input name="phone" value="${esc(u.phone || '')}"></div><button class="btn primary">Save details</button></form>
    <form class="card" id="pw"><h3>Change password</h3><div class="field"><label>Current password</label><input name="current_password" type="password" autocomplete="current-password" required></div>
    <div class="field"><label>New password</label><input name="new_password" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn">Update password</button></form>`;
}
function bindProfile(main) {
  $('#prof', main).onsubmit = guard(async e => { e.preventDefault(); await api('/me', { method: 'PUT', body: formData(e.target) }); toast('Details saved'); refreshMe(); });
  $('#pw', main).onsubmit = guard(async e => { e.preventDefault(); await api('/me', { method: 'PUT', body: formData(e.target) }); e.target.reset(); toast('Password changed'); });
}

// ------------------------------------------------------------ site admin
async function viewAdmin(main) {
  const sub = location.hash.split('/')[2] || 'overview';
  const tabs = [['overview', 'Payments & balances'], ['budget', 'Budget & charges'], ['weeks', 'Weeks & allocation'], ['credits', 'Lets'], ['families', 'Families'], ['users', 'All users'], ['settings', 'Settings & rates'], ['audit', 'Activity log']];
  main.innerHTML = isSiteRole() ? `<h1>${(tabs.find(t => t[0] === sub) || tabs[0])[1]}</h1><div id="adm"></div>`
    : `<h1>Site admin</h1><div class="subtabs">${tabs.map(([k, l]) => `<a href="#/admin/${k}" class="${k === sub ? 'on' : ''}">${l}</a>`).join('')}</div><div id="adm"></div>`;
  const el = $('#adm', main);
  if (sub.startsWith('account-')) return viewAccount(main, sub.split('-')[1]);
  await ({ overview: admOverview, budget: admBudget, weeks: admWeeks, credits: admCredits, families: admFamilies, users: admUsers, settings: admSettings, audit: admAudit }[sub] || admOverview)(el);
}
async function admOverview(el) {
  const o = await api('/admin/overview');
  el.innerHTML = `<div class="grid-2" style="align-items:start">
    <section class="stack"><h2>Payments to confirm</h2><p class="muted small" style="margin:0">Check the syndicate bank statement for each reference, then confirm. Confirming credits the household that released the week, less the letting cost.</p>
    ${o.pending.length ? `<div class="table-wrap"><table><thead><tr><th>Ref</th><th>Week</th><th>From</th><th class="r">Amount</th><th></th></tr></thead><tbody>${o.pending.map(b => `<tr><td class="small"><code>${esc(b.reference)}</code><div class="tiny muted">expires ${new Date(b.expires_at + 'Z').toLocaleDateString('en-GB')}</div></td><td>${b.week.week_no} / ${b.week.year}<div class="tiny muted">${esc(b.seller)}</div></td><td>${esc(b.booker)}</td><td class="r num">${money(b.amount, 2)}</td>
      <td class="r"><button class="btn sm green" data-conf="${b.id}">Paid</button> <button class="btn sm danger" data-rej="${b.id}">Cancel</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card flat empty small">Nothing waiting</div>'}</section>
    ${o.topups.length ? `<section class="stack" style="grid-column:1/-1"><h2>Top-ups expected</h2><p class="muted small" style="margin:0">Households sending money in to build up credit for buying weeks. When the transfer arrives, confirm it to add it to their account.</p>
      <div class="table-wrap"><table><thead><tr><th>Ref</th><th>Household</th><th>From</th><th class="r">Amount</th><th></th></tr></thead><tbody>${o.topups.map(t => `<tr><td class="small"><code>${esc(t.reference)}</code></td><td>${esc(t.family)}</td><td class="small">${esc(t.person)} · ${asked(t.created_at)}</td><td class="r num">${money(t.amount, 2)}</td>
      <td class="r"><button class="btn sm green" data-tuconf="${t.id}" data-amt="${t.amount}">Arrived</button> <button class="btn sm danger" data-tucan="${t.id}">Cancel</button></td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <section class="stack"><h2>Family balances</h2><div class="table-wrap"><table><thead><tr><th>Family</th><th class="r">Balance</th><th></th></tr></thead><tbody>
      ${o.balances.map(b => `<tr><td><i class="swatch" style="background:${b.color}"></i> <a href="#/admin/account-${b.id}">${esc(b.name)}</a></td><td class="r num ${b.balance > 0 ? '' : 'muted'}">${b.balance > 0 ? money(b.balance, 2) + ' owed' : b.balance < 0 ? money(-b.balance, 2) + ' credit' : 'Settled'}</td><td class="r"><button class="btn sm" data-pay="${b.id}">Record payment</button></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total outstanding</td><td class="r num">${money(o.balances.reduce((a, b) => a + Math.max(0, b.balance), 0), 2)}</td><td></td></tr></tfoot></table></div></section></div>`;
  el.querySelectorAll('[data-conf]').forEach(b => b.onclick = guard(async () => { await api(`/admin/bookings/${b.dataset.conf}/confirm`, { body: {} }); toast('Payment confirmed'); admOverview(el); }));
  el.querySelectorAll('[data-tuconf]').forEach(b => b.onclick = guard(async () => { const amt = prompt('Amount received (£):', b.dataset.amt); if (amt === null) return;
    await api(`/admin/topups/${b.dataset.tuconf}/confirm`, { body: { amount: amt } }); toast('Top-up added to their account'); admOverview(el); }));
  el.querySelectorAll('[data-tucan]').forEach(b => b.onclick = guard(async () => { if (!confirm('Cancel this expected top-up?')) return; await api(`/topups/${b.dataset.tucan}/cancel`, { body: {} }); toast('Cancelled'); admOverview(el); }));
  el.querySelectorAll('[data-rej]').forEach(b => b.onclick = guard(async () => { if (!confirm('Cancel this reservation and release the week?')) return; await api(`/bookings/${b.dataset.rej}/cancel`, { body: {} }); admOverview(el); }));
  el.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    const f = o.balances.find(x => x.id == b.dataset.pay);
    const m = openModal(`<form id="lp"><h2>${esc(f.name)}: record entry</h2><div class="grid-2" style="gap:12px">
      <div class="field"><label>Type</label><select name="type"><option value="payment">Payment received</option><option value="adjustment">Adjustment (+ charge / − credit)</option></select></div>
      <div class="field"><label>Year</label><input name="year" type="number" value="${new Date().getFullYear()}"></div></div>
      <div class="field"><label>Amount</label><input name="amount" type="number" step="0.01" value="${f.balance > 0 ? f.balance : ''}" required></div>
      <div class="field"><label>Description</label><input name="description" placeholder="e.g. Bank transfer 14 Mar"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    $('#lp', m).onsubmit = guard(async e => { e.preventDefault(); await api('/admin/ledger', { body: { ...formData(e.target), family_id: f.id } }); closeOverlay(); toast('Recorded'); admOverview(el); });
  });
}
async function admBudget(el, year) {
  year = year || S.budgetYear || Math.max(...S.me.years.filter(y => y <= new Date().getFullYear()), new Date().getFullYear() - 1); S.budgetYear = year;
  const b = await api('/admin/budget?year=' + year);
  const years = [...new Set([...b.years, year, year + 1])].sort();
  const cats = [...new Set(b.items.map(i => i.category).filter(Boolean))];
  const cur = S.me.settings.currency;
  el.innerHTML = `<div class="row between" style="margin-bottom:14px"><div class="seg">${years.map(y => `<button data-y="${y}" class="${y === year ? 'on' : ''}">${y}</button>`).join('')}</div>
    <div class="row"><button class="btn" id="imp">Import from spreadsheet</button><button class="btn" id="copy">Copy from ${year - 1}…</button></div></div>
    <div class="row" style="margin-bottom:14px"><div class="field" style="margin:0;min-width:260px"><label>Budget period for ${year}</label><input id="blabel" value="${esc(b.label)}" placeholder="e.g. July ${year - 1} – June ${year}"></div></div>
    <div class="grid-2" style="grid-template-columns: minmax(0,3fr) minmax(300px,2fr); align-items:start">
    <section class="stack"><div class="table-wrap"><table style="table-layout:fixed;min-width:620px"><colgroup><col style="width:34%"><col style="width:112px"><col style="width:112px"><col><col style="width:44px"></colgroup><thead><tr><th>Item</th><th class="r">Estimate (${cur})</th><th>Type</th><th>Commentary</th><th></th></tr></thead><tbody>
      ${b.items.map(i => `<tr data-id="${i.id}"><td><input name="description" value="${esc(i.description)}"></td><td class="r"><input name="amount" type="number" step="0.01" value="${i.amount}" style="text-align:right"></td><td><input name="category" value="${esc(i.category || '')}" list="cats"></td><td><input name="notes" value="${esc(i.notes || '')}"></td><td><button class="iconbtn" data-del="${i.id}" title="Remove">${icon('trash-2')}</button></td></tr>`).join('')}
      <tr id="newrow"><td><input name="description" placeholder="New item…"></td><td class="r"><input name="amount" type="number" step="0.01" placeholder="0" style="text-align:right"></td><td><input name="category" placeholder="Type" list="cats"></td><td><input name="notes" placeholder="Commentary"></td><td><button class="btn sm primary" id="addi">Add</button></td></tr>
      </tbody><tfoot><tr><td>Estimated funding need</td><td class="r num">${money(b.total, 2)}</td><td colspan="3"></td></tr></tfoot></table></div>
      <datalist id="cats">${['Regular', 'Postpone', 'Provision', 'One-off', ...cats].filter((v, i, a) => a.indexOf(v) === i).map(c => `<option value="${esc(c)}">`).join('')}</datalist><p class="tiny muted">Changes save when you leave a field.</p></section>
    <section class="stack"><div class="card"><h3>Service charges ${esc(b.label || year)}</h3>
      <dl class="kv" style="grid-template-columns:1fr auto"><dt>Funding need</dt><dd class="num r">${money(b.total, 2)}</dd><dt>÷ ${b.units} weeks</dt><dd class="num">${money(b.rate_calc, 2)} / week</dd></dl>
      <div class="field" style="margin-top:12px"><label>Service charge per week</label><div class="row" style="flex-wrap:nowrap"><input id="rate" type="number" step="0.01" min="0" value="${b.rate_per_week ?? ''}" placeholder="${b.rate_calc}">
        <button class="btn sm" data-round="5">Round to ${cur}5</button><button class="btn sm" data-round="10">${cur}10</button></div>
        <div class="tiny muted" style="margin-top:4px">Leave blank to charge exactly ${money(b.rate_calc, 2)}.</div></div>
      <table><tbody>${b.split.map(s => `<tr><td><i class="swatch" style="background:${s.color}"></i> ${esc(s.name)}<div class="tiny muted">${s.share_units} weeks × ${money(b.rate, 2)}</div></td><td class="r num">${money(s.charge, 2)}${s.charged != null && Math.abs(s.charged - s.charge) > 0.01 ? `<div class="tiny" style="color:var(--amber)">issued ${money(s.charged, 2)}</div>` : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total raised</td><td class="r num">${money(b.raised, 2)}</td></tr></tfoot></table>
      ${Math.abs(b.difference) > 0.01 ? `<p class="small" style="margin:10px 0 0;color:${b.difference < 0 ? 'var(--amber)' : 'var(--green)'}">${b.difference < 0 ? 'Shortfall' : 'Surplus'} against budget: <b>${money(Math.abs(b.difference), 2)}</b></p>` : ''}
      <button class="btn primary block" id="gen" style="margin-top:14px" ${b.total ? '' : 'disabled'}>${b.generated ? 'Re-issue' : 'Issue'} ${year} service charges</button>
      <p class="tiny muted" style="margin-bottom:0">${b.generated ? 'Charges for this year have been issued. Re-issuing replaces them with the figures above. Payments, credits and letting income are untouched.' : 'This adds each family’s charge to their account and notifies their admins.'}</p></div></section></div>`;
  const reload = () => admBudget(el, year);
  el.querySelectorAll('[data-y]').forEach(x => x.onclick = () => admBudget(el, Number(x.dataset.y)));
  el.querySelectorAll('tr[data-id] input').forEach(inp => inp.onchange = guard(async () => { await api('/admin/budget/' + inp.closest('tr').dataset.id, { method: 'PUT', body: { [inp.name]: inp.value } }); reload(); }));
  el.querySelectorAll('[data-del]').forEach(x => x.onclick = guard(async () => { await api('/admin/budget/' + x.dataset.del, { method: 'DELETE' }); reload(); }));
  $('#addi', el).onclick = guard(async () => { const r = $('#newrow', el); const d = Object.fromEntries([...r.querySelectorAll('input')].map(i => [i.name, i.value])); await api('/admin/budget', { body: { ...d, year } }); reload(); });
  const saveYear = guard(async body => { await api('/admin/budget-year/' + year, { method: 'PUT', body }); reload(); });
  $('#blabel', el).onchange = e => saveYear({ label: e.target.value });
  $('#rate', el).onchange = e => saveYear({ rate_per_week: e.target.value });
  el.querySelectorAll('[data-round]').forEach(x => x.onclick = () => { const n = +x.dataset.round; saveYear({ rate_per_week: Math.round(b.rate_calc / n) * n }); });
  $('#gen', el).onclick = guard(async () => { if (!confirm(`${b.generated ? 'Re-issue' : 'Issue'} ${year} service charges at ${money(b.rate, 2)} per week (total ${money(b.raised, 2)})?`)) return; await api('/admin/budget/generate', { body: { year } }); toast('Service charges issued'); reload(); });
  $('#copy', el).onclick = () => { const m = openModal(`<form id="cf"><h2>Start ${year} from ${year - 1}</h2><div class="field"><label>Inflation uplift %</label><input name="uplift_pct" type="number" step="0.1" value="3"></div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Copy</button></div></form>`);
    $('#cf', m).onsubmit = guard(async e => { e.preventDefault(); await api('/admin/budget/copy', { body: { from: year - 1, to: year, ...formData(e.target) } }); closeOverlay(); reload(); }); };
  $('#imp', el).onclick = () => importDialog('budget', year, reload);
}
async function admWeeks(el, year) {
  year = year || S.year; const weeks = await api('/weeks?year=' + year); const fams = (await api('/admin/families')).filter(f => f.active);
  const years = [...new Set([...S.me.years, year])].sort();
  const counts = {}; weeks.forEach(w => counts[w.original_family_id] = (counts[w.original_family_id] || 0) + 1);
  el.innerHTML = `<div class="row between" style="margin-bottom:14px"><div class="seg">${years.map(y => `<button data-y="${y}" class="${y === year ? 'on' : ''}">${y}</button>`).join('')}<button data-new>+ Year</button></div>
    <div class="row"><button class="btn" id="imp">Import allocation</button><button class="btn" id="rot">Roll forward from ${year - 1}…</button></div></div>
    ${weeks.length ? '<div id="crAdmin"></div>' : ''}
    ${weeks.length ? `<div class="legend">${fams.map(f => `<span><i class="swatch" style="background:${f.color}"></i>${esc(f.name)}: ${counts[f.id] || 0} weeks</span>`).join('')}<span>Syndicate: ${counts[null] || counts['null'] || 0}</span></div>
    <div class="table-wrap"><table><thead><tr><th>Week</th><th>Starts</th><th>Nights</th><th>School hols</th><th>Season</th><th>Allocated to</th><th>Currently held by</th><th>Status</th></tr></thead><tbody>
    ${weeks.map(w => `<tr data-id="${w.id}"><td><b>${w.week_no}</b></td><td><input type="date" name="start_date" value="${w.start_date}" style="max-width:150px"><div class="tiny muted">${dfmt(w.start_date, { weekday: 'long' })}</div></td><td class="num ${nights(w) !== 7 ? '' : 'muted'}">${nights(w)}</td>
      <td><input type="checkbox" name="school_holiday" ${w.school_holiday ? 'checked' : ''}></td>
      <td><select name="season" style="max-width:120px">${['summer', 'shoulder', 'winter'].map(s => `<option ${s === w.season ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><select name="family_id" style="max-width:180px" ${['pending', 'booked'].includes(w.status) ? 'disabled' : ''}><option value="">Syndicate (unallocated)</option>${fams.map(f => `<option value="${f.id}" ${f.id === w.original_family_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></td>
      <td>${w.family_id !== w.original_family_id ? `<i class="swatch" style="background:${w.family_color}"></i> ${esc(w.family_name)} <span class="badge">swapped</span>` : '<span class="muted small">same</span>'}</td><td>${statusBadge(w) || '<span class="muted small">Own use</span>'}<input name="comment" value="${esc(w.comment || '')}" placeholder="Calendar note" style="margin-top:4px;font-size:12px"></td></tr>`).join('')}</tbody></table></div>
    <p class="tiny muted">Changing “Allocated to” resets that week’s holder. Weeks with a booking can’t be reallocated. Changing a start date also moves the end of the week before.</p>` : '<div class="card empty">No weeks for this year yet.</div>'}`;
  el.querySelectorAll('[data-y]').forEach(x => x.onclick = () => admWeeks(el, Number(x.dataset.y)));
  if ($('#crAdmin', el)) adminChangeBox($('#crAdmin', el), year, () => admWeeks(el, year));
  $('[data-new]', el).onclick = guard(async () => { const y = Number(prompt('Create weeks for which year?', Math.max(...years) + 1)); if (!y) return; const r = await api('/admin/years', { body: { year: y } }); toast(`Created ${r.weeks} weeks for ${y}`); await refreshMe(); admWeeks(el, y); });
  el.querySelectorAll('tr[data-id] select, tr[data-id] input').forEach(s => s.onchange = guard(async () => { await api('/admin/weeks/' + s.closest('tr').dataset.id, { method: 'PUT', body: { [s.name]: s.type === 'checkbox' ? s.checked : s.value } }); toast('Saved'); admWeeks(el, year); }));
  $('#imp', el).onclick = () => importDialog('allocation', year, async () => { await refreshMe(); admWeeks(el, year); }, weeks);
  $('#rot', el).onclick = () => { const m = openModal(`<form id="rf"><h2>Roll allocation forward</h2><p class="muted small">Copies ${year - 1}’s allocation into ${year}, optionally shifting every family along by a number of weeks so peak weeks rotate fairly. Bookings in ${year} are kept.</p>
      <div class="field"><label>Shift by (weeks)</label><input name="shift" type="number" value="0"></div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Apply</button></div></form>`);
    $('#rf', m).onsubmit = guard(async e => { e.preventDefault(); await api('/admin/allocation/rotate', { body: { from: year - 1, to: year, ...formData(e.target) } }); closeOverlay(); await refreshMe(); admWeeks(el, year); }); };
}

async function admFamilies(el) {
  const fams = await api('/admin/families'); const ys = S.me.years;
  el.innerHTML = `<div class="row between" style="margin-bottom:14px"><p class="muted small" style="margin:0;max-width:640px">Each family’s ownership share is its number of weeks. The service charge is charged per week, so a family with 12 weeks pays 12 × the weekly charge.</p>
    <div class="row"><button class="btn" id="sfw">Set shares from ${S.year} allocation</button><button class="btn primary" id="addf">Add family</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Colour</th><th>Family</th><th>Shares (weeks)</th>${ys.map(y => `<th class="r">Weeks ${y}</th>`).join('')}<th>Family admins</th><th>Active</th></tr></thead><tbody>
    ${fams.map(f => `<tr data-id="${f.id}"><td><input type="color" name="color" value="${f.color}" style="width:44px;padding:2px;height:32px"></td><td><input name="name" value="${esc(f.name)}"></td><td><input name="share_units" type="number" step="0.01" value="${f.share_units}" style="max-width:90px"></td>
      ${ys.map(y => `<td class="r num">${f.weeks[y] || 0}</td>`).join('')}<td class="small">${f.admins.map(esc).join(', ') || '<span class="badge amber">None</span>'}</td><td><input type="checkbox" name="active" ${f.active ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>
    <p class="tiny muted">To add a family admin, go to All users and add a person with the Family admin role.</p>`;
  el.querySelectorAll('tr[data-id] input').forEach(i => i.onchange = guard(async () => { await api('/admin/families/' + i.closest('tr').dataset.id, { method: 'PUT', body: { [i.name]: i.type === 'checkbox' ? i.checked : i.value } }); toast('Saved'); await refreshMe(); }));
  $('#sfw', el).onclick = guard(async () => { await api('/admin/families/shares-from-weeks', { body: { year: S.year } }); toast('Share units updated'); admFamilies(el); });
  $('#addf', el).onclick = guard(async () => { const n = prompt('Family name'); if (!n) return; await api('/admin/families', { body: { name: n, share_units: 1, color: '#' + Math.floor(Math.random() * 0xaaaaaa + 0x222222).toString(16) } }); await refreshMe(); admFamilies(el); });
}
async function admUsers(el) {
  const people = await api('/people?all=1');
  el.innerHTML = `<div class="row between" style="margin-bottom:14px"><span class="muted small">${people.filter(p => p.active).length} active logins</span><button class="btn primary" id="addu">Add person</button></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Family</th><th>Role</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
    ${people.filter(p => p.active).sort((a, b) => (b.role === 'site_admin') - (a.role === 'site_admin') || String(a.family_name).localeCompare(b.family_name)).map(p => `<tr><td><b>${esc(p.name)}</b> ${p.role === 'site_admin' ? '<span class="badge accent">Site admin</span>' : ''}</td><td>${p.role === 'site_admin' ? '<span class="muted">—</span>' : esc(p.family_name)}</td><td>${roleName(p.role)} ${p.has_password ? '' : '<span class="badge amber">Invited</span>'}</td><td class="small">${esc(p.email || '')}</td><td class="small">${esc(p.phone || '')}</td><td class="r"><button class="btn sm" data-e="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => personForm(people.find(p => p.id == b.dataset.e), { admin: true }));
  $('#addu', el).onclick = () => {
    const m = openModal(`<form id="nu"><h2>Add person</h2><div class="grid-2" style="gap:12px"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" type="email"></div>
      <div class="field"><label>Phone</label><input name="phone"></div><div></div></div>
      ${roleFields('family_admin', null)}
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`);
    bindRoleFields(m);
    $('#nu', m).onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target); if (d.role === 'site_admin') delete d.family_id; const r = await api('/people', { body: d }); if (r.invite_link) showInvite(d.name, r.invite_link); else { closeOverlay(); admUsers(el); } });
  };
}
async function admSettings(el) {
  const s = await api('/admin/settings');
  const daySel = (k, l) => `<div class="field"><label>${l}</label><select name="${k}">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${String(i) === s[k] ? 'selected' : ''}>${d}</option>`).join('')}</select></div>`;
  const f = (k, l, type = 'text', extra = '') => `<div class="field"><label>${l}</label><input name="${k}" type="${type}" value="${esc(s[k])}" ${extra}></div>`;
  el.innerHTML = `<div class="card" style="margin-bottom:var(--sp-5)"><div class="row" style="align-items:flex-start;gap:var(--sp-5)">
      <div class="grow" style="min-width:260px"><h3>${icon('image')} Overview photograph</h3><p class="small muted" style="margin:0 0 var(--sp-4)">An optional panoramic photograph of the house or Loch Carron, shown on the Overview and sign-in pages. A wide landscape image works best; it’s resized before uploading.</p>
        <div class="row"><label class="btn sm" style="margin:0">${icon('upload')} ${s.hero_version ? 'Replace photograph' : 'Upload photograph'}<input type="file" id="heroFile" accept="image/jpeg,image/png,image/webp" hidden></label>${s.hero_version ? '<button type="button" class="btn sm danger" id="heroRm">Remove</button>' : ''}</div></div>
      ${s.hero_version ? `<img src="/media/hero?v=${esc(s.hero_version)}" alt="" style="width:min(360px,100%);aspect-ratio:3/1;object-fit:cover;border-radius:var(--r-md);border:1px solid var(--line)">` : ''}</div></div>
    <form id="sf" class="grid-2" style="align-items:start">
    <div class="card"><h3>Trusted-friend prices (per week)</h3><p class="small muted" style="margin-top:0">Used for any released week unless the family sets its own price. Members pay a percentage of these.</p>
      <div class="grid-2" style="gap:12px">${f('rate_school', '<i class="season school"></i> School holidays', 'number', 'min=0')}${f('rate_summer', '<i class="season summer"></i> Summer', 'number', 'min=0')}${f('rate_shoulder', '<i class="season shoulder"></i> Shoulder', 'number', 'min=0')}${f('rate_winter', '<i class="season winter"></i> Winter', 'number', 'min=0')}</div>
      <div class="grid-2" style="gap:12px">${f('member_rate_pct', 'Members pay (% of friend price)', 'number', 'min=0 max=100')}${f('members_first_days', 'Members-only days after release', 'number', 'min=0')}${f('enquiry_hours', 'Hours of first refusal for enquirers', 'number', 'min=0')}</div>
      <h3 style="margin-top:8px">Releases &amp; reminders</h3>
      ${f('reminder_weeks', 'Remind about undecided weeks at (weeks before, comma-separated)')}
      <h3 style="margin-top:8px">Seasons</h3><p class="small muted" style="margin-top:0">Months (1–12) used when new years are created. You can override individual weeks under Weeks.</p>
      <div class="grid-2" style="gap:12px">${f('summer_months', 'Summer months')}${f('shoulder_months', 'Shoulder months')}</div>
      <h3 style="margin-top:8px">Booking rules</h3><div class="grid-2" style="gap:12px">${f('hold_days', 'Days to pay before a hold lapses', 'number', 'min=1')}${f('letting_cost', 'Letting cost per let, to the maintenance fund (£)', 'number', 'min=0')}</div>
      <label class="check"><input type="checkbox" name="allow_member_account_charge" ${s.allow_member_account_charge === '1' ? 'checked' : ''}><span><b>Family members can charge weeks to their family account</b>If off, only family admins can; members pay by bank transfer.</span></label>
      <label class="check" style="margin-top:8px"><input type="checkbox" name="view_as_enabled" ${s.view_as_enabled !== '0' ? 'checked' : ''}><span><b>Site admin can “View as” other logins</b>For testing: see the portal exactly as a family admin, member or trusted friend sees it, from the dropdown in the menu. Anything done while viewing as someone really happens, and the Activity log notes it.</span></label></div>
    <div class="card"><h3>Syndicate bank account</h3><p class="small muted" style="margin-top:0">Shown to people when they book a week.</p>
      ${f('bank_account_name', 'Account name')}${f('bank_name', 'Bank')}<div class="grid-2" style="gap:12px">${f('bank_sort_code', 'Sort code')}${f('bank_account_no', 'Account number')}</div>${f('bank_iban', 'IBAN (optional)')}
      <h3 style="margin-top:8px">General</h3><div class="grid-2" style="gap:12px">${f('site_name', 'Site name')}${f('currency', 'Currency symbol')}${f('place_line', 'Place line (under the name)')}</div>
      <h3 style="margin-top:8px">Changeover days</h3><p class="small muted" style="margin-top:0">Used when a new year’s weeks are created. Week 1 starts on the first winter changeover day on or after 26 December, so some years have 53 weeks.</p>
      <div class="grid-2" style="gap:12px">${daySel('winter_changeover_day', 'Winter changeover')}${daySel('summer_changeover_day', 'Summer changeover')}
      ${f('summer_changeover_from', 'Summer changeover from week', 'number', 'min=1 max=53')}${f('summer_changeover_to', '…to week (inclusive)', 'number', 'min=1 max=53')}</div></div>
    <div><button class="btn primary">Save settings</button></div></form>`;
  $('#heroFile', el).onchange = guard(async e => {
    const file = e.target.files[0]; if (!file) return;
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That file isn’t an image the browser can read')); i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, 2400 / img.naturalWidth), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    await api('/admin/hero', { body: { data: c.toDataURL('image/jpeg', 0.84) } }); toast('Photograph saved'); await refreshMe(); admSettings(el);
  });
  $('#heroRm', el) && ($('#heroRm', el).onclick = guard(async () => { if (!confirm('Remove the Overview photograph?')) return; await api('/admin/hero', { method: 'DELETE' }); toast('Photograph removed'); await refreshMe(); admSettings(el); }));
  $('#sf', el).onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target); d.allow_member_account_charge = e.target.allow_member_account_charge.checked ? '1' : '0'; d.view_as_enabled = e.target.view_as_enabled.checked ? '1' : '0'; await api('/admin/settings', { method: 'PUT', body: d }); toast('Settings saved'); refreshMe(); });
}
async function admCredits(el, year) {
  year = year || S.creditYear || S.year; S.creditYear = year;
  const c = await api('/credits?year=' + year);
  el.innerHTML = `<div class="row between" style="margin-bottom:14px"><div class="seg">${S.me.years.map(y => `<button data-y="${y}" class="${y === year ? 'on' : ''}">${y}</button>`).join('')}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Household</th><th class="r">Shares</th><th class="r">Weeks held</th><th class="r">Released</th><th class="r">Lets</th><th class="r">Let income credited</th></tr></thead><tbody>
    ${c.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="r num">${r.shares}</td><td class="r num">${r.weeks}</td><td class="r num">${r.released_weeks}</td><td class="r num">${r.lets}</td><td class="r num">${money(r.let_income, 2)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td class="r">${c.rows.reduce((a, r) => a + r.shares, 0)}</td><td class="r">${c.rows.reduce((a, r) => a + r.weeks, 0)}</td><td class="r">${c.rows.reduce((a, r) => a + r.released_weeks, 0)}</td><td class="r">${c.income.lets}</td><td class="r">${money(c.income.credited, 2)}</td></tr></tfoot></table></div>
    <div class="card" style="margin-top:20px;max-width:760px"><h3>Let income</h3><p class="small" style="margin:0">When a released ${year} week lets and the payment is confirmed, the household that released it is credited with the payment less the ${money(S.me.settings.letting_cost || 0)} letting cost, which goes to the maintenance fund.
      So far: ${money(c.income.gross, 2)} from ${c.income.lets} let${c.income.lets === 1 ? '' : 's'}, of which <b>${money(c.income.fund, 2)}</b> to the maintenance fund. Credit comes off the household’s service charge and any extra carries forward.</p></div>`;
  el.querySelectorAll('[data-y]').forEach(b => b.onclick = () => admCredits(el, Number(b.dataset.y)));
}
async function admAudit(el) {
  const rows = await api('/admin/audit');
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${rows.map(r => `<tr><td class="small">${new Date(r.created_at + 'Z').toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(r.name || '')}</td><td><code class="small">${esc(r.action)}</code></td><td class="tiny muted" style="max-width:420px;word-break:break-all">${esc(r.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No activity yet</td></tr>'}</tbody></table></div>`;
}

// ------------------------------------------------------------ spreadsheet import (budget / allocation)
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Reads "Dec 27 Fri", "March 15", "August14", "Sept 6", "27/12/2024", Excel serials or Date objects. Returns {iso, weekdayOk}.
function parseWeekDate(v, weekNo, year) {
  if (v instanceof Date) return { iso: v.toISOString().slice(0, 10), weekdayOk: true };
  if (typeof v === 'number' && v > 30000) return { iso: new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10), weekdayOk: true };
  const t = String(v || '').toLowerCase().trim(); if (!t) return null;
  let d, mo, y;
  const num = t.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  if (num) { d = +num[1]; mo = +num[2] - 1; y = num[3] ? (+num[3] < 100 ? 2000 + +num[3] : +num[3]) : null; }
  else { mo = MONTHS.findIndex(m => new RegExp('(^|[^a-z])' + m).test(t)); const dm = t.match(/(\d{1,2})(?!\d)/); if (mo < 0 || !dm) return null; d = +dm[1]; const ym = t.match(/(20\d\d)/); y = ym ? +ym[1] : null; }
  if (!y) y = mo === 11 && weekNo <= 2 ? year - 1 : mo === 0 && weekNo >= 50 ? year + 1 : year;
  const date = new Date(Date.UTC(y, mo, d)); if (isNaN(date) || date.getUTCDate() !== d) return null;
  const wd = DAYS.findIndex(x => new RegExp('(^|[^a-z])' + x).test(t.replace(/\d/g, ' ').replace(MONTHS[mo], ' ')));
  return { iso: date.toISOString().slice(0, 10), weekdayOk: wd < 0 || wd === date.getUTCDay() };
}
// Turns an uploaded file into {sheets: {name: rows[][]}, title}. Word documents: each table becomes a "sheet".
async function readTables(file) {
  const buf = await file.arrayBuffer();
  if (/\.docx$/i.test(file.name)) {
    if (!window.JSZip) throw new Error('Word reader still loading — try again in a moment');
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml'); const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const text = el => [...el.getElementsByTagNameNS(W, 'p')].map(p => [...p.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join('').trim()).filter(Boolean).join(' / ');
    const sheets = {}; [...doc.getElementsByTagNameNS(W, 'tbl')].forEach((tbl, i) => {
      sheets['Table ' + (i + 1)] = [...tbl.getElementsByTagNameNS(W, 'tr')].map(tr => [...tr.getElementsByTagNameNS(W, 'tc')].map(tc => { const v = text(tc); return /^\d+$/.test(v) ? Number(v) : v; })); });
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    const title = [...body.childNodes].filter(n => n.localName === 'p').map(n => [...n.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join('').trim()).filter(Boolean).slice(0, 4).join(' · ');
    if (!Object.keys(sheets).length) throw new Error('No tables found in that Word document');
    return { sheets, title };
  }
  if (!window.XLSX) throw new Error('Spreadsheet reader still loading — try again in a moment');
  const wb = XLSX.read(buf, { cellDates: true }); const sheets = {};
  wb.SheetNames.forEach(n => sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
  return { sheets, title: '' };
}
function importDialog(kind, year, after, existingWeeks = []) {
  const m = openModal(`<h2>Import ${kind === 'budget' ? 'budget' : 'week allocation'} for ${year}</h2>
    <p class="muted small">Upload an Excel (.xlsx), CSV${kind === 'allocation' ? ' or Word (.docx) table' : ''} file. You’ll pick which columns to use and check a preview before anything is saved.
    ${kind === 'allocation' ? 'Works with one row per week (week number, date, family, comment) or one row per family with their week numbers across the row.' : 'Choose the column with item names and the column with amounts. Total rows are skipped automatically.'}</p>
    <input type="file" id="file" accept=".xlsx,.xls,.csv${kind === 'allocation' ? ',.docx' : ''}"><div id="cfg" style="margin-top:16px"></div>`, true);
  $('#file', m).onchange = guard(async e => {
    const book = await readTables(e.target.files[0]); const names = Object.keys(book.sheets);
    const pickSheet = name => {
      const grid = book.sheets[name].map(r => r.map(v => typeof v === 'string' ? v.trim() : v));
      const ncol = Math.max(...grid.map(r => r.length), 0); const cols = [...Array(ncol).keys()];
      const L = i => String.fromCharCode(65 + i);
      const isNum = v => v !== '' && typeof v !== 'object' && !isNaN(Number(v)); const isTxt = v => typeof v === 'string' && v.trim() && isNaN(Number(v));
      const colScore = (c, fn) => grid.filter(r => fn(r[c])).length;
      const header = grid.slice(0, 10).reduce((best, r) => r.filter(isTxt).length > best.filter(isTxt).length ? r : best, []);
      const byHeader = re => cols.find(c => re.test(String(header[c] || '')));
      const sheetSel = names.length > 1 ? `<div class="field"><label>${book.title ? 'Table' : 'Sheet'}</label><select id="sheet">${names.map(n => `<option ${n === name ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>` : '';
      const colOpts = (sel, none) => (none ? `<option value="">${none}</option>` : '') + cols.map(c => `<option value="${c}" ${c === sel ? 'selected' : ''}>Column ${L(c)} — ${esc(String(grid.find(r => r[c] !== '' && r[c] != null)?.[c] ?? '').slice(0, 24))}</option>`).join('');
      let render;
      if (kind === 'budget') {
        const desc = byHeader(/^item|descr/i) ?? [...cols].sort((a, b) => colScore(b, isTxt) - colScore(a, isTxt))[0] ?? 0; const amt = byHeader(/estimate|amount|budget|cost/i) ?? [...cols].sort((a, b) => colScore(b, isNum) - colScore(a, isNum))[0] ?? 1;
        $('#cfg', m).innerHTML = `${sheetSel}<div class="grid-3" style="gap:12px"><div class="field"><label>Item name column</label><select id="cd">${colOpts(desc)}</select></div><div class="field"><label>Amount column</label><select id="ca">${colOpts(amt)}</select></div><div class="field"><label>Type / category column (optional)</label><select id="cc">${colOpts(byHeader(/type|categ/i) ?? -1, 'None — use section headings')}</select></div><div class="field"><label>Commentary column (optional)</label><select id="cn">${colOpts(byHeader(/comment|note/i) ?? -1, 'None')}</select></div></div><div id="bmeta"></div>
          <label class="check" style="margin-bottom:12px"><input type="checkbox" id="repl" checked><span><b>Replace existing ${year} budget lines</b></span></label><div id="prev"></div>
          <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Import</button></div>`;
        render = () => {
          const cd = +$('#cd', m).value, ca = +$('#ca', m).value, cc = $('#cc', m).value, cn = $('#cn', m).value; let section = null; const items = []; let rate = null, running = 0;
          const label = (grid.flat().find(v => typeof v === 'string' && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{2,4}\s*[-–]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(v)) || '');
          for (const r of grid) {
            const d = String(r[cd] ?? '').trim(), a = r[ca];
            if (d && !isNum(a) && r.filter(v => v !== '').length === 1) { section = d; continue; }
            if (!d || !isNum(a) || /^(item|description)$/i.test(d)) continue;
            if (/per week/i.test(d)) { rate = Number(a); continue; }
            const amount = Math.round(Number(a) * 100) / 100;
            const isTotal = /total|subtotal|funding need|sum\b/i.test(d) || (items.length > 1 && Math.abs(amount - running) < 0.01);
            if (isTotal) continue;
            running += amount;
            items.push({ description: d, amount, category: cc !== '' ? String(r[+cc] || '').trim() : section, notes: cn !== '' ? String(r[+cn] || '').trim() : '', on: true });
          }
          $('#bmeta', m).innerHTML = `<div class="grid-2" style="gap:12px"><div class="field"><label>Budget period</label><input id="ilabel" value="${esc(label.replace(/(\d{2})\s*[-–]\s*/, '$1 – '))}" placeholder="optional"></div><div class="field"><label>Service charge per week (from sheet)</label><input id="irate" type="number" value="${rate ?? ''}" placeholder="calculate"></div></div>`;
          $('#prev', m).innerHTML = `<div class="table-wrap" style="max-height:320px;overflow:auto"><table><thead><tr><th></th><th>Category</th><th>Item</th><th class="r">Amount</th></tr></thead><tbody>${items.map((i, k) => `<tr><td><input type="checkbox" data-k="${k}" checked></td><td class="small muted">${esc(i.category || '')}</td><td>${esc(i.description)}${i.notes ? `<div class="tiny muted">${esc(i.notes)}</div>` : ''}</td><td class="r num">${money(i.amount, 2)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td></td><td></td><td>${items.length} lines</td><td class="r num" id="ptot">${money(items.reduce((a, b) => a + b.amount, 0), 2)}</td></tr></tfoot></table></div>`;
          $('#prev', m).querySelectorAll('[data-k]').forEach(c => c.onchange = () => { items[c.dataset.k].on = c.checked; $('#ptot', m).textContent = money(items.filter(i => i.on).reduce((a, b) => a + b.amount, 0), 2); });
          $('#go', m).onclick = guard(async () => { const r = await api('/admin/budget/import', { body: { year, replace: $('#repl', m).checked, items: items.filter(i => i.on), label: $('#ilabel', m).value, rate_per_week: $('#irate', m).value } }); toast(`Imported ${r.imported} budget lines`); closeOverlay(); after(); });
        };
        ['#cd', '#ca', '#cc', '#cn'].forEach(s => $(s, m).onchange = render);
      } else {
        const wk = v => isNum(v) && Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 53;
        const wkCols = cols.filter(c => colScore(c, wk) >= 2);
        const firstWkCol = wkCols.find(c => cols.some(t => t < c && colScore(t, isTxt) >= 2)) ?? wkCols[0] ?? 1;
        const famCol = [...cols].filter(c => c < firstWkCol && colScore(c, isTxt) >= 2).at(-1) ?? 0;
        const hWeek = byHeader(/w(ee)?k/i), hFam = byHeader(/famil|owner|syndicate/i), hDate = byHeader(/date|start|arriv/i), hCmt = byHeader(/comment|note|remark/i);
        const rowWeekLikely = hWeek != null && colScore(hWeek, wk) > 10;
        $('#cfg', m).innerHTML = `${book.title ? `<div class="small muted" style="margin-bottom:10px">Document: <b>${esc(book.title)}</b></div>` : ''}${sheetSel}
          <div class="field"><label>Layout</label><select id="lay"><option value="rowweek" ${rowWeekLikely ? 'selected' : ''}>One row per week: week number, family (and optional date &amp; comment)</option><option value="rowfam" ${rowWeekLikely ? '' : 'selected'}>One row per family, week numbers across the row</option></select></div>
          <div class="grid-2" style="gap:12px" id="lcols"></div><div id="checks"></div>
          <label class="check" style="margin-bottom:12px"><input type="checkbox" id="mk" checked><span><b>Create families that don’t exist yet</b></span></label><div id="prev"></div>
          <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Import</button></div>`;
        const lay = () => { const l = $('#lay', m).value; $('#lcols', m).innerHTML = l === 'rowfam'
          ? `<div class="field"><label>Family name column</label><select id="cf">${colOpts(famCol)}</select></div><div></div><div class="field"><label>Week numbers from column</label><select id="c1">${colOpts(firstWkCol)}</select></div><div class="field"><label>…to column</label><select id="c2">${colOpts(cols.at(-1))}</select></div>`
          : `<div class="field"><label>Week number column</label><select id="cw">${colOpts(hWeek ?? cols.find(c => colScore(c, wk) > 10) ?? 0)}</select></div><div class="field"><label>Family column</label><select id="cf">${colOpts(hFam ?? [...cols].sort((a, b) => colScore(b, isTxt) - colScore(a, isTxt))[0])}</select></div>
             <div class="field"><label>Start date column (optional)</label><select id="cdt">${colOpts(hDate ?? -1, 'None — use the standard calendar')}</select></div><div class="field"><label>Comment column (optional)</label><select id="ccm">${colOpts(hCmt ?? -1, 'None')}</select></div>`;
          $('#lcols', m).querySelectorAll('select').forEach(s => s.onchange = render); render(); };
        render = () => {
          const rows = []; const l = $('#lay', m).value; let dateInfo = null;
          if (l === 'rowfam') { const cf = +$('#cf', m).value, c1 = +$('#c1', m).value, c2 = +$('#c2', m).value;
            for (const r of grid) { const fam = String(r[cf] ?? '').trim(); if (!isTxt(fam) || /total/i.test(fam)) continue; for (let c = c1; c <= c2; c++) if (wk(r[c])) rows.push({ week: Number(r[c]), family: fam }); } }
          else {
            const cw = +$('#cw', m).value, cf = +$('#cf', m).value, cdt = $('#cdt', m).value, ccm = $('#ccm', m).value;
            const known = Object.fromEntries(existingWeeks.map(w => [w.week_no, w.start_date])); let parsed = 0, badDay = 0, differ = [];
            for (const r of grid) if (wk(r[cw])) {
              const row = { week: Number(r[cw]), family: String(r[cf] ?? '').trim() };
              if (ccm !== '') row.comment = String(r[+ccm] ?? '').replace(/\s*\/\s*/g, '; ');
              if (cdt !== '') { const d = parseWeekDate(r[+cdt], row.week, year); if (d) { parsed++; row.start_date = d.iso; if (!d.weekdayOk) badDay++; if (known[row.week] && known[row.week] !== d.iso) differ.push(row.week); } }
              rows.push(row);
            }
            if (cdt !== '') dateInfo = { parsed, badDay, differ, total: rows.length };
          }
          const titleYear = (book.title.match(/\b(20\d\d)\b/) || [])[1];
          const warn = [];
          if (titleYear && +titleYear !== year) warn.push(`The document title mentions <b>${titleYear}</b>, but you’re importing into <b>${year}</b>.`);
          if (dateInfo?.badDay) warn.push(`${dateInfo.badDay} date${dateInfo.badDay > 1 ? 's' : ''} in the file name a weekday that doesn’t match ${year} (e.g. “Fri” on a Saturday). The file is probably for a different year.`);
          const suspicious = warn.length > 0 || (dateInfo && dateInfo.differ.length > dateInfo.total / 4);
          if (dateInfo && dateInfo.differ.length > dateInfo.total / 4) warn.push(`${dateInfo.differ.length} of ${dateInfo.total} start dates differ from the ${year} calendar already on the site.`);
          $('#checks', m).innerHTML = (warn.length ? `<div class="notice warn small" style="margin-bottom:12px">⚠ ${warn.join('<br>')}</div>` : '') +
            (dateInfo ? `<label class="check" style="margin-bottom:12px"><input type="checkbox" id="usedates" ${suspicious ? '' : 'checked'}><span><b>Use the start dates from the file</b>${dateInfo.parsed} of ${dateInfo.total} dates read${dateInfo.differ.length ? `; ${dateInfo.differ.length} differ from the site’s calendar (weeks ${dateInfo.differ.slice(0, 12).join(', ')}${dateInfo.differ.length > 12 ? '…' : ''})` : existingWeeks.length ? '; all match the site’s calendar' : ''}.</span></label>` : '');
          const byFam = {}; rows.forEach(r => (byFam[r.family || 'Syndicate'] ||= []).push(r.week));
          const dup = rows.map(r => r.week).filter((w, i, a) => a.indexOf(w) !== i);
          $('#prev', m).innerHTML = `${dup.length ? `<div class="notice warn small" style="margin-bottom:10px">Weeks listed more than once: ${[...new Set(dup)].join(', ')}. The last one wins.</div>` : ''}
            <div class="table-wrap" style="max-height:300px;overflow:auto"><table><thead><tr><th>Family</th><th class="r">Weeks</th><th>Week numbers</th></tr></thead><tbody>${Object.entries(byFam).sort().map(([f, ws]) => `<tr><td><b>${esc(f)}</b></td><td class="r">${ws.length}</td><td class="small">${ws.sort((a, b) => a - b).join(', ')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nothing found — try other columns</td></tr>'}</tbody>
            <tfoot><tr><td>Total</td><td class="r">${rows.length}</td><td></td></tr></tfoot></table></div>`;
          $('#go', m).onclick = guard(async () => {
            const useDates = $('#usedates', m)?.checked; const send = rows.map(r => useDates ? r : (({ start_date, ...x }) => x)(r));
            if (warn.length && !confirm('The checks above suggest this file may be for a different year. Import anyway?')) return;
            const r = await api('/admin/allocation/import', { body: { year, rows: send, create_families: $('#mk', m).checked } });
            toast(`Updated ${r.updated} weeks${r.unknown.length ? ' · unknown families: ' + r.unknown.join(', ') : ''}`, r.unknown.length > 0); closeOverlay(); after(); });
        };
        $('#lay', m).onchange = lay; lay();
      }
      $('#sheet', m) && ($('#sheet', m).onchange = ev => pickSheet(ev.target.value));
      $('#drawer-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeOverlay);
      if (kind === 'budget') render();
    };
    pickSheet(names[0]);
  });
}

boot();
