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
// the bar at the top of a page: the year picker (and any filters) on the left, the page's actions on the right
const yearPicker = () => `<div class="seg" aria-label="Year">${S.me.years.map(y => `<button data-yr="${y}" class="${y === S.year ? 'on' : ''}">${y}</button>`).join('')}</div>`;
const pageBar = (left, right = '') => `<div class="page-bar"><div class="row">${left}</div>${right ? `<div class="row">${right}</div>` : ''}</div>`;
// picking a year changes it everywhere; leave() can refuse (e.g. unsaved changes)
const bindYears = (root, show, leave) => root.querySelectorAll('[data-yr]').forEach(b => b.onclick = () => { if (leave && !leave()) return; S.year = Number(b.dataset.yr); show(); });
const formData = f => Object.fromEntries([...new FormData(f).entries()]);
// ------------------------------------------------------------ boot / routing
async function boot() {
  const hash = location.hash;
  if (hash.startsWith('#/invite/')) return renderInvite(hash.split('/')[2]);
  try { S.me = await api('/me'); } catch { S.me = null; return publicRoute(); }
  if (hash.startsWith('#/survey')) return renderSurvey();
  if (!S.filterSet) { S.filter = 'all'; S.filterSet = true; }
  // one year for every page: it starts on the working year and follows the year last picked on any page
  if (!S.me.years.includes(S.year)) S.year = S.me.years.includes(S.me.working_year) ? S.me.working_year : S.me.years.at(-1) || S.me.working_year;
  route();
}
window.addEventListener('hashchange', () => { const h = location.hash; if (h.startsWith('#/invite/')) return boot();
  if (h.startsWith('#/survey')) return guard(renderSurvey)(); if (S.me) route(); else publicRoute(); });
