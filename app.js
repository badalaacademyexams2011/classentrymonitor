(function () {
  'use strict';

  const $ = function (s) { return document.querySelector(s); };
  const esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DEBUG = false;
  const TIMINGS = { syncDebounce: 2500, retry: [5000, 15000, 45000, 120000], refresh: 180000, tick: 60000, undo: 4000, toast: 2600 };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ord = function (n) { const v = n % 100; return v >= 11 && v <= 13 ? n + 'th' : n + (({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const shiftYmd = function (value, days) { const d = new Date(value + 'T12:00:00'); d.setDate(d.getDate() + days); return ymd(d); };
  const toMin = function (t) { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const nowMin = function () { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  const S = {
    cfg: null, user: null, all: [], entries: new Map(), tt: new Map(), teachers: new Map(),
    date: '', day: '', section: '', period: 1, manual: false, unmarkedOnly: false, tab: 'entry',
    online: navigator.onLine !== false, syncTimer: null, retryTimer: null, retryStep: 0, installEvt: null, authBad: false, skew: 0, dateOff: false, pendingExtra: {}, lastSyncError: null,
  };
  let entryRenderKey = '';
  let pendingDate = '';

  /* ───────────── helpers ───────────── */

  function toast(msg, undo, persistent) {
    const t = $('#toast');
    t.textContent = '';
    t.appendChild(document.createTextNode(msg));
    if (undo) { const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = 'Undo'; b.onclick = function () { clearTimeout(toast._t); t.classList.remove('show'); undo(); }; t.appendChild(document.createTextNode(' · ')); t.appendChild(b); }
    t.classList.add('show');
    clearTimeout(toast._t);
    if (!persistent) toast._t = setTimeout(function () { t.classList.remove('show'); }, undo ? TIMINGS.undo : TIMINGS.toast);
  }

  function setDate(value) {
    const parts = value.split('-').map(Number);
    const n = new Date(parts[0], parts[1] - 1, parts[2]);
    S.date = value;
    S.day = DAYS[n.getDay()];
    S.dateLabel = DAYS[n.getDay()] + ' ' + n.getDate() + ' ' + MONTHS[n.getMonth()] + ' ' + n.getFullYear();
  }

  function setToday() {
    const today = ymd(new Date());
    S.currentDay = today;
    setDate(today);
  }

  function isPastDate() { return S.date < ymd(new Date()); }

  function updateThemeControl() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.querySelectorAll('.theme-toggle').forEach(function (button) {
      button.innerHTML = '<span aria-hidden="true">' + (dark ? '☀' : '☾') + '</span>';
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    });
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      meta.content = dark ? '#0e3d2a' : '#1b6e4a';
    });
  }

  function toggleTheme() {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    updateThemeControl();
    try { localStorage.setItem('class-entry-theme', theme); }
    catch (error) {
      console.warn('Could not save theme preference.', error);
      toast('Theme changed, but this browser could not save the preference.');
    }
  }

  function loadCfg(cfg) {
    S.cfg = cfg;
    S.tt = new Map();
    (cfg.timetable || []).forEach(function (r) {
      const k = r[0] + '|' + r[1] + '|' + r[2];
      if (!S.tt.has(k)) S.tt.set(k, { subject: r[3], teacher: r[4] });
    });
    S.teachers = new Map((cfg.teachers || []).map(function (t) { return [t[0], { name: t[1], phone: t[2] || '' }]; }));
  }

  const tName = function (code) { const t = S.teachers.get(code); return (t && t.name) || code || ''; };
  // Tap-to-dial link for a teacher's phone number ('' when there is none).
  const telHtml = function (code) {
    const t = S.teachers.get(code), ph = t && t.phone ? String(t.phone) : '';
    const clean = ph.slice(0, 20);
    if (!/^\+?[0-9 ()-]{7,20}$/.test(clean)) return '';
    const num = clean.replace(/[^\d+]/g, '');
    return num ? '<a class="tel" href="tel:' + esc(num) + '">\uD83D\uDCDE ' + esc(clean) + '</a>' : '';
  };
  const lesson = function (period, cls) { return S.tt.get(S.day + '|' + period + '|' + cls); };
  const pending = function () { return S.all.filter(function (e) { return !e.synced && !e.err; }); };
  const rejected = function () { return S.all.filter(function (e) { return !e.synced && e.err; }); };

  async function reloadEntries() {
    S.all = await Core.entryAll();
    S.entries = new Map(S.all.filter(function (e) { return e.date === S.date; }).map(function (e) { return [e.key, e]; }));
  }

  /* ───────────── sections (Secondary / Primary / Nursery) ───────────── */

  const sections = function () { return (S.cfg && S.cfg.sections && S.cfg.sections.length) ? S.cfg.sections : ['']; };
  const secOf = function (cls) { return ((S.cfg && S.cfg.classSection) || {})[cls] || sections()[0]; };
  const classesOf = function (sec) { return ((S.cfg && S.cfg.classes) || []).filter(function (c) { return secOf(c) === sec; }); };
  const fmtMin = function (m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };

  // Bell times for a section today: rows tagged with today's day (e.g. a shorter Friday) win over the all-days rows.
  function pdsFor(sec, day) {
    const all = ((S.cfg && S.cfg.periods) || []).filter(function (p) { return (p.section || sections()[0]) === sec; });
    const mine = all.filter(function (p) { return p.day === day; });
    return mine.length ? mine : all.filter(function (p) { return !p.day; });
  }
  const pds = function () { return pdsFor(S.section, S.day); };
  function bellRange(sec, day, n) {
    const p = pdsFor(sec, day).find(function (x) { return x.n === n; });
    const a = p ? toMin(p.start) : null, b = p ? toMin(p.end) : null;
    return a !== null && b !== null && b > a ? { s: a, e: b } : null;
  }
  // True on days that are not school days, or have no timetable at all.
  function noSchool() {
    const sd = S.cfg && S.cfg.days;
    if (sd && sd.length && sd.indexOf(S.day) < 0) return true;
    const days = new Set(((S.cfg && S.cfg.timetable) || []).map(function (r) { return r[0]; }));
    return days.size > 0 && !days.has(S.day);
  }
  function noSchoolReason() {
    const sd = S.cfg && S.cfg.days;
    if (sd && sd.length && sd.indexOf(S.day) < 0) return { reason: 'holiday', day: S.day };
    const days = new Set(((S.cfg && S.cfg.timetable) || []).map(function (r) { return r[0]; }));
    return { reason: days.size && !days.has(S.day) ? 'no_timetable' : 'unset', day: S.day };
  }
  function periodLenFor(sec, n) { const r = bellRange(sec, S.day, n); return r ? r.e - r.s : 40; }

  function currentPeriodFor(sec) {
    const ps = pdsFor(sec, S.day).filter(function (p) { return toMin(p.start) !== null && toMin(p.end) !== null; })
      .sort(function (a, b) { return a.n - b.n; });
    if (!ps.length) return 1;
    const m = nowMin();
    for (let i = 0; i < ps.length; i++) if (m >= toMin(ps[i].start) && m < toMin(ps[i].end)) return ps[i].n;
    const next = ps.find(function (p) { return toMin(p.start) > m; });
    return next ? next.n : ps[ps.length - 1].n;
  }
  const currentPeriod = function () { return currentPeriodFor(S.section); };
  function firstPeriod() {
    const periods = pds().slice().sort(function (a, b) { return a.n - b.n; });
    return periods.length ? periods[0].n : 1;
  }

  function periodEndedFor(sec, n) { const r = bellRange(sec, S.day, n); return !!r && nowMin() >= r.e; }
  const periodEnded = function (n) { return isPastDate() || periodEndedFor(S.section, n); };

  // Another-section lesson of this teacher that is still running when this lesson starts (null if none).
  function heldBy(code, cls, period) {
    if (!code || sections().length < 2) return null;
    const mySec = secOf(cls), me = bellRange(mySec, S.day, period);
    if (!me) return null;
    let best = null;
    S.tt.forEach(function (v, k) {
      if (v.teacher !== code) return;
      const a = k.split('|');
      if (a[0] !== S.day) return;
      const c2 = a.slice(2).join('|'), sec2 = secOf(c2);
      if (sec2 === mySec || c2 === cls) return;
      const r = bellRange(sec2, S.day, Number(a[1]));
      if (r && r.s < me.s && r.e > me.s && (!best || r.e > best.e)) best = { c: c2, p: Number(a[1]), e: r.e, mins: r.e - me.s };
    });
    return best;
  }
  function holdNote(period, cls, code) {
    const h = heldBy(code, cls, period);
    return h ? '<span class="hold">⏱ may be held in ' + esc(h.c) + ' until ' + fmtMin(h.e) + '</span>' : '';
  }

  /* ───────────── rendering ───────────── */

  function render() {
    const d = ymd(new Date());
    if (d !== S.currentDay) {
      S.currentDay = d;
      setDate(d);
      S.manual = false;
      reloadEntries().then(function () { S.period = currentPeriod(); render(); });
      return;
    }
    if (!ensureSection()) { renderPicker(); return; }
    $('#picker').hidden = true; $('#main').hidden = false;
    if (S.tab === 'admin' && !(S.user && S.user.role === 'Admin')) S.tab = 'entry';
    if ((S.tab === 'reports' || S.tab === 'clashes') && !S.user) S.tab = 'entry';
    $('#adminTab').hidden = !(S.user && S.user.role === 'Admin');
    $('#reportsTab').hidden = !S.user;
    $('#hdrDate').textContent = S.dateLabel;
    $('#entryDate').value = S.date;
    $('#entryDate').min = shiftYmd(d, -7);
    $('#entryDate').max = d;
    $('#pastEntryWarn').hidden = !isPastDate();
    updateThemeControl();
    $('#hdrUser').textContent = (S.cfg.school || 'School') + ' · ' + (S.user ? S.user.name : '');
    const sb = $('#secBtn');
    sb.hidden = sections().length < 2;
    sb.textContent = S.section + ' ⇄';
    renderBadge();
    renderClock();
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
    $('#entryView').hidden = S.tab !== 'entry';
    $('#todayView').hidden = S.tab !== 'today';
    $('#adminView').hidden = S.tab !== 'admin';
    $('#reportsView').hidden = S.tab !== 'reports';
    $('#clashesView').hidden = S.tab !== 'clashes';
    renderFrozen();
    if (S.tab === 'entry') renderEntry(); else if (S.tab === 'today') renderToday();
  }

  function applyEntryDate(date) {
    pendingDate = '';
    setDate(date);
    S.manual = true;
    S.period = isPastDate() ? firstPeriod() : currentPeriod();
    S.entries = new Map(S.all.filter(function (e) { return e.date === S.date; }).map(function (e) { return [e.key, e]; }));
    entryRenderKey = '';
    render();
  }

  function chooseEntryDate(date) {
    const today = ymd(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < shiftYmd(today, -7) || date > today) {
      render();
      toast('Choose a date from today back through the last 7 days');
      return;
    }
    if (date >= today) { applyEntryDate(date); return; }
    pendingDate = date;
    openModal('<h2>Correcting a past entry</h2><div class="muted">You are viewing ' + esc(date) + '. Changes will update that day’s saved class entries and sync to the school records. Please check the date and period before saving.</div>' +
      '<div class="row-btns"><button id="pastDateCancel">Cancel</button><button id="pastDateContinue" class="primary">Continue</button></div>');
    $('#pastDateCancel').onclick = function () { pendingDate = ''; closeModal(); render(); };
    $('#pastDateContinue').onclick = function () { const selected = pendingDate; closeModal(); applyEntryDate(selected); };
  }

  function renderBadge() { renderBadgeInto($('#syncBadge')); if (!$('#picker').hidden) renderBadgeInto($('#pkBadge')); }
  function renderBadgeInto(b) {
    const n = pending().length;
    b.className = 'badge';
    if (S.authBad) { b.classList.add('bad'); b.textContent = '! Sign in again'; }
    else if (!S.online) { b.classList.add('off'); b.textContent = 'Offline' + (n ? ' · ' + n : ''); }
    else if (n) { b.classList.add('pend'); b.textContent = '⟳ ' + n + ' to sync'; }
    else if (rejected().length) { b.classList.add('bad'); b.textContent = '⚠ ' + rejected().length + ' rejected'; }
    else b.textContent = '✓ Synced';
  }

  function renderEntry() {
    if (noSchool()) {
      entryRenderKey = '';
      $('#periodBar').innerHTML = '';
      $('#periodInfo').textContent = 'No school today';
      const why = noSchoolReason();
      $('#list').innerHTML = '<div class="empty">' + (why.reason === 'holiday' ? (isPastDate() ? 'The selected date (' : 'Today (') + esc(why.day) + ') is not a school day.' : 'No lessons are timetabled for ' + esc(why.day) + '.') + '</div>';
      return;
    }
    const periods = (pds().length ? pds() : [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return { n: n }; }));
    $('#periodBar').innerHTML = periods.map(function (p) {
      const unmarked = unmarkedCount(S.section, p.n);
      const warn = periodEnded(p.n) && unmarked > 0 ? ' warn' : '';
      return '<button data-p="' + p.n + '" class="' + (p.n === S.period ? 'on' : '') + warn + '">' + ord(p.n) + '</button>';
    }).join('');
    const cp = periods.find(function (p) { return p.n === S.period; });
    $('#periodInfo').textContent = ord(S.period) + ' period' + (cp && cp.start ? ' · ' + cp.start + '–' + cp.end : '');
    $('#unmarkedOnly').checked = S.unmarkedOnly;

    const past = isPastDate() || periodEnded(S.period);
    const classes = classesOf(S.section);
    // classes with no lesson in this period (e.g. lower primary after they close) are hidden, unless nothing is timetabled at all
    const anyLesson = classes.some(function (c) { return !!lesson(S.period, c); });
    const hiddenN = anyLesson ? classes.filter(function (c) { return !lesson(S.period, c) && !S.entries.get(S.date + '|' + S.period + '|' + c); }).length : 0;
    const visible = [];
    classes.forEach(function (cls) {
      const key = S.date + '|' + S.period + '|' + cls;
      const e = S.entries.get(key);
      if (S.unmarkedOnly && e) return;
      if (anyLesson && !e && !lesson(S.period, cls)) return;
      visible.push(cls);
    });
    const renderCard = function (cls) {
      const key = S.date + '|' + S.period + '|' + cls, e = S.entries.get(key), l = lesson(S.period, cls);
      const teacher = e && e.teacher !== undefined && e.teacher !== '' ? e.teacher : (l ? l.teacher : '');
      const subject = e && e.subject ? e.subject : (l ? l.subject : '');
      const st = e ? e.status : '';
      const lateLabel = st === 'LATE' ? 'Late ' + e.mins : 'Late';
      const effT = e && e.cover ? e.cover : teacher;
      return '<div id="card-' + encodeURIComponent(cls).replace(/%/g, '_') + '" tabindex="0" class="card ' + (st ? 's-' + st : 'unmarked' + (past ? ' past' : '')) + '" data-cls="' + esc(cls) + '">' +
        '<div class="row1"><b class="cls">' + esc(cls) + '</b><span class="subj">' + esc(subject || (l ? '' : '— not in timetable —')) + '</span></div>' +
        '<div class="teach"><span>' + esc(tName(teacher) || 'No teacher set') + '</span>' + telHtml(teacher) +
        (e && e.cover ? '<span class="cov">Cover: ' + esc(tName(e.cover)) + '</span>' + telHtml(e.cover) : '') + holdNote(S.period, cls, effT) +
        '<a data-act="cover">' + (e && e.cover ? 'change cover' : (teacher ? 'cover' : 'set teacher')) + '</a></div>' +
        '<div class="btns">' +
        '<button class="b ok' + (st === 'OT' ? ' on' : '') + '" data-act="OT" aria-label="On time">✓</button>' +
        '<button class="b late' + (st === 'LATE' ? ' on' : '') + '" data-act="LATE">' + esc(lateLabel) + '</button>' +
        '<button class="b abs' + (st === 'ABS' ? ' on' : '') + '" data-act="ABS" aria-label="Absent">A</button>' +
        '<button class="b none' + (st === 'NONE' ? ' on' : '') + '" data-act="NONE" aria-label="No lesson">X</button>' +
        '</div></div>';
    };
    const empty = !visible.length ? '<div class="empty">' + (classes.length ? 'All classes marked for this period ✓' : 'No classes in this section. Ask the Admin to add them.') + '</div>' : '';
    const hiddenNote = hiddenN && visible.length ? '<div class="muted note">' + hiddenN + (hiddenN === 1 ? ' class has' : ' classes have') + ' no lesson in this period.</div>' : '';
    const key = [S.section, S.period, visible.join('\u0000'), hiddenN, empty].join('|');
    const host = $('#list');
    if (entryRenderKey !== key || !host.querySelector('.card') && visible.length) {
      host.innerHTML = visible.map(renderCard).join('') || empty;
      if (hiddenNote) host.insertAdjacentHTML('beforeend', hiddenNote);
      entryRenderKey = key;
      return;
    }
    visible.forEach(function (cls) {
      const oldCard = document.getElementById('card-' + encodeURIComponent(cls).replace(/%/g, '_'));
      if (!oldCard) { entryRenderKey = ''; renderEntry(); return; }
      const holder = document.createElement('div');
      holder.innerHTML = renderCard(cls);
      const fresh = holder.firstElementChild;
      oldCard.className = fresh.className;
      const oldTeacher = oldCard.querySelector('.teach'), newTeacher = fresh.querySelector('.teach');
      if (oldTeacher.innerHTML !== newTeacher.innerHTML) oldTeacher.innerHTML = newTeacher.innerHTML;
      ['OT', 'LATE', 'ABS', 'NONE'].forEach(function (act) {
        const oldButton = oldCard.querySelector('[data-act="' + act + '"]');
        const newButton = fresh.querySelector('[data-act="' + act + '"]');
        oldButton.className = newButton.className;
        oldButton.textContent = newButton.textContent;
      });
    });
    const note = host.querySelector('.note');
    if (hiddenNote && !note) host.insertAdjacentHTML('beforeend', hiddenNote);
    else if (!hiddenNote && note) note.remove();
  }

  function scheduledFor(sec, period) {
    return classesOf(sec).filter(function (c) { return !!lesson(period, c); }).length;
  }
  function markedFor(sec, period) {
    let n = 0;
    S.entries.forEach(function (e) { if (e.period === period && secOf(e.cls) === sec) n++; });
    return n;
  }
  function unmarkedCount(sec, period) {
    const expected = scheduledFor(sec, period) || classesOf(sec).length;
    return Math.max(0, expected - markedFor(sec, period));
  }

  function renderToday() {
    const ents = Array.from(S.entries.values()).filter(function (e) { return secOf(e.cls) === S.section; });
    const c = { OT: 0, LATE: 0, ABS: 0, NONE: 0, mins: 0 };
    ents.forEach(function (e) { c[e.status]++; if (e.status === 'LATE') c.mins += Number(e.mins) || 0; });
    const observed = c.OT + c.LATE + c.ABS;
    let lost = c.mins;   // an absence loses the whole period (length taken from the bell times)
    ents.forEach(function (e) { if (e.status === 'ABS') lost += periodLenFor(S.section, e.period); });
    const covers = ents.filter(function (e) { return e.cover && e.status !== 'NONE'; }).length;
    const tile = function (k, v, label, cls) { return '<button class="tile ' + cls + '" data-k="' + k + '"><b>' + v + '</b><span>' + label + '</span></button>'; };
    let h = '<div class="tot">' +
      tile('OBS', observed, 'Lessons observed', '') + tile('OT', c.OT, 'On time', 'g') + tile('LATE', c.LATE, 'Late', 'a') +
      tile('ABS', c.ABS, 'Absent', 'r') + tile('COVER', covers, 'Cover lessons', '') + tile('LOSS', lost, 'Time lost (min)', '') + '</div>' +
      '<p class="muted tot2">' + c.mins + ' min late in total · an absence counts as a whole period · tap a box for the list</p>';
    h += '<table class="tbl"><tr><th>Period</th><th>Marked</th><th>Late</th><th>Absent</th></tr>';
    pds().forEach(function (p) {
      const pe = ents.filter(function (e) { return e.period === p.n; });
      const exp = scheduledFor(S.section, p.n) || classesOf(S.section).length;
      const un = Math.max(0, exp - pe.length);
      const bad = periodEnded(p.n) && un > 0;
      h += '<tr class="go' + (bad ? ' bad' : '') + '" data-p="' + p.n + '"><td><b>' + ord(p.n) + '</b> <span class="muted">' + esc(p.start || '') + '</span></td>' +
        '<td>' + pe.length + '/' + exp + (bad ? ' ⚠' : '') + '</td>' +
        '<td>' + pe.filter(function (e) { return e.status === 'LATE'; }).length + '</td>' +
        '<td>' + pe.filter(function (e) { return e.status === 'ABS'; }).length + '</td></tr>';
    });
    h += '</table><p class="muted" style="font-size:.8rem">Tap a period to open it. ⚠ = period ended with classes still unmarked.</p>' +
      '<button id="tdPdf" class="addbtn">Download today\'s report (PDF)</button>' +
      (noSchool() ? '' : '<button id="tdPrint" class="addbtn">Print roster</button>');
    $('#todayView').innerHTML = h;
  }

  /* ───────────── today: tap a total to see who ───────────── */

  function showList(title, summary, rows) {
    openModal('<h2>' + esc(title) + '</h2><div class="muted dsum">' + (summary || '') + '</div>' +
      '<div class="dlist">' + (rows.length ? rows.join('') : '<div class="empty">None recorded.</div>') + '</div>' +
      '<div class="row-btns"><button id="mCancel">Close</button></div>');
    $('#mCancel').onclick = closeModal;
  }

  function todayRow(e) {
    const code = e.cover || e.teacher;
    const p = pds().find(function (x) { return x.n === e.period; });
    let chip = '';
    if (e.status === 'LATE') chip = '<span class="mm late">' + esc(e.mins) + ' min late</span>';
    else if (e.status === 'ABS') chip = '<span class="mm abs">absent</span>';
    else if (e.status === 'OT') chip = '<span class="mm ok">on time</span>';
    const cov = e.cover ? '<span class="muted"> · covering for ' + esc(tName(e.teacher)) + '</span>' : '';
    return '<div class="dr"><div class="dl1"><b>' + ord(e.period) + ' period' + (p && p.start ? ' ' + esc(p.start) : '') + '</b> · ' + esc(e.cls) + (e.subject ? ' · ' + esc(e.subject) : '') + '</div>' +
      '<div class="dl2"><span>' + esc(tName(code) || 'No teacher set') + '</span>' + telHtml(code) + chip + cov + '</div></div>';
  }

  function showToday(kind) {
    const titles = { OBS: 'All lessons observed', OT: 'On time', LATE: 'Late arrivals', ABS: 'Absences — missed periods', COVER: 'Cover lessons', LOSS: 'Late and absent (time lost)' };
    const list = Array.from(S.entries.values()).filter(function (e) {
      if (secOf(e.cls) !== S.section) return false;
      if (kind === 'OBS') return e.status === 'OT' || e.status === 'LATE' || e.status === 'ABS';
      if (kind === 'LOSS') return e.status === 'LATE' || e.status === 'ABS';
      if (kind === 'COVER') return !!e.cover && e.status !== 'NONE';
      return e.status === kind;
    }).sort(function (a, b) { return (a.period - b.period) || (a.cls < b.cls ? -1 : 1); });
    let sum = list.length + (list.length === 1 ? ' record' : ' records') + ' · ' + (sections().length > 1 ? esc(S.section) + ' · ' : '') + esc(S.dateLabel);
    if (kind === 'LATE' || kind === 'LOSS') {
      sum += ' · ' + list.reduce(function (t, e) { return t + (e.status === 'LATE' ? Number(e.mins) || 0 : 0); }, 0) + ' min late';
    }
    if (kind === 'LOSS') sum += ' · ' + list.reduce(function (t, e) { return t + (e.status === 'ABS' ? periodLenFor(S.section, e.period) : 0); }, 0) + ' min from absences';
    showList(titles[kind] + ' (' + list.length + ')', sum, list.map(todayRow));
  }

  /* ───────────── today's report as a PDF (built on the phone, works offline once the libraries are cached) ───────────── */

  function todayData() {
    const ents = Array.from(S.entries.values()).filter(function (e) { return e.status === 'OT' || e.status === 'LATE' || e.status === 'ABS'; });
    const th = S.cfg.thresholds || { good: 95, warn: 85 }, excuseOn = S.cfg.overlapExcuse !== false;
    const blank = function () { return { observed: 0, ot: 0, late: 0, abs: 0, minsLate: 0, timeLost: 0 }; };
    const add = function (o, st, mins, lost) {
      if (st === 'OT') { o.observed++; o.ot++; }
      else if (st === 'LATE') { o.observed++; o.late++; o.minsLate += mins; o.timeLost += mins; }
      else if (st === 'ABS') { o.observed++; o.abs++; o.timeLost += lost; }
    };
    const fin = function (o) { o.pct = o.observed ? Math.round(o.ot / o.observed * 1000) / 10 : null; return o; };
    const T = blank(); T.covers = 0; T.excused = 0; T.days = ents.length ? 1 : 0;
    const teach = {}, cls = {}, per = {}, exc = [], absLens = {};
    const bucket = function (m, k) { return m[k] || (m[k] = blank()); };
    const tget = function (code) {
      if (!teach[code]) teach[code] = Object.assign(blank(), { code: code, name: tName(code), phone: (S.teachers.get(code) || {}).phone || '', coversTaken: 0, covered: 0, excused: 0 });
      return teach[code];
    };
    ents.forEach(function (e) {
      const sec = secOf(e.cls), eff = e.cover || e.teacher, mins = e.status === 'LATE' ? Number(e.mins) || 0 : 0;
      let st = e.status, held = null;
      if (e.status === 'LATE') {
        held = e.heldMins !== '' && e.heldMins !== null && e.heldMins !== undefined
          ? (Number(e.heldMins) > 0 ? { c: '', p: 0, e: 0, mins: Number(e.heldMins), label: e.heldIn || '' } : null)
          : heldBy(eff, e.cls, e.period);
        if (held && excuseOn && mins <= held.mins + 5) st = 'OT';
      }
      const lost = st === 'ABS' ? periodLenFor(sec, e.period) : 0;
      if (st === 'ABS') absLens[lost] = (absLens[lost] || 0) + 1;
      add(T, st, mins, lost); add(bucket(cls, e.cls), st, mins, lost); add(bucket(per, e.period), st, mins, lost);
      if (eff) add(tget(eff), st, mins, lost);
      if (e.cover) { T.covers++; tget(e.cover).coversTaken++; if (e.teacher) tget(e.teacher).covered++; }
      const wasHeld = e.status === 'LATE' && st === 'OT';
      if (wasHeld) { T.excused++; if (eff) tget(eff).excused++; }
      if (e.status === 'LATE' || e.status === 'ABS' || e.cover) {
        exc.push({ type: wasHeld ? 'HELD' : e.status === 'LATE' ? 'LATE' : e.status === 'ABS' ? 'ABS' : 'COVER', date: S.date, day: S.day, period: e.period, cls: e.cls,
                   subject: e.subject || '', section: sec, teacher: eff, name: tName(eff), mins: mins, cover: !!e.cover, scheduled: e.teacher || '',
                   scheduledName: tName(e.teacher), heldIn: held ? (held.label || held.c + ' ' + ord(held.p) + ' period until ' + fmtMin(held.e)) : '', heldMins: held ? held.mins : 0, note: e.note || '' });
      }
    });
    fin(T);
    Object.keys(teach).forEach(function (k) { fin(teach[k]); });
    exc.sort(function (a, b) { return (a.period - b.period) || (a.cls < b.cls ? -1 : 1); });
    const order = S.cfg.classes || [];
    let pm = 40, best = 0;
    Object.keys(absLens).forEach(function (k) { if (absLens[k] > best) { best = absLens[k]; pm = Number(k); } });
    if (!best) { const p0 = (S.cfg.periods || [])[0]; if (p0) pm = periodLenFor(p0.section || sections()[0], p0.n); }
    return {
      ok: true, from: S.date, to: S.date, section: '', sections: sections(), school: S.cfg.school || '', thresholds: th, periodMinutes: pm, totals: T,
      byTeacher: Object.keys(teach).map(function (k) { return teach[k]; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }),
      byClass: Object.keys(cls).sort(function (a, b) { return (order.indexOf(a) - order.indexOf(b)) || (a < b ? -1 : 1); }).map(function (k) { return Object.assign({ cls: k }, fin(cls[k])); }),
      byPeriod: Object.keys(per).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return Object.assign({ period: k }, fin(per[k])); }),
      byDay: [], byWeek: [], exceptions: exc,
    };
  }

  async function downloadTodayPdf() {
    closeModal();
    if (!window.Reports || !window.Reports.pdfToday) { toast('PDF tool not loaded. Refresh the app and try again.'); return; }
    if (!S.entries.size) { toast('Nothing recorded today yet'); return; }
    toast('Preparing PDF…', null, true);
    try {
      await window.Reports.pdfToday({
        data: todayData(), mode: 'day', title: 'Daily Class Entry Report', label: S.dateLabel + (sections().length > 1 ? ' · all sections' : ''),
        school: S.cfg.school || '', user: S.user ? S.user.name : '', file: 'ClassEntry_Daily_' + S.date + '.pdf',
        footer: S.cfg.reportFooter, generatedBy: S.cfg.reportBy,
      });
      toast('PDF saved to your downloads ✓');
    } catch (e) { toast('Could not create the PDF: ' + (e && e.message ? e.message : 'unknown error') + '. It needs the app to have been opened online once.'); }
  }

  function rosterHtml() {
    const periods = pds(), classes = classesOf(S.section);
    return '<h1>' + esc(S.cfg.school || 'School') + '</h1><p>' + esc(S.dateLabel) + ' · ' + esc(S.section) + '</p>' +
      '<table><thead><tr><th>Class</th>' + periods.map(function (p) { return '<th>' + ord(p.n) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      classes.map(function (cls) { return '<tr><th>' + esc(cls) + '</th>' + periods.map(function () { return '<td>&nbsp;</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table><p class="monitor">Monitor: ' + esc(S.user ? S.user.name : '') + '</p>';
  }

  function printRoster() {
    const content = rosterHtml();
    const printWindow = window.open('', '_blank');
    const style = '<style>body{font:14px Arial,sans-serif;padding:24px;color:#111}h1{margin:0 0 6px;color:#1b6e4a}p{margin:0 0 18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #555;padding:12px;text-align:center}td{height:42px}.monitor{margin-top:24px;border-top:1px solid #555;padding-top:10px}@media print{body{padding:0}}</style>';
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Today\'s roster</title>' + style + '</head><body>' + content + '</body></html>');
      printWindow.document.close();
      printWindow.focus();
      setTimeout(function () { printWindow.print(); }, 200);
      return;
    }
    let roster = document.getElementById('rosterPrint');
    if (!roster) { roster = document.createElement('section'); roster.id = 'rosterPrint'; document.body.appendChild(roster); }
    roster.innerHTML = content;
    document.body.classList.add('print-roster');
    window.addEventListener('afterprint', function cleanup() {
      window.removeEventListener('afterprint', cleanup);
      document.body.classList.remove('print-roster');
      roster.remove();
    });
    window.print();
  }

  /* ───────────── marking ───────────── */

  async function mark(cls, status, mins, extra) {
    const key = S.date + '|' + S.period + '|' + cls;
    const prev = S.entries.get(key) || {};
    const l = lesson(S.period, cls) || {};
    const e = {
      key: key, date: S.date, period: S.period, cls: cls,
      subject: prev.subject || l.subject || '',
      teacher: prev.teacher !== undefined && prev.teacher !== '' ? prev.teacher : (l.teacher || ''),
      cover: prev.cover || '',
      status: status, mins: status === 'LATE' ? mins : '',
      note: status === 'ABS' ? (prev.note || '') : '',
      recordedAt: new Date().toISOString(), recordedBy: S.user ? S.user.name : '', synced: 0, rev: (prev.rev || 0) + 1,
    };
    if (extra) Object.assign(e, extra);
    const px = S.pendingExtra[key];
    if (px) { Object.assign(e, px); delete S.pendingExtra[key]; }
    if (status === 'LATE') {
      const held = heldBy(e.cover || e.teacher, cls, S.period);
      e.heldMins = held ? held.mins : 0;
      e.heldIn = held ? held.c + ' ' + ord(held.p) + ' period until ' + fmtMin(held.e) : '';
    }
    await Core.entryPut(e);
    S.entries.set(key, e);
    S.all = S.all.filter(function (x) { return x.key !== key; }).concat([e]);
    render();
    toast('Saved', async function () { if (prev && prev.key) await Core.entryPut(prev); else await Core.entryDel(key); await reloadEntries(); render(); });
    scheduleSync();
    regBackgroundSync();
  }

  function openModal(html) { $('#sheet').innerHTML = html; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }

  function lateModal(cls) {
    const prev = S.entries.get(S.date + '|' + S.period + '|' + cls);
    const cur = prev && prev.status === 'LATE' ? Number(prev.mins) : '';
    openModal('<h2>' + esc(cls) + ' — minutes late</h2><div class="muted">Minutes since the bell when the teacher was first in class.</div>' +
      '<div class="chips">' + [5, 10, 15, 20, 25, 30].map(function (n) { return '<button data-m="' + n + '" class="' + (cur === n ? 'on' : '') + '">' + n + '</button>'; }).join('') + '</div>' +
      '<input id="minsIn" type="number" inputmode="numeric" min="1" max="240" placeholder="Other number of minutes" value="' + (cur && [5, 10, 15, 20, 25, 30].indexOf(cur) < 0 ? cur : '') + '">' +
      '<div class="row-btns"><button id="mCancel">Cancel</button><button id="mSave" class="primary">Save</button></div>');
    const save = function (m) {
      m = Math.round(Number(m));
      if (!(m >= 1 && m <= 240)) { toast('Enter minutes between 1 and 240'); return; }
      closeModal();
      mark(cls, 'LATE', m);
    };
    $('#sheet').querySelectorAll('.chips button').forEach(function (b) { b.onclick = function () { save(b.dataset.m); }; });
    $('#mSave').onclick = function () { save($('#minsIn').value); };
    $('#mCancel').onclick = closeModal;
    $('#minsIn').onkeydown = function (e) { if (e.key === 'Enter') save($('#minsIn').value); else if (e.key === 'Escape') closeModal(); };
  }

  function absenceModal(cls) {
    const prev = S.entries.get(S.date + '|' + S.period + '|' + cls);
    openModal('<h2>' + esc(cls) + ' — absence reason</h2><div class="muted">Optional; up to 120 characters.</div><input id="noteIn" maxlength="120" type="text" placeholder="Reason (optional)" value="' + esc(prev && prev.note || '') + '"><div class="row-btns"><button id="mCancel">Cancel</button><button id="mSave" class="primary">Save</button></div>');
    const save = function () { const note = $('#noteIn').value.trim(); closeModal(); mark(cls, 'ABS', '', { note: note }); };
    $('#mSave').onclick = save; $('#mCancel').onclick = closeModal;
    $('#noteIn').onkeydown = function (e) { if (e.key === 'Enter') save(); else if (e.key === 'Escape') closeModal(); };
  }

  function coverModal(cls) {
    const key = S.date + '|' + S.period + '|' + cls;
    const prev = S.entries.get(key);
    const l = lesson(S.period, cls);
    const scheduled = (prev && prev.teacher) || (l && l.teacher) || '';
    const setting = scheduled ? 'cover teacher' : 'teacher';
    const list = Array.from(S.teachers.entries());
    const draw = function (q) {
      q = (q || '').toLowerCase();
      $('#tl').innerHTML = list.filter(function (t) { return !q || t[1].name.toLowerCase().indexOf(q) >= 0 || t[0].toLowerCase().indexOf(q) >= 0; })
        .map(function (t) { return '<button data-c="' + esc(t[0]) + '"><span>' + esc(t[1].name) + '</span><span class="muted">' + esc(t[0]) + '</span></button>'; }).join('') || '<div class="empty">No match</div>';
      $('#tl').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () {
          const code = b.dataset.c;
          closeModal();
          applyTeacher(cls, scheduled, code);
        };
      });
    };
    openModal('<h2>' + esc(cls) + ' — pick ' + setting + '</h2>' +
      '<input id="tq" type="search" placeholder="Search name or code"><div class="tlist" id="tl"></div>' +
      '<div class="row-btns">' + (prev && prev.cover ? '<button id="rmCover">Remove cover</button>' : '') + '<button id="mCancel">Cancel</button></div>');
    draw('');
    $('#tq').oninput = function () { draw($('#tq').value); };
    $('#mCancel').onclick = closeModal;
    $('#tq').onkeydown = function (e) { if (e.key === 'Escape') closeModal(); };
    if ($('#rmCover')) $('#rmCover').onclick = function () { closeModal(); applyTeacher(cls, scheduled, ''); };
  }

  async function applyTeacher(cls, scheduled, code) {
    const key = S.date + '|' + S.period + '|' + cls;
    const prev = S.entries.get(key);
    const extra = scheduled ? { cover: code } : { teacher: code, cover: '' };
    if (prev) await mark(cls, prev.status, prev.mins, extra);
    else {
      // no status yet: remember the choice, but mark as on time only when the monitor taps a status.
      toast('Now tap a status for ' + cls + ' to save the ' + (scheduled ? 'cover' : 'teacher'));
      S.pendingExtra[key] = extra;
    }
  }

  /* ───────────── sync ───────────── */

  /* ───────────── clock check & re-sign-in ───────────── */

  // Called only with a fresh server response (the stored copy has an out-of-date clock reading).
  function checkClock(res) {
    S.skew = res.skewMs || 0;
    S.dateOff = !!res.serverDate && res.serverDate !== ymd(new Date());
  }

  function isFrozen() { return !!(S.user && S.user.frozen); }
  function renderFrozen() {
    const el = $('#frozenWarn');
    el.hidden = !isFrozen();
    if (isFrozen()) el.textContent = '⛔ Monitoring is frozen for your account by the Admin. You can view reports and clashes, but new entries are not accepted.';
  }

  function renderClock() {
    const el = $('#clockWarn');
    const m = Math.round(Math.abs(S.skew) / 60000);
    const bad = S.dateOff || m >= 10;
    el.hidden = !bad;
    if (!bad) return;
    const amt = m >= 120 ? ' by about ' + Math.round(m / 60) + ' hours' : (m >= 10 ? ' by about ' + m + ' minutes' : '');
    el.textContent = '⚠ This phone\'s date or time looks wrong' + amt + '. Fix it in the phone Settings (set date & time to automatic), or entries may get the wrong date and period.';
  }

  function reauthModal() {
    openModal('<h2>Sign in again</h2><div class="muted">The PIN saved on this phone is no longer accepted, or the Admin may have revoked this phone. Your entries are safe and will sync after you sign in.</div>' +
      '<input id="rePin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" maxlength="12">' +
      '<p id="reErr" class="err"></p>' +
      '<div class="row-btns"><button id="mCancel">Cancel</button><button id="reGo" class="primary">Sign in</button></div>');
    $('#mCancel').onclick = closeModal;
    $('#reGo').onclick = async function () {
      const pin = $('#rePin').value.trim();
      const err = $('#reErr');
      if (!pin) { err.textContent = 'Enter your PIN.'; return; }
      if (!navigator.onLine) { err.textContent = 'No connection.'; return; }
      err.textContent = '';
      try {
        const res = await Core.refreshConfig(pin);
        if (res.ok) {
          loadCfg(res); S.user = res.user; S.authBad = false; checkClock(res);
          closeModal(); render(); trySync(true);
        } else if (res.error === 'auth') err.textContent = 'Wrong PIN.';
        else if (res.error === 'locked') err.textContent = 'Too many wrong PINs for this PIN. Try again in 10 minutes.';
        else if (res.error === 'revoked') err.textContent = 'This phone was revoked by the Admin. Ask them to restore access.';
        else err.textContent = 'Server problem (' + (res.error || 'unknown') + ').';
      } catch (e) { err.textContent = 'Could not reach the server.'; }
    };
  }

  function scheduleSync() {
    clearTimeout(S.syncTimer);
    S.syncTimer = setTimeout(function () { trySync(false); }, TIMINGS.syncDebounce);
  }

  function scheduleRetry() {
    clearTimeout(S.retryTimer);
    const base = TIMINGS.retry[Math.min(S.retryStep, TIMINGS.retry.length - 1)];
    S.retryStep++;
    S.retryTimer = setTimeout(function () { trySync(false); }, Math.round(base * (0.8 + Math.random() * 0.4)));
  }

  async function trySync(manual) {
    if (!pending().length) { if (manual) toast('Nothing to sync'); return; }
    if (S.authBad) { renderBadge(); if (manual) toast('Sign in again to sync'); return; }
    if (!navigator.onLine) { S.online = false; renderBadge(); if (manual) toast('No connection — entries are saved on this phone'); return; }
    S.online = true;
    renderBadge();
    let r;
    try { r = await Core.syncNow(); } catch (e) { r = { ok: false, error: 'network', detail: e && e.message ? e.message : String(e) }; }
    await reloadEntries();
    S.lastSyncError = r.ok ? null : { error: r.error || (r.rejected ? 'rejected' : 'unknown'), detail: r.detail || '' };
    Core.metaSet('lastSyncError', S.lastSyncError).catch(function (e) { console.warn('Could not save sync diagnostics.', e); });
    if (r.error === 'auth' || r.error === 'no_login' || r.error === 'revoked') S.authBad = true;
    else if (r.ok) { S.authBad = false; S.retryStep = 0; clearTimeout(S.retryTimer); }
    if (r.serverNow) checkClock({ skewMs: Date.now() - Date.parse(r.serverNow), serverDate: r.serverDate });
    if (r.frozen !== undefined && S.user && S.user.frozen !== r.frozen) { S.user.frozen = r.frozen; Core.metaSet('user', S.user); }
    // the system was busy (many phones at once): try again in a few seconds
    if (r.error === 'busy' || r.error === 'server' || r.error === 'network' || r.error === 'quota') scheduleRetry();
    render();
    if (manual) {
      if (r.ok) toast('Synced ' + r.saved + ' entries ✓');
      else if (r.error === 'auth') toast('PIN not accepted — sign in again');
      else if (r.error === 'locked') toast('Too many wrong PINs for this PIN. Try again in 10 minutes.');
      else if (r.error === 'quota') toast('The school records service is at its limit right now. Nothing was lost — try again in a minute.');
      else if (r.error === 'revoked') toast('This phone has been revoked by the Admin. Sign in again.');
      else if (r.error === 'busy') toast('The system is busy. Trying again in a moment.');
      else if (r.rejected) {
        const rejectedRows = rejected();
        const reason = rejectedRows[0] && rejectedRows[0].err;
        toast(reason === 'section_not_configured' ? 'Bell times are not set up for your section. Ask the Admin.' : r.rejected + ' entries were rejected — see Sync panel');
      }
      else toast('Could not sync — will retry. Open Sync & settings for details.');
      if (!r.ok) syncPanel();
    }
  }

  function regBackgroundSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) { if (reg.sync) return reg.sync.register('ce-sync'); }).catch(function () {});
  }

  async function backgroundRefresh() {
    S.lastRefresh = Date.now();
    if (!navigator.onLine || S.authBad) return;
    try {
      const before = S.cfg && S.cfg.version;
      const res = await Core.refreshConfig();
      if (res && res.ok) {
        S.authBad = false;
        S.user = res.user;
        renderFrozen();
        checkClock(res); renderClock();
        if (res.version !== before) { loadCfg(res); toast('Timetable updated'); render(); }
      } else if (res && res.error === 'auth') { S.authBad = true; renderBadge(); }
    } catch (e) { /* offline or not configured: keep working with the stored copy */ }
  }

  function syncPanel() {
    Promise.all([Core.metaGet('lastSync'), Core.metaGet('configAt'), Core.metaGet('lastSyncError')]).then(function (v) {
      const n = pending().length;
      const errs = rejected();
      const syncError = S.lastSyncError || v[2];
      const fmt = function (iso) { return iso ? new Date(iso).toLocaleString() : 'never'; };
      openModal('<h2>Sync &amp; settings</h2><div class="kv">' +
        '<span>Not synced</span><span><b>' + n + '</b> entries</span>' +
        '<span>Last sync</span><span>' + esc(fmt(v[0])) + '</span>' +
        '<span>Timetable</span><span>v' + esc(S.cfg.version || '?') + ' · ' + esc(fmt(v[1])) + '</span>' +
        '<span>Connection</span><span>' + (navigator.onLine ? 'Online' : 'Offline') + '</span></div>' +
        (syncError ? '<div class="errlist">Last sync error (' + esc(syncError.error || 'unknown') + '): ' + esc((syncError.detail || 'No additional server detail was returned.').slice(0, 400)) + '</div>' : '') +
        (errs.length ? '<div class="errlist">Rejected: ' + errs.slice(0, 5).map(function (e) { const reasons = { section_not_configured: 'Bell times are not set up for your section. Ask the Admin.' }; return esc(e.cls + ' ' + ord(e.period) + ' (' + (reasons[e.err] || e.err) + ')'); }).join(', ') + '</div>' : '') +
        '<div class="row-btns"><button id="pSync" class="primary">Sync now</button></div>' +
        (errs.length ? '<div class="row-btns"><button id="pRetry">Retry rejected</button><button id="pDisc">Discard rejected</button></div>' : '') +
        '<div class="row-btns"><button id="pCfg">Refresh timetable</button><button id="pExp">Share backup</button></div>' +
        '<div class="row-btns"><button id="pPdf">Download today\'s PDF</button></div>' +
        '<div class="row-btns">' + (S.installEvt ? '<button id="pInst">Install app</button>' : '') + '<button id="pHow" class="link">How to install on this phone</button><button id="pOut">Sign out</button><button id="pClose">Close</button></div>');
      $('#pSync').onclick = function () { closeModal(); trySync(true); };
      if ($('#pRetry')) $('#pRetry').onclick = async function () {
        for (const e of errs) { e.err = null; await Core.entryPut(e); }
        closeModal(); await reloadEntries(); render(); trySync(true);
      };
      if ($('#pDisc')) $('#pDisc').onclick = async function () {
        if (!confirm('Discard ' + errs.length + ' rejected entries? This cannot be undone.')) return;
        for (const e of errs) await Core.entryDel(e.key);
        closeModal(); await reloadEntries(); render();
      };
      $('#pCfg').onclick = async function () {
        if (!navigator.onLine) { toast('You need a connection to refresh'); return; }
        closeModal();
        await backgroundRefresh();
        toast('Timetable checked');
      };
      $('#pExp').onclick = exportBackup;
      $('#pPdf').onclick = downloadTodayPdf;
      $('#pClose').onclick = closeModal;
      $('#pOut').onclick = signOut;
      if ($('#pInst')) $('#pInst').onclick = install;
      $('#pHow').onclick = installHelp;
    });
  }

  async function exportBackup() {
    const rows = S.all.filter(function (e) { return !e.synced || e.date === S.date; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.period - b.period || a.cls.localeCompare(b.cls); });
    if (!rows.length) { toast('Nothing to export'); return; }
    const head = 'date,period,class,subject,teacher,cover,status,minutes_late,recorded_at,synced';
    const csv = [head].concat(rows.map(function (e) {
      return [e.date, e.period, e.cls, e.subject, e.teacher, e.cover, e.status, e.mins, e.recordedAt, e.synced ? 'yes' : 'NO']
        .map(function (v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    })).join('\n');
    const name = 'class-entry-' + S.date + '.csv';
    try {
      const file = new File([csv], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
      if (navigator.share) { await navigator.share({ title: name, text: csv }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function signOut() {
    const n = pending().length;
    if (n && !confirm(n + ' entries are not synced yet. They stay on this phone and will sync after the next sign-in. Sign out anyway?')) return;
    await Core.metaDel('pin'); await Core.metaDel('config'); await Core.metaDel('user'); await Core.metaDel('authBad');
    S.authBad = false;
    S.cfg = null; S.user = null; S.tab = 'entry';
    closeModal();
    showLogin();
  }

  function install() {
    if (!S.installEvt) { toast('Use the Chrome menu ⋮ → Install app'); return; }
    S.installEvt.prompt();
    S.installEvt.userChoice.then(function () { S.installEvt = null; $('#installBtn1').hidden = true; });
  }

  /* ───────────── screens ───────────── */

  function showLogin() {
    $('#main').hidden = true;
    $('#picker').hidden = true;
    $('#login').hidden = false;
    $('#pin').value = '';
    $('#loginErr').textContent = '';
    $('#installBtn1').hidden = !S.installEvt;
    let how = $('#installHelp1');
    if (!how) { how = document.createElement('button'); how.id = 'installHelp1'; how.className = 'link'; how.textContent = 'How to install on this phone'; $('#installBtn1').after(how); }
    how.onclick = installHelp;
  }

  function installHelp() { openModal('<h2>How to install</h2><p>Android Chrome: menu ⋮ → <b>Install app</b> (or Add to Home screen).</p><p>iPhone/iPad Safari: Share → <b>Add to Home Screen</b> → Add.</p><p>Desktop Chrome or Edge: use the install icon in the address bar. If no prompt appears, reload this page once.</p><div class="row-btns"><button id="mClose">Close</button></div>'); $('#mClose').onclick = closeModal; }

  async function doLogin() {
    const pin = $('#pin').value.trim();
    const err = $('#loginErr');
    if (!pin) { err.textContent = 'Enter your PIN.'; return; }
    if (!navigator.onLine) { err.textContent = 'No internet. You need a connection to sign in the first time.'; return; }
    const btn = $('#loginBtn');
    btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
    try {
      const res = await Core.refreshConfig(pin);
      if (res.ok) {
        loadCfg(res); S.user = res.user; S.authBad = false; checkClock(res);
        await startMain();
      } else if (res.error === 'auth') err.textContent = 'Wrong PIN.';
      else if (res.error === 'locked') err.textContent = 'Too many wrong PINs for this PIN. Try again in 10 minutes.';
      else if (res.error === 'revoked') err.textContent = 'This phone was revoked by the Admin. Ask them to restore access.';
      else err.textContent = 'Server problem (' + (res.error || 'unknown') + ').';
    } catch (e) {
      err.textContent = e && e.message === 'not_configured' ? 'App is not configured yet (config.js).' : 'Could not reach the server. Check your internet.';
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  }

  /* ───────────── section picker ───────────── */

  function ensureSection() {
    const secs = sections();
    if (secs.length < 2) { S.section = secs[0]; return true; }
    if (secs.indexOf(S.section) < 0) { S.section = ''; return false; }
    return true;
  }

  function secStatus(sec) {
    const ps = pdsFor(sec, S.day), cl = classesOf(sec);
    if (noSchool()) return { t: 'No school today', warn: false };
    if (!ps.length || !cl.length) return { t: 'Not set up yet', warn: false };
    const cp = currentPeriodFor(sec), exp = scheduledFor(sec, cp) || cl.length;
    let miss = 0;
    ps.forEach(function (p) { if (periodEndedFor(sec, p.n)) miss += unmarkedCount(sec, p.n); });
    const r = bellRange(sec, S.day, cp);
    return { t: ord(cp) + ' period' + (r ? ' · ' + fmtMin(r.s) + '–' + fmtMin(r.e) : '') + ' · ' + markedFor(sec, cp) + ' of ' + exp + ' marked' +
      (miss ? '  ⚠ ' + miss + ' unmarked in finished periods' : ''), warn: miss > 0 };
  }

  function renderPicker() {
    $('#main').hidden = true;
    $('#picker').hidden = false;
    $('#pkTitle').textContent = S.cfg.school || 'School';
    $('#pkDate').textContent = S.dateLabel + (S.user ? ' · ' + S.user.name : '');
    renderBadgeInto($('#pkBadge'));
    $('#pkList').innerHTML = sections().map(function (sec) {
      const st = secStatus(sec);
      return '<button class="pk" data-sec="' + esc(sec) + '"><b>' + esc(sec) + '</b><span class="' + (st.warn ? 'pkw' : '') + '">' + esc(st.t) + '</span></button>';
    }).join('');
  }

  function showPicker() { S.section = ''; S.tab = 'entry'; render(); }

  async function startMain() {
    setToday();
    const lastPrune = await Core.metaGet('lastPrune');
    if (lastPrune !== S.date) await Core.prune(30).then(function () { return Core.metaSet('lastPrune', S.date); }).catch(function () {});
    await reloadEntries();
    S.section = '';   // the monitor starts on the section picker (skipped when there is only one section)
    ensureSection();
    S.period = currentPeriod();
    S.manual = false;
    $('#login').hidden = true;
    render();
    if (pending().length) trySync(false);
    if (window.Admin && window.Admin.drainQueue) window.Admin.drainQueue();
  }

  /* ───────────── events ───────────── */

  function wire() {
    updateThemeControl();
    document.querySelectorAll('.theme-toggle').forEach(function (button) { button.onclick = toggleTheme; });
    $('#loginBtn').onclick = doLogin;
    $('#pkList').addEventListener('click', function (e) {
      const b = e.target.closest('[data-sec]'); if (!b) return;
      S.section = b.dataset.sec; S.manual = isPastDate(); S.tab = 'entry'; S.period = isPastDate() ? firstPeriod() : currentPeriod(); render();
    });
    $('#secBtn').onclick = showPicker;
    $('#pkBadge').onclick = function () { if (S.authBad) reauthModal(); else syncPanel(); };
    $('#pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('#installBtn1').onclick = install;
    $('#syncBadge').onclick = function () { if (S.authBad) reauthModal(); else syncPanel(); };
    $('#modal').addEventListener('click', function (e) {
      if (e.target !== $('#modal')) return;
      const cancelPast = !!pendingDate;
      pendingDate = '';
      closeModal();
      if (cancelPast) render();
    });
    $('#entryDate').addEventListener('change', function () { chooseEntryDate($('#entryDate').value); });
    document.querySelector('.tabs').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      S.tab = b.dataset.tab; render();
      if (S.tab === 'admin' && window.Admin) window.Admin.enter();
      if (S.tab === 'reports' && window.Reports) window.Reports.render($('#reportsView'));
      if (S.tab === 'clashes' && window.Clashes) window.Clashes.render($('#clashesView'));
    });
    $('#periodBar').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      S.period = Number(b.dataset.p); S.manual = true; render();
    });
    $('#unmarkedOnly').addEventListener('change', function (e) { S.unmarkedOnly = e.target.checked; renderEntry(); });
    $('#todayView').addEventListener('click', function (e) {
      if (e.target.closest('#tdPdf')) { downloadTodayPdf(); return; }
      if (e.target.closest('#tdPrint')) { printRoster(); return; }
      const tile = e.target.closest('[data-k]'); if (tile) { showToday(tile.dataset.k); return; }
      const tr = e.target.closest('tr.go'); if (!tr) return;
      S.period = Number(tr.dataset.p); S.manual = true; S.tab = 'entry'; render();
    });
    $('#list').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const card = btn.closest('.card'); const cls = card.dataset.cls;
      const act = btn.dataset.act;
      if (isFrozen()) { toast('Monitoring is frozen for your account. Ask the Admin.'); return; }
      if (act === 'cover') { coverModal(cls); return; }
      if (act === 'LATE') { lateModal(cls); return; }
      if (act === 'ABS') absenceModal(cls); else mark(cls, act, '');
    });
    $('#list').addEventListener('keydown', function (e) {
      if (e.target.matches('input,select,textarea') || !$('#modal').hidden) return;
      const card = e.target.closest('.card'); if (!card) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const cards = Array.prototype.slice.call($('#list').querySelectorAll('.card')); const n = cards.indexOf(card) + (e.key === 'ArrowDown' ? 1 : -1); if (cards[n]) cards[n].focus(); return; }
      const acts = { o: 'OT', '1': 'OT', l: 'LATE', '2': 'LATE', a: 'ABS', '3': 'ABS', x: 'NONE', '4': 'NONE' }; const act = acts[String(e.key).toLowerCase()];
      if (!act) return; e.preventDefault(); if (act === 'LATE') lateModal(card.dataset.cls); else if (act === 'ABS') absenceModal(card.dataset.cls); else mark(card.dataset.cls, act, '');
    });

    window.addEventListener('online', function () { S.online = true; renderBadge(); if (pending().length) scheduleRetry(); backgroundRefresh(); if (window.Admin && window.Admin.drainQueue) window.Admin.drainQueue(); });
    window.addEventListener('offline', function () { S.online = false; renderBadge(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !S.cfg) return;
      S.online = navigator.onLine;
      reloadEntries().then(function () {
        if (!S.manual) S.period = currentPeriod();
        render();
        if (pending().length) trySync(false);
        backgroundRefresh();
      });
    });
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); S.installEvt = e;
      if (!$('#login').hidden) $('#installBtn1').hidden = false;
    });
    setInterval(function () {
      if (!S.cfg || document.visibilityState !== 'visible') return;
      if (!S.manual) { const p = currentPeriod(); if (p !== S.period) S.period = p; }
      if (!$('#modal').hidden) return;      // do not redraw while a dialog is open
      const sig = [S.section, S.period, ymd(new Date()), pds().map(function (p) { return periodEnded(p.n) ? 1 : 0; }).join(''), pending().length, S.online].join('|');
      if (sig !== S.lastSig) { S.lastSig = sig; render(); }
      if (pending().length && navigator.onLine && !S.retryTimer) scheduleRetry();
      if (navigator.onLine && Date.now() - (S.lastRefresh || 0) > TIMINGS.refresh) { S.lastRefresh = Date.now(); backgroundRefresh(); }   // picks up a freeze or other Admin changes
    }, TIMINGS.tick);
  }

  /* ───────────── bridge for admin.js ───────────── */

  // Store a fresh config pushed back by the admin screens (without the users list or PINs).
  async function applyConfig(res) {
    const c = Object.assign({}, res);
    delete c.users; delete c.subjects;
    c.user = S.user;
    await Core.metaSet('config', c);
    await Core.metaSet('configAt', new Date().toISOString());
    loadCfg(c);
    render();
  }

  /** Marks the stored credentials as refused and updates the sync indicator. */
  function authFailed() {
    S.authBad = true;
    Core.metaSet('authBad', 1);
    renderBadge();
  }

  window.AppBridge = {
    S: S, esc: esc, toast: toast, applyConfig: applyConfig, authFailed: authFailed,
    telHtml: telHtml, showList: showList, openModal: openModal, closeModal: closeModal,
  };
  window.App = window.AppBridge;   // reports.js uses this name

  async function init() {
    if (DEBUG) console.log('Class Entry Monitor debug enabled');
    wire();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    if (!(await Core.metaGet('device'))) await Core.metaSet('device', 'dev-' + Math.random().toString(36).slice(2, 6));
    const pin = await Core.metaGet('pin');
    const cfg = await Core.metaGet('config');
    if (pin && cfg) {
      loadCfg(cfg);
      S.authBad = !!(await Core.metaGet('authBad'));
      S.user = await Core.metaGet('user');
      await startMain();
      backgroundRefresh();
    } else {
      showLogin();
    }
  }

  const hideBoot = function () { const b = document.getElementById('boot'); if (b) { b.classList.add('done'); setTimeout(function () { b.remove(); }, 450); } };
  setTimeout(hideBoot, 8000);   // never leave the loading screen up if something goes wrong
  init().then(hideBoot, hideBoot);
})();
