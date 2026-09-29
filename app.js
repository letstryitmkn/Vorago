'use strict';

// ---------- Settings ----------
const DAILY_NOTES = 7;          // goal and cap per day
const REVIEW_AFTER_DAYS = 3;    // a forgotten note comes back this many days later
const SPLASH_MS = 3500;         // loading screen before "Touch to continue"
const NETWORK_TIMEOUT_MS = 4000; // give up on a slow connection and use saved copies
const STORE_KEY = 'vorago.v1';  // must differ from Retia's: both apps share letstryitmkn.github.io

const AI_LINKS = {
  chatgpt: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`,
  claude: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`,
};
const AI_NAMES = { chatgpt: 'ChatGPT', claude: 'Claude' };
const TEXT_SIZES = { s: 'Small', m: 'Medium', l: 'Large' };

// Testing helpers: ?reset clears progress, ?today=2026-10-02 pretends it's another day,
// ?nosplash skips the loading screen, ?sw turns on offline mode while testing on localhost
const params = new URLSearchParams(location.search);

// ---------- Saved progress (on this phone only) ----------
function freshState() {
  return {
    activePack: null, packs: {}, done: {}, days: {}, reviews: {}, lookups: [],
    settings: { ai: 'chatgpt', textSize: 'm' },
  };
}
function loadState() {
  const s = freshState();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      Object.assign(s, saved);
      s.settings = Object.assign(freshState().settings, saved.settings);
      s.lookups = saved.lookups || [];
    }
  } catch (e) { /* storage unavailable: start fresh */ }
  return s;
}
let state = params.has('reset') ? freshState() : loadState();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
if (params.has('reset')) save();

// ---------- Dates (local time, YYYY-MM-DD) ----------
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function today() { return params.get('today') || isoDate(new Date()); }
function addDays(iso, n) { const d = toDate(iso); d.setDate(d.getDate() + n); return isoDate(d); }
function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function shortDate(iso) { return toDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }

function toRoman(n) {
  const table = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

function dayRecord(date = today()) {
  if (!state.days[date]) state.days[date] = { read: [], results: {}, sealed: false, recalled: false };
  return state.days[date];
}

// ---------- Packs (Cantos) ----------
// Pack format: "# Canto I", then "Subject: theme" lines, "## Day I", "### Subject | Title",
// an optional "**Evidence:** Solid / Debated / Legend" line, then the note text.
function parsePack(file, text) {
  const pack = { file, title: file.replace(/\.md$/, ''), themes: {}, notes: [] };
  let day = '', note = null, inHeader = false, para = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^#\s+(.+)/))) { pack.title = m[1].trim(); inHeader = true; continue; }
    if ((m = line.match(/^##\s+(.+)/))) { day = m[1].trim().replace(/^Day\s+/i, ''); note = null; inHeader = false; continue; }
    if ((m = line.match(/^###\s+(.+)/))) {
      const heading = m[1];
      const bar = heading.indexOf('|');
      const subject = bar >= 0 ? heading.slice(0, bar).trim() : '';
      const title = (bar >= 0 ? heading.slice(bar + 1) : heading).trim();
      note = { id: `${file}::${title}`, subject, title, day, paras: [] };
      pack.notes.push(note);
      para = null;
      inHeader = false;
      continue;
    }
    if (inHeader && (m = line.match(/^([A-Za-z][\w &-]*):\s*(.+)$/))) { pack.themes[m[1].trim()] = m[2].trim(); continue; }
    if (!note) continue;
    if ((m = line.match(/^\*\*Evidence:\*\*\s*(.+)$/i))) { note.evidence = m[1].trim(); para = null; continue; }
    if (!line) { para = null; continue; }
    if (para === null || line.startsWith('**')) { note.paras.push(line); para = note.paras.length - 1; }
    else note.paras[para] += ' ' + line;
  }
  return pack;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
// Straight quotes look crude in Crimson Pro, so use curly ones
function smartQuotes(s) {
  return s
    .replace(/(^|[\s(\[—–-])"/g, '$1“').replace(/"/g, '”')
    .replace(/(^|[\s(\[—–-])'/g, '$1‘').replace(/'/g, '’');
}
function inline(s) {
  return escapeHtml(smartQuotes(s)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}
function plainText(s) { return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1'); }

// Each note is two pages: In short + Explained, then Example + Why it matters
function splitPages(note) {
  const at = note.paras.findIndex((p) => /^\*\*Example/i.test(p));
  if (at > 0) return [note.paras.slice(0, at), note.paras.slice(at)];
  if (note.paras.length < 2) return [note.paras];
  const mid = Math.ceil(note.paras.length / 2);
  return [note.paras.slice(0, mid), note.paras.slice(mid)];
}

// "**In short:** text" becomes a small label on its own line above the text
function renderParas(paras) {
  return paras.map((p) => {
    const m = p.match(/^\*\*([^*]+?):\*\*\s*(.*)$/);
    return m ? `<p><span class="label">${escapeHtml(m[1])}</span>${inline(m[2])}</p>` : `<p>${inline(p)}</p>`;
  }).join('');
}

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); } finally { clearTimeout(timer); }
}

// On GitHub Pages (username.github.io/repo) the pack list comes from GitHub itself.
function githubRepo() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return null;
  const owner = host.split('.')[0];
  const first = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: first || host };
}

const PACKLIST_KEY = STORE_KEY + '.packlist';
function savedPackList() {
  try { return JSON.parse(localStorage.getItem(PACKLIST_KEY)) || []; } catch (e) { return []; }
}

// Asks GitHub (or the local test server) which Canto files exist; falls back to the last saved list
async function listPackFiles() {
  if (!navigator.onLine) return savedPackList();
  const gh = githubRepo();
  try {
    let files;
    if (gh) {
      const res = await fetchWithTimeout(`https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/packs`);
      if (!res.ok) return savedPackList();
      files = (await res.json()).filter((f) => f.type === 'file' && f.name.endsWith('.md')).map((f) => f.name);
    } else {
      // Local testing: read the dev server's folder listing
      const res = await fetchWithTimeout('packs/', { cache: 'no-store' });
      if (!res.ok) return savedPackList();
      files = [...(await res.text()).matchAll(/href="([^"]+\.md)"/g)].map((m) => decodeURIComponent(m[1].split('/').pop()));
    }
    files.sort();
    localStorage.setItem(PACKLIST_KEY, JSON.stringify(files));
    return files;
  } catch (e) {
    return savedPackList(); // offline or too slow
  }
}

let packs = [];
const noteIndex = new Map(); // id -> { note, pack }

async function loadPacks() {
  // Start downloading the Cantos we already know about while GitHub is asked for new ones
  const downloads = new Map();
  const download = (file) => {
    if (!downloads.has(file)) {
      downloads.set(file, fetchWithTimeout('packs/' + encodeURIComponent(file), { cache: 'no-cache' })
        .then(async (res) => (res.ok ? parsePack(file, await res.text()) : null))
        .catch(() => null));
    }
    return downloads.get(file);
  };
  savedPackList().forEach(download);
  const loaded = await Promise.all((await listPackFiles()).map(download));
  packs = loaded.filter((p) => p && p.notes.length);
  noteIndex.clear();
  for (const pack of packs) for (const note of pack.notes) noteIndex.set(note.id, { note, pack });
}

function isComplete(pack) { return pack.notes.every((n) => state.done[n.id]); }
function doneCount(pack) { return pack.notes.filter((n) => state.done[n.id]).length; }
function currentPack() {
  let pack = packs.find((p) => p.file === state.activePack);
  if (pack && !isComplete(pack)) return pack;
  pack = packs.find((p) => !isComplete(p)) || null;
  if (pack && state.activePack !== pack.file) { state.activePack = pack.file; save(); }
  return pack;
}
function nextNote(pack) { return pack.notes.find((n) => !state.done[n.id]); }

// ---------- Screens ----------
const $ = (id) => document.getElementById(id);
const screens = ['splash', 'install', 'read', 'recall', 'done', 'message', 'page'];
const themeColor = document.querySelector('meta[name="theme-color"]');
// The phone's status bar takes this colour: the art's blue on the loading screen, lilac paper inside the app
function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  themeColor.content = name === 'splash' ? '#7B9DB1' : '#EBE6EF';
}

let current = null;       // note being read
let browsing = false;     // re-reading a note already learned
let browseBack = null;    // where "Back" goes after re-reading
let recall = null;        // { queue, index }

function route() {
  browsing = false;
  pageStack.length = 0;
  const date = today();
  const rec = dayRecord(date);
  if (rec.sealed) return showDone(false);

  const pack = currentPack();
  if (rec.read.length < DAILY_NOTES && pack) return showRead(nextNote(pack), pack);

  const queue = recallQueue().filter((id) => !(id in rec.results));
  if (queue.length) return startRecall(queue);
  if (rec.read.length || Object.keys(rec.results).length) { sealDay(); return showDone(true); }

  if (!packs.length) return showMessage('No Canto yet', 'Add a Canto file to the packs folder, then open Vorago again. If you are offline, try again with signal.');
  return showMessage('Every Canto finished', 'You have read every note in every Canto. The next Canto will appear here when it is added.');
}

// ---------- Reading ----------
function arrearsDays(pack, date) {
  const started = state.packs[pack.file]?.startedOn;
  if (!started) return 0;
  const calendarDay = daysBetween(started, date) + 1;
  const doneBefore = pack.notes.filter((n) => state.done[n.id] && state.done[n.id] < date).length;
  const expected = Math.min((calendarDay - 1) * DAILY_NOTES, pack.notes.length);
  return Math.max(0, Math.floor((expected - doneBefore) / DAILY_NOTES));
}
function arrearsText(n) { return n === 1 ? '1 day behind' : `${n} days behind`; }

// A row of lily buds, one per note of the day; finished notes are open lilies.
// The bud that has just opened gets a small opening animation.
let shownBuds = -1;
function renderBuds(el, count) {
  el.innerHTML = Array.from({ length: DAILY_NOTES }, (_, i) => (i < count
    ? `<svg class="open${i === count - 1 && shownBuds === count - 1 ? ' just' : ''}" viewBox="-70 -70 140 140"><use href="#lily-bloom" x="-70" y="-70" width="140" height="140"/></svg>`
    : '<svg viewBox="-10 -44 20 46"><use href="#lily-bud" x="-10" y="-44" width="20" height="46"/></svg>')).join('');
  el.setAttribute('aria-label', `${count} of ${DAILY_NOTES} notes done today`);
  shownBuds = count;
}

function showRead(note, pack, animate = false) {
  current = note;
  const date = today();
  const rec = dayRecord(date);
  if (!browsing) {
    state.packs[pack.file] = state.packs[pack.file] || {};
    const started = state.packs[pack.file].startedOn;
    if (!started || started > date) { state.packs[pack.file].startedOn = date; save(); }
  }

  $('r-where').textContent = `Day ${note.day}`;
  $('r-count').textContent = browsing ? 'Revisiting' : '';
  $('r-buds').hidden = browsing;
  if (!browsing) renderBuds($('r-buds'), rec.read.length);

  const behind = browsing ? 0 : arrearsDays(pack, date);
  $('r-behind').hidden = behind < 1;
  $('r-behind').textContent = arrearsText(behind);
  updateReminder();

  $('r-subject').textContent = note.subject || '';
  $('r-evidence').textContent = note.evidence || '';
  $('r-title').textContent = note.title;
  pages = splitPages(note);
  renderPage(0, animate);
  show('read');
}

let pages = [];
let page = 0;
function renderPage(index, animate) {
  page = index;
  const last = page === pages.length - 1;
  $('r-body').innerHTML = renderParas(pages[page]);

  const button = $('b-understood');
  button.textContent = !last ? 'Continue' : browsing ? 'Back' : 'Understood';
  button.className = last ? 'primary' : 'next';

  const card = $('r-note');
  card.scrollTop = 0;
  card.classList.remove('out', 'in', 'back');
  if (animate) { void card.offsetWidth; card.classList.add(animate === 'back' ? 'back' : 'in'); }
}

let turning = false;
function turnTo(index) {
  if (turning || index < 0 || index >= pages.length || index === page) return;
  turning = true;
  const card = $('r-note');
  card.classList.remove('in', 'back');
  card.classList.add(index > page ? 'out' : 'out-back');
  setTimeout(() => {
    turning = false;
    card.classList.remove('out', 'out-back');
    renderPage(index, index > page ? true : 'back');
  }, 200);
}

function advance() {
  if (page < pages.length - 1) turnTo(page + 1);
  else understood();
}

function understood() {
  if (turning || !current) return;
  if (browsing) { browsing = false; return browseBack ? browseBack() : route(); }
  const date = today();
  const rec = dayRecord(date);
  state.done[current.id] = date;
  if (!rec.read.includes(current.id)) rec.read.push(current.id);
  save();

  turning = true;
  const card = $('r-note');
  card.classList.add('out');
  setTimeout(() => {
    turning = false;
    const pack = currentPack();
    if (rec.read.length < DAILY_NOTES && pack) showRead(nextNote(pack), pack, true);
    else route();
  }, 220);
}

// Re-read a note already learned; "Back" returns to where you came from
function browse(note, pack, back) {
  browsing = true;
  browseBack = back;
  showRead(note, pack);
}

// Swipe left = next page (then Understood), swipe right = previous page
(function setupSwipe() {
  let x0 = null, y0 = null;
  const card = $('r-note');
  card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dy) > 50) return;
    if (dx < -70 && !(browsing && page === pages.length - 1)) advance();
    else if (dx > 70) turnTo(page - 1);
  }, { passive: true });
})();

// ---------- Look it up / Ask AI (saved for later when offline) ----------
function noteQuery(note) {
  const pack = noteIndex.get(note.id)?.pack;
  const theme = pack?.themes[note.subject];
  const about = [note.subject, theme].filter(Boolean).join(': ');
  const known = note.paras.map(plainText).join(' ');
  return `Explain "${note.title}"${about ? ` (${about})` : ''} in more depth, with real-world examples. Here's what I already know: ${known}`;
}

function openExternal(kind, note) {
  const url = kind === 'ask'
    ? (AI_LINKS[state.settings.ai] || AI_LINKS.chatgpt)(noteQuery(note))
    : `https://www.google.com/search?q=${encodeURIComponent([note.title, note.subject].filter(Boolean).join(' '))}`;
  window.open(url, '_blank', 'noopener');
}

function external(kind) {
  if (!current) return;
  if (!navigator.onLine) {
    if (!state.lookups.some((l) => l.id === current.id && l.kind === kind)) {
      state.lookups.push({ id: current.id, kind, saved: today() });
      save();
    }
    toast('No signal. Saved to Look up later.');
    return;
  }
  openExternal(kind, current);
}

function savedLookups() { return state.lookups.filter((l) => noteIndex.has(l.id)); }

function updateReminder() {
  const n = savedLookups().length;
  const el = $('r-reminder');
  el.hidden = !n || !navigator.onLine || browsing;
  el.textContent = n === 1 ? '1 note saved to look up' : `${n} notes saved to look up`;
}

let toastTimer = null;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- Recall ----------
// Today's notes + notes from earlier days that never got recalled + forgotten notes that are due again
function recallQueue() {
  const date = today();
  const ids = new Set();
  for (const [d, rec] of Object.entries(state.days)) {
    if (d <= date && !rec.recalled) rec.read.forEach((id) => ids.add(id));
  }
  for (const [id, due] of Object.entries(state.reviews)) if (due <= date) ids.add(id);
  return [...ids].filter((id) => noteIndex.has(id));
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function startRecall(queue) {
  recall = { queue: shuffle(queue), index: 0 };
  showRecallItem();
}

function showRecallItem() {
  const id = recall.queue[recall.index];
  const { note } = noteIndex.get(id);
  const rec = dayRecord();
  const answered = Object.keys(rec.results).length;
  const total = answered + recall.queue.length - recall.index;
  $('c-count').textContent = `${answered + 1} / ${total}`;
  $('c-title').textContent = `${note.title}?`;
  $('c-hint').textContent = rec.read.includes(id) ? 'think on it first' : 'from an earlier day';
  $('c-subject').textContent = note.subject;
  $('c-body').innerHTML = renderParas(splitPages(note)[0]);
  $('c-answer').hidden = true;
  $('c-answer').scrollTop = 0;
  $('c-judge').hidden = true;
  $('b-see').hidden = false;
  $('recall').classList.remove('revealed');
  show('recall');
}

function seeAnswer() {
  $('recall').classList.add('revealed');
  $('c-answer').hidden = false;
  $('b-see').hidden = true;
  $('c-judge').hidden = false;
}

function judge(remembered) {
  const id = recall.queue[recall.index];
  const date = today();
  dayRecord(date).results[id] = remembered ? 'remembered' : 'forgotten';
  if (remembered) delete state.reviews[id];
  else state.reviews[id] = addDays(date, REVIEW_AFTER_DAYS);
  save();
  recall.index++;
  if (recall.index < recall.queue.length) showRecallItem();
  else { sealDay(); showDone(true); }
}

// ---------- Completing the day (stored as "sealed", the engine's name for it) ----------
function sealDay() {
  const date = today();
  for (const [d, rec] of Object.entries(state.days)) if (d <= date) rec.recalled = true;
  dayRecord(date).sealed = true;
  save();
}

function streak() {
  let date = today();
  if (!dayRecord(date).sealed) date = addDays(date, -1);
  let count = 0;
  while (state.days[date]?.sealed) { count++; date = addDays(date, -1); }
  return count;
}

function longestStreak() {
  const sealed = Object.keys(state.days).filter((d) => state.days[d].sealed).sort();
  let best = 0, run = 0, prev = null;
  for (const d of sealed) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
function showDone(bloomNow) {
  const rec = dayRecord();
  const last = rec.read.length ? noteIndex.get(rec.read[rec.read.length - 1]) : null;
  const dayLabel = last ? last.note.day : '';
  $('s-where').textContent = last ? `${last.pack.title} · Day ${dayLabel}` : '';
  $('s-title').textContent = dayLabel ? `Day ${dayLabel} complete` : 'Day complete';

  const learned = rec.read.length;
  const remembered = Object.values(rec.results).filter((r) => r === 'remembered').length;
  const learnedText = `${WORDS[learned] || learned} ${learned === 1 ? 'note' : 'notes'} learned`;
  const recalled = Object.keys(rec.results).length;
  $('s-sub').textContent = recalled ? `${learnedText} · ${remembered} of ${recalled} remembered` : learnedText;

  const n = streak();
  $('s-streak').textContent = `${n} ${n === 1 ? 'day' : 'days'} in a row`;
  $('b-revisit').hidden = !rec.read.length;

  const bloom = $('s-bloom');
  bloom.classList.remove('opening');
  if (bloomNow) { void bloom.getBoundingClientRect(); bloom.classList.add('opening'); }
  show('done');
}

function showMessage(title, text) {
  $('m-title').textContent = title;
  $('m-text').textContent = text;
  show('message');
}

// ---------- Pages: Contents, Progress, Library, Look up later, Settings ----------
const pageStack = [];
function openPage(render) { pageStack.push(render); renderTopPage(); }
function renderTopPage() {
  const { title, html, after } = pageStack[pageStack.length - 1]();
  $('p-title').textContent = title;
  $('p-body').innerHTML = html;
  $('p-body').scrollTop = 0;
  if (after) after($('p-body'));
  show('page');
}
function pageBack() {
  pageStack.pop();
  if (pageStack.length) renderTopPage();
  else route();
}
function openContents() {
  browsing = false;
  pageStack.length = 0;
  openPage(contentsPage);
}

function listButton(label, sub, attrs = '') {
  return `<button type="button" ${attrs}>${escapeHtml(label)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</button>`;
}

function contentsPage() {
  const n = savedLookups().length;
  const items = [
    ['progress', 'Progress', 'Streak, notes learned, calendar'],
    ['library', 'Library', `${packs.length} ${packs.length === 1 ? 'Canto' : 'Cantos'}`],
    ['lookups', 'Look up later', n ? `${n} saved` : 'Nothing saved'],
    ['settings', 'Settings', `Ask AI: ${AI_NAMES[state.settings.ai]} · Text: ${TEXT_SIZES[state.settings.textSize]}`],
  ];
  const targets = { progress: progressPage, library: libraryPage, lookups: lookupsPage, settings: settingsPage };
  return {
    title: 'Contents',
    html: `<div class="list">${items.map(([k, l, s]) => listButton(l, s, `data-go="${k}"`)).join('')}</div>`,
    after: (root) => root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => openPage(targets[b.dataset.go]); }),
  };
}

function calendarHtml() {
  const date = today();
  const monday = addDays(date, -((toDate(date).getDay() + 6) % 7));
  const start = addDays(monday, -28);
  let cells = '';
  for (let i = 0; i < 35; i++) {
    const d = addDays(start, i);
    const rec = state.days[d];
    const cls = d > date ? 'future' : rec?.sealed ? 'complete' : rec?.read?.length ? 'part' : '';
    cells += `<i class="${cls}${d === date ? ' today' : ''}" title="${shortDate(d)}"></i>`;
  }
  const head = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('');
  return `<div class="cal-head">${head}</div><div class="cal">${cells}</div>
    <div class="cal-key"><i class="complete"></i>Complete <i class="part"></i>Started</div>`;
}

function progressPage() {
  const date = today();
  const learned = Object.keys(state.done).length;
  const results = Object.values(state.days).flatMap((d) => Object.values(d.results || {}));
  const pct = results.length ? `${Math.round(results.filter((r) => r === 'remembered').length / results.length * 100)}%` : '–';
  const stats = [[learned, 'notes learned'], [streak(), 'days in a row'], [longestStreak(), 'longest run'], [pct, 'remembered']]
    .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');

  let folio = '';
  const pack = currentPack();
  if (pack) {
    const done = doneCount(pack);
    const started = state.packs[pack.file]?.startedOn;
    const totalDays = Math.ceil(pack.notes.length / DAILY_NOTES);
    const dayNo = started ? Math.min(daysBetween(started, date) + 1, totalDays) : 0;
    const behind = arrearsDays(pack, date);
    const where = started ? `Day ${toRoman(dayNo)} of ${toRoman(totalDays)} · ${behind ? arrearsText(behind) : 'on track'}` : 'Not started yet';
    folio = `<div class="block"><div class="block-label">Current Canto</div>
      <div class="block-title">${escapeHtml(pack.title)}</div>
      <div class="bar"><i style="width:${Math.round(done / pack.notes.length * 100)}%"></i></div>
      <div class="block-sub">${done} of ${pack.notes.length} notes · ${where}</div></div>`;
  }
  return {
    title: 'Progress',
    html: `<div class="stats">${stats}</div>${folio}<div class="block"><div class="block-label">Last five weeks</div>${calendarHtml()}</div>`,
  };
}

function libraryPage() {
  const active = currentPack();
  const rows = packs.map((p) => {
    const done = doneCount(p);
    const status = isComplete(p) ? 'Finished' : p === active ? 'Current' : done ? 'Paused' : 'Not started';
    return listButton(p.title, `${status} · ${done} / ${p.notes.length} notes`, `data-file="${escapeHtml(p.file)}"`);
  }).join('');
  return {
    title: 'Library',
    html: packs.length
      ? `<div class="list">${rows}</div><p class="page-note">New Cantos appear here when they are added.</p>`
      : '<p class="page-note">No Cantos yet.</p>',
    after: (root) => root.querySelectorAll('[data-file]').forEach((b) => { b.onclick = () => openPage(() => folioPage(b.dataset.file)); }),
  };
}

function folioPage(file) {
  const p = packs.find((x) => x.file === file);
  if (!p) return { title: 'Library', html: '<p class="page-note">This Canto is no longer in the packs folder.</p>' };
  const themes = Object.entries(p.themes).map(([s, t]) => `<div><span>${escapeHtml(s)}:</span> ${escapeHtml(t)}</div>`).join('');
  let html = `<div class="block"><div class="block-title">${escapeHtml(p.title)}</div><div class="themes">${themes}</div></div>`;
  if (!isComplete(p) && p !== currentPack()) html += '<button type="button" class="next wide" id="make-current">Make this my current Canto</button>';
  html += '<div class="list">';
  let day = null;
  p.notes.forEach((n, i) => {
    if (n.day !== day) { day = n.day; html += `<div class="list-day">Day ${escapeHtml(day)}</div>`; }
    const done = !!state.done[n.id];
    html += listButton(n.title, done ? n.subject : `${n.subject} · not yet read`, `data-i="${i}"${done ? '' : ' disabled'}`);
  });
  html += '</div>';
  return {
    title: 'Canto',
    html,
    after: (root) => {
      root.querySelector('#make-current')?.addEventListener('click', () => { state.activePack = p.file; save(); route(); });
      root.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => browse(p.notes[+b.dataset.i], p, renderTopPage); });
    },
  };
}