async function refreshMe() { S.me = await api('/me'); renderShell(currentTab()); }
function currentTab() { return (location.hash.replace('#/', '').split('/')[0]) || 'home'; }
async function route() {
  closeOverlay(); const tab = currentTab();
  if (tab === 'weeks') { S.filter = isFam() ? 'mine' : S.filter; location.replace('#/calendar'); return; }   // My weeks is retired: its links open the calendar
  if (tab === 'expenditure') { location.replace(isSiteRole() ? '#/admin/service-charge' : '#/service-charge'); return; }   // Expenditure became Service charge (and Upgrades)
  const allowed = new Set(navTabs().map(t => t[0].split('/')[0]));
  if (!allowed.has(tab)) { if (location.hash !== '#/home') location.hash = '#/home'; else renderShell('home'); return; }
  renderShell(tab); const main = $('main');
  const views = { home: viewHome, calendar: viewCalendar, enquiries: viewEnquiries, bookings: viewBookings, account: viewAccount, 'service-charge': viewServiceCharge, upgrades: viewUpgrades, shares: viewShares, manifesto: viewManifesto, questionnaire: viewQuestionnaire, meetings: viewMeetings, maintenance: viewMaintenance, guide: viewGuide, people: viewPeople, admin: viewAdmin };
  try { await (views[tab] || viewHome)(main); } catch (e) { main.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}

// ------------------------------------------------------------ login / invite
function loginLayout(inner) {
  $('#app').innerHTML = `<div class="login"><div class="login-art" id="loginArt"><span class="wordmark">Nab Camas</span>
    <div><h2>A private retreat on Loch Carron</h2><p>The owners’ portal for the households of Nab Camas and their trusted friends.</p></div></div>
    <div class="login-form">${inner}</div></div>`;
  const img = new Image(); img.onload = () => { const a = $('#loginArt'); if (a) a.style.backgroundImage = 'url(/media/hero)'; }; img.src = '/media/hero';
}
// Without a login: the home page is about NAB's future (the questionnaire, then the manifesto); signing in is secondary.
function publicRoute() {
  const h = location.hash;
  if (h.startsWith('#/survey')) return guard(renderSurvey)();
  if (h.startsWith('#/manifesto')) return guard(renderPublicManifesto)();
  if (h.startsWith('#/login')) return renderLogin();
  return guard(renderLanding)();
}
const publicHead = (right = '') => `<header class="survey-head"><a class="wordmark" href="#/">Nab Camas</a><nav class="row" style="gap:8px">${right}</nav></header>`;
async function renderLanding() {
  closeOverlay(); const d = await api('/public'), mf = d.manifesto, sv = d.surveys.find(x => x.slug === 'future') || d.surveys[0], more = d.surveys.filter(x => x !== sv && x.open);
  const href = x => x.slug === 'future' ? '#/survey' : `#/survey/${x.slug}`, answered = x => x.total ? `${x.total} ${x.total === 1 ? 'person has' : 'people have'} answered so far` : '';
  $('#app').innerHTML = `<div class="landing">${publicHead('<a class="btn sm ghost-light" href="#/manifesto">Manifesto</a><button class="btn sm ghost-light" data-owners>Owners’ sign in</button>')}
    <section class="hero" ${d.hero ? 'style="background-image:url(/media/hero)"' : ''}><div class="hero-inner"><span class="eyebrow">${esc(d.place || '')}</span><h1>The future of NAB</h1>
      <p class="lead">${esc(sv.intro)}</p>
      ${sv.open ? `<div class="row" style="gap:10px"><a class="btn primary lg" href="${href(sv)}">Fill in the questionnaire</a><a class="btn lg" href="#/manifesto">Read the Manifesto</a></div>
        <p class="small" style="margin:10px 0 0;opacity:.9">About ten minutes · no login needed${sv.total ? ` · ${answered(sv)}` : ''}</p>` : `<div class="row" style="gap:10px"><a class="btn primary lg" href="#/manifesto">Read the Manifesto</a></div>`}</div></section>
    <main class="landing-main">
      ${sv.open ? `<section class="stack"><span class="eyebrow">Questionnaire 1</span><h2 style="margin:0">${esc(sv.title)}</h2>
        <p class="muted" style="margin:0;max-width:70ch">It starts by asking which generation you are. Each generation then has its own questions about keeping the house in the family, using the weeks, paying for it and improving it. Choose yours:</p>
        <div class="gen-cards">${d.generations.map(g => `<a class="card gen-card" href="${href(sv)}?g=${g.key}" style="--gc:${GEN_COLOR[g.key]}"><span class="eyebrow">${genDot(g.key)}${esc(g.label)}</span><span class="small muted">${esc(g.help)}</span>
          <span class="row between small" style="margin-top:auto"><b>Start →</b><span class="muted">${sv.by[g.key] ? `${sv.by[g.key]} answered` : ''}</span></span></a>`).join('')}</div></section>` : ''}
      ${more.map((x, k) => `<section class="card trading-cta"><span class="eyebrow">Questionnaire ${sv.open ? k + 2 : k + 1}</span><h2 style="margin:4px 0 8px">${esc(x.title)}</h2><p style="margin:0 0 12px;max-width:70ch">${esc(x.intro || '')}</p>
        <div class="row" style="gap:10px;align-items:center"><a class="btn primary" href="${href(x)}">Fill in the trading questionnaire</a><span class="small muted">About ten minutes · no login needed${x.total ? ` · ${answered(x)}` : ''}</span></div></section>`).join('')}
      ${mf ? `<section class="card manifesto-preview"><span class="eyebrow">Manifesto · Nab Camas 2.0</span><h2 style="margin:4px 0 8px">${mdInline(mf.title)}</h2><p style="margin:0 0 10px;max-width:70ch">${mdInline(mf.summary)}</p>
        <p class="small muted" style="margin:0 0 14px">Anyone in the families can comment on any part of it or suggest different wording, with no login: just your name and family.${mf.comments ? ` ${mf.comments} comment${mf.comments === 1 ? '' : 's'} so far.` : ''}</p>
        <a class="btn primary" href="#/manifesto">Read it and comment →</a></section>` : ''}
      <section class="owners" id="owners"><div><h3 style="margin:0 0 4px">Owners’ portal</h3><p class="small muted" style="margin:0">For the families and their trusted friends: the calendar, bookings and accounts, and the questionnaire results.</p></div>
        <form id="lf" class="lf-compact"><input name="email" type="email" autocomplete="username" placeholder="Email" aria-label="Email" required><input name="password" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required><button class="btn">Sign in</button></form></section>
    </main></div>`;
  $('[data-owners]').onclick = () => { $('#owners').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('#lf [name=email]').focus(), 400); };
  $('#lf').onsubmit = guard(async e => { e.preventDefault(); await api('/login', { body: formData(e.target) }); history.replaceState(null, '', '#/home'); boot(); });
}
async function renderPublicManifesto() {
  closeOverlay(); $('#app').innerHTML = `<div class="survey-page">${publicHead('<a class="btn sm ghost-light" href="#/survey">Questionnaire</a><a class="btn sm ghost-light" href="#/">Home</a>')}<main class="survey-main" id="pmm" style="max-width:960px"></main></div>`;
  await viewManifesto($('#pmm'));
}
function renderLogin(msg) {
  loginLayout(`<form id="lf"><span class="eyebrow">Owners’ portal</span><h1>Sign in</h1><p class="muted" style="margin:0 0 24px">Welcome back. Sign in with the email address your invitation was sent to.</p>
    ${msg ? `<div class="notice" style="margin-bottom:16px">${esc(msg)}</div>` : ''}
    <div class="field"><label for="lf-email">Email</label><input id="lf-email" name="email" type="email" autocomplete="username" required autofocus></div>
    <div class="field"><label for="lf-pw">Password</label><input id="lf-pw" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn primary block" style="margin-top:8px">Sign in</button>
    <p class="muted small" style="margin:24px 0 0">New here? Your household’s admin will send you an invitation. Forgotten your password? Ask them to send a new link.</p></form>`);
  $('#lf').onsubmit = guard(async e => { e.preventDefault(); await api('/login', { body: formData(e.target) }); history.replaceState(null, '', '#/home'); boot(); });
  $('#lf').insertAdjacentHTML('afterend', '<p class="small" style="margin-top:24px"><a href="#/">← The future of NAB: the questionnaire and the Manifesto</a></p>');
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
//   trusted friend → Home, Available weeks, My bookings, Maintenance, House guide, My details
//   family member  → Home, Calendar, Enquiries, Bookings, Service charge, Upgrades, Maintenance, House guide, Family & friends
//   family admin   → the same plus Account (and setting plans for the family's weeks from the calendar, managing people)
//   site admin     → a separate login with no family: Home, Calendar, Upgrades, Maintenance, House guide and the admin pages
const ADMIN_PAGES = [['admin/overview', 'Payments'], ['admin/service-charge', 'Service charge'], ['admin/weeks', 'Weeks'], ['admin/lets', 'Lets'], ['admin/families', 'Families'], ['admin/users', 'Users'], ['admin/settings', 'Settings'], ['admin/audit', 'Activity']];
const isSiteRole = () => S.me.user.role === 'site_admin';
// Who is logged in: name, role and household (site admins have no household). Escaped, ready for HTML.
function whoAmI() {
  const u = S.me.user, fam = S.me.family, role = roleName(u.role);
  const house = u.role !== 'site_admin' && fam ? fam.name + ' family' : '';
  const nameIsRole = u.name.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase() === role.toLowerCase();
  return { name: esc(u.name), role: esc(role), house: esc(house), nameIsRole };
}
const NAV_ICON = { home: 'house', calendar: 'calendar-days', weeks: 'calendar-range', enquiries: 'messages-square', bookings: 'bed-double', account: 'wallet', people: 'users', admin: 'settings',
  'admin/overview': 'banknote', 'admin/service-charge': 'receipt', 'service-charge': 'receipt', upgrades: 'lightbulb', shares: 'chart-pie', manifesto: 'scroll-text', questionnaire: 'list-checks', meetings: 'clipboard-list', maintenance: 'wrench', guide: 'book-open', 'admin/weeks': 'calendar-range', 'admin/lets': 'coins', 'admin/families': 'users-round', 'admin/users': 'user-cog', 'admin/settings': 'settings', 'admin/audit': 'history' };
// The menu, in groups: a group's header opens and closes it (remembered on this device); the current page's group is always open.
// Trusted friends have a short menu, so theirs isn't grouped.
function navGroups() {
  const g = (label, items) => ({ label, items: items.filter(Boolean) });
  if (isSiteRole()) return [g(null, [['home', 'Overview']]), g('Weeks', [['calendar', 'Calendar'], ['admin/weeks', 'Weeks'], ['admin/lets', 'Lets']]),
    g('Money', [['admin/overview', 'Payments'], ['admin/service-charge', 'Service charge'], ['shares', 'Shares']]),
    g('The house', [['upgrades', 'Upgrades'], ['maintenance', 'Maintenance'], ['guide', 'House guide']]),
    g('Have your say', [['meetings', 'Meetings'], ['questionnaire', 'Questionnaire'], ['manifesto', 'Manifesto']]),
    g('Admin', [['admin/families', 'Families'], ['admin/users', 'Users'], ['admin/settings', 'Settings'], ['admin/audit', 'Activity']])];
  if (S.me.user.role === 'friend') return [g(null, [['home', 'Overview'], ['calendar', 'Available weeks'], ['bookings', 'My bookings'], ['maintenance', 'Maintenance'], ['guide', 'House guide'], ['people', 'My details']])];
  return [g(null, [['home', 'Overview']]), g('Weeks', [['calendar', 'Calendar'], ['enquiries', 'Enquiries', S.me.enquiryCount], ['bookings', 'Bookings']]),
    g('Money', [isFamAdmin() && ['account', 'Account'], ['service-charge', 'Service charge'], ['shares', 'Shares']]),
    g('The house', [['upgrades', 'Upgrades'], ['maintenance', 'Maintenance'], ['guide', 'House guide']]),
    g('Have your say', [['meetings', 'Meetings'], ['questionnaire', 'Questionnaire'], ['manifesto', 'Manifesto']]),
    g(null, [['people', 'Family & friends'], isSite() && ['admin', 'Site admin']])];
}
const navTabs = () => navGroups().flatMap(x => x.items);
const navOpen = { get() { try { return JSON.parse(localStorage.getItem('nab_nav') || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem('nab_nav', JSON.stringify(v)); } catch { /* not remembered */ } } };
function navHtml(tab) {
  const link = ([k, l, n]) => { const on = navOn(k, tab); return `<a href="#/${k}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(NAV_ICON[k] || 'chevron-right')}<span>${l}</span>${n ? `<span class="count">${n}</span>` : ''}</a>`; };
  const saved = navOpen.get();
  return navGroups().map(gr => { if (!gr.label) return gr.items.map(link).join('');
    const here = gr.items.some(([k]) => navOn(k, tab)), open = here || (saved ? saved.includes(gr.label) : false), n = gr.items.reduce((t, i) => t + (i[2] || 0), 0);
    return `<div class="nav-group${open ? ' open' : ''}${here ? ' here' : ''}" data-group="${esc(gr.label)}"><button type="button" class="nav-head" aria-expanded="${open}"><span>${esc(gr.label)}</span>${n ? `<span class="count">${n}</span>` : ''}${icon('chevron-down')}</button>
      <div class="nav-items">${gr.items.map(link).join('')}</div></div>`; }).join('');
}
function renderShell(tab) {
  const u = S.me.user, site = esc(S.me.settings.site_name);
  if (!$('.shell')) $('#app').innerHTML = '<div class="shell"><aside class="sidebar" aria-label="Main menu"></aside><div class="menu-scrim"></div><header class="mobilebar"></header><main id="main"></main></div>';
  const initials = esc((u.name.match(/\b[A-Za-z]/g) || ['?']).join('').slice(0, 2).toUpperCase());
  const unread = S.me.unread ? `<span class="count">${S.me.unread}</span>` : '';
  $('.sidebar').innerHTML = `<a class="wordmark" href="#/home">${site}</a><span class="place">${esc(S.me.settings.place_line || '')}</span>
    <div class="whoami" role="status" aria-label="Logged in as ${esc(u.name)}"><span class="whoami-label">Logged in as</span>
      <div class="whoami-row"><span class="avatar">${initials}</span><span class="who"><b>${esc(u.name)}</b></span></div></div>
    ${viewAsPicker(u)}
    <nav class="side-nav">${navHtml(tab)}</nav>
    <div class="side-foot">
      <div class="side-actions"><button class="side-btn" data-notes>${icon('bell')}Notices${unread}</button><button class="side-btn" data-logout>${icon('log-out')}Sign out</button></div></div>`;
  $('.mobilebar').innerHTML = `<div class="mb-row"><button class="iconbtn" data-menu aria-label="Open menu">${icon('menu')}</button><a class="wordmark" href="#/home">${site}</a><button class="iconbtn" data-notes aria-label="Notifications">${icon('bell')}${unread}</button></div>
    <div class="mb-who">Logged in as <b>${esc(u.name)}</b></div>`;
  viewAsBar();
  document.querySelectorAll('[data-notes]').forEach(b => b.onclick = guard(showNotifications));
  $('[data-logout]').onclick = guard(async () => { await api('/logout', { body: {} }); S.me = null; document.body.classList.remove('menu-open'); $('#app').innerHTML = ''; location.hash = '#/'; publicRoute(); });
  $('[data-menu]').onclick = () => document.body.classList.toggle('menu-open');
  $('.menu-scrim').onclick = () => document.body.classList.remove('menu-open');
  $('.sidebar').querySelectorAll('a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('menu-open')));
  $('.sidebar').querySelectorAll('.nav-head').forEach(b => b.onclick = () => { const gr = b.parentElement; if (gr.classList.contains('here')) return;
    const open = gr.classList.toggle('open'); b.setAttribute('aria-expanded', open);
    const l = gr.dataset.group, saved = (navOpen.get() || []).filter(x => x !== l); navOpen.set(open ? [...saved, l] : saved); });
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
// Site admin: cancel a booking (awaiting payment or paid). b = {id, status, method, amount, reference, guest, label, seller, buyer}
function cancelBookingModal(b, done) {
  const paid = b.status === 'confirmed';
  const what = b.gift ? [`${esc(b.seller)} gave this week to <b>${esc(b.buyer)}</b> free, so no money moves.`, `The week goes back to ${esc(b.seller)} as Undecided.`] : paid
    ? [`The let income <b>${esc(b.seller)}</b> was credited for it (${money(b.amount, 2)} less the letting cost) comes back off their account.`,
       b.method === 'account' ? `The ${money(b.amount, 2)} goes back on <b>${esc(b.buyer || 'the buyer')}</b>’s account.` : `The guest paid by bank transfer: refund them from the syndicate account yourself (the portal doesn’t move money).`]
    : ['No payment has been confirmed, so no money moves.'];
  if (!b.gift) what.push(`The week goes back on offer as released by ${esc(b.seller)}. Open it on the calendar if it should be Undecided or Using it instead.`);
  const m = openModal(`<h2>${b.gift ? `Cancel ${esc(b.buyer)}’s free week?` : `Cancel booking ${esc(b.reference || '')}?`}</h2>
    <p style="margin-top:0">${esc(b.label)} · ${esc(b.gift ? b.buyer : b.guest || '')} · <span class="badge ${b.gift ? 'green' : paid ? 'blue' : 'amber'}">${b.gift ? 'Given free' : paid ? 'Paid' : 'Awaiting payment'}</span></p>
    <ul class="small" style="padding-left:18px;margin:0 0 14px">${what.map(t => `<li style="margin-bottom:4px">${t}</li>`).join('')}</ul>
    <form id="cbf"><div class="field"><label>Message to ${b.gift ? 'both families' : 'the guest and household'} (optional)</label><textarea name="reason" rows="2" maxlength="500" placeholder="e.g. The house is closed for repairs that week"></textarea></div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Keep booking</button><button class="btn danger">${b.gift ? 'Cancel it' : 'Cancel booking'}</button></div></form>`);
  $('#cbf', m).onsubmit = guard(async e => { e.preventDefault();
    await api(`/bookings/${b.id}/cancel`, { body: formData($('#cbf', m)) }); closeOverlay(); toast(b.gift ? 'Cancelled. Both families have been told' : 'Booking cancelled. The guest and household have been told'); done && done(); });
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
const STAY_TAG = { 'Booked': 'booked', 'Your stay': 'booked', 'Reserved': 'pending', 'Released': 'available', 'Available': 'available', 'Using it': 'yours', 'In residence': 'booked' };
// this week's family: Check in, or Not in residence (either can be changed during the week)
const checkInButtons = x => !x || !x.can_check_in ? '' : `<div class="row" style="gap:8px;margin-top:12px">
    ${x.residence === 'in' ? `<span class="tag booked">${icon('check')}Checked in</span>` : `<button class="btn sm green" data-residence="in" data-wk="${x.week_id}">${icon('log-in')}Check in</button>`}
    ${x.residence === 'away' ? '<span class="tag">Not in residence</span>' : `<button class="btn sm" data-residence="away" data-wk="${x.week_id}">Not in residence</button>`}</div>
    ${x.residence === 'in' && x.released ? '<div class="tiny muted" style="margin-top:6px">The week is still released for booking. Take it off release on the calendar if you’re staying.</div>' : ''}`;
function bindCheckIn(root, reload) {
  root.querySelectorAll('[data-residence]').forEach(b => b.onclick = guard(async () => { const st = b.dataset.residence;
    await api(`/weeks/${b.dataset.wk}/residence`, { body: { state: st } }); toast(st === 'in' ? 'Checked in. Enjoy your stay' : 'Noted: not in residence this week'); reload(); }));
}
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
      <div class="res-foot"><span class="tag ${x.mine && !x.residence ? 'yours' : STAY_TAG[x.status] || ''}">${esc(x.status)}</span>${contactButtons(x.contact)}</div>${checkInButtons(x)}` : `<div class="when">${none}</div>`}</div>`;
  const arriving = (r.next || []).find(Boolean);
  return `<section class="residence">${show('In residence this week', r.now, 'No week is set up for today.')}${show('Arriving next', arriving, 'No arrivals set up yet.')}
    ${nextStay !== undefined ? `<div class="card"><span class="eyebrow">Your next stay</span>${nextStay ? `<div class="who">${esc(nextStay.title)}</div><div class="when">${esc(nextStay.detail || '')}</div>` : '<div class="when">Nothing booked yet. Browse the calendar to plan a stay.</div>'}</div>` : ''}</section>`;
}
async function viewHome(main) {
  const h = await api('/home'), u = S.me.user, friend = u.role === 'friend', hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  if (h.admin_home) return adminHome(main, h, greet);
  const weekRow = (x, right) => `<button class="list-row" data-open-week="${x.week_id}" data-year="${x.year}"><span class="grow" style="min-width:0"><b>${esc(x.title)}</b><div class="tiny muted">${esc(x.detail || '')}</div></span>${right || ''}</button>`;
  const links = friend ? [['#/calendar', 'Browse available weeks'], ['#/bookings', 'My bookings'], ['#/guide', 'House guide'], ['#/maintenance', 'Report a maintenance issue'], ['#/people', 'Update my details']]
    : [['#/calendar', 'Browse the calendar'], ['#/weeks', isFamAdmin() ? 'Set your household’s weeks' : 'Your household’s weeks'], ['#/enquiries', 'Enquiries'], ['#/upgrades', 'Suggest an upgrade'], ['#/maintenance', 'Report a maintenance issue'], ['#/guide', 'House guide'], ['#/people', isFamAdmin() ? 'Add family or friends' : 'Add a trusted friend'], ...(isFamAdmin() ? [['#/account', 'Household account']] : [])];
  const f = h.family, c = f && f.lets;
  const going = h.upcoming.find(x => ['using', 'booked', 'reserved'].includes(x.plan)) || null;
  const upTag = x => x.plan === 'using' || x.plan === 'booked' ? '<span class="tag booked">Going</span>' : x.plan === 'reserved' ? '<span class="tag pending">Awaiting payment</span>' : x.plan === 'let' ? '<span class="tag booked">Let</span>' : x.plan === 'released' ? '<span class="tag available">Released</span>' : x.plan === 'swap' ? '<span class="tag outline">Will swap</span>' : '<span class="tag">Undecided</span>';
  const future = friend ? '' : `<section class="card future"><div><span class="eyebrow">The future of NAB</span><h2 style="margin:2px 0 4px">Have your say</h2><p class="small muted" style="margin:0;max-width:65ch">The questionnaire asks each generation about keeping the house, the weeks, the costs and improvements; the trading questionnaire asks how your family would like weeks to change hands. The Manifesto sets out the proposal: comment on any part of it. Ask a question for the next meeting and it goes on the agenda.</p>
      ${h.next_meeting ? `<p class="small" style="margin:8px 0 0">${icon('clipboard-list')} Next meeting: <b>${esc(h.next_meeting.title)}</b>, ${longDate(h.next_meeting.date)} · <a href="#/meetings">the agenda${h.next_meeting.items ? ` (${h.next_meeting.items} item${h.next_meeting.items === 1 ? '' : 's'})` : ''}</a></p>` : ''}</div>
    <div class="row" style="gap:8px"><a class="btn primary" href="#/survey">Fill in the questionnaire</a><a class="btn" href="#/survey/trading">Trading weeks questionnaire</a><a class="btn" href="#/manifesto">Manifesto</a><a class="btn" href="#/meetings">Meetings</a><a class="btn" href="#/questionnaire">Results</a></div></section>`;
  main.innerHTML = `${welcomeHeader(greet)}${future}${residenceStrip(h, going)}
    <section class="stack" style="margin-bottom:var(--sp-6)"><div class="section-title"><h2>Outstanding actions</h2>${h.attention.length ? `<span class="muted small">${h.attention.length} to look at</span>` : ''}</div>
      ${h.attention.length ? h.attention.map(todoItem).join('') : todoItem({ tone: 'info', title: 'All clear', detail: 'Nothing needs your attention right now.' })}</section>
    <div class="home-grid">
      ${panelCard('calendar-clock', 'Upcoming stays', h.upcoming.length ? h.upcoming.map(x => weekRow(x, upTag(x))).join('') : quiet(friend ? 'You have no upcoming stays yet.' : 'Nothing coming up.'), friend ? '' : '<a href="#/weeks">All your household’s weeks →</a>')}
      ${panelCard('key-round', friend ? 'Weeks you can book' : 'Weeks available to book', h.available.length ? h.available.map(x => weekRow({ ...x, detail: x.family ? `From ${x.family}` : '' }, `<span class="tag available">${money(x.price)}</span>`)).join('')
        : quiet('Nothing is available right now. You’ll get a notice when a week is released.'), `<a href="#/calendar">${friend ? 'All available weeks' : 'Open the calendar'} →</a>`)}
      ${friend ? '' : panelCard('messages-square', 'Your enquiries', h.enquiries.length ? h.enquiries.map(x => weekRow({ ...x, detail: `${x.holder} · ${PLAN[x.plan] ? PLAN[x.plan].label : ''}` }, `<span class="tag pending">${ordinal(x.position)} of ${x.queue}</span>`)).join('')
        : quiet('Open any other household’s week on the calendar to enquire about it or ask a question.'), '<a href="#/enquiries">All enquiries →</a>')}
      ${f ? panelCard('coins', `${esc(f.name)} at a glance · ${f.year}`, `<dl class="kv" style="grid-template-columns:1fr auto">
          ${c ? `<dt>Weeks released</dt><dd class="num">${c.released}</dd>
          <dt>Let income credited</dt><dd class="num">${money(c.let_income, 2)} <span class="muted small">(${c.lets} let${c.lets === 1 ? '' : 's'})</span></dd>` : ''}
          ${f.balance != null ? `<dt>Account balance</dt><dd class="num">${f.balance > 0.005 ? money(f.balance, 2) + ' to pay' : f.balance < -0.005 ? money(-f.balance, 2) + ' in credit' : 'Settled'}</dd>` : ''}</dl>`, '<a href="#/weeks">Your household’s weeks →</a>') : ''}
      ${panelCard('bell', 'Recent notices', h.notifications.length ? h.notifications.map(n => `<a class="list-row ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/home')}"><span class="grow small">${esc(n.text)}<div class="tiny muted">${stamp(n.created_at)}</div></span></a>`).join('') : quiet('No notices yet.'))}
      ${panelCard('arrow-right', 'Quick links', `<div class="quick">${links.map(([href, l]) => `<a class="btn sm" href="${href}">${l}</a>`).join('')}</div>`)}
    </div>`;
  main.querySelectorAll('[data-open-week]').forEach(b => b.onclick = () => { S.year = Number(b.dataset.year); S.openWeek = Number(b.dataset.openWeek); location.hash = '#/calendar'; });
  bindCheckIn(main, () => viewHome(main));
}

function adminHome(main, h, greet) {
  const owing = h.balances.filter(b => Math.abs(b.balance) > 0.005);
  main.innerHTML = `${welcomeHeader(greet)}${residenceStrip(h)}
    <div class="grid-3" style="margin-bottom:var(--sp-6)">
      <div class="card"><span class="eyebrow">Households · logins</span><div class="stat num">${h.counts.families} <span class="small muted">· ${h.counts.logins}</span></div></div>
      <div class="card"><span class="eyebrow">Weeks released in ${h.lets.year}</span><div class="stat num">${h.counts.released}</div><div class="small muted">${h.counts.enquiries} open enquir${h.counts.enquiries === 1 ? 'y' : 'ies'}</div></div>
      <div class="card"><span class="eyebrow">${h.lets.year} lets</span><div class="stat num credit">${money(h.lets.income.credited, 2)}</div><div class="small muted">credited to households from ${h.lets.income.lets} let${h.lets.income.lets === 1 ? '' : 's'} · ${money(h.lets.income.fund, 2)} to the maintenance fund</div></div></div>
    <section class="stack" style="margin-bottom:var(--sp-6)"><div class="section-title"><h2>Outstanding actions</h2>${h.attention.length ? `<span class="muted small">${h.attention.length} to look at</span>` : ''}</div>
      ${h.attention.length ? h.attention.map(todoItem).join('') : todoItem({ tone: 'info', title: 'All clear', detail: 'No syndicate jobs waiting.' })}</section>
    <div class="home-grid">
      ${panelCard('wallet', 'Household balances', owing.length ? `<table><tbody>${owing.map(b => `<tr><td><a href="#/admin/account-${b.id}">${esc(b.name)}</a></td><td class="r num">${b.balance > 0 ? money(b.balance, 2) + ' owed' : money(-b.balance, 2) + ' credit'}</td></tr>`).join('')}</tbody></table>` : quiet('Every household is settled.'), '<a href="#/admin/overview">Payments and balances →</a>')}
      ${panelCard('coins', `Lets ${h.lets.year}`, h.lets.rows.some(r => r.lets) ? `<table><tbody>${h.lets.rows.filter(r => r.lets).map(r => `<tr><td>${esc(r.name)}</td><td class="r num">${r.lets} let${r.lets === 1 ? '' : 's'}</td><td class="r num">${money(r.let_income, 2)}</td></tr>`).join('')}</tbody></table>` : quiet('No weeks let yet this year.'), '<a href="#/admin/lets">Lets →</a>')}
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
  released: { label: 'Released', hint: 'You won’t use it. Choose below who can book it, and when. If it lets, the payment is credited to your household’s account, less the letting cost for the maintenance fund.' },
};
const BAND = { school: 'School holidays', summer: 'Summer', shoulder: 'Shoulder', winter: 'Winter' };
// who can book a released week; the family chooses when it releases
const SALE_TO = () => ({ all: 'Members and trusted friends, straight away', members_first: `Members first for ${S.me.settings.members_first_days || 7} days, then trusted friends`,
  own: 'Members and our own trusted friends', members: 'Other syndicate members only' });
// What a week means to the person looking: one of five muted states, always with a text label.
function weekState(w) {
  const friend = S.me.user.role === 'friend', fam = esc(w.family_name);
  if (w.booking?.gift) return w.is_mine ? { k: 'booked', who: 'Your week', label: `Given to ${esc(w.booking.given_to)}` }
    : w.booking.ours ? { k: 'yours', who: 'Your week', label: `Given by ${fam}` } : { k: 'other', who: esc(w.booking.given_to), label: `Given by ${fam}` };
  if (w.booking?.mine) return w.booking.status === 'confirmed' ? { k: 'booked', who: 'Your booking', label: 'Booked' } : { k: 'pending', who: 'Your booking', label: 'Awaiting payment' };
  if (friend) { const kind = w.school_holiday ? 'School holidays' : BAND[w.season];
    return w.can_book ? { k: 'available', who: kind, label: `Book now · ${money(w.price)}`, cta: 'book' }
      : w.my_friend_enquiry ? { k: 'pending', who: kind, label: 'Enquired' }
      : w.can_friend_enquire ? { k: 'other', who: kind, label: 'Enquire', cta: 'enquire' } : { k: 'other', who: kind, label: 'Unavailable', off: true }; }
  if (w.status === 'syndicate') return { k: 'other', who: 'Syndicate', label: 'Syndicate week' };
  if (w.status === 'booked') return { k: 'booked', who: w.is_mine ? 'Your week' : fam, label: w.is_mine ? 'Let to guests' : 'Booked' };
  if (w.status === 'pending') return { k: 'pending', who: w.is_mine ? 'Your week' : fam, label: 'Reserved' };
  if (w.my_enquiry) return { k: 'pending', who: fam, label: w.first_refusal_until ? 'First refusal' : `Enquired · ${ordinal(w.my_enquiry.position)}` };
  if (w.is_mine) return { k: 'yours', who: 'Your week', label: { using: 'Yours · using', released: 'Yours · released' }[w.plan] || 'Yours · undecided' };
  if (w.can_book) return { k: 'available', who: fam, label: `Available · ${money(w.price)}` };
  if (w.plan === 'released' || w.first_refusal_until) return { k: 'available', who: fam, label: 'Released' };
  if (w.plan === 'using') return { k: 'other', who: fam, label: 'In use' };
  return { k: 'other', who: fam, label: 'Enquire' };   // undecided: the holder may let it go, so ask them
}
function filterMatch(w) {
  switch (S.filter) {
    case 'book': return w.can_book;
    case 'mine': return w.is_mine || w.booking?.mine || w.booking?.ours;
    // released weeks to buy, and other families' weeks they haven't decided about yet
    case 'open': return !w.is_mine && !!w.family_id && w.start_date >= todayStr() && !['pending', 'booked'].includes(w.status) && (w.plan === 'released' || w.plan === 'undecided');
    default: return true;
  }
}
async function viewCalendar(main) {
  const years = S.me.years;
  if (!years.length) { main.innerHTML = '<div class="card empty">No weeks have been set up yet. The site admin can create a year under Site admin → Weeks.</div>'; return; }
  S.weeks = await api('/weeks?year=' + S.year);
  const role = S.me.user.role;
  const filters = isFam() ? [['all', 'All weeks'], ['mine', 'Our weeks'], ['open', 'Available for enquiry']]
    : role === 'friend' ? [] : [['all', 'All weeks'], ['book', 'Released']].filter(Boolean);
  if (!filters.filter(Boolean).some(([k]) => k === S.filter)) S.filter = 'all';
  const intro = isSiteRole() ? 'Every household’s weeks. Open a week to see it, or to change its settings on the household’s behalf.' : role === 'friend' ? 'Weeks marked <b>Book now</b> can be booked straight away. Weeks marked <b>Enquire</b> haven’t been decided yet: ask, and the household will let you know.'
    : 'Open any other household’s week to enquire about it, ask a question, or book it if it’s been released. '+ 'Open one of your own weeks to set your plans for it.';
  const byMonth = {};
  for (const w of S.weeks) (byMonth[w.start_date.slice(0, 7)] ||= []).push(w);
  const visible = S.weeks.filter(filterMatch).length;
  const band = w => w.school_holiday ? 'School holidays' : { summer: 'Summer', shoulder: 'Shoulder', winter: 'Winter' }[w.season];
  main.innerHTML = `
    <div class="page-head"><h1>${role === 'friend' ? 'Available weeks' : 'Calendar'} ${S.year}</h1><p>${intro}${isFam() && S.weeks.length && S.weeks[0].year_open ? ` The ${S.year} allocation is still a draft until the site admin signs it off; ask the site admin about any changes.` : ''}</p></div>
    ${pageBar(yearPicker() + (filters.length ? `<div class="seg" aria-label="Show">${filters.map(([k, l]) => `<button data-filter="${k}" class="${S.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''),
      filters.length ? `<span class="muted small">${visible} week${visible === 1 ? '' : 's'}</span>` : '')}
    <div class="months">${Object.entries(byMonth).map(([m, ws]) => `<section class="month"><h3>${dfmt(m + '-01', { month: 'long' })}<span class="tiny muted">${m.slice(0, 4) != S.year ? m.slice(0, 4) : ''}</span></h3>
      ${ws.map(w => { const x = weekState(w); return `<button class="week st-${x.k} ${filterMatch(w) ? '' : 'dim'} ${w.start_date < todayStr() ? 'past' : ''}" data-week="${w.id}" aria-label="Week ${w.week_no}, ${range(w)}: ${x.who}, ${x.label}">
        <span class="no">Week<b>${w.week_no}</b></span>
        <span style="min-width:0"><div class="who">${x.who}</div><div class="when">${range(w)}${role === 'friend' ? '' : ` · ${band(w)}`}${w.enquiries && !w.my_enquiry ? ` · ${w.enquiries} enquir${w.enquiries > 1 ? 'ies' : 'y'}` : ''}</div>${w.comment ? `<div class="cmt">${esc(w.comment)}</div>` : ''}</span>
        ${x.cta ? `<span class="btn sm ${x.cta === 'book' ? 'green' : ''} cal-cta">${x.label}</span>` : `<span class="tag ${x.off ? 'off' : x.k}">${x.label}</span>`}</button>`; }).join('')}</section>`).join('')}</div>`;
  bindYears(main, () => viewCalendar(main));
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
      : `<dt>Price</dt><dd><b>${money(w.price)}</b>${w.price_override != null ? ' <span class="muted small">(set by family)</span>' : ''}
        <div class="tiny muted">${w.sale_to === 'members' ? 'Members only' : (w.friends_from > todayStr() ? `Members only until ${dfmt(w.friends_from)}, then ` : 'Open to ') + (w.sale_to === 'own' ? `${esc(w.family_name)}’s trusted friends` : 'trusted friends')}</div></dd>`) : ''}
    ${w.note && role !== 'friend' ? `<dt>Note</dt><dd>${esc(w.note)}</dd>` : ''}
    ${w.booking?.gift ? `<dt>Given to</dt><dd>${esc(w.booking.given_to)} · <span class="badge green">Free</span><div class="tiny muted">${esc(w.family_name)} let them use it free of charge${w.booking.reference ? ` · ref ${esc(w.booking.reference)}` : ''}</div>${isSiteRole() ? `<button class="btn sm danger" data-admin-cancel style="margin-top:8px">${icon('x')}Cancel</button>` : ''}</dd>`
    : w.booking?.guest ? `<dt>Booking</dt><dd>${esc(w.booking.guest)} · <span class="badge ${w.booking.status === 'confirmed' ? 'blue' : 'amber'}">${w.booking.status === 'confirmed' ? 'Paid' : 'Awaiting payment'}</span><div class="tiny muted">Ref ${esc(w.booking.reference)}${w.booking.amount != null ? ` · ${money(w.booking.amount, 2)} by ${w.booking.method === 'account' ? `${esc(w.booking.buyer || '')} account` : 'bank transfer'}` : ''}</div>${isSiteRole() ? `<button class="btn sm danger" data-admin-cancel style="margin-top:8px">${icon('x')}Cancel booking</button>` : ''}</dd>` : ''}</dl>`;
  const past = w.start_date < todayStr();
  if (w.status === 'syndicate') html += '<div class="section notice">This week is held by the syndicate (e.g. maintenance or the extra 53rd week) and isn’t allocated to a family.</div>';

  html += relNote;
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
      ${isFam() ? `<p class="muted small" style="margin-top:0">${esc(w.family_name)} have released this week. What you pay is credited to their household’s account, less the letting cost.</p>` : ''}
      <div class="grid-2" style="gap:12px"><div class="field"><label>Lead guest name</label><input name="guest_name" value="${esc(S.me.user.name)}" required></div>
      <div class="field"><label>Number in party</label><input name="party_size" type="number" min="1" max="20" value="2"></div></div>
      ${allowAcct ? `<div class="field"><label>How will you pay?</label>
        <label class="check"><input type="radio" name="method" value="bank" checked><span><b>Bank transfer</b>Pay the syndicate account within ${s.hold_days} days.</span></label>
        <label class="check" style="margin-top:8px"><input type="radio" name="method" value="account" ${(S.me.family.credit_available || 0) + 0.005 < w.price ? 'disabled' : ''}><span><b>Pay from ${esc(S.me.family.name)}’s credit (${money(S.me.family.credit_available || 0, 2)} available)</b>${(S.me.family.credit_available || 0) + 0.005 < w.price ? 'Not enough credit for this week. You can top up from the <a href="#/account">Account</a> page.' : 'Taken from your household’s credit and confirmed straight away.'}</span></label></div>` : `<input type="hidden" name="method" value="bank">
        <p class="small muted">After you book, you’ll get the syndicate’s bank details and a payment reference. The week is held for you for <b>${s.hold_days} days</b> while the transfer arrives.</p>`}
      <div class="field"><label>Anything the family should know? (optional)</label><textarea name="notes" rows="2"></textarea></div>
      <button class="btn green">Reserve week</button></form>`;
  }

  if (isFam() && !w.is_mine && w.family_id) {
    const enq = !past;
    if (enq) html += await enquirySection(w, s);
    html += questionsBlock(w, !!w.can_ask && !(enq && w.can_enquire));
  }
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
      if (d.plan === 'using' && (w.enquiries || w.friend_enquiries) && !confirm('Marking this week “Using it” closes the enquiries waiting for it. Continue?')) return;
      if (d.plan === 'released' && w.plan !== 'released' && w.enquiries && !confirm(`Release week ${w.week_no}? The ${w.enquiries} famil${w.enquiries > 1 ? 'ies' : 'y'} who enquired get first refusal for ${s.enquiry_hours || 48} hours, in queue order.`)) return;
      await api('/weeks/' + w.id, { method: 'PUT', body: d }); toast('Week updated'); closeOverlay(); viewCalendar($('main')); refreshMe(); });
  }
  const bf = $('#bookForm', body);
  if (bf) bf.onsubmit = guard(async e => { e.preventDefault(); const b = await api(`/weeks/${w.id}/book`, { body: formData(bf) });
    if (b.status === 'confirmed') { toast('Booked and charged to your family account'); closeOverlay(); }
    else openModal(`<h2>Week reserved</h2><p>Please pay within <b>${s.hold_days} days</b> to secure the week. You’ll be notified when the payment is confirmed.</p>${payBox(b.reference, b.amount)}<div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`);
    viewCalendar($('main')); await refreshMe(); });
  const ac = $('[data-admin-cancel]', body);
  if (ac) ac.onclick = () => cancelBookingModal({ ...w.booking, label: `Week ${w.week_no} · ${dfmt(w.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}`, seller: w.booking.seller || w.family_name, buyer: w.booking.given_to || w.booking.buyer },
    () => { viewCalendar($('main')); refreshMe(); });
  const ff = $('#feForm', body);
  if (ff) ff.onsubmit = guard(async e => { e.preventDefault(); await api('/friend-enquiries', { body: { ...formData(ff), week_id: w.id } }); toast('Enquiry sent. The household will let you know'); closeOverlay(); viewCalendar($('main')); });
  const fw = $('[data-fe-withdraw]', body);
  if (fw) fw.onclick = guard(async () => { if (!confirm('Withdraw your enquiry about this week?')) return; await api(`/friend-enquiries/${fw.dataset.feWithdraw}/withdraw`, { body: {} }); toast('Enquiry withdrawn'); closeOverlay(); viewCalendar($('main')); });
  const ef = $('#enqForm', body);
  if (ef) {
    ef.querySelectorAll('[name=kind]').forEach(r => r.onchange = () => { const qn = ef.kind.value === 'question'; ef.message.required = qn; $('.enq-opt', ef).style.display = qn ? 'none' : '';
      ef.message.placeholder = qn ? 'e.g. What time are you leaving on Saturday? Could we arrive a day early?' : 'e.g. We’d love this week if your plans change.'; $('button.primary', ef).textContent = qn ? 'Send question' : 'Enquire'; });
    ef.onsubmit = guard(async e => { e.preventDefault(); const d = formData(ef);
      if (d.kind === 'question') { await api('/questions', { body: { week_id: w.id, message: d.message } }); toast(`Question sent to ${w.family_name}`); closeOverlay(); viewCalendar($('main')); return; }
      const r = await api('/enquiries', { body: { message: d.message, week_id: w.id } }); toast(`Enquiry sent. You’re ${ordinal(r.position)} in the queue`); closeOverlay(); viewCalendar($('main')); });
  }
  const af = $('#askForm', body);
  if (af) af.onsubmit = guard(async e => { e.preventDefault(); await api('/questions', { body: { week_id: w.id, message: af.message.value } }); toast(`Question sent to ${w.family_name}`); closeOverlay(); viewCalendar($('main')); });
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
      <div class="field" style="margin:0"><label>Price</label><input name="price_override" type="number" min="0" step="1" placeholder="${money(s['rate_' + band])} default" value="${w.price_override ?? ''}"></div>
      <div class="field" style="margin:0"><label>Who can book</label><select name="sale_to">${Object.entries(SALE_TO()).map(([k, l]) => `<option value="${k}" ${w.sale_to === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div></div>`;
}
function bindPlanFields(root) {
  const sel = $('[name=plan]', root);
  const sync = () => { $('.sale-opts', root).style.display = sel.value === 'released' ? '' : 'none'; const h = $('.plan-hint', root); if (h) h.textContent = PLAN[sel.value].hint; };
  sel.addEventListener('change', sync); sync();
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
const weekTitle = w => `<b>Week ${w.week_no}</b> ${w.year} <span class="muted">· ${range(w)}</span> <i class="season ${w.school_holiday ? 'school' : w.season}"></i>`;
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const whenTime = t => new Date(t.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const asked = t => dfmt(t.slice(0, 10));
const CLOSED = { using: 'Closed: they’re using it', taken: 'Closed: taken by someone else', given: 'Closed: given to another family', swapped: 'Closed: swapped', passed: 'You passed', no_reply: 'Closed: no answer in time' };
function enquiryStatus(e) {
  if (e.status === 'won') return `<span class="badge green">${e.given ? (e.mine ? 'Given to your family free' : 'Given free') : e.mine ? 'Your family got it' : 'Got it'}</span>`;
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
// questions about another family's week (what time are you leaving? could we arrive a day early?): any week, Using it
// included. Not a request for the week, so no queue. withForm: show the form to ask (otherwise just past questions).
function questionsBlock(w, withForm) {
  const list = (w.my_questions || []).map(x => `<div class="offer"><div class="small"><b>${esc(x.by)}</b> <span class="muted">asked ${asked(x.created_at)}</span></div><div class="small" style="margin-top:4px">“${esc(x.message)}”</div>
    ${x.reply ? `<div class="small" style="margin-top:6px"><b>${esc(w.family_name)}</b>${x.replied_by ? ` <span class="muted">(${esc(x.replied_by)})</span>` : ''}: ${esc(x.reply)}</div>` : '<div class="tiny muted" style="margin-top:4px">Waiting for a reply</div>'}</div>`).join('');
  if (!withForm) return list ? `<div class="section"><h3>Your questions about this week</h3>${list}</div>` : '';
  return `<form class="section" id="askForm"><h3>Ask ${esc(w.family_name)} about this week</h3>
    <p class="muted small" style="margin-top:0">${w.in_use ? `${esc(w.family_name)} are using this week. ` : ''}Ask anything: what time they’re leaving, whether you could arrive a day early. It isn’t a request for the week. They reply on their Enquiries page.</p>
    ${list}<div class="field" style="margin-top:${list ? 12 : 0}px"><label>Your question</label><textarea name="message" rows="2" required placeholder="e.g. What time are you leaving on Saturday? Could we arrive a day early?"></textarea></div>
    <button class="btn primary">Send question</button>
    ${w.holder_contact ? `<p class="tiny muted" style="margin:14px 0 6px">Or ask ${w.holder_contact.name ? esc(w.holder_contact.name) : 'them'} directly:</p>${contactButtons(w.holder_contact)}` : ''}</form>`;
}
async function enquirySection(w, s) {
  const q = w.enquiries || 0;
  if (w.first_refusal_until) return w.my_enquiry
    ? `<div class="section"><h3>Your family has first refusal</h3><p class="small" style="margin:0">${esc(w.family_name)} have released this week. You’re ${ordinal(w.my_enquiry.position)} of ${q} who enquired; whoever enquired first and says yes gets it. First refusal ends ${whenTime(w.first_refusal_until)}.</p>${claimForm(w.my_enquiry.id, w.price, w.my_enquiry.claim, w.first_refusal_until)}</div>`
    : `<div class="section notice small">The families who enquired about this week have first refusal until ${whenTime(w.first_refusal_until)}. After that, any member can book it.</div>`;
  if (w.my_enquiry) return `<div class="section"><h3>Your family has enquired</h3><p class="small" style="margin:0">Asked on ${asked(w.my_enquiry.created_at)}. You’re <b>${ordinal(w.my_enquiry.position)} of ${q}</b> in the queue.
    ${esc(w.family_name)} can give it to your family free, or release it, when you’ll get first refusal for ${s.enquiry_hours || 48} hours, in queue order.</p><p class="small" style="margin:8px 0 0"><a href="#/enquiries">See it on the Enquiries page →</a></p></div>`;
  if (w.can_enquire) return `<form class="section" id="enqForm"><h3>Enquire about this week</h3>
      <p class="muted small" style="margin-top:0">Your enquiry goes to ${esc(w.family_name)}’s Enquiries page. They can give the week to your family free, or release it: then families who enquired get first refusal for ${s.enquiry_hours || 48} hours at ${money(w.price)}, first come first served.${q ? ` <b>${q} famil${q > 1 ? 'ies have' : 'y has'} already enquired.</b>` : ''}</p>
      <div class="field"><label>What’s it about?</label>
        <label class="check"><input type="radio" name="kind" value="week" checked><span><b>We’d like this week</b>If they don’t need it. Your family joins the queue.</span></label>
        <label class="check" style="margin-top:8px"><input type="radio" name="kind" value="question"><span><b>Just a question</b>Arrival times, arriving a day early, anything. No queue.</span></label></div>
      <div class="field"><label>Message <span class="muted enq-opt">(optional)</span></label><textarea name="message" rows="2" placeholder="e.g. We’d love this week if your plans change."></textarea></div>
      <button class="btn primary">Enquire</button>${w.holder_contact ? `<p class="tiny muted" style="margin:14px 0 6px">Or ask ${w.holder_contact.name ? esc(w.holder_contact.name) : 'them'} directly:</p>${contactButtons(w.holder_contact)}` : ''}</form>`;
  return '';
}
function incomingCard(g) {
  const w = g.week, open = g.items.filter(e => e.status === 'open'), fopen = g.friends.filter(f => f.status === 'open'), admin = isFamAdmin(), free = !['pending', 'booked'].includes(w.state);
  const planBtns = admin && free && (open.length || fopen.length) ? [['released', 'Release it'], ['using', 'We’re using it']].filter(([k]) => k !== w.plan)
    .map(([k, l]) => `<button class="btn sm" data-plan-week="${w.id}" data-plan="${k}">${l}</button>`).join('') : '';
  return `<div class="card flat" style="padding:16px"><div class="row between"><div>${weekTitle(w)}</div><span class="badge">${PLAN[w.plan].label}</span></div>
    ${w.first_refusal_until ? `<p class="small" style="margin:8px 0 0">Released. The families who enquired have first refusal until ${whenTime(w.first_refusal_until)}.</p>` : ''}
    ${g.items.length ? `<ol class="queue">${g.items.map(e => `<li class="${e.status === 'open' ? '' : 'done'}"><div class="row between"><div><b>${esc(e.family)}</b> <span class="muted small">${esc(e.user)} · asked ${asked(e.created_at)}</span></div>${e.status === 'open' ? (e.claim === 'yes' ? '<span class="badge green">Said yes</span>' : e.claim === 'no' ? '<span class="badge">Passed</span>' : '') : enquiryStatus(e)}</div>
      ${e.message ? `<div class="small" style="margin-top:4px">“${esc(e.message)}”</div>` : ''}${pickBox(e, e.can_give ? `<button class="btn green sm" data-give="${e.id}" data-give-fam="${esc(e.family)}" data-give-week="${w.week_no}" data-give-others="${open.length - 1}" data-give-friends="${fopen.length}">Give it to them free</button>` : '')}</li>`).join('')}</ol>` : ''}
    ${g.questions.length ? `<div class="small muted" style="margin:12px 0 0">Questions from other families</div>${g.questions.map(questionIn).join('')}` : ''}
    ${g.friends.length ? `<div class="small muted" style="margin:12px 0 0">Booking enquiries from trusted friends</div>${g.friends.map(friendEnquiry).join('')}` : ''}
    ${planBtns ? `<div class="row" style="margin-top:10px;gap:8px"><span class="tiny muted">Your plans for this week:</span>${planBtns}</div>` : ''}
    ${!admin && (open.length || fopen.length) ? '<p class="tiny muted" style="margin:8px 0 0">Your family admin answers these: giving the week to a family free, letting it to a trusted friend, releasing it, or saying you’re using it.</p>' : ''}</div>`;
}
// a question about one of our weeks (holder's side) and one we asked (asker's side)
function questionIn(x) {
  return `<div class="offer"><div class="row between"><div class="small"><b>${esc(x.family)}</b> <span class="muted">${esc(x.by)} · asked ${asked(x.created_at)}</span></div>${x.reply ? '<span class="badge green">Replied</span>' : '<span class="badge amber">Waiting for a reply</span>'}</div>
    <div class="small" style="margin-top:4px">“${esc(x.message)}”</div>
    ${x.reply ? `<div class="small" style="margin-top:6px"><span class="muted">${esc(x.replied_by || '')} replied:</span> ${esc(x.reply)}</div>`
      : x.can_reply ? `<div class="row" data-qbox="${x.id}" style="margin-top:8px;gap:8px;align-items:flex-end;flex-wrap:nowrap"><textarea rows="1" style="flex:1" placeholder="Your reply"></textarea><button class="btn sm primary" data-qreply="${x.id}">Reply</button></div>` : ''}</div>`;
}
function questionOut(x) {
  return `<div class="card flat" style="padding:16px"><div class="row between"><div>${weekTitle(x.week)} <span class="muted small">· ${esc(x.week.family_name)}</span></div>${x.reply ? '<span class="badge green">Replied</span>' : '<span class="badge amber">Waiting for a reply</span>'}</div>
    <p class="tiny muted" style="margin:6px 0 0">Question from ${esc(x.by)} on ${asked(x.created_at)}</p><div class="small" style="margin-top:4px">“${esc(x.message)}”</div>
    ${x.reply ? `<div class="small" style="margin-top:8px"><b>${esc(x.week.family_name)}</b>${x.replied_by ? ` <span class="muted">(${esc(x.replied_by)})</span>` : ''}: ${esc(x.reply)}</div>` : ''}</div>`;
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
function pickBox(e, give = '') {
  if (e.status !== 'open') return '';
  const unsure = e.reply === 'unsure' ? '<span class="badge">You replied: not sure yet</span>' : e.can_reply ? `<button class="btn sm" data-unsure="${e.id}">Not sure yet</button><span class="tiny muted">They stay in the queue.</span>` : '';
  return give || unsure ? `<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap;align-items:center">${give}${unsure}</div>` : '';
}
function outgoingCard(e) {
  return `<div class="card flat" style="padding:16px"><div class="row between"><div>${weekTitle(e.week)} <span class="muted small">· ${esc(e.week.family_name)}</span></div>${enquiryStatus(e)}</div>
    <p class="tiny muted" style="margin:6px 0 0">${esc(e.user)} asked on ${asked(e.created_at)}${e.status === 'open' ? ` · they’ve marked it <b>${PLAN[e.week.plan].label}</b>` : ''}</p>
    ${e.message ? `<div class="small" style="margin-top:4px">“${esc(e.message)}”</div>` : ''}
    ${e.can_claim ? claimForm(e.id, e.week.price, e.claim, e.week.first_refusal_until) : ''}
    
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
  act('[data-give]', async b => { const d = b.dataset, others = Number(d.giveOthers), fr = Number(d.giveFriends);
    if (!confirm(`Give week ${d.giveWeek} to ${d.giveFam}, free of charge?\n\nThey can use the week. Nothing is paid, there’s no letting cost, and nothing goes on either family’s account.${others || fr ? `\n\nThe other enquiries for this week close (${[others && `${others} famil${others > 1 ? 'ies' : 'y'}`, fr && `${fr} trusted friend${fr > 1 ? 's' : ''}`].filter(Boolean).join(', ')}).` : ''}`)) return false;
    await api(`/enquiries/${d.give}/give`, { body: {} }); toast(`Given to ${d.giveFam}. They’ve been told`); });
  act('[data-qreply]', async b => { const t = b.closest('[data-qbox]').querySelector('textarea').value.trim(); if (!t) { toast('Write your reply first', true); return false; }
    await api(`/questions/${b.dataset.qreply}/reply`, { body: { reply: t } }); toast('Reply sent'); });
  act('[data-unsure]', async b => { await api(`/enquiries/${b.dataset.unsure}/reply`, { body: { reply: 'unsure' } }); toast('They’ve been told you’re not sure yet'); });
  act('[data-plan-week]', async b => { const plan = b.dataset.plan;
    if (plan === 'using' && !confirm('Mark this week “Using it”? The enquiries for it will close.')) return false;
    if (plan === 'released' && !confirm('Release this week? The families who enquired get first refusal, in queue order, then all members.')) return false;
    await api('/weeks/' + b.dataset.planWeek, { method: 'PUT', body: { plan } }); toast('Week updated'); });
}
function enquiryLists(d, opts = {}) {
  const groups = {}, group = wk => (groups[wk.id] ||= { week: wk, items: [], friends: [], questions: [] });
  (d.questions_in || []).filter(x => !opts.openOnly || !x.reply).forEach(x => group(x.week).questions.push(x));
  d.incoming.filter(e => !opts.openOnly || e.status === 'open').forEach(e => group(e.week).items.push(e));
  (d.friends || []).filter(f => !opts.openOnly || f.status === 'open').forEach(f => group(f.week).friends.push(f));
  const out = d.outgoing.filter(e => !opts.openOnly || e.status === 'open'), qout = (d.questions_out || []).filter(x => !opts.openOnly || !x.reply);
  const about = Object.values(groups).sort((a, b) => a.week.start_date.localeCompare(b.week.start_date)).map(incomingCard).join('') || '<div class="card flat empty small">No enquiries or questions about your weeks</div>';
  return `<div class="grid-2"><section class="stack"><h3 style="margin-bottom:0">About your family’s weeks</h3>${about}</section>
    <section class="stack"><h3 style="margin-bottom:0">Your family’s enquiries</h3>${out.map(outgoingCard).join('') + qout.map(questionOut).join('') || '<div class="card flat empty small">None yet. Click another family’s week on the calendar to enquire or ask a question.</div>'}</section></div>`;
}
async function viewEnquiries(main) {
  const d = await api('/enquiries'), s = S.me.settings;
  main.innerHTML = `<h1>Enquiries</h1><p class="muted">Enquire about any other family’s week marked <b>Enquire</b> on the calendar: your enquiry appears here and on their Enquiries page. The family that holds the week can give it to you free, or release it, when those who enquired get first refusal for ${s.enquiry_hours || 48} hours, first come first served; then it opens to all members, then trusted friends. You can also ask a question about any other family’s week, even one they’re using (what time they’re leaving, whether you could arrive a day early): it doesn’t join the queue, and they reply here. Trusted friends can also ask to book your weeks that are still <b>Undecided</b>: you can let the week to them at the friend price, or decline. For changes to next year’s allocation, ask the site admin.</p>
    ${enquiryLists(d)}`;
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
      <td>${esc(b.guest_name || '')}${b.party_size ? ` <span class="muted small">(${b.party_size})</span>` : ''}</td><td class="r num">${b.gift ? 'Free' : money(b.amount)}${b.gift ? `<div class="tiny muted">given by ${esc(b.seller)}</div>` : b.method === 'account' ? '<div class="tiny muted">on account</div>' : ''}</td>
      <td class="small"><code>${esc(b.reference)}</code></td><td>${st(b)}</td>
      <td class="r">${b.status === 'pending' && b.mine ? `<button class="btn sm" data-pay="${b.id}">Pay</button> ` : ''}${b.status === 'pending' ? `<button class="btn sm danger" data-cancel="${b.id}">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
  main.innerHTML = `<h1>${S.me.user.role === 'friend' ? 'My bookings' : 'Bookings'}</h1>
    <section class="stack"><h2>Weeks you’ve booked</h2>${table(mine) || `<div class="card flat empty small">You haven’t booked any weeks. Look for green prices on the calendar${S.me.user.role === 'friend' ? ', or enquire about a week marked Open to enquiries' : ''}.</div>`}</section>
    ${feTable}
    ${isFam() ? `<section class="stack" style="margin-top:32px"><h2>Your family’s weeks let to others</h2>${table(lets, true) || '<div class="card flat empty small">None yet. Family admins can offer weeks for letting from the calendar.</div>'}</section>` : ''}`;
  main.querySelectorAll('[data-fe-withdraw]').forEach(b => b.onclick = guard(async () => { if (!confirm('Withdraw your enquiry about this week?')) return; await api(`/friend-enquiries/${b.dataset.feWithdraw}/withdraw`, { body: {} }); toast('Enquiry withdrawn'); viewBookings(main); }));
  main.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => { const x = list.find(r => r.id == b.dataset.pay); openModal(`<h2>Payment details</h2>${payBox(x.reference, x.amount)}<div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Close</button></div>`); });
  main.querySelectorAll('[data-cancel]').forEach(b => b.onclick = guard(async () => { if (!confirm('Cancel this reservation? The week will become available again.')) return; await api(`/bookings/${b.dataset.cancel}/cancel`, { body: {} }); toast('Cancelled'); viewBookings(main); }));
}

// ------------------------------------------------------------ family account
async function viewAccount(main, familyId) {
  const year = S.year, s = S.me.settings;
  const [a, enq, cs] = await Promise.all([api('/account' + (familyId ? '?family_id=' + familyId : '')), familyId ? null : api('/enquiries'), api('/lets?year=' + year)]);
  const me = cs.rows.find(r => r.id === (familyId ? Number(familyId) : S.me.user.family_id)) || { lets: 0, let_income: 0, released_weeks: 0 };
  const canRm = !!familyId && isSiteRole();   // the site admin can remove a payment or adjustment recorded by mistake
  const typeName = { service_charge: 'Service charge', rental_credit: 'Letting income', purchase: 'Week purchase', payment: 'Payment', adjustment: 'Adjustment' };
  const owes = a.balance > 0.005;
  main.innerHTML = `<div class="row between"><h1>${esc(a.family.name)} account</h1>${familyId ? '<a class="btn sm" href="#/admin/overview">← Back to Payments</a>' : ''}</div>
    <div class="grid-3" style="margin-bottom:24px">
      <div class="card"><div class="muted small">${owes ? 'Balance to pay' : a.balance < -0.005 ? 'In credit' : 'Balance'}</div><div class="stat ${owes ? 'owes' : a.balance < -0.005 ? 'credit' : ''} num">${money(Math.abs(a.balance), 2)}</div>
        ${owes ? `<div class="small muted" style="margin-top:6px">Pay to ${esc(S.me.settings.bank.account_name)} using reference <b>${esc(a.family.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}-SC</b></div>` : ''}</div>
      <div class="card"><div class="muted small">Ownership share</div><div class="stat num">${a.family.share_units} <span class="small muted">weeks</span></div>
        <div class="small muted" style="margin-top:6px">${a.weeks.map(w => `${w.n} weeks held in ${w.year}`).join(' · ')}</div></div>
      <div class="card"><div class="muted small">By year</div>${a.byYear.map(y => `<div class="row between small"><span>${y.year}</span><span class="num">${Math.abs(y.total) < 0.005 ? 'Settled' : y.total > 0 ? money(y.total, 2) + ' due' : money(-y.total, 2) + ' credit'}</span></div>`).join('') || '<div class="small muted">No entries yet</div>'}</div></div>
    <h2 style="margin-bottom:12px">${year} weeks</h2>
    <div class="grid-2" style="margin-bottom:24px">
      <div class="card"><div class="muted small">Released this year</div><div class="stat num">${me.released_weeks} <span class="small muted">week${me.released_weeks === 1 ? '' : 's'}</span></div>
        <div class="small muted" style="margin-top:6px">Members and trusted friends can book a released week, as you chose when you released it.</div></div>
      <div class="card"><div class="muted small">Let income credited for ${year}</div><div class="stat num credit">${money(me.let_income, 2)}</div>
        <div class="small muted" style="margin-top:6px">From ${me.lets} let${me.lets === 1 ? '' : 's'}, after the ${money(s.letting_cost || 0)} letting cost on each. It comes off your service charge, and any extra carries forward.</div></div></div>
    ${!familyId ? `<div id="topupBox"></div><div id="acctSwaps"></div>` : ''}
    <h2>Statement</h2><p class="muted small">When one of your released weeks lets, the payment is credited here as soon as it arrives, less the ${money(S.me.settings.letting_cost || 0)} letting cost for the maintenance fund. Any credit carries forward against future charges. Charges are positive; credits and payments are negative.</p>
    ${a.lines.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Year</th><th>Type</th><th>Description</th><th class="r">Amount</th><th class="r">Balance</th>${canRm ? '<th></th>' : ''}</tr></thead><tbody>
    ${a.lines.map(l => `<tr><td class="small">${new Date(l.entry_date ? l.entry_date + 'T00:00:00Z' : l.created_at + 'Z').toLocaleDateString('en-GB')}</td><td>${l.year}</td><td><span class="badge ${l.amount < 0 ? 'green' : 'accent'}">${typeName[l.type]}</span></td><td>${esc(l.description)}</td>
      <td class="r num" style="white-space:nowrap">${l.amount < 0 ? '−' : ''}${money(Math.abs(l.amount), 2)}</td><td class="r num" style="white-space:nowrap">${l.running < -0.005 ? money(-l.running, 2) + ' credit' : money(l.running, 2)}</td>${canRm ? `<td class="r">${['payment', 'adjustment'].includes(l.type) && !l.booking_id ? `<button class="btn sm danger" data-rmline="${l.id}">Remove</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="card empty">No charges or credits yet.</div>'}`;
  main.querySelectorAll('[data-rmline]').forEach(b => b.onclick = guard(async () => { const l = a.lines.find(x => x.id == b.dataset.rmline);
    const when = new Date(l.entry_date ? l.entry_date + 'T00:00:00Z' : l.created_at + 'Z').toLocaleDateString('en-GB');
    if (!confirm(`Remove this ${l.type === 'payment' ? 'payment' : 'adjustment'} from ${a.family.name}’s account?\n\n${when} · ${l.year} · ${l.description} · ${l.amount < 0 ? '−' : ''}${money(Math.abs(l.amount), 2)}\n\nTheir balance changes by ${money(Math.abs(l.amount), 2)}${l.type === 'payment' ? ' (they owe that much more)' : ''}, and their family admins are told.`)) return;
    const r = await api('/admin/ledger/' + l.id, { method: 'DELETE' }); toast(r.topup ? 'Removed. The top-up is back on the Payments page as expected' : 'Removed'); viewAccount(main, familyId); }));
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
  main.innerHTML = `<h1>Family &amp; friends</h1>
    ${pageBar(`<span class="muted small">${esc(S.me.family.name)} family</span>`, `${isFamAdmin() ? `<button class="btn" data-add="family_member">${icon('plus')}Add family member</button>` : ''}<button class="btn" data-add="friend">${icon('plus')}Add trusted friend</button>`)}
    <p class="muted">Everyone with an email address gets their own login. ${isFamAdmin() ? 'Family admins can release weeks, answer enquiries and manage people.' : 'Only your family admin can add family members or change access.'}</p>
    <section class="stack"><h2>Family</h2>${tbl(fam, 'No family members yet')}</section>
    <section class="stack" style="margin-top:28px"><h2>Trusted friends</h2><p class="muted small" style="margin:0">Trusted friends can log in, see weeks offered for letting and book them. They can’t see other families’ details.</p>${tbl(friends, 'No trusted friends added yet')}</section>
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
    <div class="field"><label>New password</label><input name="new_password" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn primary">Update password</button></form>`;
}
function bindProfile(main) {
  $('#prof', main).onsubmit = guard(async e => { e.preventDefault(); await api('/me', { method: 'PUT', body: formData(e.target) }); toast('Details saved'); refreshMe(); });
  $('#pw', main).onsubmit = guard(async e => { e.preventDefault(); await api('/me', { method: 'PUT', body: formData(e.target) }); e.target.reset(); toast('Password changed'); });
}

// ------------------------------------------------------------ one-off costs: upgrades and maintenance quotes
// Upgrades the families suggest and quotes for maintenance wait on the Service charge page until the site admin adopts them:
// now, paid from the bank balance, or put forward for a year's service charge. An adopted cost can be bumped or cancelled.
const COST_KIND = { upgrade: 'Upgrade', maintenance: 'Maintenance' };
const costOrigin = c => c.kind === 'maintenance' ? `Maintenance${c.issue ? `: “${esc(c.issue.title)}”` : ''}${c.quote_from ? ` · quote from ${esc(c.quote_from)}` : ''}`
  : `Suggested by ${esc(c.by)}${c.family ? `, ${esc(c.family)} family` : ''}${c.quote_from ? ` · price from ${esc(c.quote_from)}` : ''}`;
const costAmount = c => c.amount != null ? money(c.amount, 2) : 'cost not known yet';
const lastEvent = c => { const h = c.history[c.history.length - 1]; return h ? `${asked(h.at)}${h.by ? `, ${esc(h.by)}` : ''}: ${esc(h.text)}` : ''; };
function costCard(c) {
  const btns = [c.can_adopt && `<button class="btn sm green" data-adopt="${c.id}">Adopt…</button>`, c.can_bump && `<button class="btn sm" data-bump="${c.id}">Bump or cancel…</button>`,
    c.can_edit && `<button class="btn sm" data-cost-edit="${c.id}">Edit…</button>`, c.can_cancel && c.status === 'waiting' && `<button class="btn sm" data-cost-cancel="${c.id}">Cancel…</button>`,
    c.can_reinstate && `<button class="btn sm" data-reinstate="${c.id}">Reinstate</button>`, c.can_withdraw && `<button class="btn sm danger" data-cost-withdraw="${c.id}">Withdraw</button>`].filter(Boolean).join('');
  return `<div class="card flat cost" data-cost="${c.id}" style="padding:16px"><div class="row between" style="align-items:flex-start;gap:12px"><div style="min-width:0"><b>${esc(c.title)}</b> <span class="num">· ${costAmount(c)}</span>
      <div class="tiny muted" style="margin-top:2px">${costOrigin(c)} · ${asked(c.created_at)}</div></div>
      <div class="row" style="gap:6px;justify-content:flex-end;flex-wrap:wrap"><span class="tag">${COST_KIND[c.kind]}</span><span class="badge ${c.tone}">${esc(c.label)}</span></div></div>
    ${c.details ? `<div class="small" style="margin-top:8px;white-space:pre-line">${guideText(c.details)}</div>` : ''}
    ${c.history.length ? `<div class="tiny muted" style="margin-top:8px">${lastEvent(c)}${c.history.length > 1 ? ` · <a href="#" data-cost-history="${c.id}">History (${c.history.length})</a>` : ''}</div>` : ''}
    ${btns ? `<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">${btns}</div>` : ''}</div>`;
}
// what a cost is: the same fields when suggesting, adding and editing
const costFields = (c, o = {}) => `<div class="field"><label>${o.upgrade ? 'What would you like?' : 'What is it?'}</label><input name="title" required maxlength="200" value="${esc(c.title || '')}" placeholder="${o.upgrade ? 'e.g. A hot tub, a new coffee grinder' : 'e.g. Replace the water supply pipe'}"></div>
  ${o.kind ? '<div class="field"><label>Kind</label><select name="kind"><option value="maintenance">Maintenance (works, repairs)</option><option value="upgrade">Upgrade</option></select></div>' : ''}
  <div class="grid-2" style="gap:12px"><div class="field"><label>${o.upgrade ? 'Rough cost (£, if you know it)' : 'Cost (£)'}</label><input name="amount" type="number" min="0" step="0.01" value="${c.amount ?? ''}" ${o.need ? 'required' : ''}></div>
    <div class="field"><label>${o.upgrade ? 'Price from (optional)' : 'Quote from (optional)'}</label><input name="quote_from" maxlength="200" value="${esc(c.quote_from || '')}" placeholder="${o.upgrade ? 'e.g. John Lewis' : 'e.g. Highland Plumbing'}"></div></div>
  <div class="field"><label>Details (optional)</label><textarea name="details" rows="3" placeholder="${o.upgrade ? 'Why, where it would go, a link to one you like…' : 'What it covers, how long the quote is valid…'}">${esc(c.details || '')}</textarea></div>`;
// a change to a year whose charges are issued: offer to re-issue them. If a rounded charge per week is set on Payments, the
// re-issue uses the rate the budget now works out at (it can be rounded again on Payments).
async function offerReissue(rs) { for (const { year: y, fixed, calc } of rs || []) {
  const refix = fixed != null && Math.abs(fixed - calc) > 0.005;
  if (!confirm(refix ? `The ${y} service charges are already issued, at ${money(fixed, 2)} a week. With this change the ${y} budget works out at ${money(calc, 2)} a week. Re-issue the ${y} charges at ${money(calc, 2)} a week? (You can round it on Payments and issue again.)`
    : `The ${y} service charges are already issued, and the ${y} budget has changed. Re-issue them now so households are charged the new amount?`)) continue;
  if (refix) await api('/admin/budget-year/' + y, { method: 'PUT', body: { rate_per_week: '' } });
  await api('/admin/budget/generate', { body: { year: y } }); toast(`${y} service charges re-issued`); }
}
// the actions on cost cards (and on a one-off line in the Service charge table): adopt, bump or cancel, edit, history
function bindCosts(root, d, reload, more = []) {
  const find = id => d.costs.find(c => c.id == id) || more.find(c => c.id == id);
  const yearOpts = sel => d.years.map(y => `<option value="${y}" ${y === sel ? 'selected' : ''}>${y}${d.issued.includes(y) ? ' (charges issued)' : ''}</option>`).join('');
  root.querySelectorAll('[data-adopt]').forEach(x => x.onclick = () => { const c = find(x.dataset.adopt), bank = d.bank;
    const m = openModal(`<form id="adf"><h2>Adopt “${esc(c.title)}”</h2><p class="small muted" style="margin-top:0">${costOrigin(c)} · ${costAmount(c)}</p>
      <div class="field"><label>How</label><select name="how"><option value="bank">Carry it out now, paid from the bank balance</option><option value="charge">Put it forward for a year’s service charge, for the AGM to agree</option></select></div>
      <div class="grid-2" style="gap:12px"><div class="field"><label>Amount (£)</label><input name="amount" type="number" min="0.01" step="0.01" required value="${c.amount ?? ''}"></div>
        <div class="field"><label>Year</label><select name="year"></select></div></div>
      <p class="tiny muted" id="adhint" style="margin:-4px 0 12px"></p>
      <div class="field"><label>Note (optional)</label><input name="note" maxlength="300" placeholder="e.g. Agreed by the board, 1 Dec 2026"></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn green">Adopt</button></div></form>`);
    const f = $('#adf', m);
    const sync = fresh => { const how = f.how.value; if (fresh) f.year.innerHTML = yearOpts(how === 'bank' ? d.now_year : d.forward_year); const y = Number(f.year.value);
      $('#adhint', m).textContent = how === 'bank' ? `A line in the ${y} budget paid from the bank balance: nothing is charged. A year’s bank-balance lines can’t add up to more than the latest bank balance${bank ? ` (${money(bank.amount, 2)} on ${dfmt(bank.as_of, { day: 'numeric', month: 'short', year: 'numeric' })})` : ' (none is recorded yet: add it on Payments)'}.`
        : `A line in the ${y} budget, so the service charge goes up. The AGM agrees the budget before the charges are issued.${d.issued.includes(y) ? ` The ${y} charges are already issued, so you’ll be asked whether to re-issue them.` : ''}`; };
    f.how.onchange = () => sync(true); f.year.onchange = () => sync(false); sync(true);
    f.onsubmit = guard(async e => { e.preventDefault(); const r = await api(`/admin/costs/${c.id}/adopt`, { body: formData(f) }); closeOverlay(); toast('Adopted'); await offerReissue(r.reissue); reload(); });
  });
  // an adopted cost: back to the waiting list, to another year, or cancelled; a waiting one: cancelled
  const change = (c, adopted) => {
    const m = openModal(`<form id="bcf"><h2>${adopted ? 'Bump or cancel' : 'Cancel'} “${esc(c.title)}”</h2><p class="small muted" style="margin-top:0">${costAmount(c)} · ${esc(c.label)}.</p>
      ${adopted ? `<div class="field"><label>What happens to it</label><select name="action"><option value="waiting">Bump it back to the waiting list</option>${d.years.filter(y => y !== c.year).map(y => `<option value="${y}">Move it to ${y}</option>`).join('')}<option value="cancel">Cancel it</option></select></div>` : '<input type="hidden" name="action" value="cancel">'}
      <div class="field"><label>Reason (optional)</label><input name="note" maxlength="300" placeholder="e.g. The hot water tank has to come first"></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Keep it</button><button class="btn ${adopted ? 'primary' : 'danger'}">${adopted ? 'Save' : 'Cancel it'}</button></div></form>`);
    $('#bcf', m).onsubmit = guard(async e => { e.preventDefault(); const v = formData(e.target);
      const r = v.action === 'cancel' ? await api(`/admin/costs/${c.id}/cancel`, { body: { note: v.note } }) : await api(`/admin/costs/${c.id}/bump`, { body: { to: v.action === 'waiting' ? null : v.action, note: v.note } });
      closeOverlay(); toast(v.action === 'cancel' ? 'Cancelled' : v.action === 'waiting' ? 'Bumped back to the waiting list' : `Moved to ${v.action}`); await offerReissue(r.reissue); reload(); });
  };
  root.querySelectorAll('[data-bump]').forEach(x => x.onclick = () => change(find(x.dataset.bump), true));
  root.querySelectorAll('[data-cost-cancel]').forEach(x => x.onclick = () => change(find(x.dataset.costCancel), false));
  root.querySelectorAll('[data-reinstate]').forEach(x => x.onclick = guard(async () => { await api(`/admin/costs/${x.dataset.reinstate}/reinstate`, { body: {} }); toast('Waiting again'); reload(); }));
  root.querySelectorAll('[data-cost-withdraw]').forEach(x => x.onclick = guard(async () => { if (!confirm('Withdraw this suggestion?')) return; await api(`/costs/${x.dataset.costWithdraw}/withdraw`, { body: {} }); toast('Withdrawn'); reload(); }));
  root.querySelectorAll('[data-cost-edit]').forEach(x => x.onclick = () => { const c = find(x.dataset.costEdit);
    const m = openModal(`<form id="cef"><h2>Edit “${esc(c.title)}”</h2>${costFields(c, { upgrade: c.kind === 'upgrade', need: c.status === 'adopted' })}
      ${c.status === 'adopted' ? `<p class="tiny muted" style="margin-top:-4px">Its line in the ${c.year} budget changes too.</p>` : ''}
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    $('#cef', m).onsubmit = guard(async e => { e.preventDefault(); const r = await api('/costs/' + c.id, { method: 'PUT', body: formData(e.target) }); closeOverlay(); toast('Saved'); await offerReissue(r.reissue); reload(); }); });
  root.querySelectorAll('[data-cost-history]').forEach(x => x.onclick = e => { e.preventDefault(); const c = find(x.dataset.costHistory);
    openModal(`<h2>History of “${esc(c.title)}”</h2><div class="stack">${c.history.map(h => `<div class="small"><b>${asked(h.at)}</b>${h.by ? ` · ${esc(h.by)}` : ''}<div>${esc(h.text)}</div></div>`).join('')}</div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-close>Close</button></div>`); });
  const add = $('[data-add-cost]', root); if (add) add.onclick = () => {
    const m = openModal(`<form id="acf"><h2>Add a cost</h2><p class="small muted" style="margin-top:0">A one-off cost to wait with the others: works from a quote, say, or an upgrade.</p>${costFields({}, { kind: true })}
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`);
    $('#acf', m).onsubmit = guard(async e => { e.preventDefault(); await api('/costs', { body: formData(e.target) }); closeOverlay(); toast('Added: waiting to be adopted'); reload(); }); };
}
// costs waiting to be adopted (any year), and those cancelled in the last year
const waitingCosts = (d, admin) => { const waiting = d.costs.filter(c => c.status === 'waiting'), gone = d.costs.filter(c => c.status === 'cancelled'), known = waiting.filter(c => c.amount != null);
  return `<section class="stack"><div class="row between" style="gap:12px"><h2 style="margin:0">Waiting to be adopted</h2>${admin ? `<button class="btn" data-add-cost>${icon('plus')}Add a cost…</button>` : ''}</div>
    <p class="muted small" style="margin:0">Upgrades the families suggested and quotes for maintenance${known.length ? `: ${waiting.length} waiting, ${money(known.reduce((a, c) => a + c.amount, 0), 2)} in all` : ''}. ${admin ? 'Adopt one now (paid from the bank balance) or put it forward for a year’s service charge; or leave it waiting.' : 'The site admin adopts them now, paid from the bank balance, or puts them forward for a year’s service charge.'}</p>
    ${waiting.map(costCard).join('') || '<div class="card flat empty small">Nothing waiting</div>'}
    ${gone.length ? `<details class="card flat" style="padding:12px 16px"><summary class="small" style="cursor:pointer">Cancelled in the last year (${gone.length})</summary><div class="stack" style="margin-top:12px">${gone.map(costCard).join('')}</div></details>` : ''}</section>`; };
// a one-off line in a year's service charge: where it came from, and whether it's still only put forward for the AGM
const lineCost = i => i.cost ? `<div class="tiny muted" style="margin-top:2px">${costOrigin(i.cost)} · <span class="badge ${i.cost.tone}">${i.cost.tone === 'blue' ? 'Put forward: for the AGM' : 'Adopted'}</span></div>` : '';
// the year's service charge in figures
const chargeCard = (b, admin) => `<div class="card"><h3>Service charge ${esc(b.label || String(b.year))}</h3>
  <dl class="kv" style="grid-template-columns:1fr auto"><dt>Added to the service charge</dt><dd class="num r">${money(b.charge_total, 2)}</dd><dt>÷ ${b.units} weeks (shares)</dt><dd class="num r">${money(b.charge_total / (b.units || 1), 2)} a week</dd>
    <dt>Charge per week</dt><dd class="num r">${money(b.rate, 2)}</dd><dt>Paid from the bank balance</dt><dd class="num r">${money(b.bank_total, 2)}</dd>
    <dt>Status</dt><dd class="r">${b.generated ? '<span class="badge green">Issued</span>' : '<span class="badge amber">Not issued</span>'}</dd></dl>
  ${admin ? '<a class="btn block" href="#/admin/overview" id="toPay" style="margin-top:14px">Issue and record payments →</a>' : ''}</div>`;
const SC_INTRO = 'What the service charge pays for each year, line by line. One-off costs (upgrades the families suggest and quotes for maintenance) wait below until the site admin adopts them: now, paid from the bank balance, or put forward for a year’s service charge, which the AGM agrees. An adopted cost can still be bumped or cancelled if something more urgent comes up.';
async function viewServiceCharge(main) {
  const [b, d] = await Promise.all([api('/service-charge?year=' + S.year), api('/costs')]);
  main.innerHTML = `<h1>Service charge</h1><p class="muted" style="max-width:75ch">${SC_INTRO}</p>
    ${pageBar(yearPicker())}
    ${b.items.length ? `<div class="table-wrap" style="margin-bottom:24px"><table><thead><tr><th>Item</th><th>Type</th><th>Paid from</th><th class="r">Amount</th></tr></thead><tbody>
      ${b.items.map(i => `<tr><td>${esc(i.description)}${i.cost ? lineCost(i) : i.notes ? `<div class="tiny muted">${esc(i.notes)}</div>` : ''}</td><td class="small muted">${esc(i.category || '')}</td><td class="small muted">${i.funding === 'bank' ? 'Bank balance' : 'Service charge'}</td><td class="r num">${money(i.amount, 2)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">Added to the service charge</td><td class="r num">${money(b.charge_total, 2)}</td></tr>${b.bank_total > 0.005 ? `<tr><td colspan="3">Paid from the bank balance</td><td class="r num">${money(b.bank_total, 2)}</td></tr>` : ''}<tr><td colspan="3">Total</td><td class="r num">${money(b.total, 2)}</td></tr></tfoot></table></div>`
      : `<div class="card flat empty small" style="margin-bottom:24px">No service charge set for ${b.year} yet</div>`}
    <div class="grid-2" style="align-items:start">${chargeCard(b)}${waitingCosts(d)}</div>`;
  const reload = () => viewServiceCharge(main);
  bindYears(main, reload); bindCosts(main, d, reload);
}
async function viewUpgrades(main) {
  const d = await api('/costs'), ups = d.costs.filter(c => c.kind === 'upgrade');
  const waiting = ups.filter(c => c.status === 'waiting'), adopted = ups.filter(c => c.status === 'adopted'), gone = ups.filter(c => c.status === 'cancelled' || c.status === 'withdrawn');
  main.innerHTML = `<h1>Upgrades</h1><p class="muted" style="max-width:75ch">Suggest something that would make the house better: a new fridge, a hot tub, a new coffee grinder. It waits on the Service charge page until the site admin adopts it: now, paid from the bank balance, or put forward for a year’s service charge for the AGM to agree. For repairs, report the problem on the Maintenance page.</p>
    <div class="grid-2" style="align-items:start">
      <section class="stack">${d.can_suggest ? `<form class="card" id="upf"><h3>${icon('lightbulb')} Suggest an upgrade</h3>${costFields({}, { upgrade: true })}<button class="btn primary">Suggest</button></form>` : ''}</section>
      <section class="stack"><h2 style="margin:0">Waiting</h2>${waiting.map(costCard).join('') || '<div class="card flat empty small">No suggestions waiting</div>'}
        ${adopted.length ? `<h2 style="margin:8px 0 0">Adopted</h2>${adopted.map(costCard).join('')}` : ''}
        ${gone.length ? `<h2 style="margin:8px 0 0">Cancelled and withdrawn</h2>${gone.map(costCard).join('')}` : ''}</section></div>`;
  const reload = () => viewUpgrades(main);
  const f = $('#upf', main); if (f) f.onsubmit = guard(async e => { e.preventDefault(); await api('/costs', { body: formData(f) }); toast(isSite() ? 'Added: waiting to be adopted' : 'Suggested. The site admin has been told'); reload(); });
  bindCosts(main, d, reload);
}

// ------------------------------------------------------------ shares
// A family admin offers some of the family's shares to the other syndicate families; they register interest until the closing
// date; the site admin records the sale once it's complete, and weeks and the service charge follow the shares from that year.
const shareText = n => `${n} share${n === 1 ? '' : 's'}`;
function offerCard(o, admin) {
  const status = o.status === 'open' ? (o.taking ? `<span class="badge green">Open until ${dfmt(o.closes_on)}</span>` : `<span class="badge amber">Closed for interest on ${dfmt(o.closes_on)}</span>`)
    : { sold: '<span class="badge blue">Sold</span>', closed: '<span class="badge">Closed</span>', withdrawn: '<span class="badge">Withdrawn</span>' }[o.status];
  const mine = o.my_interest, btns = [o.can_interest && `<button class="btn sm" data-interest="${o.id}">${mine ? 'Change our interest…' : 'Register interest…'}</button>`,
    mine && o.can_interest && `<button class="btn sm danger" data-interest-withdraw="${mine.id}">Withdraw our interest</button>`,
    o.can_record && `<button class="btn sm green" data-record="${o.id}">Record the sale…</button>`, o.can_close && `<button class="btn sm" data-offer-close="${o.id}">Close without a sale…</button>`,
    o.can_withdraw && !admin && `<button class="btn sm danger" data-offer-withdraw="${o.id}">Withdraw the offer</button>`].filter(Boolean).join('');
  return `<div class="card flat offer" data-offer="${o.id}" style="padding:16px"><div class="row between" style="align-items:flex-start;gap:12px"><div style="min-width:0"><b>The ${esc(o.family)} family: ${shareText(o.shares)} for sale</b>${o.price != null ? ` <span class="num">· ${money(o.price, 2)} a share</span>` : ''}
      <div class="tiny muted" style="margin-top:2px">Takes effect from ${o.from_year} · offered by ${esc(o.by)} on ${asked(o.created_at)}</div></div>${status}</div>
    ${o.note ? `<div class="small" style="margin-top:8px;white-space:pre-line">${esc(o.note)}</div>` : ''}
    ${o.interests.length ? `<div class="small stack" style="margin-top:10px;gap:2px"><b>Interest</b>${o.interests.map(i => `<div>${esc(i.family)}: ${i.status === 'accepted' ? `bought ${i.allotted}` : i.status === 'declined' ? `asked for ${i.shares}, none this time` : `would like ${i.shares}`}${i.note ? ` <span class="muted">· “${esc(i.note)}”</span>` : ''}</div>`).join('')}</div>`
      : o.status === 'open' ? '<div class="tiny muted" style="margin-top:10px">No interest registered yet.</div>' : ''}
    ${o.oversubscribed && o.status === 'open' ? `<div class="tiny muted" style="margin-top:6px">${o.wanted} shares wanted and ${o.shares} offered: they’ll be shared out in proportion to holdings.</div>` : ''}
    ${o.outcome && o.status !== 'open' ? `<div class="small" style="margin-top:8px">${o.status === 'sold' ? 'Sold: ' : ''}${esc(o.outcome)}.</div>` : ''}
    ${btns ? `<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">${btns}</div>` : ''}</div>`;
}
async function viewShares(main) {
  const d = await api('/shares?year=' + S.year), admin = isSite(), cur = S.me.settings.currency;
  const open = d.offers.filter(o => o.status === 'open'), past = d.offers.filter(o => o.status !== 'open');
  const myOpen = isFam() && open.find(o => o.family_id === S.me.user.family_id);
  main.innerHTML = `<h1>Shares</h1><p class="muted" style="max-width:75ch">Each share is one week a year and a share of the service charge. A family admin can offer some of the family’s shares to the other syndicate families, who register interest before the closing date; if more are wanted than offered, they’re shared out in proportion to holdings. The sale itself is completed outside the portal, under the syndicate’s articles and any shareholders’ agreement. The site admin then records it here, and the weeks and the service charge follow the shares from the year it takes effect.</p>
    ${pageBar(yearPicker(), admin ? `<button class="btn" data-transfer>${icon('plus')}Record a transfer…</button>` : '')}
    <div class="grid-2" style="align-items:start">
      <section class="stack">
        <div class="card"><h3>${icon('chart-pie')} Share register ${S.year}</h3>
          <div class="table-wrap"><table><thead><tr><th>Family</th><th class="r">Shares</th><th class="r">Of the house</th></tr></thead><tbody>
          ${d.register.map(f => `<tr ${f.mine ? 'style="font-weight:600"' : ''}><td><span class="dot" style="background:${esc(f.color || '#999')}"></span>${esc(f.name)}${f.mine ? ' (you)' : ''}</td><td class="r num">${f.shares}</td><td class="r num">${f.pct.toFixed(1)}%</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="r num">${d.total}</td><td class="r num">100%</td></tr></tfoot></table></div>
          ${d.price ? `<p class="small muted" style="margin:10px 0 0">Agreed price per share: <b>${money(d.price, 2)}</b> (about ${money(d.price * 52, 0)} for the house). A family can ask a different price.</p>` : ''}</div>
        ${d.can_offer ? `<form class="card" id="sof"><h3>Offer shares for sale</h3><p class="small muted" style="margin-top:0">To the other syndicate families. Your family holds ${shareText(d.my_shares)} from next year.</p>
          <div class="grid-2" style="gap:12px"><div class="field"><label>Shares to sell</label><input name="shares" type="number" min="1" max="${d.my_shares}" step="1" value="1" required></div>
            <div class="field"><label>Asking price per share (${cur})</label><input name="price" type="number" min="0" step="0.01" value="${d.price ?? ''}"></div>
            <div class="field"><label>Takes effect from</label><select name="from_year">${d.years.map(y => `<option value="${y}" ${y === d.years[1] ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
            <div class="field"><label>Interest closes on</label><input name="closes_on" type="date" value="${addDays(new Date().toISOString().slice(0, 10), d.offer_days)}" required></div></div>
          <div class="field"><label>Note (optional)</label><textarea name="note" rows="2" placeholder="e.g. We’re coming less now the children have grown up"></textarea></div>
          <button class="btn primary">Offer for sale</button></form>`
          : myOpen ? '<div class="card flat small muted">Your family’s offer is open: it’s listed under Shares for sale.</div>' : ''}
      </section>
      <section class="stack"><h2 style="margin:0">Shares for sale</h2>${open.map(o => offerCard(o, admin)).join('') || '<div class="card flat empty small">No shares on offer at the moment</div>'}
        ${past.length ? `<h2 style="margin:8px 0 0">Earlier offers</h2>${past.map(o => offerCard(o, admin)).join('')}` : ''}
        ${d.transfers.length ? `<h2 style="margin:8px 0 0">Transfers recorded</h2><div class="table-wrap"><table><thead><tr><th>From</th><th></th><th class="r">Shares</th><th class="r">Price each</th><th>Recorded</th></tr></thead><tbody>
          ${d.transfers.map(t => `<tr><td>${t.from_year}</td><td>${esc(t.from)} → ${esc(t.to)}${t.note ? `<div class="tiny muted">${esc(t.note)}</div>` : ''}</td><td class="r num">${t.shares}</td><td class="r num">${t.price != null ? money(t.price, 2) : '—'}</td><td class="small muted">${asked(t.created_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}</section></div>`;
  const reload = () => viewShares(main), find = id => d.offers.find(o => o.id == id);
  bindYears(main, reload);
  const f = $('#sof', main); if (f) f.onsubmit = guard(async e => { e.preventDefault(); if (!confirm('Offer these shares to the other syndicate families? Their family admins will be told.')) return; await api('/shares/offers', { body: formData(f) }); toast('Offered. The other families have been told'); reload(); });
  main.querySelectorAll('[data-offer-withdraw]').forEach(x => x.onclick = guard(async () => { if (!confirm('Withdraw the offer?')) return; await api(`/shares/offers/${x.dataset.offerWithdraw}/withdraw`, { body: {} }); toast('Withdrawn'); reload(); }));
  main.querySelectorAll('[data-interest-withdraw]').forEach(x => x.onclick = guard(async () => { if (!confirm('Withdraw your family’s interest?')) return; await api(`/shares/interests/${x.dataset.interestWithdraw}/withdraw`, { body: {} }); toast('Withdrawn'); reload(); }));
  main.querySelectorAll('[data-interest]').forEach(x => x.onclick = () => { const o = find(x.dataset.interest), mine = o.my_interest;
    const m = openModal(`<form id="sif"><h2>Shares from the ${esc(o.family)} family</h2><p class="small muted" style="margin-top:0">${shareText(o.shares)} for sale${o.price != null ? ` at ${money(o.price, 2)} a share` : ''}, from ${o.from_year}. Registering interest isn’t a commitment: the sale is agreed and completed outside the portal.</p>
      <div class="field"><label>How many would your family like?</label><input name="shares" type="number" min="1" max="${o.shares}" step="1" value="${mine ? mine.shares : 1}" required></div>
      <div class="field"><label>Note (optional)</label><input name="note" maxlength="300" value="${esc(mine ? mine.note || '' : '')}" placeholder="e.g. One would be perfect for us"></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${mine ? 'Save' : 'Register interest'}</button></div></form>`);
    $('#sif', m).onsubmit = guard(async e => { e.preventDefault(); await api(`/shares/offers/${o.id}/interest`, { body: formData(e.target) }); closeOverlay(); toast('Interest registered. The family and the site admin have been told'); reload(); }); });
  // the site admin: record the sale (shares for each family, prefilled in proportion to holdings), or close it
  main.querySelectorAll('[data-record]').forEach(x => x.onclick = () => { const o = find(x.dataset.record), live = o.interests.filter(i => i.status === 'open');
    const others = d.families.filter(f => f.id !== o.family_id && !live.some(i => i.family_id === f.id));
    const m = openModal(`<form id="srf"><h2>Record the sale</h2><p class="small muted" style="margin-top:0">${shareText(o.shares)} from the ${esc(o.family)} family. Record it once the sale is complete under the syndicate’s articles. ${o.oversubscribed ? 'More were wanted than offered: the numbers below share them out in proportion to holdings.' : ''}</p>
      <div class="table-wrap"><table><thead><tr><th>Family</th><th class="r">Asked for</th><th class="r">Shares</th></tr></thead><tbody>
        ${live.map(i => `<tr><td>${esc(i.family)} <span class="tiny muted">(holds ${i.holding})</span></td><td class="r num">${i.shares}</td><td class="r"><input name="allot_${i.family_id}" type="number" min="0" max="${o.shares}" step="1" value="${o.suggestion[i.family_id] || 0}" style="max-width:80px;text-align:right"></td></tr>`).join('')}
        ${others.length ? `<tr><td><select name="other_family"><option value="">Another family…</option>${others.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></td><td></td><td class="r"><input name="other_shares" type="number" min="0" max="${o.shares}" step="1" value="0" style="max-width:80px;text-align:right"></td></tr>` : ''}</tbody></table></div>
      <div class="grid-2" style="gap:12px;margin-top:12px"><div class="field"><label>Price per share (${cur})</label><input name="price" type="number" min="0" step="0.01" value="${o.price ?? ''}"></div>
        <div class="field"><label>Takes effect from</label><select name="from_year">${d.years.map(y => `<option value="${y}" ${y === o.from_year ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
      <div class="field"><label>Note (optional)</label><input name="note" maxlength="300" placeholder="e.g. Completed 1 March 2027"></div>
      <p class="tiny muted">From that year, the shares (and with them the weeks and the service charge) move to the buyers. Reallocate weeks on the Weeks page for any year that’s already allocated.</p>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn green">Record the sale</button></div></form>`, true);
    $('#srf', m).onsubmit = guard(async e => { e.preventDefault(); const v = formData(e.target), allot = {};
      for (const [k, n] of Object.entries(v)) if (k.startsWith('allot_') && Number(n) > 0) allot[k.slice(6)] = Number(n);
      if (v.other_family && Number(v.other_shares) > 0) allot[v.other_family] = (allot[v.other_family] || 0) + Number(v.other_shares);
      const r = await api(`/admin/shares/offers/${o.id}/record`, { body: { allot, price: v.price, from_year: v.from_year, note: v.note } }); closeOverlay(); toast('Sale recorded'); await offerReissue(r.reissue); reload(); }); });
  main.querySelectorAll('[data-offer-close]').forEach(x => x.onclick = () => { const o = find(x.dataset.offerClose);
    const m = openModal(`<form id="scf"><h2>Close without a sale</h2><p class="small muted" style="margin-top:0">The ${esc(o.family)} family’s offer of ${shareText(o.shares)}. The family and anyone who registered interest are told.</p>
      <div class="field"><label>Reason (optional)</label><input name="note" maxlength="300" placeholder="e.g. No interest; the family is keeping them"></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Close the offer</button></div></form>`);
    $('#scf', m).onsubmit = guard(async e => { e.preventDefault(); await api(`/admin/shares/offers/${o.id}/close`, { body: formData(e.target) }); closeOverlay(); toast('Closed'); reload(); }); });
  const tr = $('[data-transfer]', main); if (tr) tr.onclick = () => {
    const fam = sel => `<select name="${sel}" required><option value="">Choose…</option>${d.families.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>`;
    const m = openModal(`<form id="stf"><h2>Record a transfer</h2><p class="small muted" style="margin-top:0">Shares moving without an offer here: a holding split between the next generation’s households (add the new household on Families first), a gift, or a sale agreed another way.</p>
      <div class="grid-2" style="gap:12px"><div class="field"><label>From</label>${fam('from_family_id')}</div><div class="field"><label>To</label>${fam('to_family_id')}</div>
        <div class="field"><label>Shares</label><input name="shares" type="number" min="1" step="1" required></div><div class="field"><label>Price per share (${cur}, optional)</label><input name="price" type="number" min="0" step="0.01"></div>
        <div class="field"><label>Takes effect from</label><select name="from_year">${d.years.map(y => `<option value="${y}" ${y === d.years[1] ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
      <div class="field"><label>Note (optional)</label><input name="note" maxlength="300" placeholder="e.g. Split between the two households"></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Record</button></div></form>`, true);
    $('#stf', m).onsubmit = guard(async e => { e.preventDefault(); const r = await api('/admin/shares/transfers', { body: formData(e.target) }); closeOverlay(); toast('Transfer recorded'); await offerReissue(r.reissue); reload(); }); };
}

// ------------------------------------------------------------ the manifesto
// The Nab Camas 2.0 proposal, block by block. Families comment on any part or suggest new wording; the site admin accepts or
// declines suggestions, resolves comments and edits the text.
const mdInline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1<i>$2</i>')
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
const mdTable = t => { const rows = t.split('\n').map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())).filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));
  return `<div class="table-wrap"><table><thead><tr>${rows[0].map(c => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; };
const mdBlockHtml = b => b.type === 'table' ? mdTable(b.text) : /^h\d$/.test(b.type) ? `<${b.type}>${mdInline(b.text)}</${b.type}>` : `<p>${mdInline(b.text)}</p>`;
const M_STATUS = { accepted: '<span class="badge green">Accepted</span>', declined: '<span class="badge">Not taken up</span>', resolved: '<span class="badge">Resolved</span>' };
function mThread(c, admin) {
  const open = c.status === 'open';
  const btns = [`<button class="btn sm" data-mreply="${c.id}">Reply</button>`, admin && open && c.kind === 'suggestion' && `<button class="btn sm green" data-maccept="${c.id}">Accept</button>`,
    admin && open && c.kind === 'suggestion' && `<button class="btn sm" data-mdecline="${c.id}">Decline</button>`, admin && open && c.kind === 'comment' && `<button class="btn sm" data-mresolve="${c.id}">Mark as resolved</button>`,
    admin && !open && `<button class="btn sm" data-mreopen="${c.id}">Reopen</button>`, c.can_delete && `<button class="btn sm danger" data-mdel="${c.id}">Delete</button>`].filter(Boolean).join('');
  return `<div class="mthread ${c.kind} ${c.status}" data-thread="${c.id}"><div class="row between" style="gap:8px;align-items:flex-start"><span class="small"><b>${esc(c.by)}</b>${c.family ? `, ${esc(c.family)}` : ''} <span class="muted">· ${asked(c.created_at)}</span></span>
      <span class="row" style="gap:6px">${c.kind === 'suggestion' ? '<span class="badge blue">Suggestion</span>' : ''}${M_STATUS[c.status] || ''}</span></div>
    ${c.text ? `<div class="small" style="margin-top:4px;white-space:pre-line">${esc(c.text)}</div>` : ''}
    ${c.kind === 'suggestion' ? `<div class="msuggest small"><span class="tiny muted">Suggested wording</span><div>${mdInline(c.suggestion)}</div></div>` : ''}
    ${c.replies.map(r => `<div class="mreply small"><b>${esc(r.by)}</b>${r.family ? `, ${esc(r.family)}` : ''} <span class="muted">· ${asked(r.created_at)}</span><div style="white-space:pre-line">${esc(r.text)}</div></div>`).join('')}
    ${!open && c.resolved_by ? `<div class="tiny muted" style="margin-top:6px">${M_STATUS[c.status].replace(/<[^>]+>/g, '')} by ${esc(c.resolved_by)} on ${asked(c.resolved_at)}</div>` : ''}
    <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${btns}</div></div>`;
}
// a block's threads: open ones shown, the rest folded away
const mThreads = (cs, admin) => { if (!cs.length) return ''; const open = cs.filter(c => c.status === 'open'), done = cs.filter(c => c.status !== 'open');
  return `<div class="mthreads">${open.map(c => mThread(c, admin)).join('')}${done.length ? `<details class="small"><summary class="muted" style="cursor:pointer">${done.length} dealt with</summary><div class="mthreads" style="margin:8px 0 0">${done.map(c => mThread(c, admin)).join('')}</div></details>` : ''}</div>`; };
// who's commenting without a login: remembered on this device so they needn't type it again
const guest = { get: () => { try { return JSON.parse(localStorage.getItem('nab_guest') || '{}'); } catch { return {}; } }, set: v => { try { localStorage.setItem('nab_guest', JSON.stringify(v)); } catch { } } };
const guestFields = d => { const g = guest.get(); return `<div class="grid-2" style="gap:12px"><div class="field"><label>Your name</label><input name="name" required maxlength="120" autocomplete="name" value="${esc(g.name || '')}"></div>
  <div class="field"><label>Your family</label><select name="family_id" required><option value="">Choose…</option>${d.families.map(f => `<option value="${f.id}" ${String(g.family_id) === String(f.id) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div></div>
  <div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>`; };
async function viewManifesto(main) {
  const d = await api('/manifesto'), admin = d.can_manage, pub = !d.signed_in;
  const body = d.blocks.map(b => { const n = b.comments.filter(c => c.status === 'open').length, li = b.type === 'ul' || b.type === 'ol';
    return `<div class="mblock ${li ? `li l${b.level}` : b.type}" data-b="${b.i}" ${b.type === 'ol' ? `data-num="${b.num}."` : ''}>${mdBlockHtml(b)}
      <button class="iconbtn mcom ${n ? 'has' : ''}" data-comment="${b.i}" title="Comment${b.type === 'table' ? '' : ' or suggest wording'}" aria-label="Comment on this part">${icon('message-square-plus')}${n ? `<span class="mcount">${n}</span>` : ''}</button></div>${mThreads(b.comments, admin)}`; }).join('');
  main.innerHTML = `${pub ? '<span class="eyebrow">Nab Camas 2.0</span>' : ''}<h1>Manifesto</h1><p class="muted" style="max-width:75ch">Nab Camas 2.0: the proposal for how the syndicate could run from here. Read it, then comment on any part, or suggest different wording, with the speech bubble beside each paragraph.${pub ? ' No login needed: just give your name and family.' : ''} The site admin gathers comments and suggestions, and updates the text.</p>
    ${pageBar(`<span class="small muted">${d.open} open comment${d.open === 1 ? '' : 's'} and suggestions · text updated ${asked(d.updated_at || '')}${d.updated_by ? ` by ${esc(d.updated_by)}` : ''}</span>`,
      `<button class="btn" data-comment="-1">${icon('message-square-plus')}Comment on the whole manifesto…</button>${admin ? '<button class="btn" id="medit">Edit the text…</button>' : ''}`)}
    <article class="manifesto card">${body}</article>
    ${d.general.length ? `<section class="stack" style="margin-top:24px;max-width:860px"><h2 style="margin:0">On the whole manifesto</h2>${mThreads(d.general, admin)}</section>` : ''}
    ${d.orphans.length ? `<section class="stack" style="margin-top:24px;max-width:860px"><h2 style="margin:0">On wording that has since changed</h2><p class="small muted" style="margin:0">These were on text that has been edited since.</p>
      ${d.orphans.map(c => `<div class="small muted" style="margin-top:6px">On: “${mdInline(c.block_text.slice(0, 200))}${c.block_text.length > 200 ? '…' : ''}”</div>${mThreads([c], admin)}`).join('')}</section>` : ''}`;
  const reload = () => { const y = scrollY; viewManifesto(main).then(() => scrollTo(0, y)); };
  const post = async body => { if (pub) guest.set({ name: body.name, family_id: body.family_id }); return api('/manifesto/comments', { body }); };
  const all = [...d.blocks.flatMap(b => b.comments), ...d.general, ...d.orphans], find = id => all.find(c => c.id == id);
  main.querySelectorAll('[data-comment]').forEach(x => x.onclick = () => { const i = Number(x.dataset.comment), b = d.blocks[i], canSuggest = b && b.type !== 'table';
    const m = openModal(`<form id="mcf"><h2>${b ? 'Comment on this part' : 'Comment on the whole manifesto'}</h2>
      ${b ? `<blockquote class="small mquote">${b.type === 'table' ? 'A table' : mdInline(b.text.length > 300 ? b.text.slice(0, 300) + '…' : b.text)}</blockquote>` : ''}
      ${canSuggest ? `<div class="field"><label>What would you like to do?</label><select name="kind"><option value="comment">Comment or ask a question</option><option value="suggestion">Suggest different wording</option></select></div>` : '<input type="hidden" name="kind" value="comment">'}
      <div class="field" id="msug" style="display:none"><label>Suggested wording</label><textarea name="suggestion" rows="5">${b ? esc(b.text) : ''}</textarea><p class="tiny muted" style="margin:4px 0 0">Change the words above. Text between **double stars** shows in bold.</p></div>
      <div class="field"><label id="mtl">Your comment</label><textarea name="text" rows="4" placeholder="What do you think?"></textarea></div>
      ${pub ? guestFields(d) : ''}
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Post</button></div></form>`, true);
    const f = $('#mcf', m), sync = () => { const s = f.kind.value === 'suggestion'; $('#msug', m).style.display = s ? '' : 'none'; $('#mtl', m).textContent = s ? 'Why (optional)' : 'Your comment'; };
    if (f.kind.tagName === 'SELECT') { f.kind.onchange = sync; sync(); }
    f.onsubmit = guard(async e => { e.preventDefault(); await post({ ...formData(f), block: i }); closeOverlay(); toast('Posted. Thank you'); reload(); }); });
  main.querySelectorAll('[data-mreply]').forEach(x => x.onclick = () => { const t = x.closest('.mthread');
    if (pub) { const m = openModal(`<form id="mrf"><h2>Reply</h2><div class="field"><label>Your reply</label><textarea name="text" rows="3" required></textarea></div>${guestFields(d)}
        <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Reply</button></div></form>`);
      $('#mrf', m).onsubmit = guard(async e => { e.preventDefault(); await post({ ...formData(e.target), parent_id: x.dataset.mreply }); closeOverlay(); toast('Replied'); reload(); }); return; }
    if ($('.mreplyf', t)) return;
    t.insertAdjacentHTML('beforeend', `<form class="mreplyf row" style="gap:8px;margin-top:8px"><input name="text" placeholder="Write a reply…" style="flex:1;min-width:180px" required><button class="btn sm primary">Reply</button></form>`);
    const f = $('.mreplyf', t); f.text.focus(); f.onsubmit = guard(async e => { e.preventDefault(); await api('/manifesto/comments', { body: { parent_id: x.dataset.mreply, text: f.text.value } }); toast('Replied'); reload(); }); });
  const act = (sel, action, msg, ask) => main.querySelectorAll(`[${sel}]`).forEach(x => x.onclick = guard(async () => { const id = x.getAttribute(sel), c = find(id);
    let note = ''; if (ask) { note = prompt(ask, ''); if (note === null) return; }
    await api(`/manifesto/comments/${id}/resolve`, { body: { action, note } }); toast(msg); reload(); }));
  act('data-maccept', 'accept', 'Accepted: the wording has been changed'); act('data-mdecline', 'decline', 'Declined', 'A note for whoever suggested it (optional):');
  act('data-mresolve', 'resolve', 'Marked as resolved'); act('data-mreopen', 'reopen', 'Reopened');
  main.querySelectorAll('[data-mdel]').forEach(x => x.onclick = guard(async () => { if (!confirm('Delete this, with any replies?')) return; await api('/manifesto/comments/' + x.dataset.mdel, { method: 'DELETE' }); toast('Deleted'); reload(); }));
  const ed = $('#medit', main); if (ed) ed.onclick = guard(async () => { const full = await api('/manifesto/versions'), cur = d.blocks;
    const m = openModal(`<form id="mef"><h2>Edit the manifesto</h2><p class="small muted" style="margin-top:0">Markdown: # and ## for headings, - for points, **bold**, *italic*, | for tables. Comments stay with the paragraphs whose wording doesn’t change; the rest are kept under “On wording that has since changed”. The text before each edit is kept.</p>
      <div class="field"><textarea name="body" rows="22" style="font-family:ui-monospace,monospace;font-size:13px"></textarea></div>
      ${full.length ? `<div class="field"><label>Earlier versions (${full.length})</label><div class="row" style="gap:8px;flex-wrap:wrap"><select id="mver" style="flex:1;min-width:200px">${full.map((v, k) => `<option value="${k}">${asked(v.edited_at || '')} · ${esc(v.edited_by || 'loaded')}</option>`).join('')}</select><button type="button" class="btn sm" id="mverLoad">Load into the form</button></div></div>` : ''}
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, true);
    const f = $('#mef', m); f.body.value = (await api('/manifesto/text')).body;
    const lv = $('#mverLoad', m); if (lv) lv.onclick = () => { f.body.value = full[$('#mver', m).value].body; toast('Earlier version loaded. Save to bring it back'); };
    f.onsubmit = guard(async e => { e.preventDefault(); await api('/manifesto', { method: 'PUT', body: { body: f.body.value } }); closeOverlay(); toast('Saved'); reload(); }); });
}

// ------------------------------------------------------------ the questionnaire (public: no login needed)
// "NAB: your house, your future". First, which generation you are; then that generation's questions. Filled in from the sign-in
// page, or from inside the portal (one response per login: sending again replaces it).
const GEN_COLOR = { founder: 'var(--gen-founder)', second: 'var(--gen-second)', third: 'var(--gen-third)' };
const letter = k => String.fromCharCode(65 + k);
const optText = (o, g) => (o.labels && o.labels[g]) || o.label;   // an option in a generation's own wording
function surveyQuestionHtml(qn, n, prev, gen) {
  const a = prev || {}, name = `q${qn.id}`;
  const head = `<legend><span class="qnum">${n}.</span> ${esc(qn.texts[gen] || qn.text)}</legend>${qn.help ? `<p class="small muted" style="margin:2px 0 8px">${esc(qn.help)}</p>` : ''}`;
  if (qn.kind === 'text') return `<fieldset class="sq" data-q="${qn.id}" data-kind="text">${head}<textarea name="${name}" rows="4" placeholder="Your comments">${esc(a.text || '')}</textarea></fieldset>`;
  if (qn.kind === 'allocation') return `<fieldset class="sq" data-q="${qn.id}" data-kind="allocation" data-total="${qn.total}" data-unit="${qn.unit || ''}">${head}<div class="table-wrap"><table class="alloc"><thead><tr><th>${qn.unit === 'points' ? 'What matters' : 'Improvement'}</th><th class="r">${qn.unit === 'points' ? 'Points' : 'Allocation (£)'}</th></tr></thead><tbody>
    ${qn.options.map((o, k) => `<tr><td>${esc(o.label)}${o.input === 'text' ? `<input name="${name}_other" placeholder="Please specify" value="${esc(a.other || '')}" style="margin-top:6px">` : ''}</td><td class="r"><input name="${name}_${k}" type="number" min="0" step="${qn.unit === 'points' ? 1 : 100}" inputmode="numeric" value="${a.amounts && a.amounts[k] ? a.amounts[k] : ''}" style="max-width:130px;text-align:right"></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td class="r num" data-sum></td></tr></tfoot></table></div></fieldset>`;
  const multi = qn.kind === 'multi', chosen = k => multi ? (a.choices || []).includes(k) : a.choice === k;
  return `<fieldset class="sq" data-q="${qn.id}" data-kind="${qn.kind}" ${qn.max ? `data-max="${qn.max}"` : ''}>${head}<div class="sopts">${qn.options.map((o, k) => `<label class="sopt"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${k}" ${chosen(k) ? 'checked' : ''}><span><b>${letter(k)}.</b> ${esc(optText(o, gen))}${o.hint ? `<small class="ohint">${esc(o.hint)}</small>` : ''}</span>
      ${o.input === 'amount' ? `<input class="sinput" name="${name}_in${k}" type="number" min="0" step="0.5" placeholder="£ thousand" value="${chosen(k) && a.input != null ? a.input : ''}">` : ''}</label>`).join('')}</div></fieldset>`;
}
async function renderSurvey() {
  closeOverlay(); document.body.classList.remove('menu-open');
  const slug = location.hash.split('?')[0].split('/')[2] || 'future', d = await api('/survey?s=' + encodeURIComponent(slug)), back = d.me ? '#/questionnaire' : '#/', pick = (/[?&]g=(\w+)/.exec(location.hash) || [])[1];
  const others = d.surveys.filter(x => x.slug !== d.slug && x.open), surveyHref = x => x === 'future' ? '#/survey' : `#/survey/${x}`;
  if (d.me) S.qs = d.slug;
  $('#app').innerHTML = `<div class="survey-page">${publicHead(d.me ? `<a class="btn sm ghost-light" href="${back}">Back to the portal</a>` : '<a class="btn sm ghost-light" href="#/manifesto">Manifesto</a><a class="btn sm ghost-light" href="#/">Home</a>')}
    <main class="survey-main" id="svm"></main></div>`;
  const m = $('#svm');
  if (!d.open) { m.innerHTML = `<h1>${esc(d.title)}</h1><div class="card empty">The questionnaire is closed at the moment. Thank you for your interest.</div>`; return; }
  const prev = d.mine, me = d.me || {};
  m.innerHTML = `<span class="eyebrow">Questionnaire</span><h1>${esc(d.title)}</h1><p class="lead">${esc(d.intro)}</p>
    ${prev ? `<div class="notice small" style="margin-bottom:16px">You filled this in on ${asked(prev.at)}. Your answers are below: sending again replaces them.</div>` : ''}
    <form id="svf" novalidate><section class="card stack"><h2 style="margin:0">About you</h2>
      <fieldset class="sq" data-kind="generation"><legend><span class="qnum">1.</span> Which generation are you?</legend><div class="gens">
        ${d.generations.map(g => `<label class="gen"><input type="radio" name="generation" value="${g.key}" ${(prev ? prev.generation === g.key : pick === g.key) ? 'checked' : ''} required><span><b>${esc(g.label)}</b><span class="small muted">${esc(g.help)}</span></span></label>`).join('')}</div></fieldset>
      <div class="grid-2" style="gap:12px"><div class="field"><label>Your family</label><select name="family_id" required><option value="">Choose…</option>${d.families.map(f => `<option value="${f.id}" ${String((prev || me).family_id || '') === String(f.id) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}<option value="other" ${prev && !prev.family_id ? 'selected' : ''}>Another family, or not listed</option></select>
          <input name="family_other" placeholder="Family name" value="${esc(prev && prev.family_other || '')}" style="margin-top:8px;${prev && !prev.family_id ? '' : 'display:none'}"></div>
        <div class="field"><label>Your name</label><input name="name" required maxlength="120" autocomplete="name" value="${esc((prev || me).name || '')}"></div>
        <div class="field"><label>Email (optional)</label><input name="email" type="email" maxlength="200" autocomplete="email" value="${esc((prev || me).email || '')}"></div></div>
      <div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div></section>
      <div id="svq"></div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn primary" id="svgo" disabled>Send my answers</button></div></form>`;
  const f = $('#svf'), qbox = $('#svq');
  const show = () => { const gen = f.generation.value; if (!gen) { qbox.innerHTML = '<div class="card flat empty small" style="margin-top:16px">Choose your generation to see your questions.</div>'; return; }
    $('#svgo').disabled = false; let sec = null, n = 1, html = '';
    for (const qn of d.questions.filter(x => x.versions.includes(gen))) {
      if (qn.section !== sec) { html += `${sec !== null ? '</section>' : ''}<section class="card stack" style="margin-top:16px"><h2 style="margin:0">${esc(qn.section || '')}</h2>`; sec = qn.section; }
      html += surveyQuestionHtml(qn, ++n, prev && prev.generation === gen ? prev.answers[qn.id] : null, gen); }
    qbox.innerHTML = html + (sec !== null ? '</section>' : '');
    // up to N choices; the amount box goes with its option; the £20,000 adds up as you go
    qbox.querySelectorAll('[data-max]').forEach(fs => { const max = Number(fs.dataset.max), boxes = [...fs.querySelectorAll('input[type=checkbox]')];
      const lim = () => { const c = boxes.filter(b => b.checked).length; boxes.forEach(b => b.disabled = !b.checked && c >= max); }; boxes.forEach(b => b.onchange = lim); lim(); });
    qbox.querySelectorAll('[data-kind=allocation]').forEach(fs => { const total = Number(fs.dataset.total), pts = fs.dataset.unit === 'points', u = n => pts ? `${n.toLocaleString('en-GB')}` : `£${n.toLocaleString('en-GB')}`;
      const sum = () => { const t = [...fs.querySelectorAll('input[type=number]')].reduce((x, i) => x + (Number(i.value) || 0), 0), el = $('[data-sum]', fs);
      el.textContent = `${u(t)} of ${u(total)}${pts ? ' points' : ''}${t && t !== total ? (t > total ? ` · ${u(t - total)} too many` : ` · ${u(total - t)} left`) : ''}`; el.style.color = t > total ? 'var(--st-alert-ink)' : ''; };
      fs.querySelectorAll('input[type=number]').forEach(i => i.oninput = sum); sum(); });
    qbox.querySelectorAll('.sinput').forEach(i => i.onfocus = () => { const r = i.closest('.sopt').querySelector('input[type=radio]'); if (r) r.checked = true; });
  };
  f.querySelectorAll('[name=generation]').forEach(r => r.onchange = show); show();
  f.family_id.onchange = () => { f.family_other.style.display = f.family_id.value === 'other' ? '' : 'none'; };
  f.onsubmit = guard(async e => { e.preventDefault();
    if (!f.generation.value) throw new Error('Say which generation you are'); if (!f.family_id.value) throw new Error('Choose your family'); if (!f.name.value.trim()) throw new Error('Enter your name');
    const answers = {};
    qbox.querySelectorAll('.sq[data-q]').forEach(fs => { const id = fs.dataset.q, kind = fs.dataset.kind;
      if (kind === 'text') { const t = fs.querySelector('textarea').value.trim(); if (t) answers[id] = { text: t }; }
      else if (kind === 'allocation') { const am = [...fs.querySelectorAll('tbody input[type=number]')].map(i => Number(i.value) || 0); if (am.some(Boolean)) answers[id] = { amounts: am, other: (fs.querySelector(`[name=q${id}_other]`) || {}).value || '' }; }
      else if (kind === 'multi') { const cs = [...fs.querySelectorAll('input[type=checkbox]:checked')].map(i => Number(i.value)); if (cs.length) answers[id] = { choices: cs }; }
      else { const c = fs.querySelector('input[type=radio]:checked'); if (c) { const inp = fs.querySelector(`[name=q${id}_in${c.value}]`); answers[id] = { choice: Number(c.value), ...(inp && inp.value !== '' ? { input: Number(inp.value) } : {}) }; } } });
    const b = $('#svgo'); b.disabled = true;
    try { const r = await api('/survey', { body: { survey: d.slug, generation: f.generation.value, family_id: f.family_id.value, family_other: f.family_other.value, name: f.name.value, email: f.email.value, website: f.website.value, answers } });
      m.innerHTML = `<span class="eyebrow">Questionnaire</span><h1>Thank you</h1><p class="lead">Your answers have been ${r.updated ? 'updated' : 'saved'}. The families will see a summary of everyone’s answers in the portal, by family and generation.</p>
        <div class="row" style="gap:8px"><a class="btn primary" href="${back}">${d.me ? 'See the results' : 'Back to the home page'}</a>${others.map(x => `<a class="btn" href="${surveyHref(x.slug)}">Next: ${esc(x.title)}</a>`).join('')}${d.me ? '' : `<a class="btn" href="#/manifesto">Read the Manifesto</a><a class="btn" href="${surveyHref(d.slug)}" id="again">Fill in another</a>`}</div>`;
      scrollTo(0, 0); const ag = $('#again'); if (ag) ag.onclick = e => { e.preventDefault(); renderSurvey(); };
    } finally { b.disabled = false; } });
}

// ------------------------------------------------------------ questionnaire results (inside the portal)
// Who has answered (by family and generation) and a summary of each question. Bars are the share of people asked who chose each
// answer; with every generation showing, each bar is split by generation (founders, second, third), with the numbers beside it.
const GENS = ['founder', 'second', 'third'], GEN_NAME = { founder: 'Founders', second: 'Second generation', third: 'Third generation' };
const genDot = g => `<i class="gdot" style="background:${GEN_COLOR[g]}"></i>`;
const genList = vs => vs.length === 3 ? 'all three generations' : vs.map(g => GEN_NAME[g].toLowerCase()).join(' and ');
// who a question was asked of: a clear badge when it was only one generation
const askedOf = qn => qn.versions.length === 1 ? `<span class="badge only" style="--gc:${GEN_COLOR[qn.versions[0]]}">${genDot(qn.versions[0])}Only asked of ${qn.versions[0] === 'founder' ? 'founder members' : `the ${GEN_NAME[qn.versions[0]].toLowerCase()}`}</span>`
  : `<span class="tiny muted">Asked of ${genList(qn.versions)}: ${qn.versions.map(g => genDot(g)).join('')}</span>`;
// each generation's wording of the question (and of any answer worded differently)
const howAsked = qn => { if (qn.versions.length < 2) return '';
  const diff = (qn.options || []).filter(o => o.labels && Object.keys(o.labels).length);
  return `<details class="small" style="margin-top:8px"><summary class="muted" style="cursor:pointer">How each generation was asked</summary><div class="stack" style="gap:6px;margin-top:6px">
    ${qn.versions.map(g => `<div>${genDot(g)}<b>${GEN_NAME[g]}:</b> ${esc(qn.texts[g])}${diff.length ? `<div class="tiny muted" style="margin-left:15px">${diff.map(o => `“${esc(optText(o, g))}”`).join(' · ')}</div>` : ''}</div>`).join('')}</div></details>`; };
const unitText = (n, qn) => qn.unit === 'points' ? `${Math.round(n).toLocaleString('en-GB')} points` : `£${Math.round(n).toLocaleString('en-GB')}`;
// each family's answers: how many of its people chose each option, or its average share-out
function qFamilies(qn) {
  if (!qn.by_family || !qn.by_family.length) return '';
  const head = qn.kind === 'allocation' ? qn.options.map(o => `<th class="r" title="${esc(o.label)}">${esc(o.label.length > 18 ? o.label.slice(0, 17) + '…' : o.label)}</th>`).join('') : qn.options.map((o, k) => `<th class="r" title="${esc(o.label)}">${letter(k)}</th>`).join('');
  const rows = qn.by_family.map(f => `<tr><td>${esc(f.name)} <span class="tiny muted">(${f.n})</span></td>${qn.kind === 'allocation' ? f.avgs.map(v => `<td class="r num">${v ? unitText(v, qn) : '–'}</td>`).join('')
    : f.counts.map(c => `<td class="r num ${c ? '' : 'muted'}">${c ? `<b>${c}</b>` : '–'}</td>`).join('')}</tr>`).join('');
  return `<details class="small" style="margin-top:8px"><summary class="muted" style="cursor:pointer">Each family’s answers</summary><div class="table-wrap" style="margin-top:6px"><table class="famtable"><thead><tr><th>Family (people)</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    ${qn.kind === 'allocation' ? '' : `<p class="tiny muted" style="margin:4px 0 0">${qn.options.map((o, k) => `${letter(k)}: ${esc(o.label)}`).join(' · ')}</p>`}</details>`;
}
function qChart(qn, split) {
  const gs = GENS.filter(g => qn.versions.includes(g)), stacked = split && gs.length > 1, one = gs.length === 1 ? GEN_COLOR[gs[0]] : 'var(--chart-single)';
  if (qn.kind === 'allocation') { const max = Math.max(1, ...qn.options.map(o => o.avg));
    return `<div class="qchart">${qn.options.map(o => `<div class="qrow" title="${esc(o.label)}: average ${unitText(o.avg, qn)}${gs.length > 1 ? ' · ' + gs.map(g => `${GEN_NAME[g]} ${o.by[g] == null ? '–' : unitText(o.by[g], qn)}`).join(', ') : ''}">
      <div class="qlabel small">${esc(o.label)}</div><div class="qbar"><div class="qtrack">${o.avg ? `<span class="seg" style="width:${o.avg / max * 100}%;background:${one}"></span>` : ''}</div><span class="qval small num">${unitText(o.avg, qn)}</span></div></div>`).join('')}</div>
      <p class="tiny muted" style="margin:6px 0 0">Average of ${qn.n} answer${qn.n === 1 ? '' : 's'}, out of ${unitText(qn.total, qn)}.</p>
      ${qn.other.length ? `<div class="small" style="margin-top:8px"><b>Other improvements suggested</b>${qn.other.map(o => `<div>“${esc(o.text)}” <span class="muted">· ${esc(o.family)}, ${esc(o.generation.toLowerCase())}</span></div>`).join('')}</div>` : ''}`; }
  return `<div class="qchart">${qn.options.map((o, k) => { const pct = qn.n ? o.count / qn.n * 100 : 0;
    const segs = stacked ? gs.filter(g => o.by[g]).map(g => `<span class="seg" style="width:${o.by[g] / qn.n * 100}%;background:${GEN_COLOR[g]}"></span>`).join('') : pct ? `<span class="seg" style="width:${pct}%;background:${one}"></span>` : '';
    return `<div class="qrow" title="${esc(o.label)}: ${o.count} of ${qn.n}${stacked ? ' · ' + gs.map(g => `${GEN_NAME[g]} ${o.by[g]}`).join(', ') : ''}">
      <div class="qlabel small"><b>${letter(k)}.</b> ${esc(o.label)}${o.amount_avg != null ? ` <span class="muted">· on average £${o.amount_avg.toLocaleString('en-GB')} thousand (${o.amount_n})</span>` : ''}</div>
      <div class="qbar"><div class="qtrack">${segs}</div><span class="qval small num">${o.count} · ${Math.round(pct)}%</span></div></div>`; }).join('')}</div>`;
}
// the same numbers as a table (for anyone who can't tell the colours apart, or wants the detail)
function qNumbers(qn) {
  const gs = GENS.filter(g => qn.versions.includes(g));
  if (qn.kind === 'text') return '';
  const head = `<tr><th>${qn.kind === 'allocation' ? 'Improvement' : 'Answer'}</th><th class="r">${qn.kind === 'allocation' ? 'Average' : 'All'}</th>${gs.length > 1 ? gs.map(g => `<th class="r">${GEN_NAME[g]}</th>`).join('') : ''}</tr>`;
  const rows = qn.options.map((o, k) => qn.kind === 'allocation' ? `<tr><td>${esc(o.label)}</td><td class="r num">${unitText(o.avg, qn)}</td>${gs.length > 1 ? gs.map(g => `<td class="r num">${o.by[g] == null ? '–' : unitText(o.by[g], qn)}</td>`).join('') : ''}</tr>`
    : `<tr><td>${letter(k)}. ${esc(o.label)}</td><td class="r num">${o.count}</td>${gs.length > 1 ? gs.map(g => `<td class="r num">${o.by[g]}</td>`).join('') : ''}</tr>`).join('');
  return `<details class="small" style="margin-top:8px"><summary class="muted" style="cursor:pointer">The numbers</summary><div class="table-wrap" style="margin-top:6px"><table>${head}${rows}</table></div></details>`;
}
async function viewQuestionnaire(main) {
  const admin = isSite(), view = admin && ['responses', 'questions'].includes(S.qview) ? S.qview : 'results', slug = S.qs || 'future';
  const surveys = S.surveys || (S.surveys = (await api('/survey?s=future')).surveys), cur = surveys.find(x => x.slug === slug) || surveys[0];
  const which = `<div class="seg" aria-label="Questionnaire">${surveys.map(x => `<button data-qs="${x.slug}" class="${x.slug === cur.slug ? 'on' : ''}">${esc(x.slug === 'future' ? 'Your house, your future' : x.title.replace(/:.*$/, ''))}</button>`).join('')}</div>`;
  const seg = admin ? `<div class="seg" aria-label="View">${[['results', 'Results'], ['responses', 'Responses'], ['questions', 'Questions']].map(([k, l]) => `<button data-qv="${k}" class="${k === view ? 'on' : ''}">${l}</button>`).join('')}</div>` : '';
  const head = (bar, right = '') => `<h1>Questionnaire</h1><p class="muted" style="max-width:75ch">Answers to the questionnaires on the home page: “${esc(cur.title)}”${cur.slug === 'future' ? ', where founders, the second generation and the third each have their own questions' : ', on how each family would like weeks to change hands'}.${admin ? '' : ' Names aren’t shown here: only families and generations.'} Open “Each family’s answers” under a question to compare the families.</p>
    <div style="margin-bottom:12px">${which}</div>
    ${pageBar(`${seg}${bar}`, `${right}<a class="btn" href="${cur.slug === 'future' ? '#/survey' : '#/survey/' + cur.slug}">${icon('list-checks')}Fill in the questionnaire</a>`)}`;
  const reload = () => viewQuestionnaire(main);
  const bindTop = () => { main.querySelectorAll('[data-qv]').forEach(b => b.onclick = () => { S.qview = b.dataset.qv; reload(); });
    main.querySelectorAll('[data-qs]').forEach(b => b.onclick = () => { S.qs = b.dataset.qs; reload(); }); };
  if (view === 'responses') return admResponses(main, head, bindTop, reload, cur.slug);
  if (view === 'questions') return admQuestions(main, head, bindTop, reload, cur.slug);
  const gf = S.qgen || '', ff = S.qfam || '';
  const d = await api(`/survey/results?s=${cur.slug}&generation=${gf}&family=${ff}`);
  const filters = `<div class="seg" aria-label="Generation">${[['', 'All generations'], ...d.generations.map(g => [g.key, g.label])].map(([k, l]) => `<button data-qg="${k}" class="${k === gf ? 'on' : ''}">${l}</button>`).join('')}</div>
    <select id="qfam" aria-label="Family" style="width:auto"><option value="">All families</option>${d.family_list.map(f => `<option value="${f.id}" ${String(f.id) === String(ff) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
  let sec = null, body = '';
  for (const qn of d.questions) {
    if (qn.section !== sec) { body += `<h2 style="margin:24px 0 8px">${esc(qn.section || '')}</h2>`; sec = qn.section; }
    body += `<div class="card qcard ${qn.versions.length === 1 ? 'one-gen' : ''}" ${qn.versions.length === 1 ? `style="--gc:${GEN_COLOR[qn.versions[0]]}"` : ''}><div class="row between" style="align-items:flex-start;gap:12px"><b>${esc(qn.text)}</b><span class="tiny muted" style="white-space:nowrap">${qn.n} of ${qn.asked} answered</span></div>
      <div class="row" style="gap:8px;margin:4px 0 10px">${askedOf(qn)}${qn.max ? '<span class="tiny muted">Up to ' + qn.max + ' choices each, so the shares add up to more than 100%</span>' : ''}</div>
      ${!qn.n ? '<div class="small muted">No answers yet.</div>' : qn.kind === 'text' ? `<div class="stack" style="gap:8px">${qn.comments.map(c => `<blockquote class="qquote small">“${esc(c.text)}”<span class="muted"> · ${esc(c.family)}, ${esc(c.generation.toLowerCase())}</span></blockquote>`).join('')}</div>` : qChart(qn, !gf) + qNumbers(qn) + qFamilies(qn)}${howAsked(qn)}</div>`;
  }
  main.innerHTML = `${head(filters)}
    <section class="qstats"><div class="card stat"><span class="eyebrow">Responses</span><b class="num">${d.total}</b><span class="tiny muted">${d.open ? 'The questionnaire is open' : 'The questionnaire is closed'}${d.last ? ` · latest ${asked(d.last)}` : ''}</span></div>
      ${d.generations.map(g => `<div class="card stat"><span class="eyebrow">${genDot(g.key)} ${esc(g.label)}</span><b class="num">${d.by_generation[g.key]}</b><span class="tiny muted">${d.total ? Math.round(d.by_generation[g.key] / d.total * 100) : 0}% of responses</span></div>`).join('')}</section>
    <div class="grid-2" style="align-items:start;margin-top:16px"><div class="card"><h3>Who has answered</h3><div class="table-wrap"><table><thead><tr><th>Family</th>${GENS.map(g => `<th class="r">${genDot(g)}${GEN_NAME[g].replace(' generation', '')}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
      ${d.families.map(f => `<tr><td>${esc(f.name)}</td>${GENS.map(g => `<td class="r num ${f[g] ? '' : 'muted'}">${f[g]}</td>`).join('')}<td class="r num"><b>${f.total}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td>${GENS.map(g => `<td class="r num">${d.by_generation[g]}</td>`).join('')}<td class="r num">${d.total}</td></tr></tfoot></table></div></div>
      <div class="card"><h3>Reading the results</h3><p class="small muted" style="margin-top:0">${gf || ff ? `Showing ${d.filtered} response${d.filtered === 1 ? '' : 's'}${gf ? ` from the ${GEN_NAME[gf].toLowerCase()}` : ''}${ff ? ` in the ${esc((d.family_list.find(x => String(x.id) === String(ff)) || {}).name || '')} family` : ''}.` : `Showing all ${d.total} responses.`}
        Each generation was asked the same underlying questions in its own words; a few questions were for one generation only, and are marked. Each bar is the share of the people asked that question who chose that answer.${gf ? '' : ' Bars are split by generation:'}</p>
        ${gf ? '' : `<div class="legend small">${GENS.map(g => `<span>${genDot(g)}${GEN_NAME[g]}</span>`).join('')}</div>`}
        <p class="small muted" style="margin-bottom:0">Hover over a bar for the detail, or open “The numbers” under each question.</p></div></div>
    ${d.total ? body : '<div class="card empty" style="margin-top:16px">No one has filled in the questionnaire yet. It’s on the sign-in page, and the button above.</div>'}`;
  bindTop();
  main.querySelectorAll('[data-qg]').forEach(b => b.onclick = () => { S.qgen = b.dataset.qg; reload(); });
  $('#qfam', main).onchange = e => { S.qfam = e.target.value; reload(); };
}
async function admResponses(main, head, bindTop, reload, slug) {
  const rs = await api('/admin/survey/responses?s=' + slug);
  main.innerHTML = `${head('', `<a class="btn" href="/api/admin/survey/export?s=${slug}">Download as a spreadsheet (CSV)</a>`)}
    ${rs.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Name</th><th>Family</th><th>Generation</th><th class="r">Answers</th><th></th></tr></thead><tbody>
      ${rs.map(r => `<tr><td class="small">${asked(r.at)}</td><td>${esc(r.name)}${r.email ? `<div class="tiny muted">${esc(r.email)}</div>` : ''}${r.by_login ? '<div class="tiny muted">from their login</div>' : ''}</td><td>${esc(r.family)}</td><td>${esc(r.generation)}</td><td class="r num">${r.answers.length}</td>
        <td class="r" style="white-space:nowrap"><button class="btn sm" data-rview="${r.id}">View</button> <button class="btn sm danger" data-rdel="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="card empty">No responses yet.</div>'}`;
  bindTop();
  main.querySelectorAll('[data-rview]').forEach(x => x.onclick = () => { const r = rs.find(y => y.id == x.dataset.rview);
    openModal(`<h2>${esc(r.name)}</h2><p class="small muted" style="margin-top:0">${esc(r.family)} · ${esc(r.generation)} · ${asked(r.at)}${r.email ? ` · ${esc(r.email)}` : ''}</p>
      <div class="stack" style="gap:10px">${r.answers.map(a => `<div class="small"><b>${esc(a.question)}</b><div style="white-space:pre-line">${esc(a.answer)}</div></div>`).join('') || '<div class="small muted">No answers</div>'}</div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-close>Close</button></div>`, true); });
  main.querySelectorAll('[data-rdel]').forEach(x => x.onclick = guard(async () => { if (!confirm('Delete this response? Use it for duplicates or tests.')) return; await api('/admin/survey/responses/' + x.dataset.rdel, { method: 'DELETE' }); toast('Deleted'); reload(); }));
}
async function admQuestions(main, head, bindTop, reload, slug) {
  const [qs, all] = await Promise.all([api('/admin/survey/questions?s=' + slug), api('/survey?s=' + slug)]), link = `${location.origin}/#/survey${slug === 'future' ? '' : '/' + slug}`;
  const s = { survey_open: all.open ? '1' : '0', survey_title: all.title, survey_intro: all.intro };
  const sections = [...new Set(qs.map(x => x.section).filter(Boolean))];
  main.innerHTML = `${head('', `<button class="btn" data-qadd>${icon('plus')}Add a question…</button>`)}
    <div class="grid-2" style="align-items:start;margin-bottom:16px"><form class="card" id="qsf"><h3>This questionnaire</h3>
      <label class="check"><input type="checkbox" name="survey_open" ${s.survey_open !== '0' ? 'checked' : ''}><span><b>Open</b>Shown on the sign-in page, and anyone with the link can fill it in.</span></label>
      <div class="field" style="margin-top:12px"><label>Title</label><input name="survey_title" value="${esc(s.survey_title || '')}"></div>
      <div class="field"><label>Introduction</label><textarea name="survey_intro" rows="4">${esc(s.survey_intro || '')}</textarea></div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary">Save</button></div></form>
      <div class="card"><h3>Link to share</h3><p class="small muted" style="margin-top:0">No login is needed; it’s also on the home page. The first question is which generation someone is; each generation then sees the questions marked for it below (F, 2 and 3).</p>
        <div class="row" style="gap:8px"><input value="${esc(link)}" readonly style="flex:1;min-width:200px" id="qlink"><button class="btn sm" id="qcopy">${icon('copy')}Copy</button></div></div></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Question</th><th>Kind</th><th>Asked of</th><th class="r">Answers</th><th></th></tr></thead><tbody>
      ${qs.map((x, k) => `<tr class="${x.active ? '' : 'muted'}"><td class="num">${k + 1}</td><td><div class="tiny muted">${esc(x.section || '')}</div>${esc(x.text)}${x.active ? '' : ' <span class="badge">Switched off</span>'}${x.versions.length > 1 ? `<div class="tiny muted">Worded for each generation it’s asked of</div>` : ''}</td>
        <td class="small">${{ single: 'One answer', multi: x.max ? `Up to ${x.max}` : 'Several', allocation: `Share ${unitText(x.total, x)}`, text: 'Comments' }[x.kind]}</td>
        <td style="white-space:nowrap">${GENS.map(g => x.versions.includes(g) ? `<span class="tag" title="${GEN_NAME[g]}">${genDot(g)}${{ founder: 'F', second: '2', third: '3' }[g]}</span>` : '').join(' ')}</td><td class="r num">${x.answers}</td>
        <td class="r" style="white-space:nowrap"><button class="iconbtn" data-qmove="${x.id}" data-dir="up" title="Move up" ${k ? '' : 'disabled'}>↑</button><button class="iconbtn" data-qmove="${x.id}" data-dir="down" title="Move down" ${k < qs.length - 1 ? '' : 'disabled'}>↓</button> <button class="btn sm" data-qedit="${x.id}">Edit…</button></td></tr>`).join('')}</tbody></table></div>
    <p class="tiny muted">Answers are kept against each option’s position, so reword options freely but avoid reordering them once answers have come in.</p>`;
  bindTop();
  $('#qsf', main).onsubmit = guard(async e => { e.preventDefault(); const f = e.target; await api('/admin/surveys/' + slug, { method: 'PUT', body: { open: f.survey_open.checked, title: f.survey_title.value, intro: f.survey_intro.value } }); S.surveys = null; toast('Saved'); reload(); });
  $('#qcopy', main).onclick = () => { $('#qlink', main).select(); try { navigator.clipboard.writeText(link); } catch { document.execCommand('copy'); } toast('Link copied'); };
  main.querySelectorAll('[data-qmove]').forEach(x => x.onclick = guard(async () => { await api(`/admin/survey/questions/${x.dataset.qmove}/move`, { body: { dir: x.dataset.dir } }); reload(); }));
  const edit = x => () => {
    const opt0 = x ? x.options : [{ label: '' }, { label: '' }];
    const row = (o = {}) => `<tr><td><input data-o="label" value="${esc(o.label || '')}" placeholder="In the results"><input data-o="hint" class="ohint-in" value="${esc(o.hint || '')}" placeholder="Description (optional)"></td>${GENS.map(g => `<td><input data-o="${g}" value="${esc((o.labels || {})[g] || '')}" placeholder="Same"></td>`).join('')}
      <td><select data-o="input"><option value="">–</option><option value="amount" ${o.input === 'amount' ? 'selected' : ''}>Amount box</option><option value="text" ${o.input === 'text' ? 'selected' : ''}>Words box</option></select></td><td><button type="button" class="iconbtn" data-orm title="Remove">${icon('trash-2')}</button></td></tr>`;
    const m = openModal(`<form id="qef"><h2>${x ? 'Edit the question' : 'Add a question'}</h2>${x && x.answers ? `<p class="small muted" style="margin-top:0">${x.answers} answer${x.answers === 1 ? '' : 's'} so far.</p>` : ''}
      <div class="grid-2" style="gap:12px"><div class="field"><label>Section</label><input name="section" list="qsecs" value="${esc(x ? x.section || '' : '')}"><datalist id="qsecs">${sections.map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>
        <div class="field"><label>Kind</label><select name="kind">${[['single', 'Choose one answer'], ['multi', 'Choose several'], ['allocation', 'Share out a sum of money'], ['text', 'Comments']].map(([k, l]) => `<option value="${k}" ${x && x.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label>The question, as it’s shown in the results</label><input name="text" required value="${esc(x ? x.text : '')}" placeholder="e.g. Keeping the family’s shares"></div>
      <p class="small muted" style="margin:0 0 8px">Word it for each generation it’s asked of, so it relates to them; leave a generation blank to not ask it.</p>
      ${GENS.map(g => `<div class="field"><label>${genDot(g)}${GEN_NAME[g]}</label><textarea name="t_${g}" rows="2" placeholder="Not asked of the ${GEN_NAME[g].toLowerCase()}">${esc(x && x.texts[g] || '')}</textarea></div>`).join('')}
      <div class="field"><label>Help (optional)</label><input name="help" value="${esc(x ? x.help || '' : '')}"></div>
      <div class="field" id="qopts"><label>Options</label><p class="tiny muted" style="margin:0 0 6px">The first column is how each answer is shown in the results, with an optional line under it on the form saying what it means; give a generation its own wording where it helps. Keep them in the same order once answers have come in.</p>
        <div class="table-wrap"><table class="qotable"><thead><tr><th>In the results</th>${GENS.map(g => `<th>${genDot(g)}${{ founder: 'Founders', second: 'Second', third: 'Third' }[g]}</th>`).join('')}<th>Box</th><th></th></tr></thead><tbody>${opt0.map(row).join('')}</tbody></table></div>
        <button type="button" class="btn sm" id="qoadd" style="margin-top:6px">${icon('plus')}Add an option</button></div>
      <div class="grid-2" style="gap:12px"><div class="field" id="qmax"><label>Choose up to</label><input name="max" type="number" min="1" value="${x && x.max || 3}"></div><div class="field" id="qtot"><label>Sum to share out</label><div class="row" style="gap:8px"><input name="total" type="number" min="1" value="${x && x.total || 20000}" style="flex:1"><select name="unit" style="width:auto"><option value="">£</option><option value="points" ${x && x.unit === 'points' ? 'selected' : ''}>points</option></select></div></div></div>
      ${x ? `<label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}><span><b>In use</b>Switch off to stop asking it; its answers stay.</span></label>` : ''}
      <div class="row between" style="gap:8px;margin-top:12px">${x ? '<button type="button" class="btn sm danger" id="qdel">Delete</button>' : '<span></span>'}<span class="row" style="gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${x ? 'Save' : 'Add'}</button></span></div></form>`, true);
    const f = $('#qef', m), body = $('.qotable tbody', m), sync = () => { const k = f.kind.value; $('#qopts', m).style.display = k === 'text' ? 'none' : ''; $('#qmax', m).style.display = k === 'multi' ? '' : 'none'; $('#qtot', m).style.display = k === 'allocation' ? '' : 'none'; };
    const bindRm = () => body.querySelectorAll('[data-orm]').forEach(b => b.onclick = () => b.closest('tr').remove());
    $('#qoadd', m).onclick = () => { body.insertAdjacentHTML('beforeend', row()); bindRm(); }; bindRm();
    f.kind.onchange = sync; sync();
    f.onsubmit = guard(async e => { e.preventDefault(); const v = formData(f);
      const out = { survey: slug, unit: v.unit, section: v.section, kind: v.kind, text: v.text, help: v.help, max: v.max, total: v.total, texts: Object.fromEntries(GENS.map(g => [g, v['t_' + g]])),
        options: [...body.querySelectorAll('tr')].map(tr => { const get = k => tr.querySelector(`[data-o="${k}"]`).value; return { label: get('label'), hint: get('hint'), labels: Object.fromEntries(GENS.map(g => [g, get(g)])), input: get('input') }; }) };
      if (x) out.active = f.active.checked;
      await api(x ? `/admin/survey/questions/${x.id}` : '/admin/survey/questions', { method: x ? 'PUT' : 'POST', body: out }); closeOverlay(); toast('Saved'); reload(); });
    const del = $('#qdel', m); if (del) del.onclick = guard(async () => { if (!confirm('Delete this question? If anyone has answered it, it’s switched off instead so the answers stay.')) return;
      const r = await api('/admin/survey/questions/' + x.id, { method: 'DELETE' }); closeOverlay(); toast(r.switched_off ? 'Switched off (it has answers)' : 'Deleted'); reload(); }); };
  $('[data-qadd]', main).onclick = edit(null);
  main.querySelectorAll('[data-qedit]').forEach(b => b.onclick = edit(qs.find(x => x.id == b.dataset.qedit)));
}

// ------------------------------------------------------------ meetings: agendas, questions, polls and minutes
// The next meeting's agenda (with questions from the families and polls' results), polls of the family admins, and past minutes.
const longDate = d => `${dfmt(d, { weekday: 'long' })} ${dfmt(d, { day: 'numeric', month: 'long', year: 'numeric' })}`;   // Saturday 10 April 2027
// minutes and details: paragraphs, - points and # headings
const mdLite = t => { const out = []; let para = [], list = [];
  const endPara = () => { if (para.length) out.push(`<p>${para.map(mdInline).join('<br>')}</p>`); para = []; };
  const endList = () => { if (list.length) out.push(`<ul>${list.map(l => `<li>${mdInline(l)}</li>`).join('')}</ul>`); list = []; };
  for (const line of String(t || '').replace(/\r/g, '').split('\n')) { let x;
    if (!line.trim()) { endPara(); endList(); }
    else if ((x = /^#{1,3}\s+(.*)$/.exec(line))) { endPara(); endList(); out.push(`<h4>${mdInline(x[1])}</h4>`); }
    else if ((x = /^\s*[-*•]\s+(.*)$/.exec(line))) { endPara(); list.push(x[1]); }
    else { endList(); para.push(line); } }
  endPara(); endList(); return out.join(''); };
const ITEM_BADGE = { question: f => `<span class="badge blue">Question${f ? ` from the ${esc(f)} family` : ''}</span>`, poll: () => '<span class="badge green">Poll result</span>', item: () => '' };
function agendaHtml(m, admin) {
  if (!m.agenda.length && !m.put_forward.length) return '<p class="small muted">Nothing on the agenda yet.</p>';
  return `<ol class="agenda">${m.agenda.map((i, k) => `<li data-item="${i.id}"><div class="agenda-row"><div style="min-width:0"><b>${esc(i.title)}</b> ${ITEM_BADGE[i.kind](i.family)}
      ${i.kind === 'question' ? `<div class="tiny muted">${esc(i.by)} · ${asked(i.created_at)}</div>` : ''}${i.details ? `<div class="small" style="margin-top:4px;white-space:pre-line">${esc(i.details)}</div>` : ''}</div>
      <div class="agenda-acts">${admin ? `<button class="btn sm" data-imove="${i.id}" data-dir="up" title="Move up" aria-label="Move up" ${k ? '' : 'disabled'}>↑</button><button class="btn sm" data-imove="${i.id}" data-dir="down" title="Move down" aria-label="Move down" ${k < m.agenda.length - 1 ? '' : 'disabled'}>↓</button><button class="btn sm" data-iedit="${i.id}">Edit…</button>` : ''}
        ${i.can_withdraw ? `<button class="btn sm danger" data-idel="${i.id}">Withdraw</button>` : ''}</div></div></li>`).join('')}</ol>
    ${m.put_forward.length ? `<div class="small" style="margin-top:12px"><b>Costs put forward for the service charge, for the AGM to agree</b><ul style="margin:4px 0 0">${m.put_forward.map(c => `<li>${esc(c.title)}: ${money(c.amount, 2)} (${c.year})</li>`).join('')}</ul><p class="tiny muted" style="margin:4px 0 0">From the Service charge page.</p></div>` : ''}`;
}
function pollCard(p) {
  const r = p.result, open = p.status === 'open', max = Math.max(1, ...r.options.map(o => o.families.length));
  return `<div class="card flat poll" data-poll="${p.id}" style="padding:16px"><div class="row between" style="align-items:flex-start;gap:12px"><b>${esc(p.question)}</b>${open ? `<span class="badge amber">Open${p.closes_on ? ` until ${dfmt(p.closes_on)}` : ''}</span>` : '<span class="badge">Closed</span>'}</div>
    ${p.details ? `<div class="small" style="margin-top:6px;white-space:pre-line">${esc(p.details)}</div>` : ''}
    <div class="qchart" style="margin-top:10px">${r.options.map((o, k) => `<div class="qrow" title="${esc(o.families.join(', ') || 'No families')}"><div class="qlabel small"><b>${letter(k)}.</b> ${esc(o.label)}</div>
      <div class="qbar"><div class="qtrack">${o.families.length ? `<span class="seg" style="width:${o.families.length / r.families * 100}%;background:var(--chart-single)"></span>` : ''}</div><span class="qval small num">${o.families.length} · ${o.shares} sh</span></div></div>`).join('')}</div>
    <p class="tiny muted" style="margin:6px 0 0">${r.voted} of ${r.families} families have voted (one vote each; “sh” is the shares they hold, of ${r.total_shares}).${open && r.waiting.length ? ` Waiting for: ${esc(r.waiting.join(', '))}.` : ''}</p>
    ${r.comments.length ? `<div class="small" style="margin-top:6px">${r.comments.map(c => `<div>${esc(c.family)}: “${esc(c.text)}”</div>`).join('')}</div>` : ''}
    ${p.can_vote ? `<form class="pollf" data-pid="${p.id}" style="margin-top:10px"><div class="sopts">${r.options.map((o, k) => `<label class="sopt"><input type="radio" name="choice" value="${k}" ${p.my_vote && p.my_vote.choice === k ? 'checked' : ''} required><span><b>${letter(k)}.</b> ${esc(o.label)}</span></label>`).join('')}</div>
      <input name="comment" placeholder="A comment for the meeting (optional)" value="${esc(p.my_vote && p.my_vote.comment || '')}" style="margin-top:8px"><div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px">${p.my_vote ? `<span class="tiny muted">Your family voted (${esc(p.my_vote.by)}). You can change it.</span>` : ''}<button class="btn sm primary">${p.my_vote ? 'Change our vote' : 'Vote for our family'}</button></div></form>`
      : open && !p.my_vote ? '<p class="tiny muted" style="margin:6px 0 0">Family admins vote for their family.</p>' : ''}
    ${!open ? `<p class="tiny muted" style="margin:6px 0 0">Closed ${asked(p.closed_at || p.created_at)}; the result went on the agenda${p.meeting ? ` for the ${esc(p.meeting)}` : ' for the next meeting'}.</p>` : ''}
    ${p.can_close ? `<div class="row" style="gap:8px;margin-top:10px"><button class="btn sm green" data-pclose="${p.id}">Close and add to the agenda…</button><button class="btn sm danger" data-pdel="${p.id}">Delete</button></div>` : ''}</div>`;
}
async function viewMeetings(main) {
  const d = await api('/meetings'), admin = d.can_manage, n = d.next, open = d.polls.filter(p => p.status === 'open'), shut = d.polls.filter(p => p.status !== 'open');
  const meetingHead = m => `<span class="eyebrow">${esc(m.kind_label)}${m.held ? ' · held' : ''}</span><h2 style="margin:2px 0 2px">${esc(m.title)}</h2><div class="small muted">${longDate(m.date)}${m.place ? ` · ${esc(m.place)}` : ''}</div>`;
  main.innerHTML = `<h1>Meetings</h1><p class="muted" style="max-width:75ch">The agendas of the syndicate’s AGMs and board meetings, polls of the family admins, and the minutes of past meetings. Anyone in the families can ask a question for the next meeting: it goes on the agenda.</p>
    ${pageBar('', `<button class="btn primary" data-ask>${icon('plus')}Ask a question for the next meeting…</button>${admin ? `<button class="btn" data-madd>${icon('plus')}Add a meeting…</button><button class="btn" data-padd>${icon('plus')}Create a poll…</button>` : ''}`)}
    <div class="grid-2" style="align-items:start">
      <section class="stack">${n ? `<div class="card meeting-next">${meetingHead(n)}${admin ? `<div class="row" style="gap:8px;margin:10px 0 0"><button class="btn sm" data-iadd="${n.id}">${icon('plus')}Add an agenda item…</button><button class="btn sm" data-medit="${n.id}">Edit the meeting…</button>${n.date <= new Date().toLocaleDateString('en-CA') ? `<button class="btn sm" data-minutes="${n.id}">Record the minutes…</button>` : ''}</div>` : ''}
          <h3 style="margin:16px 0 6px">Agenda</h3>${agendaHtml(n, admin)}</div>`
        : `<div class="card"><span class="eyebrow">Next meeting</span><h2 style="margin:2px 0 6px">Not set up yet</h2><p class="small muted" style="margin:0">${admin ? 'Add the next meeting, and the questions waiting go on its agenda.' : 'Questions asked now wait for the next meeting’s agenda.'}</p>
          ${d.waiting.length ? `<h3 style="margin:16px 0 6px">Waiting for the next meeting</h3>${agendaHtml({ agenda: d.waiting, put_forward: [] }, admin)}` : ''}</div>`}
        ${d.upcoming.length ? `<h3 style="margin:8px 0 0">Later meetings</h3>${d.upcoming.map(m => `<div class="card flat" style="padding:14px 16px">${meetingHead(m)}${admin ? `<div class="row" style="gap:8px;margin-top:8px"><button class="btn sm" data-iadd="${m.id}">${icon('plus')}Add an agenda item…</button><button class="btn sm" data-medit="${m.id}">Edit…</button></div>` : ''}${m.agenda.length ? `<div style="margin-top:8px">${agendaHtml(m, admin)}</div>` : ''}</div>`).join('')}` : ''}</section>
      <section class="stack"><h2 style="margin:0">Polls of the family admins</h2>${open.map(pollCard).join('') || '<div class="card flat empty small">No polls open</div>'}
        ${shut.length ? `<details><summary class="small muted" style="cursor:pointer">Closed polls (${shut.length})</summary><div class="stack" style="margin-top:8px">${shut.map(pollCard).join('')}</div></details>` : ''}</section></div>
    <section class="stack" style="margin-top:24px"><h2 style="margin:0">Past meetings and minutes</h2>
      ${d.past.map(m => `<details class="card flat past-meeting" ${d.past[0] === m ? 'open' : ''}><summary><span class="row between" style="gap:8px;width:100%"><span><b>${esc(m.title)}</b> <span class="small muted">· ${longDate(m.date)}</span></span>${m.minutes ? '<span class="badge green">Minutes</span>' : '<span class="badge amber">No minutes yet</span>'}</span></summary>
        <div class="minutes">${m.minutes ? mdLite(m.minutes) + `<p class="tiny muted">Recorded by ${esc(m.minutes_by || 'the site admin')}${m.minutes_at ? ` on ${asked(m.minutes_at)}` : ''}.</p>` : '<p class="small muted">The minutes haven’t been added yet.</p>'}
          ${m.agenda.length ? `<details class="small"><summary class="muted" style="cursor:pointer">The agenda</summary>${agendaHtml(m, false)}</details>` : ''}
          ${admin ? `<div class="row" style="gap:8px;margin-top:10px"><button class="btn sm" data-minutes="${m.id}">${m.minutes ? 'Edit the minutes…' : 'Record the minutes…'}</button><button class="btn sm" data-medit="${m.id}">Edit the meeting…</button></div>` : ''}</div></details>`).join('') || '<div class="card flat empty small">No past meetings yet</div>'}</section>`;
  const reload = () => viewMeetings(main), all = [n, ...d.upcoming, ...d.past].filter(Boolean), items = [...all.flatMap(m => m.agenda), ...d.waiting];
  $('[data-ask]', main).onclick = () => { const m = openModal(`<form id="maf"><h2>Ask a question for the next meeting</h2><p class="small muted" style="margin-top:0">${n ? `It goes on the agenda for the ${esc(n.title)} (${longDate(n.date)}).` : 'It waits for the next meeting’s agenda.'} Everyone in the families can see the agenda.</p>
      <div class="field"><label>Your question</label><input name="title" required maxlength="300" placeholder="e.g. Could we review the cleaning contract?"></div>
      <div class="field"><label>More detail (optional)</label><textarea name="details" rows="3"></textarea></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add to the agenda</button></div></form>`);
    $('#maf', m).onsubmit = guard(async e => { e.preventDefault(); await api('/meetings/questions', { body: formData(e.target) }); closeOverlay(); toast('Added. The site admin has been told'); reload(); }); };
  main.querySelectorAll('[data-idel]').forEach(x => x.onclick = guard(async () => { if (!confirm('Withdraw your question?')) return; await api('/meetings/items/' + x.dataset.idel, { method: 'DELETE' }); toast('Withdrawn'); reload(); }));
  main.querySelectorAll('.pollf').forEach(f => f.onsubmit = guard(async e => { e.preventDefault(); await api(`/polls/${f.dataset.pid}/vote`, { body: formData(f) }); toast('Your family’s vote is in'); reload(); }));
  if (!admin) return;
  const meetingForm = m => { const dlg = openModal(`<form id="mmf"><h2>${m ? 'Edit the meeting' : 'Add a meeting'}</h2><div class="grid-2" style="gap:12px">
      <div class="field"><label>Kind</label><select name="kind">${Object.entries({ agm: 'AGM', board: 'Board meeting', other: 'Other meeting' }).map(([k, l]) => `<option value="${k}" ${m && m.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Date</label><input name="date" type="date" required value="${m ? m.date : ''}"></div></div>
      <div class="field"><label>Title</label><input name="title" maxlength="120" value="${esc(m ? m.title : '')}" placeholder="e.g. AGM 2027 (filled in if left blank)"></div>
      <div class="field"><label>Where (optional)</label><input name="place" maxlength="200" value="${esc(m && m.place || '')}" placeholder="e.g. At the house, or online"></div>
      <div class="row between" style="gap:8px">${m && !m.minutes ? '<button type="button" class="btn sm danger" id="mmdel">Remove the meeting</button>' : '<span></span>'}<span class="row" style="gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${m ? 'Save' : 'Add'}</button></span></div></form>`);
    $('#mmf', dlg).onsubmit = guard(async e => { e.preventDefault(); await api(m ? '/admin/meetings/' + m.id : '/admin/meetings', { method: m ? 'PUT' : 'POST', body: formData(e.target) }); closeOverlay(); toast(m ? 'Saved' : 'Added. The families have been told'); reload(); });
    const del = $('#mmdel', dlg); if (del) del.onclick = guard(async () => { if (!confirm('Remove this meeting? Its agenda items wait for the next one.')) return; await api('/admin/meetings/' + m.id, { method: 'DELETE' }); closeOverlay(); toast('Removed'); reload(); }); };
  $('[data-madd]', main).onclick = () => meetingForm(null);
  main.querySelectorAll('[data-medit]').forEach(x => x.onclick = () => meetingForm(all.find(m => m.id == x.dataset.medit)));
  const itemForm = (mid, it) => { const dlg = openModal(`<form id="mif2"><h2>${it ? 'Edit the agenda item' : 'Add an agenda item'}</h2>
      <div class="field"><label>Item</label><input name="title" required maxlength="300" value="${esc(it ? it.title : '')}"></div>
      <div class="field"><label>Details (optional)</label><textarea name="details" rows="${it && it.kind === 'poll' ? 6 : 3}">${esc(it && it.details || '')}</textarea></div>
      ${it ? `<div class="field"><label>Meeting</label><select name="meeting_id"><option value="">The next meeting, when it’s set up</option>${d.meetings.map(m => `<option value="${m.id}" ${(it.meeting_id ? it.meeting_id === m.id : n && m.id === n.id) ? 'selected' : ''}>${esc(m.title)} (${dfmt(m.date)})</option>`).join('')}</select></div>` : ''}
      <div class="row between" style="gap:8px">${it ? '<button type="button" class="btn sm danger" id="midel">Remove from the agenda</button>' : '<span></span>'}<span class="row" style="gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${it ? 'Save' : 'Add'}</button></span></div></form>`);
    $('#mif2', dlg).onsubmit = guard(async e => { e.preventDefault(); await api(it ? '/admin/meetings/items/' + it.id : `/admin/meetings/${mid}/items`, { method: it ? 'PUT' : 'POST', body: formData(e.target) }); closeOverlay(); toast('Saved'); reload(); });
    const del = $('#midel', dlg); if (del) del.onclick = guard(async () => { if (!confirm('Remove this from the agenda?')) return; await api('/meetings/items/' + it.id, { method: 'DELETE' }); closeOverlay(); toast('Removed'); reload(); }); };
  main.querySelectorAll('[data-iadd]').forEach(x => x.onclick = () => itemForm(x.dataset.iadd, null));
  main.querySelectorAll('[data-iedit]').forEach(x => x.onclick = () => itemForm(null, items.find(i => i.id == x.dataset.iedit)));
  main.querySelectorAll('[data-imove]').forEach(x => x.onclick = guard(async () => { await api(`/admin/meetings/items/${x.dataset.imove}/move`, { body: { dir: x.dataset.dir } }); reload(); }));
  main.querySelectorAll('[data-minutes]').forEach(x => x.onclick = () => { const m = all.find(y => y.id == x.dataset.minutes);
    const dlg = openModal(`<form id="mnf"><h2>Minutes: ${esc(m.title)}</h2><p class="small muted" style="margin-top:0">${longDate(m.date)}. Paragraphs, “- ” for points and “# ” for headings. Everyone in the families is told when they’re first added.</p>
      <div class="field"><textarea name="minutes" rows="18">${esc(m.minutes || '')}</textarea></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save the minutes</button></div></form>`, true);
    $('#mnf', dlg).onsubmit = guard(async e => { e.preventDefault(); await api(`/admin/meetings/${m.id}/minutes`, { method: 'PUT', body: formData(e.target) }); closeOverlay(); toast('Minutes saved'); reload(); }); });
  $('[data-padd]', main).onclick = () => { const dlg = openModal(`<form id="mpf"><h2>Create a poll for the family admins</h2><p class="small muted" style="margin-top:0">Each family gets one vote, cast by one of its admins. When you close it, the result goes on a meeting’s agenda.</p>
      <div class="field"><label>Question</label><input name="question" required maxlength="300" placeholder="e.g. Should we install a log burner?"></div>
      <div class="field"><label>More detail (optional)</label><textarea name="details" rows="2"></textarea></div>
      <div class="field"><label>Answers, one per line</label><textarea name="options" rows="4" required>Yes\nNo\nNot sure</textarea></div>
      <div class="grid-2" style="gap:12px"><div class="field"><label>Closes on (optional)</label><input name="closes_on" type="date"></div>
        <div class="field"><label>Result goes on the agenda for</label><select name="meeting_id"><option value="">The next meeting</option>${d.meetings.map(m => `<option value="${m.id}">${esc(m.title)} (${dfmt(m.date)})</option>`).join('')}</select></div></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Send to the family admins</button></div></form>`);
    $('#mpf', dlg).onsubmit = guard(async e => { e.preventDefault(); const v = formData(e.target); await api('/admin/polls', { body: { ...v, options: v.options.split('\n') } }); closeOverlay(); toast('Poll sent to the family admins'); reload(); }); };
  main.querySelectorAll('[data-pclose]').forEach(x => x.onclick = () => { const dlg = openModal(`<form id="mcl"><h2>Close the poll</h2><p class="small muted" style="margin-top:0">Voting stops, and the result goes on an agenda.</p>
      <div class="field"><label>Add the result to</label><select name="meeting_id"><option value="">The next meeting${n ? ` (${esc(n.title)})` : ', when it’s set up'}</option>${d.meetings.map(m => `<option value="${m.id}">${esc(m.title)} (${dfmt(m.date)})</option>`).join('')}</select></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn green">Close and add to the agenda</button></div></form>`);
    $('#mcl', dlg).onsubmit = guard(async e => { e.preventDefault(); const r = await api(`/admin/polls/${x.dataset.pclose}/close`, { body: formData(e.target) }); closeOverlay(); toast(`Closed: the result is on the agenda${r.meeting ? ` for the ${r.meeting}` : ''}`); reload(); }); });
  main.querySelectorAll('[data-pdel]').forEach(x => x.onclick = guard(async () => { if (!confirm('Delete this poll and its votes?')) return; await api('/admin/polls/' + x.dataset.pdel, { method: 'DELETE' }); toast('Deleted'); reload(); }));
}

// ------------------------------------------------------------ maintenance
// anyone who logs in reports a problem at the house; the site admin keeps each report up to date until it's fixed
async function shrinkPhoto(file, max = 1600) {   // one photo per report, made smaller in the browser before it's sent
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That file isn’t a photo the browser can read')); i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
const URGENCY_HELP = { urgent: 'Urgent: safety, or the house can’t be used', soon: 'Needs fixing soon', whenever: 'When convenient' };
const ISSUE_BADGE = { open: 'amber', in_hand: 'blue', fixed: 'green', closed: '' };
const issueFields = (d, i = {}) => `<div class="field"><label>What’s the problem?</label><input name="title" required maxlength="200" value="${esc(i.title || '')}" placeholder="e.g. Hot water tank leaking"></div>
  <div class="grid-2" style="gap:12px"><div class="field"><label>Where</label><select name="area" required>${i.area ? '' : '<option value="" selected disabled>Choose…</option>'}${d.areas.map(a => `<option ${a === i.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
    <div class="field"><label>How urgent</label><select name="urgency">${Object.keys(d.urgency).map(k => `<option value="${k}" ${k === (i.urgency || 'soon') ? 'selected' : ''}>${URGENCY_HELP[k]}</option>`).join('')}</select></div></div>
  <div class="field"><label>Details (optional)</label><textarea name="details" rows="3" placeholder="What you noticed, when, and anything you did about it">${esc(i.details || '')}</textarea></div>
  ${photoField(i.photo)}`;
// one optional photo on a form (maintenance reports, house guides); formWithPhoto() sends it made smaller, or removes it
const photoField = has => `<div class="field"><label>${has ? 'Replace the photo (optional)' : 'Photo (optional)'}</label><input type="file" name="photo" accept="image/*"></div>
  ${has ? '<label class="row small" style="gap:8px;margin:-6px 0 12px"><input type="checkbox" name="remove_photo"> Remove the photo</label>' : ''}`;
async function formWithPhoto(form) {
  const v = formData(form), file = form.photo.files[0]; delete v.photo; delete v.remove_photo;
  if (file) v.photo = await shrinkPhoto(file); else if (form.remove_photo && form.remove_photo.checked) v.photo = null;
  return v;
}
function issueCard(i, d) {
  const meta = [esc(i.area), i.urgency !== 'urgent' && d.urgency[i.urgency], `reported by ${esc(i.by)}${i.family ? `, ${esc(i.family)} family,` : i.by_friend ? ' (trusted friend)' : ''} on ${asked(i.created_at)}`].filter(Boolean).join(' · ');
  const q = i.cost, requote = q && q.status === 'waiting';
  const btns = [i.can_update && `<button class="btn sm" data-iss-status="${i.id}">Update…</button>`, i.can_quote && `<button class="btn sm" data-iss-quote="${i.id}">${requote ? 'Update the quote…' : 'Add a quote…'}</button>`,
    i.can_edit && `<button class="btn sm" data-iss-edit="${i.id}">Edit…</button>`, i.can_withdraw && `<button class="btn sm danger" data-iss-withdraw="${i.id}">Withdraw</button>`].filter(Boolean).join('');
  return `<div class="card flat issue" style="padding:16px"><div class="row between" style="align-items:flex-start;gap:12px"><div style="min-width:0"><b>${esc(i.title)}</b><div class="tiny muted" style="margin-top:2px">${meta}</div></div>
      <div class="row" style="gap:6px;justify-content:flex-end;flex-wrap:wrap">${i.urgency === 'urgent' ? '<span class="badge red">Urgent</span>' : ''}<span class="badge ${ISSUE_BADGE[i.status]}">${d.statuses[i.status]}</span></div></div>
    ${i.details ? `<div class="small" style="margin-top:8px;white-space:pre-line">${esc(i.details)}</div>` : ''}
    ${i.photo ? `<a href="${i.photo}" target="_blank" rel="noopener" class="issue-photo"><img src="${i.photo}" alt="Photo: ${esc(i.title)}" loading="lazy"></a>` : ''}
    ${i.status !== 'open' || i.update_note ? `<div class="small" style="margin-top:8px"><b>${d.statuses[i.status]}</b>${i.updated_at ? ` <span class="muted">· ${asked(i.updated_at)}${i.updated_by ? `, ${esc(i.updated_by)}` : ''}</span>` : ''}${i.update_note ? `: ${esc(i.update_note)}` : ''}</div>` : ''}
    ${q ? `<div class="small row" style="margin-top:8px;gap:6px">${icon('receipt')} Quote ${money(q.amount, 2)}${q.quote_from ? ` from ${esc(q.quote_from)}` : ''} <span class="badge ${q.tone}">${esc(q.label)}</span></div>` : ''}
    ${btns ? `<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">${btns}</div>` : ''}</div>`;
}
async function viewMaintenance(main) {
  const d = await api('/maintenance'), live = i => i.status === 'open' || i.status === 'in_hand', open = d.issues.filter(live), done = d.issues.filter(i => !live(i));
  main.innerHTML = `<h1>Maintenance</h1><p class="muted" style="max-width:75ch">Report anything at the house that needs fixing or looking at: a leak, a broken appliance, a damp patch, a light that’s out. The site admin is told straight away and keeps each report up to date until it’s fixed. ${d.all_reports ? 'Everyone in the syndicate can see the reports, so check the list before reporting something again.' : 'You can see the reports you’ve made.'}</p>
    <div class="grid-2" style="align-items:start">
      <form class="card" id="mif"><h3>${icon('wrench')} Report an issue</h3>${issueFields(d)}<button class="btn primary">Report</button></form>
      <section class="stack"><h2 style="margin:0">Open issues</h2>${open.map(i => issueCard(i, d)).join('') || '<div class="card flat empty small">Nothing reported at the moment</div>'}
        ${done.length ? `<h2 style="margin:8px 0 0">Fixed and closed</h2>${done.map(i => issueCard(i, d)).join('')}` : ''}</section></div>`;
  const reload = () => viewMaintenance(main), find = id => d.issues.find(i => i.id == id);
  $('#mif', main).onsubmit = guard(async e => { e.preventDefault(); const b = e.target.querySelector('button.primary'); b.disabled = true;
    try { await api('/maintenance', { body: await formWithPhoto(e.target) }); } finally { b.disabled = false; } toast('Reported. The site admin has been told'); reload(); });
  main.querySelectorAll('[data-iss-edit]').forEach(x => x.onclick = () => { const i = find(x.dataset.issEdit);
    const m = openModal(`<form id="mie"><h2>Edit “${esc(i.title)}”</h2>${issueFields(d, i)}<div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    $('#mie', m).onsubmit = guard(async e => { e.preventDefault(); await api('/maintenance/' + i.id, { method: 'PUT', body: await formWithPhoto(e.target) }); closeOverlay(); toast('Saved'); reload(); }); });
  main.querySelectorAll('[data-iss-withdraw]').forEach(x => x.onclick = guard(async () => { if (!confirm('Withdraw this report?')) return; await api('/maintenance/' + x.dataset.issWithdraw, { method: 'DELETE' }); toast('Withdrawn'); reload(); }));
  main.querySelectorAll('[data-iss-status]').forEach(x => x.onclick = () => { const i = find(x.dataset.issStatus);
    const m = openModal(`<form id="mis"><h2>Update “${esc(i.title)}”</h2><p class="small muted" style="margin-top:0">Reported by ${esc(i.by)}${i.family ? `, ${esc(i.family)} family,` : ''} on ${asked(i.created_at)}. They’re sent the status and your note.</p>
      <div class="field"><label>Status</label><select name="status">${Object.entries(d.statuses).map(([k, l]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Note (optional)</label><textarea name="note" rows="3" placeholder="e.g. Plumber booked for 3 December">${esc(i.update_note || '')}</textarea></div>
      <div class="row between" style="gap:8px"><button type="button" class="btn sm danger" id="misDel">Delete report</button><span class="row" style="gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></span></div></form>`);
    $('#mis', m).onsubmit = guard(async e => { e.preventDefault(); await api(`/maintenance/${i.id}/status`, { body: formData(e.target) }); closeOverlay(); toast('Updated'); reload(); });
    $('#misDel', m).onclick = guard(async () => { if (!confirm('Delete this report? Use it for duplicates or reports made by mistake.')) return; await api('/maintenance/' + i.id, { method: 'DELETE' }); closeOverlay(); toast('Deleted'); reload(); }); });
  // a quote for the work: it becomes a cost waiting to be adopted on the Service charge page (a new quote replaces one still waiting)
  main.querySelectorAll('[data-iss-quote]').forEach(x => x.onclick = () => { const i = find(x.dataset.issQuote), c = i.cost && i.cost.status === 'waiting' ? i.cost : {};
    const m = openModal(`<form id="miq"><h2>${c.id ? 'Update the quote' : 'Add a quote'}</h2><p class="small muted" style="margin-top:0">For “${esc(i.title)}”. It waits on the Service charge page until the site admin adopts it: now, paid from the bank balance, or put forward for a year’s service charge.</p>
      <div class="grid-2" style="gap:12px"><div class="field"><label>Amount quoted (£)</label><input name="amount" type="number" min="0.01" step="0.01" required value="${c.amount ?? ''}"></div>
        <div class="field"><label>Quote from</label><input name="quote_from" maxlength="200" value="${esc(c.quote_from || '')}" placeholder="e.g. Highland Plumbing"></div></div>
      <div class="field"><label>Details (optional)</label><textarea name="details" rows="3" placeholder="What it covers, how long the quote is valid…">${esc(c.details || '')}</textarea></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${c.id ? 'Save' : 'Add quote'}</button></div></form>`);
    $('#miq', m).onsubmit = guard(async e => { e.preventDefault(); await api(`/maintenance/${i.id}/quote`, { body: formData(e.target) }); closeOverlay(); toast('Quote saved: waiting to be adopted'); reload(); }); });
}

// ------------------------------------------------------------ house guide
// everyone reads it and can report something wrong; the families add guides; family admins (and a guide's author) edit them
const guideText = t => esc(t).replace(/https?:\/\/[^\s<]+[^\s<.,;:)!?]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
function guideCard(g) {
  const n = g.reports.length;
  return `<details class="card flat guide" data-gid="${g.id}" ${S.openGuide == g.id ? 'open' : ''}><summary>${icon('chevron-right')}<b class="grow">${esc(g.title)}</b>${n ? `<span class="badge red">${n} reported</span>` : ''}</summary>
    <div class="guide-body">${guideText(g.body)}</div>
    ${g.photo ? `<a href="${g.photo}" target="_blank" rel="noopener" class="issue-photo"><img src="${g.photo}" alt="Photo: ${esc(g.title)}" loading="lazy"></a>` : ''}
    <div class="tiny muted" style="margin-top:12px">Added by ${esc(g.created_by || 'someone')} on ${asked(g.created_at)}${g.updated_at ? ` · last edited by ${esc(g.updated_by)} on ${asked(g.updated_at)}` : ''}</div>
    ${g.reports.map(r => `<div class="notice small row" style="margin-top:10px;gap:10px;align-items:flex-start">${icon('flag')}<span class="grow"><b>Reported by ${esc(r.by_name || 'someone')} on ${asked(r.created_at)}:</b> ${esc(r.note)}</span><button class="btn sm" data-sorted="${r.id}">Mark as sorted</button></div>`).join('')}
    <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">${g.can_edit ? `<button class="btn sm" data-edit-guide="${g.id}">Edit…</button>` : ''}
      ${g.reported ? '<span class="tiny muted">You’ve reported a problem with this guide. You’ll hear when it’s sorted.</span>' : `<button class="btn sm" data-report-guide="${g.id}">${icon('flag')}Report an inaccuracy…</button>`}</div></details>`;
}
async function viewGuide(main) {
  const d = await api('/guide'), reported = d.guides.reduce((a, g) => a + g.reports.length, 0);
  const groups = d.sections.map(s => [s, d.guides.filter(g => g.section === s)]).filter(([, gs]) => gs.length);
  main.innerHTML = `<h1>House guide</h1><p class="muted" style="max-width:75ch">How things work at the house: arriving and leaving, heating and hot water, Wi-Fi, rubbish, what to do in an emergency. ${d.can_add ? 'Anyone in the families can add a guide, and family admins keep them up to date. ' : ''}If something’s wrong or out of date, report it on the guide.</p>
    ${pageBar(`<label class="search-box">${icon('search')}<input type="search" id="gq" placeholder="Search the guide" aria-label="Search the guide"></label>`, d.can_add ? `<button class="btn" data-add-guide>${icon('plus')}Add a guide…</button>` : '')}
    ${reported && d.guides.some(g => g.can_edit) ? `<div class="notice small" style="margin-bottom:16px">${icon('flag')} ${reported} inaccurac${reported > 1 ? 'ies' : 'y'} reported. Correct the guide, then mark the report as sorted.</div>` : ''}
    ${groups.length ? groups.map(([s, gs]) => `<section class="stack guide-sec" style="margin-bottom:24px"><h2 style="margin:0">${esc(s)}</h2>${gs.map(guideCard).join('')}</section>`).join('')
      : `<div class="card empty">No guides yet.${d.can_add ? ' Add the first: how to get in, the heating, the Wi-Fi, the bins.' : ''}</div>`}
    <div class="card flat empty small" id="gnone" style="display:none">Nothing in the guide matches that.</div>`;
  const reload = () => viewGuide(main), find = id => d.guides.find(g => g.id == id);
  main.querySelectorAll('details.guide').forEach(x => x.ontoggle = () => { if (x.open) S.openGuide = x.dataset.gid; });
  // search: show the guides that match, opened
  $('#gq', main).oninput = e => { const t = e.target.value.trim().toLowerCase(); let any = false;
    main.querySelectorAll('details.guide').forEach(x => { const hit = !t || x.textContent.toLowerCase().includes(t); x.style.display = hit ? '' : 'none'; if (t) x.open = hit; any = any || hit; });
    main.querySelectorAll('.guide-sec').forEach(sec => sec.style.display = [...sec.querySelectorAll('details.guide')].some(x => x.style.display !== 'none') ? '' : 'none');
    $('#gnone', main).style.display = any || !d.guides.length ? 'none' : ''; };
  const editor = g => () => {
    const m = openModal(`<form id="gf"><h2>${g ? `Edit “${esc(g.title)}”` : 'Add a guide'}</h2>
      <div class="grid-2" style="gap:12px"><div class="field"><label>Section</label><select name="section">${d.sections.map(s => `<option ${g ? (s === g.section ? 'selected' : '') : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div class="field"><label>Title</label><input name="title" required maxlength="200" value="${esc(g ? g.title : '')}" placeholder="e.g. Turning the water on"></div></div>
      <div class="field"><label>Guidance</label><textarea name="body" rows="12" required placeholder="Step by step, as you’d explain it to someone arriving for the first time.">${esc(g ? g.body : '')}</textarea></div>
      ${photoField(g && g.photo)}
      ${g && g.versions ? `<div class="field"><label>Earlier versions (${g.versions})</label><div class="row" style="gap:8px;flex-wrap:wrap"><select id="gver" style="flex:1;min-width:200px"><option>Loading…</option></select><button type="button" class="btn sm" id="gverLoad">Load into the form</button></div>
        <p class="tiny muted" style="margin:4px 0 0">Puts that version’s text in the form above. Save to bring it back.</p></div>` : ''}
      <div class="row between" style="gap:8px">${g ? '<button type="button" class="btn sm danger" id="gdel">Remove guide</button>' : '<span></span>'}<span class="row" style="gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${g ? 'Save' : 'Add'}</button></span></div></form>`, true);
    const form = $('#gf', m);
    form.onsubmit = guard(async e => { e.preventDefault(); const r = await api(g ? '/guide/' + g.id : '/guide', { method: g ? 'PUT' : 'POST', body: await formWithPhoto(form) }); S.openGuide = g ? g.id : r.id; closeOverlay(); toast(g ? 'Saved' : 'Added to the house guide'); reload(); });
    if (g && g.versions) (async () => { const vs = await api(`/guide/${g.id}/versions`), sel = $('#gver', m); if (!sel) return;
      sel.innerHTML = vs.map((v, k) => `<option value="${k}">${asked(v.edited_at || '')} · ${esc(v.edited_by_name || 'someone')} · ${esc(v.title)}</option>`).join('');
      $('#gverLoad', m).onclick = () => { const v = vs[sel.value]; form.section.value = v.section; form.title.value = v.title; form.body.value = v.body; toast('Earlier version loaded. Save to bring it back'); }; })().catch(e => toast(e.message, true));
    const del = $('#gdel', m); if (del) del.onclick = guard(async () => { if (!confirm(`Remove “${g.title}” from the house guide? Its earlier versions go too.`)) return; await api('/guide/' + g.id, { method: 'DELETE' }); closeOverlay(); toast('Removed'); reload(); });
  };
  const add = $('[data-add-guide]', main); if (add) add.onclick = editor(null);
  main.querySelectorAll('[data-edit-guide]').forEach(x => x.onclick = editor(find(x.dataset.editGuide)));
  main.querySelectorAll('[data-report-guide]').forEach(x => x.onclick = () => { const g = find(x.dataset.reportGuide);
    const m = openModal(`<form id="grf"><h2>Report an inaccuracy</h2><p class="small muted" style="margin-top:0">In “${esc(g.title)}”. Family admins can correct it, and you’ll hear when it’s sorted.</p>
      <div class="field"><label>What’s wrong or out of date?</label><textarea name="note" rows="4" required placeholder="e.g. The Wi-Fi password changed in October"></textarea></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Report</button></div></form>`);
    $('#grf', m).onsubmit = guard(async e => { e.preventDefault(); await api(`/guide/${g.id}/report`, { body: formData(e.target) }); S.openGuide = g.id; closeOverlay(); toast('Reported. Thank you'); reload(); }); });
  main.querySelectorAll('[data-sorted]').forEach(x => x.onclick = guard(async () => { S.openGuide = x.closest('details').dataset.gid; await api(`/guide/reports/${x.dataset.sorted}/sorted`, { body: {} }); toast('Marked as sorted'); reload(); }));
}

// ------------------------------------------------------------ site admin
async function viewAdmin(main) {
  const raw = location.hash.split('/')[2] || 'overview', sub = { budget: 'service-charge', expenditure: 'service-charge', credits: 'lets' }[raw] || raw;   // older addresses still work
  const pages = { overview: ['Payments', admOverview], 'service-charge': ['Service charge', admServiceCharge], weeks: ['Weeks', admWeeks], lets: ['Lets', admLets],
    families: ['Families', admFamilies], users: ['Users', admUsers], settings: ['Settings', admSettings], audit: ['Activity', admAudit] };
  if (sub.startsWith('account-')) return viewAccount(main, sub.split('-')[1]);
  const [title, view] = pages[sub] || pages.overview;
  main.innerHTML = isSiteRole() ? `<h1>${title}</h1><div id="adm"></div>`
    : `<h1>Site admin</h1><div class="subtabs">${Object.entries(pages).map(([k, [l]]) => `<a href="#/admin/${k}" class="${k === sub ? 'on' : ''}">${l}</a>`).join('')}</div><div id="adm"></div>`;
  await view($('#adm', main));
}
async function admOverview(el) {
  const [o, c, bank, b] = await Promise.all([api('/admin/overview'), api('/admin/charges?year=' + S.year), api('/admin/bank-balances'), api('/admin/budget?year=' + S.year)]);
  const cur = S.me.settings.currency, plan = Object.fromEntries(b.split.map(x => [x.id, x]));
  const issued = r => Math.abs(r.charge) > 0.005;
  const today = todayStr(), latest = bank[0], owedAll = o.balances.reduce((a, b) => a + Math.max(0, b.balance), 0);
  const status = r => !issued(r) ? (r.paid > 0.005 ? '<span class="badge amber">Paid before issue</span>' : '<span class="badge">Not issued</span>') : r.outstanding < -0.005 ? '<span class="badge green">In credit</span>' : r.outstanding <= 0.005 ? '<span class="badge green">Paid</span>'
    : r.paid > 0.005 ? '<span class="badge amber">Part paid</span>' : '<span class="badge red">Unpaid</span>';
  const signed = n => Math.abs(n) < 0.005 ? '<span class="muted">—</span>' : (n < 0 ? '−' : '') + money(Math.abs(n), 2);
  el.innerHTML = `${pageBar(yearPicker())}<div class="grid-2" style="align-items:start;margin-bottom:28px">
    <section class="stack"><h2>Bank balance</h2>
      <div class="card"><div class="muted small">${latest ? `Syndicate account on ${dfmt(latest.as_of, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'No balance recorded yet'}</div>
        <div class="stat num">${latest ? money(latest.amount, 2) : '—'}</div>${latest && latest.note ? `<div class="small muted" style="margin-top:4px">${esc(latest.note)}</div>` : ''}
        <form id="bbf" class="row" style="margin-top:14px;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="margin:0"><label>Date</label><input name="as_of" type="date" value="${today}" required style="max-width:170px"></div>
          <div class="field" style="margin:0"><label>Balance (£)</label><input name="amount" type="number" step="0.01" required style="max-width:150px"></div>
          <div class="field grow" style="margin:0;min-width:160px"><label>Note (optional)</label><input name="note" placeholder="e.g. From online banking"></div>
          <button class="btn primary">Add balance</button></form></div>
      ${bank.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th class="r">Balance</th><th class="r">Change</th><th>Note</th><th></th></tr></thead><tbody>${bank.slice(0, 8).map((b, i) => { const prev = bank[i + 1]; const d = prev ? b.amount - prev.amount : null;
        return `<tr><td class="small" style="white-space:nowrap">${dfmt(b.as_of, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td class="r num">${money(b.amount, 2)}</td><td class="r num small ${d > 0 ? 'credit' : ''}" style="white-space:nowrap">${d == null ? '' : (d >= 0 ? '+' : '−') + money(Math.abs(d), 2)}</td><td class="small muted">${esc(b.note || '')}</td><td class="r"><button class="btn sm" data-bbdel="${b.id}" aria-label="Delete this balance">${icon('trash-2')}</button></td></tr>`; }).join('')}</tbody></table></div>` : ''}</section>
    <section class="stack"><h2>Payments to confirm</h2><p class="muted small" style="margin:0">Check the syndicate bank statement for each reference, then confirm. Confirming credits the household that released the week, less the letting cost.</p>
    ${o.pending.length ? `<div class="table-wrap"><table><thead><tr><th>Ref</th><th>Week</th><th>From</th><th class="r">Amount</th><th></th></tr></thead><tbody>${o.pending.map(b => `<tr><td class="small"><code>${esc(b.reference)}</code><div class="tiny muted">expires ${new Date(b.expires_at + 'Z').toLocaleDateString('en-GB')}</div></td><td>${b.week.week_no} <span class="muted small">${b.week.year}</span></td><td class="small">${esc(b.booker)}</td><td class="r num">${money(b.amount, 2)}</td>
      <td class="r"><button class="btn sm green" data-conf="${b.id}">Paid</button> <button class="btn sm danger" data-rej="${b.id}">Cancel</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card flat empty small">Nothing waiting</div>'}</section></div>
    ${o.topups.length ? `<section class="stack" style="margin-bottom:28px"><h2>Top-ups expected</h2><p class="muted small" style="margin:0">Households sending money in to build up credit for buying weeks. When the transfer arrives, confirm it to add it to their account.</p>
      <div class="table-wrap"><table><thead><tr><th>Ref</th><th>Household</th><th>From</th><th class="r">Amount</th><th></th></tr></thead><tbody>${o.topups.map(t => `<tr><td class="small"><code>${esc(t.reference)}</code></td><td>${esc(t.family)}</td><td class="small">${esc(t.person)} · ${asked(t.created_at)}</td><td class="r num">${money(t.amount, 2)}</td>
      <td class="r"><button class="btn sm green" data-tuconf="${t.id}" data-amt="${t.amount}">Arrived</button> <button class="btn sm danger" data-tucan="${t.id}">Cancel</button></td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <section class="stack"><h2 style="margin:0">Service charges ${c.year}</h2>
      <div class="card"><div class="row" style="gap:28px;flex-wrap:wrap;align-items:flex-end">
        <div><div class="muted small">Added to the service charge</div><div class="num" style="font-size:20px">${money(b.charge_total, 2)}</div>${b.bank_total > 0.005 ? `<div class="tiny muted">plus ${money(b.bank_total, 2)} from the bank balance</div>` : ''}</div>
        <div><div class="muted small">÷ ${b.units} weeks</div><div class="num" style="font-size:20px">${money(b.rate_calc, 2)}<span class="small muted"> / week</span></div></div>
        <div class="field" style="margin:0"><label>Charge per week</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input id="rate" type="number" step="0.01" min="0" value="${b.rate_per_week ?? ''}" placeholder="${b.rate_calc}" style="max-width:120px">
          <button class="btn sm" data-round="5">Round to ${cur}5</button><button class="btn sm" data-round="10">${cur}10</button></div></div>
        <div><div class="muted small">Total raised</div><div class="num" style="font-size:20px">${money(b.raised, 2)}</div>${Math.abs(b.difference) > 0.01 ? `<div class="tiny" style="color:${b.difference < 0 ? 'var(--amber)' : 'var(--green)'}">${b.difference < 0 ? 'Shortfall' : 'Surplus'} ${money(Math.abs(b.difference), 2)}</div>` : ''}</div></div>
        <div class="row between" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line);gap:12px;flex-wrap:wrap">
          <span class="small">${b.generated ? `<span class="badge green">Issued</span> Each household’s ${c.year} charge is on its account. Re-issuing replaces the charges with the figures below; payments are untouched.` : `<span class="badge amber">Not issued yet</span> Issuing adds each household’s charge below to its account and tells its admins.`}</span>
          <button class="btn ${b.generated ? '' : 'primary'}" id="gen" ${b.total || b.rate_per_week ? '' : 'disabled'}>${b.generated ? 'Re-issue' : 'Issue'} ${c.year} service charges</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Household</th><th class="r">Charge</th><th class="r">Paid</th><th class="r">Outstanding</th><th>Status</th><th></th></tr></thead><tbody>
      ${c.rows.map(r => { const pl = plan[r.id], on = issued(r);
        return `<tr><td><a href="#/admin/account-${r.id}">${esc(r.name)}</a><div class="tiny muted">${r.shares} share${r.shares === 1 ? '' : 's'} × ${money(b.rate, 2)}${r.last_payment ? ` · last paid ${money(r.last_payment.a, 2)} on ${dfmt(r.last_payment.d)}` : ''}</div></td>
        <td class="r num">${on ? money(r.charge, 2) + (pl && Math.abs(pl.charge - r.charge) > 0.01 ? `<div class="tiny" style="color:var(--amber)">budget now ${money(pl.charge, 2)}</div>` : '') : `<span class="muted">${money(pl ? pl.charge : 0, 2)}</span><div class="tiny muted">not issued</div>`}</td>
        <td class="r num">${signed(r.paid)}</td>
        <td class="r num">${on ? `<b>${r.outstanding > 0.005 ? money(r.outstanding, 2) : r.outstanding < -0.005 ? money(-r.outstanding, 2) + ' credit' : money(0, 2)}</b>${Math.abs(r.other) > 0.005 ? `<div class="tiny muted">${r.other < 0 ? 'after' : 'plus'} ${money(Math.abs(r.other), 2)} other ${r.other < 0 ? 'credits' : 'charges'}</div>` : ''}` : '<span class="muted">—</span>'}</td>
        <td>${status(r)}</td>
        <td class="r" style="white-space:nowrap">${on && r.outstanding > 0.005 ? `<button class="btn sm green" data-full="${r.id}">Paid in full</button> ` : ''}<button class="btn sm" data-pay="${r.id}">Record payment</button></td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${b.generated ? signed(c.totals.charge) : money(b.raised, 2)}</td><td class="r">${signed(c.totals.paid)}</td><td class="r">${b.generated ? money(Math.max(0, c.totals.outstanding), 2) : '—'}</td><td></td><td></td></tr></tfoot></table></div>
      <p class="tiny muted" style="margin:0">Outstanding is the year’s charge less payments, after anything else on the household’s account for that year: let income, purchases, one-off charges. In total across all years, households owe ${money(owedAll, 2)}. To remove a payment recorded by mistake, open the household’s account.</p></section>`;
  const reload = () => admOverview(el);
  bindYears(el, reload);
  const saveRate = guard(async v => { await api('/admin/budget-year/' + c.year, { method: 'PUT', body: { rate_per_week: v } }); reload(); });
  $('#rate', el).onchange = e => saveRate(e.target.value);
  el.querySelectorAll('[data-round]').forEach(x => x.onclick = () => { const n = +x.dataset.round; saveRate(Math.round(b.rate_calc / n) * n); });
  $('#gen', el).onclick = guard(async () => { if (!confirm(`${b.generated ? 'Re-issue' : 'Issue'} the ${c.year} service charges at ${money(b.rate, 2)} per week (total ${money(b.raised, 2)})?${b.generated ? '' : ' Each household’s admin is told.'}`)) return;
    await api('/admin/budget/generate', { body: { year: c.year } }); toast(`${c.year} service charges issued`); reload(); });
  $('#bbf', el).onsubmit = guard(async e => { e.preventDefault(); await api('/admin/bank-balances', { body: formData(e.target) }); toast('Bank balance added'); reload(); });
  el.querySelectorAll('[data-bbdel]').forEach(b => b.onclick = guard(async () => { if (!confirm('Delete this bank balance?')) return; await api('/admin/bank-balances/' + b.dataset.bbdel, { method: 'DELETE' }); reload(); }));
  el.querySelectorAll('[data-conf]').forEach(b => b.onclick = guard(async () => { await api(`/admin/bookings/${b.dataset.conf}/confirm`, { body: {} }); toast('Payment confirmed'); reload(); }));
  el.querySelectorAll('[data-tuconf]').forEach(b => b.onclick = guard(async () => { const amt = prompt('Amount received (£):', b.dataset.amt); if (amt === null) return;
    await api(`/admin/topups/${b.dataset.tuconf}/confirm`, { body: { amount: amt } }); toast('Top-up added to their account'); reload(); }));
  el.querySelectorAll('[data-tucan]').forEach(b => b.onclick = guard(async () => { if (!confirm('Cancel this expected top-up?')) return; await api(`/topups/${b.dataset.tucan}/cancel`, { body: {} }); toast('Cancelled'); reload(); }));
  el.querySelectorAll('[data-rej]').forEach(b => b.onclick = guard(async () => { if (!confirm('Cancel this reservation and release the week?')) return; await api(`/bookings/${b.dataset.rej}/cancel`, { body: {} }); reload(); }));
  el.querySelectorAll('[data-full]').forEach(b => b.onclick = guard(async () => { const r = c.rows.find(x => x.id == b.dataset.full);
    if (!confirm(`Record ${money(r.outstanding, 2)} received today from ${r.name}, paying their ${c.year} service charge in full?`)) return;
    await api('/admin/ledger', { body: { family_id: r.id, year: c.year, type: 'payment', amount: r.outstanding, date: today } }); toast(`${r.name}: paid in full`); reload(); }));
  el.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    const r = c.rows.find(x => x.id == b.dataset.pay);
    const m = openModal(`<form id="lp"><h2>${esc(r.name)}: record a payment</h2>
      <p class="small muted" style="margin-top:0">${!issued(r) ? `The ${c.year} charges haven’t been issued yet${plan[r.id] ? ` (${esc(r.name)}’s will be ${money(plan[r.id].charge, 2)})` : ''}. A payment recorded now counts towards it.` : r.outstanding > 0.005 ? `Outstanding for ${c.year}: <b>${money(r.outstanding, 2)}</b>. Enter less for a part payment.` : `Nothing is outstanding for ${c.year}.`}</p>
      <div class="grid-2" style="gap:12px"><div class="field"><label>Type</label><select name="type"><option value="payment">Payment received</option><option value="adjustment">Adjustment (+ charge / − credit)</option></select></div>
      <div class="field"><label>Service-charge year</label><input name="year" type="number" value="${c.year}" required></div></div>
      <div class="grid-2" style="gap:12px"><div class="field"><label>Amount (£)</label><input name="amount" type="number" step="0.01" value="${r.outstanding > 0.005 ? r.outstanding : ''}" required></div>
      <div class="field"><label>Date received</label><input name="date" type="date" value="${today}"></div></div>
      <div class="field"><label>Reference or note (optional)</label><input name="description" placeholder="e.g. Bank transfer, first instalment"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    $('#lp', m).onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target);
      if (d.description && d.type === 'payment') d.description = `Payment received ${dfmt(d.date || today)} ${(d.date || today).slice(0, 4)}: ${d.description}`;
      await api('/admin/ledger', { body: { ...d, family_id: r.id } }); closeOverlay(); toast('Recorded'); reload(); });
  });
}
// how a budget line is paid for: added to the service charge, or from the bank balance
const paidFrom = v => `<select name="funding"><option value="charge" ${v !== 'bank' ? 'selected' : ''}>Service charge</option><option value="bank" ${v === 'bank' ? 'selected' : ''}>Bank balance</option></select>`;
async function admServiceCharge(el) {
  const year = S.year, [b, d] = await Promise.all([api('/admin/budget?year=' + year), api('/costs')]);
  const over = b.bank_total > 0.005 && (!b.bank || b.bank_total > b.bank.amount + 0.005);   // bank lines more than the balance (e.g. a lower balance recorded since)
  const cats = [...new Set(b.items.map(i => i.category).filter(Boolean))], cur = S.me.settings.currency;
  const row = i => `<tr data-id="${i.id}"><td><input name="description" value="${esc(i.description)}"></td><td class="r"><input name="amount" type="number" step="0.01" value="${i.amount}" style="text-align:right"></td><td>${paidFrom(i.funding)}</td>
    <td><input name="category" value="${esc(i.category || '')}" list="cats"></td>
    <td>${i.cost ? `<div class="small">${costOrigin(i.cost)}</div><span class="badge ${i.cost.tone}">${i.cost.tone === 'blue' ? 'Put forward: for the AGM' : 'Adopted'}</span>` : `<input name="notes" value="${esc(i.notes || '')}">`}</td>
    <td>${i.cost ? `<button class="iconbtn" data-bump="${i.cost.id}" title="Bump or cancel">${icon('trash-2')}</button>` : `<button class="iconbtn" data-del="${i.id}" title="Remove">${icon('trash-2')}</button>`}</td></tr>`;
  el.innerHTML = `<p class="muted" style="max-width:75ch;margin-top:0">${SC_INTRO}</p>
    ${pageBar(yearPicker(), `<button class="btn" id="imp">Import from spreadsheet</button><button class="btn" id="copy">Copy from ${year - 1}…</button>`)}
    <div class="row" style="margin-bottom:14px"><div class="field" style="margin:0;min-width:260px"><label>Budget period for ${year}</label><input id="blabel" value="${esc(b.label)}" placeholder="e.g. July ${year - 1} – June ${year}"></div></div>
    <section class="stack" style="margin-bottom:24px"><div class="table-wrap"><table style="table-layout:fixed;min-width:900px"><colgroup><col style="width:24%"><col style="width:120px"><col style="width:160px"><col style="width:110px"><col><col style="width:56px"></colgroup><thead><tr><th>Item</th><th class="r">Amount (${cur})</th><th>Paid from</th><th>Type</th><th>Commentary</th><th></th></tr></thead><tbody>
      ${b.items.map(row).join('')}
      <tr id="newrow"><td><input name="description" placeholder="New item…"></td><td class="r"><input name="amount" type="number" step="0.01" placeholder="0" style="text-align:right"></td><td>${paidFrom('charge')}</td><td><input name="category" placeholder="Type" list="cats"></td><td><input name="notes" placeholder="Commentary"></td><td><button class="btn sm primary" id="addi">Add</button></td></tr>
      </tbody><tfoot><tr><td>Added to the service charge</td><td class="r num">${money(b.charge_total, 2)}</td><td colspan="4"></td></tr>
        <tr><td>Paid from the bank balance</td><td class="r num" ${over ? 'style="color:var(--st-alert-ink)"' : ''}>${money(b.bank_total, 2)}</td><td colspan="4" class="small ${over ? '' : 'muted'}" ${over ? 'style="color:var(--st-alert-ink)"' : ''}>${b.bank ? (over ? `More than the ${money(b.bank.amount, 2)} bank balance on ${dfmt(b.bank.as_of, { day: 'numeric', month: 'short', year: 'numeric' })}: move some lines to the service charge, or bump them` : `Bank balance ${money(b.bank.amount, 2)} on ${dfmt(b.bank.as_of, { day: 'numeric', month: 'short', year: 'numeric' })}`) : 'No bank balance recorded yet (add it on Payments)'}</td></tr>
        <tr><td>Total</td><td class="r num">${money(b.total, 2)}</td><td colspan="4"></td></tr></tfoot></table></div>
      <datalist id="cats">${['Regular', 'Postpone', 'Provision', 'One-off', ...cats].filter((v, i, a) => a.indexOf(v) === i).map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <p class="tiny muted" style="margin:0">Changes save when you leave a field. Lines from adopted costs show where they came from; the bin bumps or cancels them.</p></section>
    <div class="grid-2" style="align-items:start">${chargeCard(b, true)}${waitingCosts(d, true)}</div>`;
  const reload = () => admServiceCharge(el);
  bindYears(el, reload);
  // each field saves when it changes; if the server refuses (e.g. too much from the bank balance) the page reloads to what's saved
  el.querySelectorAll('tr[data-id] input, tr[data-id] select').forEach(inp => inp.onchange = guard(async () => { try { await api('/admin/budget/' + inp.closest('tr').dataset.id, { method: 'PUT', body: { [inp.name]: inp.value } }); } finally { reload(); } }));
  el.querySelectorAll('[data-del]').forEach(x => x.onclick = guard(async () => { await api('/admin/budget/' + x.dataset.del, { method: 'DELETE' }); reload(); }));
  $('#addi', el).onclick = guard(async () => { const r = $('#newrow', el); const v = Object.fromEntries([...r.querySelectorAll('input, select')].map(i => [i.name, i.value])); await api('/admin/budget', { body: { ...v, year } }); reload(); });
  $('#blabel', el).onchange = guard(async e => { await api('/admin/budget-year/' + year, { method: 'PUT', body: { label: e.target.value } }); reload(); });
  bindCosts(el, d, reload, b.items.map(i => i.cost).filter(Boolean));
  $('#copy', el).onclick = () => { const m = openModal(`<form id="cf"><h2>Start ${year} from ${year - 1}</h2><p class="small muted" style="margin-top:0">One-off lines (adopted costs, and any line whose type is One-off) stay in ${year - 1}: they aren’t yearly costs.</p><div class="field"><label>Inflation uplift %</label><input name="uplift_pct" type="number" step="0.1" value="3"></div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Copy</button></div></form>`);
    $('#cf', m).onsubmit = guard(async e => { e.preventDefault(); const r = await api('/admin/budget/copy', { body: { from: year - 1, to: year, ...formData(e.target) } }); closeOverlay();
      toast(`Copied ${r.copied} line${r.copied === 1 ? '' : 's'}${r.skipped ? `; ${r.skipped} one-off line${r.skipped > 1 ? 's' : ''} left in ${year - 1}` : ''}`); reload(); }); };
  $('#imp', el).onclick = () => importDialog('budget', year, reload);
}
async function admWeeks(el) {
  const year = S.year, weeks = await api('/weeks?year=' + year); const fams = (await api('/admin/families?year=' + year)).filter(f => f.active);
  const counts = {}; weeks.forEach(w => counts[w.original_family_id] = (counts[w.original_family_id] || 0) + 1);
  const draft = weeks.length && weeks[0].year_open;
  el.innerHTML = `${pageBar(yearPicker(), `<button class="btn" data-new>${icon('plus')}Add year…</button><button class="btn" id="imp">Import allocation</button><button class="btn" id="rot">Roll forward from ${year - 1}…</button>`)}
    ${weeks.length ? `<div class="table-bar">${draft ? `<span><b>${year} allocation</b> <span class="badge amber">Draft</span> <span class="muted small">Families ask you for any changes. Make them below, then sign off.</span></span><button class="btn primary sm" id="signoff">Sign off ${year} allocation</button>`
      : `<span><b>${year} allocation</b> <span class="badge green">Signed off</span></span>${year > new Date().getFullYear() ? '<button class="btn sm" id="reopen">Reopen as draft</button>' : ''}`}</div>
    <div class="table-wrap"><table><thead><tr><th>Week</th><th>Starts</th><th>School hols</th><th>Season</th><th>Allocated to</th></tr></thead><tbody>
    ${weeks.map(w => `<tr data-id="${w.id}"><td><b>${w.week_no}</b></td><td><input type="date" name="start_date" value="${w.start_date}" style="max-width:150px"><div class="tiny muted">${dfmt(w.start_date, { weekday: 'long' })}${nights(w) !== 7 ? ` · ${nights(w)} nights` : ''}</div></td>
      <td><input type="checkbox" name="school_holiday" ${w.school_holiday ? 'checked' : ''}></td>
      <td><select name="season" style="max-width:120px">${['summer', 'shoulder', 'winter'].map(s => `<option ${s === w.season ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><select name="family_id" style="max-width:180px" ${['pending', 'booked'].includes(w.status) ? 'disabled' : ''}><option value="">Syndicate (unallocated)</option>${fams.map(f => `<option value="${f.id}" ${f.id === w.original_family_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
    <p class="tiny muted">Changing “Allocated to” resets that week’s holder. Weeks with a booking can’t be reallocated. Changing a start date also moves the end of the week before.</p>` : '<div class="card empty">No weeks for this year yet.</div>'}`;
  bindYears(el, () => admWeeks(el));
  const signOff = guard(async () => { await api(`/admin/years/${year}/signoff`, { body: {} }); closeOverlay(); await refreshMe(); toast(`${year} allocation signed off`); admWeeks(el); });
  const so = $('#signoff', el); if (so) so.onclick = () => {
    // before signing off, check each family's allocated weeks against its shares for the year (Families page)
    const off = fams.map(f => ({ name: f.name, weeks: counts[f.id] || 0, shares: f.shares })).filter(x => x.weeks !== x.shares);
    if (!off.length) { if (confirm(`Every family’s ${year} weeks match its shares. Sign off the ${year} allocation? Every family is told it’s agreed, and that ${year} weeks are now bought and sold.`)) signOff(); return; }
    const m = openModal(`<h2>The ${year} allocation doesn’t match the shares</h2>
      <p class="small muted" style="margin-top:0">Each family should have one week per share, as set for ${year} on the Families page.</p>
      <div class="table-wrap"><table><thead><tr><th>Family</th><th class="r">Weeks allocated</th><th class="r">Shares ${year}</th><th class="r">Difference</th></tr></thead><tbody>
      ${off.map(x => `<tr><td>${esc(x.name)}</td><td class="r num">${x.weeks}</td><td class="r num">${x.shares}</td><td class="r num" style="color:var(--st-alert-ink)">${x.weeks > x.shares ? `${x.weeks - x.shares} too many` : `${x.shares - x.weeks} short`}</td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn danger" id="soAnyway">Sign off anyway</button><button class="btn primary" data-close>Go back and fix</button></div>`);
    $('#soAnyway', m).onclick = signOff;
  };
  const ro = $('#reopen', el); if (ro) ro.onclick = guard(async () => { if (!confirm(`Mark the ${year} allocation as a draft again?`)) return; await api(`/admin/years/${year}/signoff`, { body: { undo: true } }); await refreshMe(); toast('Back to draft'); admWeeks(el); });
  $('[data-new]', el).onclick = guard(async () => { const y = Number(prompt('Create weeks for which year?', Math.max(...S.me.years) + 1)); if (!y) return; const r = await api('/admin/years', { body: { year: y } }); toast(`Created ${r.weeks} weeks for ${y}`); await refreshMe(); S.year = y; admWeeks(el); });
  el.querySelectorAll('tr[data-id] select, tr[data-id] input').forEach(s => s.onchange = guard(async () => { await api('/admin/weeks/' + s.closest('tr').dataset.id, { method: 'PUT', body: { [s.name]: s.type === 'checkbox' ? s.checked : s.value } }); toast('Saved'); admWeeks(el); }));
  $('#imp', el).onclick = () => importDialog('allocation', year, async () => { await refreshMe(); admWeeks(el); }, weeks);
  $('#rot', el).onclick = () => { const m = openModal(`<form id="rf"><h2>Roll allocation forward</h2><p class="muted small">Copies ${year - 1}’s allocation into ${year}, optionally shifting every family along by a number of weeks so peak weeks rotate fairly. Bookings in ${year} are kept.</p>
      <div class="field"><label>Shift by (weeks)</label><input name="shift" type="number" value="0"></div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Apply</button></div></form>`);
    $('#rf', m).onsubmit = guard(async e => { e.preventDefault(); await api('/admin/allocation/rotate', { body: { from: year - 1, to: year, ...formData(e.target) } }); closeOverlay(); await refreshMe(); admWeeks(el); }); };
}

async function admFamilies(el) {
  const year = S.year, fams = (await api('/admin/families?year=' + year)).filter(f => f.active), TOTAL = 52;
  el.innerHTML = `${pageBar(yearPicker(), `<button class="btn" id="sfw">Fill in from the ${year} allocation</button><button class="btn" id="addf">${icon('plus')}Add family</button>`)}
    <p class="muted small" style="margin:0 0 14px;max-width:75ch">Each family’s shares for ${year}. One share is one week, and the ${year} service charge is charged per share. The shares must total ${TOTAL}. Make your changes, then press Save.</p>
    <form id="famf"><div class="table-wrap"><table><thead><tr><th>Colour</th><th>Family</th><th>Shares ${year}</th><th>Family admins</th></tr></thead><tbody>
    ${fams.map(f => `<tr data-id="${f.id}" data-alloc="${f.allocated ?? ''}"><td><input type="color" name="color" value="${f.color}" style="width:44px;padding:2px;height:32px"></td><td><input name="name" value="${esc(f.name)}" required></td>
      <td><input name="share_units" type="number" step="1" min="0" value="${f.shares}" style="max-width:110px" required></td>
      <td class="small">${f.admins.map(esc).join(', ') || '<span class="badge amber">None</span>'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td>Total</td><td id="famTotal"></td><td></td></tr></tfoot></table></div>
    <div class="row between" style="margin-top:14px"><span class="small" id="famMsg"></span><button class="btn primary" id="famSave" disabled>Save ${year}</button></div></form>
    <p class="tiny muted">To add a family admin, go to Users and add a person with the Family admin role.</p>`;
  const rows = () => [...el.querySelectorAll('tr[data-id]')].map(tr => ({ id: Number(tr.dataset.id), name: $('[name=name]', tr).value, color: $('[name=color]', tr).value, share_units: $('[name=share_units]', tr).value }));
  const start = JSON.stringify(rows());
  const check = () => {
    const rs = rows(), total = rs.reduce((a, r) => a + (Number(r.share_units) || 0), 0), changed = JSON.stringify(rs) !== start, good = total === TOTAL;
    $('#famTotal', el).innerHTML = `<b>${total}</b> of ${TOTAL}`;
    $('#famMsg', el).innerHTML = good ? (changed ? '<span class="muted">Unsaved changes</span>' : '<span class="muted">Saved</span>') : `<span style="color:var(--st-alert-ink, #8a3b33)">The shares must total ${TOTAL}: ${total > TOTAL ? `${total - TOTAL} too many` : `${TOTAL - total} short`}.</span>`;
    $('#famSave', el).disabled = !changed;   // clickable once anything changes; it explains if the total isn't right
    return { total, good };
  };
  check();
  el.querySelectorAll('#famf input').forEach(i => i.addEventListener('input', check));
  el.querySelectorAll('#famf input[type=color]').forEach(i => i.addEventListener('change', check));
  $('#famf', el).onsubmit = guard(async e => { e.preventDefault(); const { total, good } = check();
    if (!good) { toast(`Not saved: the ${year} shares must total ${TOTAL}, and they total ${total} (${total > TOTAL ? `${total - TOTAL} too many` : `${TOTAL - total} short`}).`, true); return; }
    await api('/admin/families/save', { body: { year, rows: rows() } }); toast(`${year} saved`); await refreshMe(); admFamilies(el); });
  bindYears(el, () => admFamilies(el), () => !$('#famSave', el) || $('#famSave', el).disabled || confirm('You have unsaved changes. Leave without saving?'));
  $('#sfw', el).onclick = () => { el.querySelectorAll('tr[data-id]').forEach(tr => { if (tr.dataset.alloc !== '') $('[name=share_units]', tr).value = tr.dataset.alloc; }); check(); toast('Filled in from the allocation. Check the total, then Save'); };
  $('#addf', el).onclick = guard(async () => { const n = prompt('Family name'); if (!n) return; await api('/admin/families', { body: { name: n, share_units: 0, color: '#' + Math.floor(Math.random() * 0xaaaaaa + 0x222222).toString(16) } }); await refreshMe(); admFamilies(el); });
}
async function admUsers(el) {
  const people = await api('/people?all=1');
  el.innerHTML = `${pageBar(`<span class="muted small">${people.filter(p => p.active).length} active logins</span>`, `<button class="btn" id="addu">${icon('plus')}Add person</button>`)}
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
    <form id="sf"><div class="grid-2" style="align-items:start">
    <div class="card"><h3>Prices (per week)</h3><p class="small muted" style="margin-top:0">Used for any released week unless the family sets its own price. Members and trusted friends pay the same.</p>
      <div class="grid-2" style="gap:12px">${f('rate_school', '<i class="season school"></i> School holidays', 'number', 'min=0')}${f('rate_summer', '<i class="season summer"></i> Summer', 'number', 'min=0')}${f('rate_shoulder', '<i class="season shoulder"></i> Shoulder', 'number', 'min=0')}${f('rate_winter', '<i class="season winter"></i> Winter', 'number', 'min=0')}</div>
      <div class="grid-2" style="gap:12px">${f('members_first_days', 'Days for “Members first” releases', 'number', 'min=0')}${f('enquiry_hours', 'Hours of first refusal for enquirers', 'number', 'min=0')}</div>
      <h3 style="margin-top:8px">Releases &amp; reminders</h3>
      ${f('reminder_weeks', 'Remind about undecided weeks at (weeks before, comma-separated)')}
      <h3 style="margin-top:8px">Seasons</h3><p class="small muted" style="margin-top:0">Months (1–12) used when new years are created. You can override individual weeks under Weeks.</p>
      <div class="grid-2" style="gap:12px">${f('summer_months', 'Summer months')}${f('shoulder_months', 'Shoulder months')}</div>
      <h3 style="margin-top:8px">Booking rules</h3><div class="grid-2" style="gap:12px">${f('hold_days', 'Days to pay before a hold lapses', 'number', 'min=1')}${f('letting_cost', 'Letting cost per let, to the maintenance fund (£)', 'number', 'min=0')}</div>
      <label class="check"><input type="checkbox" name="allow_member_account_charge" ${s.allow_member_account_charge === '1' ? 'checked' : ''}><span><b>Family members can charge weeks to their family account</b>If off, only family admins can; members pay by bank transfer.</span></label>
      <label class="check" style="margin-top:8px"><input type="checkbox" name="view_as_enabled" ${s.view_as_enabled !== '0' ? 'checked' : ''}><span><b>Site admin can “View as” other logins</b>For testing: see the portal exactly as a family admin, member or trusted friend sees it, from the dropdown in the menu. Anything done while viewing as someone really happens, and the Activity log notes it.</span></label></div>
    <div class="card"><h3>Syndicate bank account</h3><p class="small muted" style="margin-top:0">Shown to people when they book a week.</p>
      ${f('bank_account_name', 'Account name')}${f('bank_name', 'Bank')}<div class="grid-2" style="gap:12px">${f('bank_sort_code', 'Sort code')}${f('bank_account_no', 'Account number')}</div>${f('bank_iban', 'IBAN (optional)')}
      <h3 style="margin-top:8px">Shares</h3><div class="grid-2" style="gap:12px">${f('share_price', 'Agreed price per share (£)', 'number', 'min=0 step=0.01')}${f('share_offer_days', 'Days an offer stays open for interest', 'number', 'min=1')}</div>
      <h3 style="margin-top:8px">General</h3><div class="grid-2" style="gap:12px">${f('site_name', 'Site name')}${f('currency', 'Currency symbol')}${f('place_line', 'Place line (under the name)')}</div>
      <h3 style="margin-top:8px">Changeover days</h3><p class="small muted" style="margin-top:0">Used when a new year’s weeks are created. Week 1 starts on the first winter changeover day on or after 26 December, so some years have 53 weeks.</p>
      <div class="grid-2" style="gap:12px">${daySel('winter_changeover_day', 'Winter changeover')}${daySel('summer_changeover_day', 'Summer changeover')}
      ${f('summer_changeover_from', 'Summer changeover from week', 'number', 'min=1 max=53')}${f('summer_changeover_to', '…to week (inclusive)', 'number', 'min=1 max=53')}</div></div>
    </div><div class="row" style="justify-content:flex-end;margin-top:var(--sp-4)"><button class="btn primary">Save settings</button></div></form>`;
  $('#heroFile', el).onchange = guard(async e => {
    const file = e.target.files[0]; if (!file) return;
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That file isn’t an image the browser can read')); i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, 2400 / img.naturalWidth), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    await api('/admin/hero', { body: { data: c.toDataURL('image/jpeg', 0.84) } }); toast('Photograph saved'); await refreshMe(); admSettings(el);
  });
  $('#heroRm', el) && ($('#heroRm', el).onclick = guard(async () => { if (!confirm('Remove the Overview photograph?')) return; await api('/admin/hero', { method: 'DELETE' }); toast('Photograph removed'); await refreshMe(); admSettings(el); }));
  // Start afresh: clear test activity, keeping every login (preview first, backup offered, then RESET to confirm)
  el.insertAdjacentHTML('beforeend', `<div class="card" id="resetCard" style="margin-top:var(--sp-6);border-color:var(--st-alert, #b4544a)"><h3>${icon('trash-2')} Start afresh</h3>
    <p class="small muted" style="margin:0 0 var(--sp-4);max-width:75ch">Clears all test activity: bookings and lets, enquiries and questions, upgrade suggestions and quotes, share offers, maintenance reports, top-ups, bank balances, notices and account lines. Every login is kept, including the demo logins (@example.com). Each week’s plan goes back to Undecided. Who holds each week, the families, budgets and settings are kept. Service charges are reissued from the budgets: 2026 paid in full, 2027 unpaid. The 2027 allocation goes back to draft.</p>
    <button type="button" class="btn" id="resetCheck">Check what would be removed</button><div id="resetPlan"></div></div>`);
  $('#resetCheck', el).onclick = guard(async () => {
    const p = await api('/admin/reset'), box = $('#resetPlan', el), yr = x => x.budget ? `${money(x.charges, 2)} from the ${x.year} budget${x.label ? ` (${esc(x.label)})` : ''}` : `no ${x.year} budget yet, so no charges`;
    box.innerHTML = `<ul class="small" style="margin:var(--sp-4) 0;line-height:1.8">
      <li>All logins kept${p.demo_logins ? `, including ${p.demo_logins} demo login${p.demo_logins === 1 ? '' : 's'}` : ''}</li>
      <li>${p.bookings} booking${p.bookings === 1 ? '' : 's'} and lets, ${p.enquiries} enquir${p.enquiries === 1 ? 'y' : 'ies'} and questions, ${p.costs} one-off cost${p.costs === 1 ? '' : 's'} (upgrades and quotes), ${p.share_offers} share offer${p.share_offers === 1 ? '' : 's'}, ${p.maintenance} maintenance report${p.maintenance === 1 ? '' : 's'}, ${p.topups} top-up${p.topups === 1 ? '' : 's'}, ${p.bank_balances} bank balance${p.bank_balances === 1 ? '' : 's'}, ${p.notifications} notice${p.notifications === 1 ? '' : 's'}</li>
      <li>${p.ledger_lines} account line${p.ledger_lines === 1 ? '' : 's'} cleared, so every family balance starts again from the service charges</li>
      <li>${p.weeks_reset} week${p.weeks_reset === 1 ? '' : 's'} set back to Undecided (who holds them is kept)</li>
      <li><b>2026:</b> ${yr(p.paid)}${p.paid.budget ? ', marked <b>paid in full</b>' : ''}</li>
      <li><b>2027:</b> ${yr(p.unpaid)}${p.unpaid.budget ? ', left <b>unpaid</b>' : '. Add the 2027 budget and press Issue charges afterwards.'}</li>
      <li>2027 allocation: ${p.signed_off ? 'set back to <b>draft</b>' : 'stays a <b>draft</b>'}</li></ul>
      <div class="row" style="gap:8px"><a class="btn" href="/api/admin/backup">${icon('arrow-right')} Download a backup first</a><button type="button" class="btn danger" id="resetGo">Remove it all</button></div>`;
    $('#resetGo', el).onclick = guard(async () => {
      if (prompt('This can’t be undone. Type RESET to clear the test data (logins are kept).') !== 'RESET') return;
      const r = await api('/admin/reset', { body: { confirm: 'RESET' } });
      toast('Done: test data cleared, logins kept'); setTimeout(() => { location.hash = '#/admin/overview'; location.reload(); }, 900);
    });
  });
  $('#sf', el).onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target); d.allow_member_account_charge = e.target.allow_member_account_charge.checked ? '1' : '0'; d.view_as_enabled = e.target.view_as_enabled.checked ? '1' : '0'; await api('/admin/settings', { method: 'PUT', body: d }); toast('Settings saved'); refreshMe(); });
}
async function admLets(el) {
  const year = S.year;
  const [c, all] = await Promise.all([api('/lets?year=' + year), api('/bookings?all=1')]);
  const bks = all.filter(b => b.week.year === year).sort((x, y) => x.week.start_date.localeCompare(y.week.start_date) || y.id - x.id);
  const bState = { pending: ['amber', 'Awaiting payment'], confirmed: ['blue', 'Paid'], cancelled: ['', 'Cancelled'], expired: ['', 'Expired'] };
  const bRow = b => { const [tone, label] = b.gift && b.status === 'confirmed' ? ['green', 'Given free'] : bState[b.status] || ['', b.status], live = ['pending', 'confirmed'].includes(b.status);
    return `<tr class="${live ? '' : 'muted'}"><td>${b.week.week_no} <span class="muted small">${dfmt(b.week.start_date)}</span></td>
      <td>${b.gift ? `${esc(b.buyer)}<div class="tiny muted">asked by ${esc(b.booker)}</div>` : esc(b.guest_name || b.booker)}${!b.gift && b.guest_name && b.guest_name !== b.booker ? `<div class="tiny muted">booked by ${esc(b.booker)}</div>` : ''}</td>
      <td>${esc(b.seller)}</td><td class="r num">${money(b.amount, 2)}</td><td class="small">${b.gift ? 'Free' : b.method === 'account' ? 'Account' : 'Bank'}</td>
      <td class="small"><code>${esc(b.reference)}</code></td><td><span class="badge ${tone}">${label}</span></td>
      <td class="r">${live ? `<button class="btn sm danger" data-bcancel="${b.id}">Cancel</button>` : ''}</td></tr>`; };
  el.innerHTML = `${pageBar(yearPicker())}
    <div class="table-wrap"><table><thead><tr><th>Household</th><th class="r">Shares</th><th class="r">Weeks held</th><th class="r">Released</th><th class="r">Lets</th><th class="r">Let income credited</th></tr></thead><tbody>
    ${c.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="r num">${r.shares}</td><td class="r num">${r.weeks}</td><td class="r num">${r.released_weeks}</td><td class="r num">${r.lets}</td><td class="r num">${money(r.let_income, 2)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td class="r">${c.rows.reduce((a, r) => a + r.shares, 0)}</td><td class="r">${c.rows.reduce((a, r) => a + r.weeks, 0)}</td><td class="r">${c.rows.reduce((a, r) => a + r.released_weeks, 0)}</td><td class="r">${c.income.lets}</td><td class="r">${money(c.income.credited, 2)}</td></tr></tfoot></table></div>
    <div class="card" style="margin-top:20px;max-width:760px"><h3>Let income</h3><p class="small" style="margin:0">When a released ${year} week lets and the payment is confirmed, the household that released it is credited with the payment less the ${money(S.me.settings.letting_cost || 0)} letting cost, which goes to the maintenance fund.
      So far: ${money(c.income.gross, 2)} from ${c.income.lets} let${c.income.lets === 1 ? '' : 's'}, of which <b>${money(c.income.fund, 2)}</b> to the maintenance fund. Credit comes off the household’s service charge and any extra carries forward.</p></div>
    <section class="stack" style="margin-top:28px"><h2>Bookings ${year}</h2><p class="muted small" style="margin:0">Every booking of a ${year} week. You can cancel one that is awaiting payment or paid: the guest and the household are told, any let income credited is reversed and the week goes back on offer.</p>
    ${bks.length ? `<div class="table-wrap"><table><thead><tr><th>Week</th><th>Guest</th><th>Household</th><th class="r">Amount</th><th>Paid by</th><th>Ref</th><th>Status</th><th></th></tr></thead><tbody>${bks.map(bRow).join('')}</tbody></table></div>` : `<div class="card flat empty small">No bookings for ${year} yet</div>`}</section>`;
  bindYears(el, () => admLets(el));
  el.querySelectorAll('[data-bcancel]').forEach(btn => btn.onclick = () => { const b = bks.find(x => x.id == btn.dataset.bcancel);
    cancelBookingModal({ ...b, gift: !!b.gift, guest: b.guest_name || b.booker, label: `Week ${b.week.week_no} · ${dfmt(b.week.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}` }, () => { admLets(el); refreshMe(); }); });
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
