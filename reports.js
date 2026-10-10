/* Admin "Reports" tab: day / week / month / term analysis, drill-downs, CSV and PDF export.
 * Data comes from the server's 'report' action (aggregated from the Log sheet). Needs a connection. */
(function (g) {
  'use strict';

  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ordFull = function (n) { const v = n % 100; return v >= 11 && v <= 13 ? n + 'th period' : n + (({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th') + ' period'; };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const R = { mode: 'week', section: '', anchor: '', termIdx: null, sub: 'teachers', data: null, key: '', loading: false, err: '', host: null, built: false, tok: 0 };

  /* ───────── date helpers (strings 'yyyy-mm-dd', computed in UTC so time zones never shift a day) ───────── */
  const parse = function (s) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); };
  const fmt = function (d) { return d.toISOString().slice(0, 10); };
  const addDays = function (s, n) { return fmt(new Date(parse(s).getTime() + n * 86400000)); };
  const wsDow = function () { const w = A().S.cfg && A().S.cfg.weekStart; return w == null ? 1 : w; };   // first day of the school week (0 = Sun)
  const mondayOf = function (s) { return addDays(s, -((parse(s).getUTCDay() - wsDow() + 7) % 7)); };
  const monthStart = function (s) { return s.slice(0, 8) + '01'; };
  const monthEnd = function (s) { const d = parse(s); return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))); };
  const addMonths = function (s, n) {          // keeps the day of the month (clamped), so stepping back and forth returns to the same date
    const d = parse(s), first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
    return fmt(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d.getUTCDate(), last), 12)));
  };
  const nice = function (s) { const d = parse(s); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; };
  const niceY = function (s) { return nice(s) + ' ' + parse(s).getUTCFullYear(); };

  const A = function () { return g.App; };
  const esc = function (s) { return A().esc(s); };

  function terms() { return (A().S.cfg && A().S.cfg.terms) || []; }

  function rangeFor() {
    if (R.mode === 'day') return { from: R.anchor, to: R.anchor, label: niceY(R.anchor), title: 'Daily' };
    if (R.mode === 'week') {
      const f = mondayOf(R.anchor), t = addDays(f, 6);
      return { from: f, to: t, label: nice(f) + ' - ' + niceY(t), title: 'Weekly' };
    }
    if (R.mode === 'month') {
      const d = parse(R.anchor);
      return { from: monthStart(R.anchor), to: monthEnd(R.anchor), label: MONTHS_FULL[d.getUTCMonth()] + ' ' + d.getUTCFullYear(), title: 'Monthly' };
    }
    const tm = terms()[R.termIdx];
    if (!tm) return null;
    return { from: tm.start, to: tm.end, label: tm.name + ' (' + nice(tm.start) + ' - ' + niceY(tm.end) + ')', title: 'Term' };
  }

  /* ───────── data ───────── */
  const errText = function (code) {
    return ({ auth: 'Your PIN was not accepted. Sign out and sign in again.', forbidden: 'Only admins can view reports.',
              locked: 'Too many wrong PINs. Try again in 10 minutes.', range_too_long: 'That date range is too long.',
              bad_range: 'That date range is not valid.', bad_section: 'That section no longer exists. Pick another.' })[code] || 'Server problem (' + (code || 'unknown') + ').';
  };

  async function load(force) {
    const rg = rangeFor();
    if (!rg) { R.data = null; R.err = ''; draw(); return; }
    const key = rg.from + '|' + rg.to + '|' + R.section;
    if (!force && R.data && R.key === key) { draw(); return; }
    const token = ++R.tok;
    R.loading = true; R.err = ''; draw();
    try {
      const res = await g.Core.api('report', { from: rg.from, to: rg.to, section: R.section });
      if (token !== R.tok) return;
      if (!res || !res.ok) { R.err = errText(res && res.error); R.data = null; } else { R.data = res; R.key = key; }
    } catch (e) {
      if (token !== R.tok) return;
      R.err = navigator.onLine ? 'Could not reach the server.' : 'You are offline. Reports need a connection.';
      R.data = null;
    }
    R.loading = false; draw();
  }

  /* ───────── rendering ───────── */
  const pcClass = function (p, th) { return p == null ? 'n' : p >= th.good ? 'g' : p >= th.warn ? 'a' : 'r'; };
  const pcHtml = function (p, th) { return '<span class="pc ' + pcClass(p, th) + '">' + (p == null ? '–' : p.toFixed(1) + '%') + '</span>'; };

  function draw() {
    const host = R.host; if (!host) return;
    const rg = rangeFor();
    let h = '<div class="rseg">' + ['day', 'week', 'month', 'term'].map(function (m) {
      return '<button data-mode="' + m + '" class="' + (R.mode === m ? 'on' : '') + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</button>';
    }).join('') + '</div>';

    if (R.mode === 'term') {
      const ts = terms();
      h += '<div class="rnav">' + (ts.length
        ? '<select id="rTerm">' + ts.map(function (t, i) { return '<option value="' + i + '"' + (i === R.termIdx ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select>'
        : '') + '</div>';
    } else {
      h += '<div class="rnav"><button class="arrow" data-nav="-1" aria-label="Previous">‹</button><div class="lbl">' + esc(rg ? rg.label : '') +
        '</div><button class="arrow" data-nav="1" aria-label="Next">›</button></div>';
    }
    const sl = (A().S.cfg && A().S.cfg.sections) || [];
    if (sl.length > 1) {
      h += '<div class="rnav"><select id="rSec"><option value="">All sections</option>' + sl.map(function (x) {
        return '<option value="' + esc(x) + '"' + (x === R.section ? ' selected' : '') + '>' + esc(x) + '</option>';
      }).join('') + '</select></div>';
    }
    h += '<div class="rtools"><button id="rReload">↻ Refresh</button><button id="rExport" class="exp"' + (R.data ? '' : ' disabled') + '>Export · PDF / CSV</button></div>';

    if (R.mode === 'term' && !terms().length) {
      h += '<div class="rmsg">No terms set up yet.<br>Add the term names and dates in <b>Admin → Terms</b>, then come back here.</div>';
    } else if (R.loading) h += '<div class="rmsg">Loading…</div>';
    else if (R.err) h += '<div class="rmsg"><div class="err">' + esc(R.err) + '</div><p><button id="rReload2" class="xbtn" style="text-align:center">Try again</button></p></div>';
    else if (R.data) h += body(R.data);
    host.innerHTML = h;
  }

  function body(d) {
    const T = d.totals, th = d.thresholds;
    const tile = function (r, v, label, cls, clickable) {
      return (clickable ? '<button class="tile ' + cls + '" data-r="' + r + '">' : '<div class="tile ' + cls + '">') + '<b>' + v + '</b><span>' + label + '</span>' + (clickable ? '</button>' : '</div>');
    };
    let h = '<div class="tot">' +
      tile('', T.observed, 'Lessons observed', '', false) +
      tile('', T.pct == null ? '–' : T.pct.toFixed(1) + '%', 'On time', pcClass(T.pct, th) === 'g' ? 'g' : pcClass(T.pct, th) === 'a' ? 'a' : pcClass(T.pct, th) === 'r' ? 'r' : '', false) +
      tile('LATE', T.late, 'Late', 'a', true) + tile('ABS', T.abs, 'Absent', 'r', true) +
      tile('COVER', T.covers || 0, 'Cover lessons', '', true) + tile('LOSS', T.timeLost, 'Time lost (min)', '', true) +
      (T.excused ? tile('HELD', T.excused, 'Held in other section', '', true) : '') + '</div>' +
      '<p class="muted tot2">' + T.days + ' day' + (T.days === 1 ? '' : 's') + ' recorded · ' + T.minsLate + ' min late' + (T.excused ? ' · ' + T.excused + ' late arrival' + (T.excused === 1 ? '' : 's') + ' excused (teacher still in a lesson in another section)' : '') + ' · absence counts as ' + d.periodMinutes + ' min · tap a box for the list</p>';

    h += '<div class="rsub">' + [['teachers', 'Teachers'], ['classes', 'Classes'], ['periods', 'Periods'], ['trend', 'Trend']].map(function (s) {
      return '<button data-sub="' + s[0] + '" class="' + (R.sub === s[0] ? 'on' : '') + '">' + s[1] + '</button>';
    }).join('') + '</div>';

    if (R.sub === 'teachers') h += table(['Teacher', 'Obs', 'Late', 'Abs', 'Min', '% on time'],
      sortedTeachers(d).map(function (t) { return { attr: 'data-t="' + esc(t.code) + '"', cells: [esc(t.name), t.observed, t.late, t.abs, t.minsLate, pcHtml(t.pct, th)] }; }));
    else if (R.sub === 'classes') h += table(['Class', 'Obs', 'Late', 'Abs', 'Min', '% on time'],
      d.byClass.map(function (c) { return { cells: [esc(c.cls), c.observed, c.late, c.abs, c.minsLate, pcHtml(c.pct, th)] }; }));
    else if (R.sub === 'periods') h += table(['Period', 'Obs', 'Late', 'Abs', 'Min', '% on time'],
      d.byPeriod.map(function (p) { return { cells: [ordFull(p.period), p.observed, p.late, p.abs, p.minsLate, pcHtml(p.pct, th)] }; }));
    else h += trend(d);
    return h;
  }

  function sortedTeachers(d) {
    return d.byTeacher.slice().sort(function (a, b) {
      const x = a.pct == null ? 999 : a.pct, y = b.pct == null ? 999 : b.pct;
      return (x - y) || (a.name < b.name ? -1 : 1);
    });
  }

  function table(head, rows) {
    if (!rows.length) return '<div class="rmsg">No data for this period.</div>';
    return '<table class="rtbl"><tr>' + head.map(function (t) { return '<th>' + t + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) {
        return '<tr' + (r.attr ? ' class="go" ' + r.attr : '') + '>' + r.cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table>' + (rows[0].attr ? '<p class="muted" style="font-size:.78rem">Lowest punctuality first. Tap a teacher for details and to call.</p>' : '');
  }

  function series(d) {
    if (R.mode === 'week') return d.byDay.map(function (x) { return { label: nice(x.date), s: x }; });
    if (R.mode === 'day') return [];
    return d.byWeek.map(function (x) { return { label: 'w/c ' + nice(x.weekStart).replace(/^\w+ /, ''), s: x }; });
  }

  function trend(d) {
    const pts = series(d);
    if (!pts.length) return '<div class="rmsg">Trend needs a week, month or term.</div>';
    return '<div class="bars">' + pts.map(function (p) {
      const c = pcClass(p.s.pct, d.thresholds);
      return '<div class="bar"><span>' + esc(p.label) + '</span><div class="track"><div class="fill ' + (c === 'n' ? '' : c) + '" style="width:' + (p.s.pct || 0) + '%"></div></div><b>' + (p.s.pct == null ? '–' : p.s.pct.toFixed(0) + '%') + '</b></div>';
    }).join('') + '</div>';
  }

  /* ───────── drill-down lists ───────── */
  function exRow(e) {
    const A_ = A();
    let chip = '';
    if (e.type === 'LATE') chip = '<span class="mm late">' + esc(e.mins) + ' min late</span>';
    else if (e.type === 'ABS') chip = '<span class="mm abs">absent</span>';
    else if (e.type === 'HELD') chip = '<span class="mm held">' + esc(e.mins) + ' min · held in ' + esc(e.heldIn) + '</span>';
    else chip = '<span class="mm">cover</span>';
    const cov = e.cover ? '<span class="muted"> · covering for ' + esc(e.scheduledName) + '</span>' : '';
    return '<div class="dr"><div class="dl1"><b>' + esc(nice(e.date)) + '</b> · ' + ordFull(e.period) + ' · ' + esc(e.cls) + (e.subject ? ' · ' + esc(e.subject) : '') + '</div>' +
      '<div class="dl2"><span>' + esc(e.name) + '</span>' + A_.telHtml(e.teacher) + chip + cov + '</div></div>';
  }

  function showKind(kind) {
    const d = R.data; if (!d) return;
    const titles = { LATE: 'Late arrivals', ABS: 'Absences — missed periods', COVER: 'Cover lessons', HELD: 'Held in another section (excused)', LOSS: 'Late and absent (time lost)' };
    const list = d.exceptions.filter(function (e) {
      return kind === 'LOSS' ? (e.type === 'LATE' || e.type === 'ABS') : e.type === kind || (kind === 'COVER' && e.cover);
    });
    let sum = list.length + (list.length === 1 ? ' record' : ' records');
    if (kind === 'LATE' || kind === 'LOSS' || kind === 'HELD') sum += ' · ' + list.reduce(function (t, e) { return t + (e.type === 'LATE' || e.type === 'HELD' ? e.mins : 0); }, 0) + ' minutes in total';
    A().showList(titles[kind] + ' (' + list.length + ')', sum, list.map(exRow));
  }

  function showTeacher(code) {
    const d = R.data; if (!d) return;
    const t = d.byTeacher.find(function (x) { return x.code === code; }); if (!t) return;
    const list = d.exceptions.filter(function (e) { return e.teacher === code || (e.cover && e.scheduled === code); });
    const sum = t.observed + ' lessons observed · ' + t.late + ' late (' + t.minsLate + ' min) · ' + t.abs + ' absent · ' +
      (t.pct == null ? 'no punctuality score' : t.pct.toFixed(1) + '% on time') +
      (t.coversTaken ? ' · covered ' + t.coversTaken + ' for others' : '') + (t.covered ? ' · ' + t.covered + ' of theirs covered' : '');
    A().showList(t.name + (A().telHtml(code) ? '' : ''), sum + (A().telHtml(code) ? '<div style="margin-top:6px">' + A().telHtml(code) + '</div>' : ''), list.map(exRow));
  }

  /* ───────── export ───────── */
  const fname = function (rg, ext, tag) { return 'ClassEntry_' + rg.title + (R.section ? '_' + R.section.replace(/\W+/g, '') : '') + (tag ? '_' + tag : '') + '_' + rg.from + (rg.to !== rg.from ? '_to_' + rg.to : '') + '.' + ext; };

  function csv(head, rows) {
    const q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    return '\ufeff' + [head].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }
  const stat = function (x) { return [x.observed, x.ot, x.late, x.abs, x.minsLate, x.timeLost, x.pct == null ? '' : x.pct]; };
  const STAT_HEAD = ['Lessons observed', 'On time', 'Late', 'Absent', 'Minutes late', 'Time lost (min)', '% on time'];

  function csvFor(kind) {
    const d = R.data;
    if (kind === 'teachers') return csv(['Teacher', 'Code', 'Phone'].concat(STAT_HEAD, ['Covers taken', 'Covered by others']),
      d.byTeacher.map(function (t) { return [t.name, t.code, t.phone].concat(stat(t), [t.coversTaken, t.covered]); }));
    if (kind === 'classes') return csv(['Class'].concat(STAT_HEAD), d.byClass.map(function (c) { return [c.cls].concat(stat(c)); }));
    if (kind === 'periods') return csv(['Period'].concat(STAT_HEAD), d.byPeriod.map(function (p) { return [ordFull(p.period)].concat(stat(p)); }));
    if (kind === 'days') return csv(['Date', 'Day'].concat(STAT_HEAD), d.byDay.map(function (x) { return [x.date, x.day].concat(stat(x)); }));
    if (kind === 'weeks') return csv(['Week starting'].concat(STAT_HEAD), d.byWeek.map(function (x) { return [x.weekStart].concat(stat(x)); }));
    return csv(['Date', 'Day', 'Period', 'Section', 'Class', 'Subject', 'Type', 'Minutes late', 'Teacher', 'Phone', 'Covering for', 'Held in (overlap)'],
      d.exceptions.map(function (e) { return [e.date, e.day, e.period, e.section || '', e.cls, e.subject, e.type, e.type === 'LATE' || e.type === 'HELD' ? e.mins : '', e.name, (g.App.S.teachers.get(e.teacher) || {}).phone || '', e.cover ? e.scheduledName : '', e.heldIn || '']; }));
  }

  async function saveBlob(blob, name, forceDownload) {
    try {
      if (forceDownload) throw new Error('download');
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function pngSize(dataUrl) {
    try {
      const b = atob(dataUrl.split(',')[1].slice(0, 60));
      if (b.charCodeAt(1) === 0x50 && b.charCodeAt(2) === 0x4e) {
        const u = function (i) { return (b.charCodeAt(i) << 24 | b.charCodeAt(i + 1) << 16 | b.charCodeAt(i + 2) << 8 | b.charCodeAt(i + 3)) >>> 0; };
        return { w: u(16), h: u(20) };
      }
    } catch (e) { /* fall through */ }
    return { w: 1, h: 1 };
  }

  async function loadLogo() {
    try {
      const r = await fetch('logo.png');
      if (!r.ok) return null;
      const blob = await r.blob();
      const url = await new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); });
      return Object.assign({ dataUrl: url }, pngSize(url));
    } catch (e) { return null; }
  }

  async function makePdf(opts) {
    if (!g.jspdf) await loadScript('lib/jspdf.umd.min.js');
    if (!(g.jspdf && g.jspdf.jsPDF.API.autoTable)) await loadScript('lib/jspdf.plugin.autotable.min.js');
    if (!g.PdfReport) await loadScript('pdf-report.js');
    opts.logo = await loadLogo();
    return g.PdfReport.build(opts);
  }

  async function exportPdf() {
    const rg = rangeFor();
    A().toast('Preparing PDF…');
    try {
      const blob = await makePdf({
        data: R.data, mode: R.mode, title: rg.title + ' Class Entry Report' + (R.section ? ' - ' + R.section : ''), label: rg.label,
        school: R.data.school || A().S.cfg.school || '', user: (A().S.user || {}).name || '',
      });
      A().closeModal();
      await saveBlob(blob, fname(rg, 'pdf'));
    } catch (e) {
      A().toast('Could not create the PDF: ' + (e && e.message ? e.message : 'unknown error'));
    }
  }

  function exportModal() {
    const rg = rangeFor();
    const btn = function (x, t, sub, cls) { return '<button class="xbtn ' + (cls || '') + '" data-x="' + x + '">' + t + '<small>' + sub + '</small></button>'; };
    A().openModal('<h2>Export — ' + esc(rg.title) + '</h2><div class="muted dsum">' + esc(rg.label) + (R.section ? ' · ' + esc(R.section) : '') + '</div>' +
      btn('pdf', 'PDF report', 'Formatted report with logo, summary, chart, tables and sign-off', 'pdf') +
      btn('teachers', 'CSV · By teacher', 'Lessons, late, absent, minutes, % on time, phone') +
      btn('details', 'CSV · Late, absent and cover details', 'One row per incident') +
      btn('classes', 'CSV · By class', 'For spreadsheets') + btn('periods', 'CSV · By period', 'For spreadsheets') +
      btn('days', 'CSV · By day', 'Daily totals') + btn('weeks', 'CSV · By week', 'Weekly totals') +
      '<div class="row-btns"><button id="mCancel">Close</button></div>');
    document.getElementById('mCancel').onclick = A().closeModal;
    document.getElementById('sheet').querySelectorAll('[data-x]').forEach(function (b) {
      b.onclick = function () {
        const x = b.dataset.x;
        if (x === 'pdf') { exportPdf(); return; }
        A().closeModal();
        saveBlob(new Blob([csvFor(x)], { type: 'text/csv' }), fname(rg, 'csv', x));
      };
    });
  }

  /* ───────── events ───────── */
  function wire(host) {
    host.addEventListener('click', function (e) {
      const t = e.target;
      const mode = t.closest('[data-mode]');
      if (mode) { R.mode = mode.dataset.mode; if (R.mode === 'term' && R.termIdx == null) R.termIdx = defaultTerm(); load(false); return; }
      const nav = t.closest('[data-nav]');
      if (nav) {
        const n = Number(nav.dataset.nav);
        R.anchor = R.mode === 'day' ? addDays(R.anchor, n) : R.mode === 'week' ? addDays(R.anchor, 7 * n) : addMonths(R.anchor, n);
        load(false); return;
      }
      const sub = t.closest('[data-sub]'); if (sub) { R.sub = sub.dataset.sub; draw(); return; }
      const tile = t.closest('[data-r]'); if (tile) { showKind(tile.dataset.r); return; }
      const row = t.closest('tr.go'); if (row) { showTeacher(row.dataset.t); return; }
      if (t.closest('#rReload') || t.closest('#rReload2')) { load(true); return; }
      if (t.closest('#rExport')) { if (R.data) exportModal(); return; }
    });
    host.addEventListener('change', function (e) {
      if (e.target.id === 'rTerm') { R.termIdx = Number(e.target.value); load(false); }
      if (e.target.id === 'rSec') { R.section = e.target.value; load(false); }
    });
  }

  function defaultTerm() {
    const ts = terms(), today = A().S.date;
    let i = ts.findIndex(function (t) { return t.start <= today && today <= t.end; });
    if (i < 0) { ts.forEach(function (t, k) { if (t.start <= today) i = k; }); }
    return i < 0 ? (ts.length ? ts.length - 1 : null) : i;
  }

  g.Reports = {
    render: function (host) {
      R.host = host;
      if (!R.built) { R.built = true; R.anchor = A().S.date; R.termIdx = defaultTerm(); wire(host); load(false); return; }
      if (!host.innerHTML) draw();
    },
    // exposed for tests
    pdfToday: async function (opts) { const file = opts.file; delete opts.file; const blob = await makePdf(opts); await saveBlob(blob, file, true); },
    _state: R, _rangeFor: rangeFor, _csvFor: csvFor,
  };
})(typeof self !== 'undefined' ? self : globalThis);
