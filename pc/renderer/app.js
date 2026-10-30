const PALETTE = [['#CECBF6', '#3C3489'], ['#F5C4B3', '#712B13'], ['#9FE1CB', '#085041'], ['#F4C0D1', '#72243E'], ['#B5D4F4', '#0C447C'], ['#FAC775', '#633806']];
const KIND = { missed: 'Appel en absence', in: 'Appel reçu', out: 'Appel émis', rejected: 'Appel refusé', voicemail: 'Message vocal' };

const state = {
  icons: {}, threads: [], msgs: {}, notifs: [], calls: [], seenCallId: 0, cur: null, filter: 'all',
  connected: false, device: '', battery: null,
  settings: { theme: 'auto', glass: 0.14, blur: 22, toasts: true, autostart: true, muted: {}, apps: {} }
};
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

function colorFor(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}

function fmtDuration(s) {
  if (!s) return '';
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

/** Nom d'application précédé de son icône, si le téléphone l'a envoyée. */
function appLabel(pkg, label) {
  const box = el('span', 'applabel');
  const src = state.icons[pkg];
  if (src) {
    const img = el('img', 'appic');
    img.alt = '';
    img.src = src;
    box.append(img);
  }
  box.append(document.createTextNode(label));
  return box;
}

function avatar(name) {
  const [bg, fg] = colorFor(name);
  const av = el('div', 'av', initials(name));
  av.style.background = bg;
  av.style.color = fg;
  return av;
}

/* Apparence */
function applyAppearance() {
  const s = state.settings;
  const light = s.theme === 'light' || (s.theme === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches);
  const root = document.documentElement;
  root.dataset.theme = light ? 'light' : 'dark';
  root.style.setProperty('--glass-a', String(light ? Math.min(0.9, s.glass + 0.32) : s.glass));
  root.style.setProperty('--glass-blur', s.blur + 'px');
}

/* Messages : SMS et conversations des messageries (Messenger, WhatsApp…) dans la même liste */
const isApp = (t) => t.kind === 'app';
const threadVisible = (t) => !(isApp(t) && state.settings.muted[t.pkg]);

/** Pastille d'application posée sur l'avatar d'une conversation de messagerie. */
function avatarWithApp(t) {
  const wrap = el('div', 'avw');
  wrap.append(avatar(t.name || t.address));
  if (isApp(t)) {
    const badge = el('div', 'appbadge');
    const src = state.icons[t.pkg];
    if (src) {
      const img = el('img');
      img.alt = '';
      img.src = src;
      badge.append(img);
    } else {
      badge.textContent = (t.app || '?')[0].toUpperCase();
    }
    wrap.append(badge);
  }
  return wrap;
}

function renderFilters() {
  const box = $('threadChips');
  box.replaceChildren();
  const sources = [['all', 'Toutes']];
  if (state.threads.some((t) => !isApp(t))) sources.push(['sms', 'SMS']);
  const seen = new Set();
  for (const t of state.threads) {
    if (isApp(t) && threadVisible(t) && !seen.has(t.pkg)) {
      seen.add(t.pkg);
      sources.push([t.pkg, t.app]);
    }
  }
  if (!sources.some(([k]) => k === state.filter)) state.filter = 'all';
  for (const [key, label] of sources) {
    const b = el('button', 'chip' + (key === state.filter ? ' on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => { state.filter = key; renderThreads(); });
    box.append(b);
  }
  box.classList.toggle('hidden', sources.length < 3);
}

function renderThreads() {
  renderFilters();
  const box = $('threads');
  box.replaceChildren();
  const list = state.threads.filter((t) =>
    threadVisible(t) && (state.filter === 'all' || (state.filter === 'sms' ? !isApp(t) : t.pkg === state.filter)));
  if (!list.length) box.append(el('p', 'empty', 'Aucune conversation'));
  for (const t of list) {
    const row = el('div', 'thread' + (t.id === state.cur ? ' on' : ''));
    const info = el('div', 'tinfo');
    info.append(el('div', 'tname', t.name || t.address), el('div', 'tsnip', t.snippet || ''));
    row.append(avatarWithApp(t), info);
    if (t.unread) row.append(el('span', 'badge', String(t.unread)));
    row.addEventListener('click', () => openThread(t.id));
    box.append(row);
  }
}

function renderMsgs() {
  const box = $('msgs');
  box.replaceChildren();
  const t = state.threads.find((x) => x.id === state.cur);
  $('chatTitle').replaceChildren();
  $('chatTitle').append(el('span', null, t ? (t.name || t.address) : 'Sélectionnez une conversation'));
  if (t && isApp(t)) $('chatTitle').append(appLabel(t.pkg, t.app));
  if (!t) box.append(el('p', 'empty', 'Choisissez une conversation à gauche'));

  const appThread = !!t && isApp(t);
  $('appNote').classList.toggle('hidden', !appThread);
  const input = $('composeInput');
  const canReply = !!t && (!appThread || t.canReply);
  input.disabled = !canReply;
  $('sendBtn').disabled = !canReply;
  input.placeholder = canReply ? 'Écrire un message' : 'Réponse impossible : notification fermée sur le téléphone';
  $('via').textContent = appThread && canReply ? `Votre réponse sera envoyée depuis ${t.app} sur le téléphone.` : '';
  $('via').classList.toggle('hidden', !($('via').textContent));

  for (const m of state.msgs[state.cur] || []) {
    if (appThread && t.group && !m.out && m.sender) box.append(el('div', 'who', m.sender));
    const b = el('div', 'm ' + (m.out ? 'out' : 'in'));
    for (const src of m.images || []) {
      const img = el('img');
      img.alt = 'Photo reçue';
      img.src = src;
      img.addEventListener('load', () => { box.scrollTop = box.scrollHeight; });
      b.append(img);
    }
    if (m.body) b.append(document.createTextNode(m.body));
    b.append(el('time', null, fmtTime(m.date)));
    box.append(b);
  }
  box.scrollTop = box.scrollHeight;
}

function openThread(id) {
  state.cur = id;
  const t = state.threads.find((x) => x.id === id);
  if (t) t.unread = 0;
  showTab('messages');
  renderThreads();
  renderMsgs();
  if (t && !isApp(t)) window.bridge.send({ t: 'get_thread', threadId: id });
}

/** Fusionne les messages d'une notification de messagerie dans sa conversation (sans doublons). */
function addConv(m) {
  const c = m.conv;
  let t = state.threads.find((x) => x.id === c.id);
  if (!t) {
    t = { id: c.id, kind: 'app', pkg: m.pkg, app: m.app, name: c.name, group: !!c.group, unread: 0, date: 0, seen: new Set() };
    state.threads.push(t);
    state.msgs[c.id] = [];
  }
  t.replyKey = m.key;
  t.canReply = !!m.canReply;
  const list = state.msgs[c.id];
  for (const x of c.messages || []) {
    const key = `${x.time}|${x.sender}|${x.text}`;
    if (t.seen.has(key)) continue;
    t.seen.add(key);
    // Une réponse déjà envoyée depuis le PC revient dans la notification : on n'affiche pas la bulle en double.
    if (x.out && list.some((o) => o.out && o.body === x.text && Math.abs(o.date - x.time) < 300000)) continue;
    list.push({ body: x.text, date: x.time, out: !!x.out, sender: x.sender });
    if (!x.out && c.id !== state.cur) t.unread = (t.unread || 0) + 1;
  }
  list.sort((a, b) => a.date - b.date);
  const last = list[list.length - 1];
  if (last) {
    t.snippet = (t.group && !last.out && last.sender ? last.sender + ' : ' : '') + last.body;
    t.date = last.date;
  }
  state.threads.sort((a, b) => (b.date || 0) - (a.date || 0));
  renderThreads();
  if (c.id === state.cur) renderMsgs();
}

/* Notifications */
function visibleNotifs() {
  return state.notifs.filter((n) => !state.settings.muted[n.pkg]);
}

function dismissNotif(n) {
  window.bridge.send({ t: 'dismiss_notif', key: n.key });
  state.notifs = state.notifs.filter((x) => x.key !== n.key);
  renderNotifs();
}

/** Glisser à deux doigts sur le pavé tactile (défilement horizontal) pour effacer la carte. */
function attachSwipe(card, n) {
  const LIMIT = 130;
  let dx = 0;
  let idle = null;
  let gone = false;

  const place = () => {
    card.style.transform = `translateX(${dx}px)`;
    card.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / 260));
  };

  card.addEventListener('wheel', (e) => {
    if (gone || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    card.style.transition = 'none';
    dx -= e.deltaX;
    place();
    if (Math.abs(dx) >= LIMIT) {
      gone = true;
      clearTimeout(idle);
      card.style.transition = 'transform .2s ease, opacity .2s ease';
      dx = dx > 0 ? 420 : -420;
      card.style.transform = `translateX(${dx}px)`;
      card.style.opacity = '0';
      setTimeout(() => dismissNotif(n), 200);
      return;
    }
    clearTimeout(idle);
    idle = setTimeout(() => {
      card.style.transition = 'transform .2s ease, opacity .2s ease';
      dx = 0;
      place();
    }, 180);
  }, { passive: false });
}

function renderNotifs() {
  const box = $('notifs');
  box.replaceChildren();
  const list = visibleNotifs();
  if (!list.length) box.append(el('p', 'empty', 'Aucune notification'));
  else box.append(el('p', 'swipehint', 'Glissez à deux doigts pour effacer'));
  for (const n of list) {
    const card = el('div', 'notif');
    attachSwipe(card, n);
    const head = el('div', 'nhead');
    head.append(appLabel(n.pkg, n.app), el('span', null, fmtTime(n.time)));
    card.append(head, el('div', 'ntitle', n.title || ''), el('div', 'ntext', n.text || ''));
    if (n.canReply) {
      const form = el('form', 'nreply');
      const inp = el('input');
      inp.placeholder = 'Répondre';
      inp.setAttribute('aria-label', 'Répondre à ' + (n.title || n.app));
      const btn = el('button', null, 'OK');
      btn.type = 'submit';
      form.append(inp, btn);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = inp.value.trim();
        if (!text) return;
        window.bridge.send({ t: 'reply_notif', key: n.key, text });
        inp.value = '';
        inp.placeholder = 'Envoyé';
      });
      card.append(form);
    }
    box.append(card);
  }
}