function lookupsPage() {
  const items = savedLookups();
  const html = items.length
    ? `<div class="list">${items.map((l, i) => listButton(noteIndex.get(l.id).note.title, `${l.kind === 'ask' ? 'Ask AI' : 'Look it up'} · saved ${shortDate(l.saved)}`, `data-i="${i}"`)).join('')}</div>
       <p class="page-note">Tap one to open it. It leaves the list once opened.</p>`
    : '<p class="page-note">Nothing saved. If you tap Look it up or Ask AI without signal, the note waits here until you are back online.</p>';
  return {
    title: 'Look up later',
    html,
    after: (root) => root.querySelectorAll('[data-i]').forEach((b) => {
      b.onclick = () => {
        const l = items[+b.dataset.i];
        if (!navigator.onLine) return toast('Still offline. Try again when you have signal.');
        openExternal(l.kind, noteIndex.get(l.id).note);
        state.lookups = state.lookups.filter((x) => x !== l);
        save();
        renderTopPage();
      };
    }),
  };
}

function settingsPage() {
  const choice = (group, value, label, on) => `<button type="button" class="choice${on ? ' on' : ''}" data-${group}="${value}">${label}</button>`;
  const html = `
    <div class="block"><div class="block-label">Ask AI opens</div>
      <div class="choices">${Object.entries(AI_NAMES).map(([k, v]) => choice('ai', k, v, state.settings.ai === k)).join('')}</div></div>
    <div class="block"><div class="block-label">Text size</div>
      <div class="choices">${Object.entries(TEXT_SIZES).map(([k, v]) => choice('size', k, v, state.settings.textSize === k)).join('')}</div></div>
    <p class="page-note">Your progress is saved on this phone only. Open Vorago from its home-screen icon rather than a browser tab, and don't clear your browser's website data, or your progress will be lost.</p>`;
  return {
    title: 'Settings',
    html,
    after: (root) => {
      root.querySelectorAll('[data-ai]').forEach((b) => { b.onclick = () => { state.settings.ai = b.dataset.ai; save(); renderTopPage(); }; });
      root.querySelectorAll('[data-size]').forEach((b) => { b.onclick = () => { state.settings.textSize = b.dataset.size; save(); applyTextSize(); renderTopPage(); }; });
    },
  };
}

