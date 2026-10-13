/* Clashes tab: teachers whose lessons overlap (timetable clashes), and late arrivals caused by an overlap between sections. */
(function (g) {
  'use strict';

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const C = { host: null, data: null, tab: 'timetable', section: '', loading: false, err: '', built: false, tok: 0, cached: false, at: '' };
  const A = function () { return g.App; };
  const esc = function (s) { return A().esc(s); };
  const ord = function (n) { const v = n % 100; return v >= 11 && v <= 13 ? n + 'th' : n + (({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };
  const parse = function (s) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); };
  const addDays = function (s, n) { return new Date(parse(s).getTime() + n * 86400000).toISOString().slice(0, 10); };
  const nice = function (s) { const d = parse(s); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; };
  const KIND = { same_time: ['Same time', 'hard'], overlap: ['Overlap', 'soft'], combined: ['Same period', 'info'], double_class: ['Class double-booked', 'hard'] };

  async function load() {
    const token = ++C.tok;
    C.loading = true; C.err = ''; draw();
    const to = A().S.date, from = addDays(to, -27);
    try {
      const res = await g.Core.api('clashes', { from: from, to: to });
      if (token !== C.tok) return;
      if (res && res.ok) { C.data = res; C.cached = false; C.at = new Date().toISOString(); await g.Core.metaSet('clashesCache', { at: C.at, data: res }); }
      else C.err = res && res.error === 'auth' ? 'Your PIN was not accepted. Sign out and sign in again.' :
        res && res.error === 'busy' ? 'The system is busy. Tap Refresh in a moment.' :
        res && res.error === 'rate_limited' ? 'Too many report requests just now. Wait a few seconds and try again.' :
        res && res.error === 'quota' ? 'The school records service is at its limit right now. Nothing was lost — try again in a minute.' :
        'Server problem (' + ((res && res.error) || 'unknown') + ').';
    } catch (e) {
      if (token !== C.tok) return;
      const cache = await g.Core.metaGet('clashesCache');
      if (cache && cache.data) { C.data = cache.data; C.cached = true; C.at = cache.at; }
      else C.err = navigator.onLine ? 'Could not reach the server.' : 'You are offline.';
    }
    C.loading = false; draw();
  }

  function line(c) {
    const x = function (e) { return '<b>' + esc(e.cls) + '</b> <span class="muted">' + esc(e.section) + ' · ' + ord(e.period) + ' period' + (e.start ? ' · ' + esc(e.start) + '–' + esc(e.end) : '') + '</span>'; };
    const k = KIND[c.kind] || ['Clash', 'soft'];
    let why = '';
    if (c.kind === 'overlap') why = ' The lessons overlap by <b>' + c.overlap + ' min</b>.';
    else if (c.kind === 'same_time') why = ' Both lessons are at the same time.';
    else if (c.kind === 'combined') why = ' Fine only if these classes are taught together.';
    else if (c.kind === 'double_class') why = ' The app shows only the first lesson.';
    return '<div class="clitem"><span class="clk ' + k[1] + '">' + k[0] + '</span><b>' + esc(c.day) + '</b> · ' + x(c.a) + ' and ' + x(c.b) + '.' + why + '</div>';
  }

  function timetableView(d) {
    const list = d.clashes.filter(function (c) { return !C.section || c.a.section === C.section || c.b.section === C.section; });
    if (!list.length) return '<div class="rmsg">No timetable clashes' + (C.section ? ' in ' + esc(C.section) : '') + '. ✓</div>';
    const groups = {}, order = [];
    list.forEach(function (c) { const k = c.teacher || c.a.cls; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(c); });
    return order.map(function (k) {
      const items = groups[k], f = items[0];
      return '<div class="clgroup"><h3>' + esc(f.name || k) + ' <span class="muted" style="font-weight:400">' + items.length + (items.length === 1 ? ' clash' : ' clashes') + '</span>' +
        (f.teacher ? A().telHtml(f.teacher) : '') + '</h3>' + items.map(line).join('') + '</div>';
    }).join('');
  }

  function heldView(d) {
    const list = d.held.filter(function (e) { return !C.section || e.section === C.section; });
    if (!list.length) return '<div class="rmsg">No late arrivals caused by an overlap in the last 4 weeks.</div>';
    const groups = {}, order = [];
    list.forEach(function (e) { if (!groups[e.teacher]) { groups[e.teacher] = []; order.push(e.teacher); } groups[e.teacher].push(e); });
    order.sort(function (a, b) { return groups[b].length - groups[a].length; });
    return '<p class="muted tot2">Late arrivals where the teacher was still finishing a lesson in another section. Excused ones count as on time in reports.</p>' + order.map(function (k) {
      const items = groups[k];
      return '<div class="clgroup"><h3>' + esc(items[0].name) + ' <span class="muted" style="font-weight:400">' + items.length + (items.length === 1 ? ' time' : ' times') + '</span>' + A().telHtml(k) + '</h3>' +
        items.map(function (e) {
          return '<div class="clitem"><b>' + esc(nice(e.date)) + '</b> · ' + ord(e.period) + ' period · ' + esc(e.cls) + ' · <span class="mm late">' + esc(e.mins) + ' min late</span> ' +
            '<span class="mm ' + (e.type === 'HELD' ? 'held' : '') + '">' + (e.type === 'HELD' ? 'excused' : 'counted late') + '</span><div class="muted">Still in ' + esc(e.heldIn) + '</div></div>';
        }).join('') + '</div>';
    }).join('');
  }

  function draw() {
    const host = C.host; if (!host) return;
    const d = C.data;
    let h = '<div class="rseg" style="grid-template-columns:repeat(2,1fr)"><button data-t="timetable" class="' + (C.tab === 'timetable' ? 'on' : '') + '">Timetable' + (d ? ' (' + d.clashes.length + ')' : '') + '</button>' +
      '<button data-t="held" class="' + (C.tab === 'held' ? 'on' : '') + '">Caused lateness' + (d ? ' (' + d.held.length + ')' : '') + '</button></div>';
    const sl = (d && d.sections) || [];
    h += '<div class="rtools">' + (sl.length > 1 ? '<select id="cSec" style="flex:1;font:inherit;padding:10px;border:2px solid var(--line);border-radius:10px;background:#fff"><option value="">All sections</option>' +
      sl.map(function (x) { return '<option value="' + esc(x) + '"' + (x === C.section ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' : '') + '<button id="cReload">↻ Refresh</button></div>';
    if (C.cached) h += '<p class="muted tot2">Offline: showing the list saved on this phone' + (C.at ? ' (' + esc(new Date(C.at).toLocaleString()) + ')' : '') + '.</p>';
    if (C.loading && !d) h += '<div class="rmsg">Loading…</div>';
    else if (C.err && !d) h += '<div class="rmsg"><div class="err">' + esc(C.err) + '</div></div>';
    else if (d) h += (C.loading ? '<p class="muted tot2">Refreshing…</p>' : '') + (C.tab === 'timetable' ? timetableView(d) : heldView(d));
    host.innerHTML = h;
  }

  function wire(host) {
    host.addEventListener('click', function (e) {
      const t = e.target.closest('[data-t]'); if (t) { C.tab = t.dataset.t; draw(); return; }
      if (e.target.closest('#cReload')) load(true);
    });
    host.addEventListener('change', function (e) { if (e.target.id === 'cSec') { C.section = e.target.value; draw(); } });
  }

  g.Clashes = {
    /** Mounts the Clashes screen and refreshes its server data. */
    render: function (host) {
      C.host = host;
      if (!C.built) { C.built = true; wire(host); }
      draw();
      load(false);   // always refresh when the tab is opened
    },
  };
})(typeof self !== 'undefined' ? self : globalThis);