/* Appels */
function renderCalls() {
  const box = $('calls');
  box.replaceChildren();
  if (!state.calls.length) box.append(el('p', 'empty', 'Aucun appel'));
  for (const c of state.calls) {
    const row = el('div', 'call' + (c.kind === 'missed' ? ' missed' : ''));
    const info = el('div', 'tinfo');
    const sub = KIND[c.kind] || 'Appel';
    info.append(el('div', 'tname', c.name || c.number), el('div', 'ckind', c.number && c.name !== c.number ? `${sub} · ${c.number}` : sub));
    const time = el('div', 'ctime');
    time.append(el('div', null, fmtTime(c.date)), el('div', null, fmtDuration(c.duration)));
    row.append(avatar(c.name || c.number), info, time);
    box.append(row);
  }
  renderMissedBadge();
}

function renderMissedBadge() {
  const n = state.calls.filter((c) => c.kind === 'missed' && c.id > state.seenCallId).length;
  const b = $('missedBadge');
  b.textContent = String(n);
  b.classList.toggle('hidden', n === 0);
}

/* Réglages */
function renderSettings() {
  const s = state.settings;
  document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.theme));
  $('glass').value = Math.round(s.glass * 100);
  $('glassOut').textContent = Math.round(s.glass * 100) + ' %';
  $('blur').value = s.blur;
  $('blurOut').textContent = s.blur + ' px';
  $('toasts').checked = !!s.toasts;
  $('autostart').checked = !!s.autostart;
  $('autoUpdate').checked = s.autoUpdate !== false;

  const box = $('appList');
  box.replaceChildren();
  const apps = Object.entries(s.apps || {}).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  if (!apps.length) box.append(el('p', 'muted small', 'Aucune application pour le moment.'));
  for (const [pkg, label] of apps) {
    const row = el('label', 'row');
    row.append(appLabel(pkg, label));
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !s.muted[pkg];
    cb.setAttribute('aria-label', 'Notifications de ' + label);
    cb.addEventListener('change', () => window.bridge.setSettings({ mutePkg: pkg, muted: !cb.checked }));
    row.append(cb);
    box.append(row);
  }
}