function applyTextSize() { document.body.dataset.text = state.settings.textSize; }

function revisitPage() {
  const items = dayRecord().read.map((id) => noteIndex.get(id)).filter(Boolean);
  return {
    title: "Today's notes",
    html: `<div class="list">${items.map(({ note }, i) => listButton(note.title, note.subject, `data-i="${i}"`)).join('')}</div>`,
    after: (root) => root.querySelectorAll('[data-i]').forEach((b) => {
      b.onclick = () => { const { note, pack } = items[+b.dataset.i]; browse(note, pack, renderTopPage); };
    }),
  };
}

// ---------- Loading screen ----------
async function start() {
  applyTextSize();
  // Ask the browser not to clear Vorago's saved data when the phone runs low on space
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  // Offline mode, set up once the first screen is showing so it doesn't slow it down
  // (on localhost only with ?sw, so testing always shows the latest files)
  if ('serviceWorker' in navigator && (location.hostname !== 'localhost' || params.has('sw'))) {
    const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);
  }

  const loading = loadPacks();
  if (params.has('nosplash')) { await loading; return route(); }

  show('splash');
  const splash = $('splash');
  await Promise.all([loading, new Promise((r) => setTimeout(r, SPLASH_MS))]);
  splash.classList.add('ready');
  splash.addEventListener('click', function go() {
    splash.removeEventListener('click', go);
    splash.classList.add('leaving');
    setTimeout(() => {
      splash.classList.remove('leaving', 'ready');
      // Friends opening the link in a browser tab first see how to add it to the home screen (once)
      if (!isInstalled() && !state.installSeen) show('install');
      else route();
    }, 480);
  });
}

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// ---------- Wire up ----------
$('b-understood').addEventListener('click', advance);
$('b-install-ok').addEventListener('click', () => { state.installSeen = true; save(); route(); });
$('b-lookup').addEventListener('click', () => external('lookup'));
$('b-ask').addEventListener('click', () => external('ask'));
$('r-reminder').addEventListener('click', () => { pageStack.length = 0; openPage(lookupsPage); });
$('b-see').addEventListener('click', seeAnswer);
$('b-remembered').addEventListener('click', () => judge(true));
$('b-forgotten').addEventListener('click', () => judge(false));
$('b-revisit').addEventListener('click', () => { pageStack.length = 0; openPage(revisitPage); });
$('p-back').addEventListener('click', pageBack);
document.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', openContents));
// No zooming: iPhone ignores the page's "no zoom" setting, so block pinch and double-tap here too
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300 && !e.target.closest('button')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
window.addEventListener('online', updateReminder);
window.addEventListener('offline', updateReminder);

start();