function applySettings(s) {
  state.settings = { ...state.settings, ...s };
  applyAppearance();
  renderSettings();
  renderNotifs();
  renderThreads();
}

function renderState() {
  $('dot').classList.toggle('off', !state.connected);
  $('stateText').textContent = state.connected
    ? `${state.device} connecté` + (state.battery != null ? ` · ${state.battery} %` : '')
    : 'Téléphone déconnecté';
}

function showTab(tab) {
  document.querySelectorAll('.ri').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const grid = document.querySelector('.grid');
  for (const t of ['notifs', 'calls', 'settings']) grid.classList.toggle('show-' + t, tab === t);
  if (tab === 'calls') {
    state.seenCallId = Math.max(0, ...state.calls.map((c) => c.id));
    renderMissedBadge();
  }
}

function addIncoming(m) {
  const list = state.msgs[m.threadId] || (state.msgs[m.threadId] = []);
  list.push({ id: m.id, body: m.body, date: m.date, out: false, images: m.images });
  let t = state.threads.find((x) => x.id === m.threadId);
  if (!t) {
    t = { id: m.threadId, kind: 'sms', address: m.address, name: m.name, unread: 0 };
    state.threads.unshift(t);
  }
  t.snippet = m.body || (m.images && m.images.length ? 'Photo' : '');
  t.date = m.date;
  if (m.threadId !== state.cur) t.unread = (t.unread || 0) + 1;
  state.threads.sort((a, b) => b.date - a.date);
  renderThreads();
  if (m.threadId === state.cur) renderMsgs();
}

function addOutgoing(threadId, body) {
  const t = state.threads.find((x) => x.id === threadId);
  if (!t) return;
  (state.msgs[threadId] || (state.msgs[threadId] = [])).push({ body, date: Date.now(), out: true });
  t.snippet = body;
  t.date = Date.now();
  state.threads.sort((a, b) => b.date - a.date);
  if (threadId === state.cur) renderMsgs();
  renderThreads();
}

function onPhone(m) {
  switch (m.t) {
    case 'sms_list':
      state.threads = [
        ...state.threads.filter(isApp),
        ...(m.threads || []).map((t) => ({ ...t, kind: 'sms' }))
      ].sort((a, b) => (b.date || 0) - (a.date || 0));
      renderThreads();
      break;
    case 'sms_thread':
      state.msgs[m.threadId] = (m.messages || []).sort((a, b) => a.date - b.date);
      if (m.threadId === state.cur) renderMsgs();
      break;
    case 'sms_new':
      addIncoming(m);
      break;
    case 'notif':
      // Une notification de messagerie alimente sa conversation au lieu de la liste des notifications.
      if (m.conv) {
        addConv(m);
        break;
      }
      state.notifs = state.notifs.filter((n) => n.key !== m.key);
      state.notifs.unshift(m);
      state.notifs = state.notifs.slice(0, 100);
      renderNotifs();
      break;
    case 'notif_removed': {
      state.notifs = state.notifs.filter((n) => n.key !== m.key);
      renderNotifs();
      let changed = false;
      for (const t of state.threads) {
        if (isApp(t) && t.replyKey === m.key && t.canReply) { t.canReply = false; changed = true; }
      }
      if (changed) renderMsgs();
      break;
    }
    case 'calls':
      state.calls = m.calls || [];
      renderCalls();
      break;
    case 'battery':
      state.battery = m.pct;
      renderState();
      break;
  }
}

async function init() {
  const [info, settings, icons] = await Promise.all([window.bridge.pairingInfo(), window.bridge.getSettings(), window.bridge.getIcons()]);
  state.icons = icons || {};
  window.bridge.onIcon((o) => {
    state.icons[o.pkg] = o.icon;
    renderNotifs();
    renderSettings();
    renderThreads();
  });
  $('qr').src = info.qr;
  $('qr2').src = info.qr;
  $('addr').textContent = info.ips.map((ip) => `${ip}:${info.port}`).join('  ') || 'aucune connexion réseau';
  $('code').textContent = info.code;
  $('code2').textContent = info.ips[0] ? `${info.ips[0]}:${info.port}\n${info.code}` : info.code;
  applySettings(settings);
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyAppearance);

  window.bridge.onSettings(applySettings);
  window.bridge.onStatus((s) => {
    state.connected = s.connected;
    if (s.connected) {
      state.device = s.device;
      $('pair').classList.add('hidden');
      $('app').classList.remove('hidden');
      window.bridge.send({ t: 'get_threads' });
      window.bridge.send({ t: 'get_calls' });
    } else {
      state.battery = null;
      if (s.error) $('pairState').textContent = 'Erreur : ' + s.error;
    }
    renderState();
  });
  window.bridge.onMessage(onPhone);
  window.bridge.onLocalSent((o) => addOutgoing(o.threadId, o.body));
  window.bridge.onOpen((o) => {
    if (state.threads.some((t) => t.id === o.threadId)) openThread(o.threadId);
  });

  $('composeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('composeInput');
    const body = input.value.trim();
    const t = state.threads.find((x) => x.id === state.cur);
    if (!body || !t) return;
    if (isApp(t)) {
      if (!t.canReply) return;
      window.bridge.send({ t: 'reply_notif', key: t.replyKey, text: body });
    } else {
      window.bridge.send({ t: 'send_sms', to: t.address, threadId: t.id, body });
    }
    addOutgoing(t.id, body);
    input.value = '';
  });
  $('clearNotifs').addEventListener('click', () => {
    visibleNotifs().forEach((n) => window.bridge.send({ t: 'dismiss_notif', key: n.key }));
    state.notifs = state.notifs.filter((n) => state.settings.muted[n.pkg]);
    renderNotifs();
  });
  document.querySelectorAll('.ri').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  document.querySelectorAll('#themeSeg button').forEach((b) =>
    b.addEventListener('click', () => window.bridge.setSettings({ theme: b.dataset.v })));
  for (const [id, key, div] of [['glass', 'glass', 100], ['blur', 'blur', 1]]) {
    const input = $(id);
    input.addEventListener('input', () => {
      state.settings[key] = Number(input.value) / div;
      applyAppearance();
      $(id + 'Out').textContent = key === 'glass' ? input.value + ' %' : input.value + ' px';
    });
    input.addEventListener('change', () => window.bridge.setSettings({ [key]: Number(input.value) / div }));
  }
  $('toasts').addEventListener('change', (e) => window.bridge.setSettings({ toasts: e.target.checked }));
  $('autostart').addEventListener('change', (e) => window.bridge.setSettings({ autostart: e.target.checked }));

  $('autoUpdate').addEventListener('change', (e) => window.bridge.setSettings({ autoUpdate: e.target.checked }));
  initUpdates();

  renderThreads();
  renderMsgs();
  renderNotifs();
  renderCalls();
  renderState();
}

/* Mises à jour */
let updateDismissed = '';
const errText = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function showUpdate(u) {
  const label = u && u.canInstall ? 'Installer et redémarrer' : 'Voir la page de téléchargement';
  $('installUpdate').classList.toggle('hidden', !u);
  if (u) $('installUpdate').textContent = label;
  if (!u || u.version === updateDismissed) { $('updateBar').classList.add('hidden'); return; }
  $('updateText').textContent = `La version ${u.version} de PhoneBridge est disponible.`;
  $('updateGo').textContent = label;
  $('updateGo').disabled = false;
  $('updateBar').dataset.version = u.version;
  $('updateBar').classList.remove('hidden');
}

function initUpdates() {
  window.bridge.updateState().then((r) => {
    $('updateStatus').textContent = `Version installée : ${r.current}`;
    showUpdate(r.update);
  });
  window.bridge.onUpdateAvail(showUpdate);
  window.bridge.onUpdateProgress(({ got, total }) => {
    $('updateGo').textContent = total ? `Téléchargement… ${Math.floor((got / total) * 100)} %` : 'Téléchargement…';
  });
  $('updateGo').addEventListener('click', async () => {
    $('updateGo').disabled = true;
    try {
      await window.bridge.installUpdate();
    } catch (err) {
      $('updateText').textContent = errText(err);
      $('updateGo').disabled = false;
    }
  });
  $('updateX').addEventListener('click', () => {
    updateDismissed = $('updateBar').dataset.version || '';
    $('updateBar').classList.add('hidden');
  });
  $('installUpdate').addEventListener('click', () => $('updateGo').click());
  $('checkUpdate').addEventListener('click', async () => {
    $('updateStatus').textContent = 'Recherche en cours…';
    try {
      const r = await window.bridge.checkUpdate();
      updateDismissed = '';
      $('updateStatus').textContent = r.update
        ? `Version ${r.update.version} disponible (installée : ${r.current}).`
        : `Vous avez la dernière version (${r.current}).`;
      showUpdate(r.update);
    } catch (err) {
      $('updateStatus').textContent = `Recherche impossible : ${errText(err)}`;
    }
  });
}

init();
