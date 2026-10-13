/* Admin screens: manage school name, classes, subjects, teachers, bell times, timetable and users from the app. */
(function (g) {
  'use strict';

  const $ = function (s) { return document.querySelector(s); };
  const ord = function (n) { const v = n % 100; return v >= 11 && v <= 13 ? n + 'th' : n + (({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };
  const MAX_P = 10;
  const DEBUG = false;
  const A = { data: null, dirty: false, busy: false, view: '', menuToken: 0 };
  const days = function () { return (A.data && A.data.days && A.data.days.length) ? A.data.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']; };
  const secs = function () { return (A.data && A.data.sections && A.data.sections.length) ? A.data.sections : ['']; };
  const secOfCls = function (c) { return ((A.data.classSection) || {})[c] || secs()[0]; };
  const B = function () { return g.AppBridge; };
  const esc = function (s) { return B().esc(s); };
  const box = function () { return $('#adminView'); };
  const note = function (t) { return '<div class="empty">' + esc(t) + '</div>'; };
  const sel = function (v, cur) { return v === cur ? ' selected' : ''; };

  function randPin() {
    const a = new Uint32Array(1);
    g.crypto.getRandomValues(a);
    return String(100000 + (a[0] % 900000));
  }

  /* ───────── common ───────── */

  function head(title, hint) {
    return '<div class="ahead"><button class="link" id="aBack">‹ Back</button><h2>' + esc(title) + '</h2></div>' +
      (hint ? '<p class="ahint">' + esc(hint) + '</p>' : '') + '<p id="aErr" class="err"></p>';
  }

  function wireBack() {
    const b = $('#aBack');
    if (b) b.onclick = function () {
      if (A.dirty && !confirm('Discard your unsaved changes?')) return;
      A.dirty = false; menu();
    };
  }

  function showErr(msg) {
    const e = $('#aErr');
    if (!e) { if (msg) B().toast(msg); return; }
    e.textContent = msg || '';
    if (msg && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' });
  }

  function fail(res) {
    const code = res && res.error;
    if (code === 'auth') { B().authFailed(); showErr('Your PIN is no longer accepted. Tap the red badge at the top to sign in again.'); }
    else if (code === 'forbidden') showErr('Only an Admin can change these settings.');
    else if (code === 'locked') showErr('Too many wrong PINs. Try again in 10 minutes.');
    else if (code === 'busy') showErr('The system is busy with other users. Nothing was changed. Try again in a moment.');
    else if (code === 'invalid') showErr(res.detail || 'Some values are not valid.');
    else showErr('Server problem (' + (code || 'unknown') + '). Nothing was changed.');
  }

  async function save(payload, action, doneMsg) {
    showErr('');
    if (A.busy) return false;
    if (!navigator.onLine) {
      const q = (await g.Core.metaGet('adminQueue')) || [];
      q.push({ payload: payload, action: action || 'admin_save', doneMsg: doneMsg || '' });
      await g.Core.metaSet('adminQueue', q);
      A.dirty = false; B().toast('Saved locally — will sync when online'); return true;
    }
    A.busy = true;
    const btn = $('#aSave');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const res = await g.Core.api(action || 'admin_save', payload);
      if (res && res.ok) {
        A.data = res; A.dirty = false;
        await B().applyConfig(res);
        B().toast(doneMsg || 'Saved ✓');
        return true;
      }
      fail(res);
      return false;
    } catch (e) {
      showErr('Could not reach the server. Nothing was saved.');
      return false;
    } finally {
      A.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  }

  /** Loads the current Admin snapshot and opens its settings menu. */
  async function enter() {
    if (DEBUG) console.log('Loading Admin settings');
    A.dirty = false;
    const el = box();
    el.oninput = null;
    if (B().S.authBad) { el.innerHTML = note('Sign in again first: tap the red badge at the top.'); return; }
    if (!navigator.onLine) { el.innerHTML = note('You need an internet connection to load settings. Queued changes will sync when you are online.'); return; }
    el.innerHTML = note('Loading…');
    try {
      const res = await g.Core.api('admin_get', {});
      if (res && res.ok) { A.data = res; menu(); }
      else { el.innerHTML = '<p id="aErr" class="err"></p>'; fail(res); }
    } catch (e) {
      el.innerHTML = note('Could not reach the server. Check your internet and open this tab again.');
    }
  }

  /** Sends locally queued Admin writes in their original order when connectivity returns. */
  async function drainQueue() {
    if (!navigator.onLine || A.busy) return;
    const q = (await g.Core.metaGet('adminQueue')) || [];
    while (q.length) {
      try {
        const item = q[0], res = await g.Core.api(item.action, item.payload);
        if (!res || !res.ok) break;
        q.shift(); await g.Core.metaSet('adminQueue', q);
        A.data = res; await B().applyConfig(res); B().toast('Queued change applied.');
      } catch (e) { break; }
    }
    if (A.view === 'menu' || A.view === 'queued') menu();
  }

  async function queuedChanges() {
    const q = (await g.Core.metaGet('adminQueue')) || [];
    box().innerHTML = head('Queued changes', 'Offline Admin edits are sent in order when this phone is online.') +
      (q.length ? '<div class="alist">' + q.map(function (item, i) {
        return '<div class="clgroup"><b>' + (i + 1) + '. ' + esc(item.payload && item.payload.table || item.action) + '</b><div class="muted">Will be applied in queue order.</div></div>';
      }).join('') + '<div class="row-btns"><button id="discardQueuedView">Discard queued changes</button></div>' : note('No queued changes.'));
    wireBack();
    const discard = $('#discardQueuedView');
    if (discard) discard.onclick = async function () {
      if (!confirm('Discard all ' + q.length + ' queued changes? This cannot be undone.')) return;
      await g.Core.metaDel('adminQueue'); B().toast('Queued changes discarded.'); menu();
    };
  }

  async function devices() {
    box().innerHTML = head('Devices', 'Phones that have successfully synced. Revoke blocks the device on its next request.') + note('Loading…');
    wireBack();
    try {
      const res = await g.Core.api('admin_devices', {});
      if (!res || !res.ok) { fail(res); return; }
      const list = res.devices || [];
      box().innerHTML = head('Devices', 'Phones that have successfully synced. Revoke blocks the device on its next request.') +
        (list.length ? '<div class="alist">' + list.map(function (d) {
          return '<div class="clgroup"><b>' + esc(d.user) + '</b> · PIN ' + esc(d.pin) +
            '<div class="muted">Device: ' + esc(d.device) + '<br>First seen: ' + esc(d.firstSeen) + '<br>Last seen: ' + esc(d.lastSeen) +
            (d.revokedAt ? '<br>Revoked: ' + esc(d.revokedAt) : '') + '</div>' +
            (d.revokedAt ? '' : '<button class="xbtn" data-revoke="' + esc(d.device) + '">Revoke</button>') + '</div>';
        }).join('') + '</div>' : note('No devices have synced yet.'));
      wireBack();
      box().querySelectorAll('[data-revoke]').forEach(function (btn) {
        btn.onclick = async function () {
          if (!confirm('Revoke this device? Its next request will be refused.')) return;
          try {
            const result = await g.Core.api('admin_revoke_device', { device: btn.dataset.revoke });
            if (!result || !result.ok) { fail(result); return; }
            B().toast('Device revoked.'); devices();
          } catch (e) { showErr('Could not reach the server. Nothing was changed.'); }
        };
      });
    } catch (e) { box().innerHTML = head('Devices') + note('Could not reach the server. Check your internet and try again.'); wireBack(); }
  }

  /* ───────── menu ───────── */

  function menu() {
    const d = A.data, token = ++A.menuToken;
    A.view = 'menu';
    g.Core.metaGet('adminQueue').then(function (queued) {
      if (token !== A.menuToken || A.view !== 'menu') return;
      const q = queued || [];
    box().oninput = null;
    const items = [
      ['school', 'School name & days', d.school || '—'],
      ['sections', 'Sections', (d.sections || []).join(', ') || '—'],
      ['classes', 'Classes', d.classes.length + ' classes'],
      ['subjects', 'Subjects', d.subjects.length + ' subjects'],
      ['records', 'Saved records (Drive)', ((d.records && d.records.files) || []).length + ' term files'],
      ['teachers', 'Teachers', d.teachers.length + ' teachers'],
      ['periods', 'Bell times', d.periods.length + ' rows'],
      ['terms', 'Terms', (d.terms || []).length + ' terms'],
      ['timetable', 'Timetable', d.timetable.length + ' lessons'],
      ['users', 'Users & PINs', d.users.length + ' users'],
      ['devices', 'Devices', 'Manage synced phones'],
      ['queued', 'Queued changes (' + q.length + ')', q.length ? 'Saved offline' : 'No pending saves'],
    ];
    box().innerHTML = '<p class="ahint">Changes reach the monitor\'s phone the next time it opens the app with internet.</p><div class="amenu">' +
      items.map(function (m) {
        return '<button class="amrow" data-v="' + m[0] + '"><b>' + esc(m[1]) + '</b><span class="muted">' + esc(m[2]) + '</span></button>';
      }).join('') + '</div>' + (q.length ? '<div class="row-btns"><button id="discardQueued">Discard queued changes</button></div>' : '');
    box().querySelectorAll('.amrow').forEach(function (b) { b.onclick = function () { open(b.dataset.v); }; });
    const discard = $('#discardQueued');
    if (discard) discard.onclick = async function () {
      if (!confirm('Discard all ' + q.length + ' queued changes? This cannot be undone.')) return;
      await g.Core.metaDel('adminQueue'); B().toast('Queued changes discarded.'); menu();
    };
    });
  }

  function open(view) {
    A.dirty = false;
    A.view = view;
    if (view === 'school') school();
    else if (view === 'classes' || view === 'subjects' || view === 'sections') listEditor(view);
    else if (view === 'teachers') teachers();
    else if (view === 'periods') periods();
    else if (view === 'terms') terms();
    else if (view === 'records') records();
    else if (view === 'timetable') timetable();
    else if (view === 'users') users();
    else if (view === 'devices') devices();
    else if (view === 'queued') queuedChanges();
  }

  /* ───────── school name ───────── */

  function school() {
    const ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], cur = days();
    box().innerHTML = head('School name & days') +
      '<input type="text" id="aSchool" maxlength="60" value="' + esc(A.data.school) + '">' +
      '<p class="ahint">School days (the monitor sees only these days, and report weeks start on the first one after a non-school day).</p>' +
      '<p class="ahint">Text at the bottom of every PDF report, and the "Generated by" line (leave empty to hide).</p>' +
      '<input type="text" id="aFooter" maxlength="80" placeholder="Footer text" value="' + esc(A.data.reportFooter) + '">' +
      '<input type="text" id="aBy" maxlength="80" placeholder="Generated by" style="margin-top:6px" value="' + esc(A.data.reportBy) + '">' +
      '<input type="email" id="aPrincipal" maxlength="254" placeholder="Principal email (weekly digest)" style="margin-top:6px" value="' + esc(A.data.principalEmail || '') + '">' +
      '<input type="url" id="aAppUrl" maxlength="80" placeholder="https:// app URL for reports link" style="margin-top:6px" value="' + esc(A.data.appUrl || '') + '">' +
      '<div class="dayrow">' + ORDER.map(function (d) {
        return '<label class="chkl"><input type="checkbox" data-day="' + d + '"' + (cur.indexOf(d) >= 0 ? ' checked' : '') + '> ' + d + '</label>';
      }).join('') + '</div>' +
      '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
    wireBack();
    box().oninput = function () { A.dirty = true; };
    box().onchange = function () { A.dirty = true; };
    $('#aSave').onclick = async function () {
      const v = $('#aSchool').value.trim();
      if (!v) { showErr('Enter the school name.'); return; }
      const ds = Array.prototype.slice.call(box().querySelectorAll('[data-day]')).filter(function (x) { return x.checked; }).map(function (x) { return x.dataset.day; });
      if (!ds.length) { showErr('Choose at least one school day.'); return; }
      const email = $('#aPrincipal').value.trim(), url = $('#aAppUrl').value.trim();
      const localPart = email.split('@')[0];
      if (email && (email.length > 254 || localPart.charAt(0) === '.' || localPart.charAt(localPart.length - 1) === '.' || email.indexOf('..') >= 0 ||
        !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i.test(email))) { showErr('Enter a valid Principal email.'); return; }
      if (url && !/^https:\/\//i.test(url)) { showErr('The app URL must start with https://.'); return; }
      if (await save({ table: 'Config', rows: [['SchoolName', v], ['SchoolDays', ds.join(',')], ['ReportFooter', $('#aFooter').value.trim()], ['ReportBy', $('#aBy').value.trim()], ['PrincipalEmail', email], ['AppUrl', url]] })) school();
    };
  }

  /* ───────── classes / subjects ───────── */

  function listEditor(kind) {
    const cfg = kind === 'classes'
      ? { title: 'Classes', table: 'Classes', items: A.data.classes, max: 20,
          hint: 'Each class belongs to a section. This order is the order on the monitor\'s screen. Renaming a class updates the timetable; past records keep the old name. A class that still has lessons cannot be deleted. Let the monitor sync before you rename.' }
      : kind === 'sections'
      ? { title: 'Sections', table: 'Sections', items: A.data.sections || [], max: 20,
          hint: 'Sections such as Secondary, Primary and Nursery. Each has its own classes and bell times, and the monitor picks one when he opens the app. Renaming a section updates its classes and bell times. A section that still has classes cannot be deleted.' }
      : { title: 'Subjects', table: 'Subjects', items: A.data.subjects, max: 40,
          hint: 'Renaming a subject updates the timetable. A subject that is still used in the timetable cannot be deleted.' };
    const isCls = kind === 'classes', sl = secs();
    const rows = cfg.items.map(function (v) { return { orig: v, v: v, sec: isCls ? secOfCls(v) : '' }; });

    function draw() {
      box().innerHTML = head(cfg.title, cfg.hint) + '<div class="alist">' + rows.map(function (r, i) {
        return '<div class="erow' + (isCls ? ' wrap' : '') + '"><input type="text" class="nm" data-i="' + i + '" maxlength="' + cfg.max + '" value="' + esc(r.v) + '">' +
          (isCls ? '<select data-i="' + i + '" data-sec="1">' + sl.map(function (x) { return '<option' + sel(x, r.sec) + '>' + esc(x) + '</option>'; }).join('') + '</select>' : '') +
          '<button class="x" data-up="' + i + '" aria-label="Move up">▲</button>' +
          '<button class="x" data-dn="' + i + '" aria-label="Move down">▼</button>' +
          '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button></div>';
      }).join('') + '</div><button id="aAdd" class="addbtn">+ Add</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      wireBack();
      const el = box();
      el.querySelectorAll('input[data-i]').forEach(function (inp) {
        inp.oninput = function () { rows[+inp.dataset.i].v = inp.value; A.dirty = true; };
      });
      el.querySelectorAll('select[data-sec]').forEach(function (x) {
        x.onchange = function () { rows[+x.dataset.i].sec = x.value; A.dirty = true; };
      });
      el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }; });
      el.querySelectorAll('[data-up]').forEach(function (b) {
        b.onclick = function () { const i = +b.dataset.up; if (i > 0) { const t = rows[i]; rows[i] = rows[i - 1]; rows[i - 1] = t; A.dirty = true; draw(); } };
      });
      el.querySelectorAll('[data-dn]').forEach(function (b) {
        b.onclick = function () { const i = +b.dataset.dn; if (i < rows.length - 1) { const t = rows[i]; rows[i] = rows[i + 1]; rows[i + 1] = t; A.dirty = true; draw(); } };
      });
      $('#aAdd').onclick = function () {
        rows.push({ orig: '', v: '', sec: sl[0] }); A.dirty = true; draw();
        const ins = box().querySelectorAll('input[data-i]');
        if (ins.length) ins[ins.length - 1].focus();
      };
      $('#aSave').onclick = async function () {
        const out = [], renames = {}, seen = {};
        for (let i = 0; i < rows.length; i++) {
          const n = rows[i].v.trim();
          if (!n) continue;
          if (seen[n.toLowerCase()]) { showErr('"' + n + '" appears twice.'); return; }
          seen[n.toLowerCase()] = 1;
          out.push(isCls ? [n, rows[i].sec] : [n]);
          if (rows[i].orig && n !== rows[i].orig) renames[rows[i].orig] = n;
        }
        if (!out.length) { showErr('Keep at least one.'); return; }
        if (await save({ table: cfg.table, rows: out, renames: renames })) listEditor(kind);
      };
    }
    draw();
  }

  /* ───────── teachers ───────── */

  function teachers() {
    const rows = A.data.teachers.map(function (t) { return { orig: t[0], code: t[0], name: t[1], phone: t[2] || '' }; });
    const nextCode = function () {
      let max = 0;
      rows.forEach(function (r) { const m = /^T(\d+)$/i.exec(r.code); if (m) max = Math.max(max, +m[1]); });
      return 'T' + String(max + 1).padStart(2, '0');
    };

    function draw() {
      box().innerHTML = head('Teachers', 'The code is permanent once saved (the timetable uses it); names and phone numbers can be changed any time. The phone number shows next to the name on the monitor\'s screen and can be tapped to call. A teacher who is still in the timetable cannot be deleted.') +
        '<div class="alist">' + rows.map(function (r, i) {
          return '<div class="erow wrap"><input type="text" class="code" data-i="' + i + '" data-f="code" maxlength="12" placeholder="Code" value="' + esc(r.code) + '"' + (r.orig ? ' readonly' : '') + '>' +
            '<input type="text" class="nm" data-i="' + i + '" data-f="name" maxlength="60" placeholder="Name" value="' + esc(r.name) + '">' +
            '<input type="tel" class="phone" data-i="' + i + '" data-f="phone" maxlength="20" inputmode="tel" placeholder="Phone (e.g. 08031234567)" value="' + esc(r.phone) + '">' +
            '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button></div>';
        }).join('') + '</div><button id="aAdd" class="addbtn">+ Add teacher</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      wireBack();
      const el = box();
      el.querySelectorAll('input[data-f]').forEach(function (inp) {
        inp.oninput = function () { rows[+inp.dataset.i][inp.dataset.f] = inp.value; A.dirty = true; };
      });
      el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }; });
      $('#aAdd').onclick = function () {
        rows.push({ orig: '', code: nextCode(), name: '', phone: '' }); A.dirty = true; draw();
        const ins = box().querySelectorAll('input[data-f="name"]');
        if (ins.length) ins[ins.length - 1].focus();
      };
      $('#aSave').onclick = async function () {
        const out = [], seen = {};
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i], code = r.code.trim(), name = r.name.trim(), phone = (r.phone || '').trim();
          if (!r.orig && !name) continue;   // untouched new row
          if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$/.test(code)) { showErr('Code "' + code + '" must be 1 to 12 letters or numbers, no spaces.'); return; }
          if (!name) { showErr('Teacher ' + code + ' needs a name.'); return; }
          if (phone && !/^[0-9+ ()-]{7,20}$/.test(phone)) { showErr(name + ': phone numbers can only have digits, +, spaces, brackets and dashes (at least 7 digits).'); return; }
          if (seen[code.toLowerCase()]) { showErr('Code ' + code + ' is used twice.'); return; }
          seen[code.toLowerCase()] = 1;
          out.push([code, name, phone]);
        }
        if (await save({ table: 'Teachers', rows: out })) teachers();
      };
    }
    draw();
  }

  /* ───────── bell times ───────── */

  function periods() {
    const sl = secs(), st = { sec: sl[0] };
    const rows = A.data.periods.map(function (p) { return { n: p.n, start: p.start || '', end: p.end || '', day: p.day || '', sec: p.section || sl[0] }; });

    function draw() {
      let h = head('Bell times', 'Times are 24-hour. Each section has its own bell times. Leave Day as "Every day" for the normal times; add rows for a specific day only if that day is different (its rows then replace the normal times for that day). A break is just the gap between one period\'s end and the next one\'s start.');
      if (sl.length > 1) h += '<div class="periods" id="bSec">' + sl.map(function (x) { return '<button data-s="' + esc(x) + '" class="' + (x === st.sec ? 'on' : '') + '" style="min-width:90px;padding:10px 14px">' + esc(x) + '</button>'; }).join('') + '</div>';
      h += '<div class="alist">' + rows.map(function (r, i) {
        if (r.sec !== st.sec) return '';
        let x = '<div class="erow wrap"><select data-i="' + i + '" data-f="n">';
        for (let n = 1; n <= MAX_P; n++) x += '<option value="' + n + '"' + (n === r.n ? ' selected' : '') + '>' + ord(n) + ' period</option>';
        x += '</select><input type="time" data-i="' + i + '" data-f="start" value="' + esc(r.start) + '"><span class="muted">to</span>' +
          '<input type="time" data-i="' + i + '" data-f="end" value="' + esc(r.end) + '">' +
          '<select data-i="' + i + '" data-f="day"><option value="">Every day</option>' +
          days().map(function (d) { return '<option' + sel(d, r.day) + '>' + d + '</option>'; }).join('') + '</select>' +
          '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button></div>';
        return x;
      }).join('') + '</div><button id="aAdd" class="addbtn">+ Add period</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      box().innerHTML = h;
      wireBack();
      const el = box();
      el.querySelectorAll('#bSec button').forEach(function (b) { b.onclick = function () { st.sec = b.dataset.s; draw(); }; });
      el.querySelectorAll('[data-f]').forEach(function (inp) {
        const upd = function () { rows[+inp.dataset.i][inp.dataset.f] = inp.dataset.f === 'n' ? Number(inp.value) : inp.value; A.dirty = true; };
        inp.addEventListener('input', upd); inp.addEventListener('change', upd);
      });
      el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }; });
      $('#aAdd').onclick = function () {
        let n = 0;
        rows.forEach(function (r) { if (r.sec === st.sec && !r.day && r.n > n) n = r.n; });
        rows.push({ n: Math.min(MAX_P, n + 1), start: '', end: '', day: '', sec: st.sec }); A.dirty = true; draw();
      };
      $('#aSave').onclick = async function () {
        for (let i = 0; i < rows.length; i++) {
          if (!rows[i].start || !rows[i].end) { showErr('Fill in the start and end time for every row (' + rows[i].sec + ' ' + ord(rows[i].n) + ' period), or delete the row.'); return; }
        }
        const out = rows.map(function (r) { return [r.n, r.start, r.end, r.day, r.sec]; });
        if (await save({ table: 'Periods', rows: out })) periods();
      };
    }
    draw();
  }

  /* ───────── saved records (Drive) ───────── */

  function records() {
    const r = A.data.records || { folder: '', files: [] };
    box().innerHTML = head('Saved records', 'Entries are kept in Google Drive: one folder for each school year, one spreadsheet for each term, and one tab for each week. Weeks are locked a week after they end. Open these in Google Sheets or Drive; do not rename the term files.') +
      (r.folder ? '<p><a class="tel" href="' + esc(r.folder) + '" target="_blank" rel="noopener">Open the records folder</a></p>' : '') +
      (r.files.length ? '<div class="alist">' + r.files.map(function (f) {
        return '<div class="erow wrap"><b>' + esc(f.session) + ' · ' + esc(f.term) + '</b><span class="muted">' + esc(f.min || '') + (f.max && f.max !== f.min ? ' to ' + esc(f.max) : '') + '</span>' +
          '<a class="tel" href="' + esc(f.url) + '" target="_blank" rel="noopener">Open spreadsheet</a></div>';
      }).join('') + '</div>' : '<div class="empty">No records yet. The first spreadsheet is created when the first entry arrives.</div>');
    wireBack();
  }

  /* ───────── terms ───────── */

  function terms() {
    const rows = (A.data.terms || []).map(function (t) { return { name: t.name, start: t.start, end: t.end }; });

    function draw() {
      box().innerHTML = head('Terms', 'Used by the Reports tab for term reports. Add each term with its first and last day (holidays included in the range are simply days with no records).') +
        '<div class="alist">' + rows.map(function (r, i) {
          return '<div class="erow wrap"><input type="text" class="nm" data-i="' + i + '" data-f="name" maxlength="40" placeholder="e.g. First Term 2026/2027" value="' + esc(r.name) + '">' +
            '<input type="date" data-i="' + i + '" data-f="start" value="' + esc(r.start) + '"><span class="muted">to</span>' +
            '<input type="date" data-i="' + i + '" data-f="end" value="' + esc(r.end) + '">' +
            '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button></div>';
        }).join('') + '</div><button id="aAdd" class="addbtn">+ Add term</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      wireBack();
      const el = box();
      el.querySelectorAll('[data-f]').forEach(function (inp) {
        const upd = function () { rows[+inp.dataset.i][inp.dataset.f] = inp.value; A.dirty = true; };
        inp.addEventListener('input', upd); inp.addEventListener('change', upd);
      });
      el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }; });
      $('#aAdd').onclick = function () { rows.push({ name: '', start: '', end: '' }); A.dirty = true; draw(); };
      $('#aSave').onclick = async function () {
        const out = [], seen = {};
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i], name = r.name.trim();
          if (!name && !r.start && !r.end) continue;
          if (!name) { showErr('Every term needs a name.'); return; }
          if (!r.start || !r.end) { showErr(name + ': choose a start and end date.'); return; }
          if (r.end < r.start) { showErr(name + ': the end date is before the start date.'); return; }
          if (seen[name.toLowerCase()]) { showErr('"' + name + '" appears twice.'); return; }
          seen[name.toLowerCase()] = 1;
          out.push([name, r.start, r.end]);
        }
        if (await save({ table: 'Terms', rows: out })) terms();
      };
    }
    draw();
  }

  /* ───────── timetable ───────── */

  function timetable() {
    const d = A.data;
    if (!d.classes.length || !d.subjects.length) {
      box().innerHTML = head('Timetable') + note('Add at least one class and one subject first.');
      wireBack();
      return;
    }
    const tt = {};   // 'Mon|1|JSS1A' -> {s: subject, t: teacher code}
    d.timetable.forEach(function (r) { tt[r[0] + '|' + r[1] + '|' + r[2]] = { s: r[3], t: r[4] }; });
    const st = { cls: d.classes[0], day: days()[0] };
    const tname = {};
    d.teachers.forEach(function (t) { tname[t[0]] = t[1]; });
    const hm = function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
    const mn = function (t) { const x = /^(\d{1,2}):(\d{2})/.exec(t || ''); return x ? +x[1] * 60 + +x[2] : null; };
    // bell range for a section on a day (day-specific rows replace the all-days rows)
    const range = function (sec, day, n) {
      const all = d.periods.filter(function (p) { return (p.section || secs()[0]) === sec; });
      const mine = all.filter(function (p) { return p.day === day; });
      const p = (mine.length ? mine : all.filter(function (x) { return !x.day; })).find(function (x) { return x.n === n; });
      const a = p ? mn(p.start) : null, b = p ? mn(p.end) : null;
      return a !== null && b !== null && b > a ? { s: a, e: b } : null;
    };
    const periodNums = function (sec) {
      const all = d.periods.filter(function (p) { return (p.section || secs()[0]) === sec; });
      const mine = all.filter(function (p) { return p.day === st.day; });
      const nums = (mine.length ? mine : all.filter(function (x) { return !x.day; })).map(function (p) { return p.n; });
      nums.sort(function (a, b) { return a - b; });
      return nums.length ? nums : [1, 2, 3, 4, 5, 6, 7, 8];
    };

    function draw() {
      const sec = secOfCls(st.cls), nums = periodNums(sec);
      let h = head('Timetable', 'Choose a class and a day, then the subject and teacher for each period. Leave the subject empty when there is no lesson (for example lower primary after they close). Press Save when you have finished (changes for all classes are saved together).');
      h += '<select id="tClass" class="full">' + d.classes.map(function (c) { return '<option value="' + esc(c) + '"' + sel(c, st.cls) + '>' + esc(c) + (secs().length > 1 ? ' — ' + esc(secOfCls(c)) : '') + '</option>'; }).join('') + '</select>';
      h += '<div class="periods" id="tDays">' + days().map(function (x) { return '<button data-d="' + x + '" class="' + (x === st.day ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div><div class="tt">';
      nums.forEach(function (p) {
        const e = tt[st.day + '|' + p + '|' + st.cls] || { s: '', t: '' };
        const subs = d.subjects.indexOf(e.s) < 0 && e.s ? d.subjects.concat([e.s]) : d.subjects;
        const me = range(sec, st.day, p);
        let clash = '';
        if (e.s && e.t) {
          // another lesson of the same teacher, in any section, that overlaps this one in clock time
          Object.keys(tt).some(function (k) {
            const o = tt[k], a = k.split('|');
            if (a[0] !== st.day || !o.s || o.t !== e.t) return false;
            const c2 = a.slice(2).join('|');
            if (c2 === st.cls) return false;
            const r2 = range(secOfCls(c2), st.day, Number(a[1]));
            if (me && r2) {
              const ov = Math.min(me.e, r2.e) - Math.max(me.s, r2.s);
              if (ov <= 0) return false;
              clash = '<div class="warnnote">⚠ ' + esc(tname[e.t] || e.t) + ' is also teaching ' + esc(c2) + ' (' + esc(secOfCls(c2)) + ' ' + ord(Number(a[1])) + ' period, ' + hm(r2.s) + '–' + hm(r2.e) + ')' +
                (me.s === r2.s && me.e === r2.e ? ' at the same time' : ': overlaps by ' + ov + ' min') + '</div>';
              return true;
            }
            if (secOfCls(c2) === sec && Number(a[1]) === p) { clash = '<div class="warnnote">⚠ ' + esc(tname[e.t] || e.t) + ' is also teaching ' + esc(c2) + ' in this period</div>'; return true; }
            return false;
          });
        }
        h += '<div class="ttp"><b>' + ord(p) + ' period' + (me ? ' <span class="muted">' + hm(me.s) + '–' + hm(me.e) + '</span>' : '') + '</b>' +
          '<select data-p="' + p + '" data-f="s"><option value="">— no lesson —</option>' +
          subs.map(function (s) { return '<option' + sel(s, e.s) + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
          (e.s ? '<select data-p="' + p + '" data-f="t"><option value="">— teacher —</option>' +
            d.teachers.map(function (t) { return '<option value="' + esc(t[0]) + '"' + sel(t[0], e.t) + '>' + esc(t[1]) + ' (' + esc(t[0]) + ')</option>'; }).join('') + '</select>' : '') +
          clash + '</div>';
      });
      h += '</div><button id="tCopy" class="addbtn">Copy ' + st.day + ' to the other days</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      box().innerHTML = h;
      wireBack();
      $('#tClass').onchange = function (e) { st.cls = e.target.value; draw(); };
      box().querySelectorAll('#tDays button').forEach(function (b) { b.onclick = function () { st.day = b.dataset.d; draw(); }; });
      box().querySelectorAll('select[data-p]').forEach(function (s) {
        s.onchange = function () {
          const k = st.day + '|' + s.dataset.p + '|' + st.cls;
          const e = tt[k] || (tt[k] = { s: '', t: '' });
          e[s.dataset.f] = s.value;
          if (s.dataset.f === 's' && !s.value) e.t = '';
          A.dirty = true; draw();
        };
      });
      $('#tCopy').onclick = function () {
        if (!confirm('Copy ' + st.cls + ' ' + st.day + ' to all other days? This replaces that class\'s lessons on the other days.')) return;
        days().forEach(function (x) {
          if (x === st.day) return;
          for (let p = 1; p <= MAX_P; p++) {
            const src = tt[st.day + '|' + p + '|' + st.cls], k = x + '|' + p + '|' + st.cls;
            if (src && src.s) tt[k] = { s: src.s, t: src.t }; else delete tt[k];
          }
        });
        A.dirty = true; B().toast('Copied. Press Save to keep it.'); draw();
      };
      $('#aSave').onclick = async function () {
        const rows = [];
        days().forEach(function (day) {
          for (let p = 1; p <= MAX_P; p++) {
            d.classes.forEach(function (c) {
              const e = tt[day + '|' + p + '|' + c];
              if (e && e.s) rows.push([day, p, c, e.s, e.t || '']);
            });
          }
        });
        if (await save({ table: 'Timetable', rows: rows })) { A.dirty = false; timetable(); }
      };
    }
    draw();
  }

  /* ───────── users ───────── */

  async function users() {
    const myPin = await g.Core.metaGet('pin');
    const rows = A.data.users.map(function (u) { return { name: u[0], pin: u[1], role: u[2], active: u[3], frozen: !!u[4], me: u[1] === myPin, origPin: u[1] }; });

    function draw() {
      box().innerHTML = head('Users & PINs', 'Give each person their own PIN (6 to 12 digits). A Monitor can record entries; an Admin can also change these settings. Switch Active off to block someone without deleting. Tick Frozen to stop a Monitor from recording: they can still sign in and view reports, but new entries are refused (entries recorded before the freeze are kept). You cannot change your own role or switch yourself off. Keep the Admin PIN private.') +
        '<div class="alist">' + rows.map(function (r, i) {
          return '<div class="erow wrap urow"><input type="text" data-i="' + i + '" data-f="name" maxlength="40" placeholder="Name" value="' + esc(r.name) + '">' +
            '<input type="text" inputmode="numeric" class="pin" data-i="' + i + '" data-f="pin" maxlength="12" placeholder="PIN" value="' + esc(r.pin) + '">' +
            '<button class="x" data-gen="' + i + '" aria-label="New random PIN">🎲</button>' +
            '<select data-i="' + i + '" data-f="role"' + (r.me ? ' disabled' : '') + '><option' + sel('Monitor', r.role) + '>Monitor</option><option' + sel('Admin', r.role) + '>Admin</option></select>' +
            '<label class="chkl"><input type="checkbox" data-i="' + i + '" data-f="active"' + (r.active ? ' checked' : '') + (r.me ? ' disabled' : '') + '> Active</label>' +
            (r.role === 'Monitor' && !r.me ? '<label class="chkl frz"><input type="checkbox" data-i="' + i + '" data-f="frozen"' + (r.frozen ? ' checked' : '') + '> Frozen</label>' : '') +
            (r.me ? '<span class="muted">(you)</span>' : '<button class="x del" data-del="' + i + '" aria-label="Delete">✕</button>') + '</div>';
        }).join('') + '</div><button id="aAdd" class="addbtn">+ Add user</button>' +
        '<div class="row-btns"><button id="aSave" class="primary">Save</button></div>';
      wireBack();
      const el = box();
      el.querySelectorAll('[data-f]').forEach(function (inp) {
        const upd = function () { rows[+inp.dataset.i][inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value; A.dirty = true; };
        inp.addEventListener('input', upd); inp.addEventListener('change', upd);
      });
      el.querySelectorAll('[data-gen]').forEach(function (b) { b.onclick = function () { rows[+b.dataset.gen].pin = randPin(); A.dirty = true; draw(); }; });
      el.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          const r = rows[+b.dataset.del];
          if (confirm('Delete ' + (r.name || 'this user') + '?')) { rows.splice(+b.dataset.del, 1); A.dirty = true; draw(); }
        };
      });
      $('#aAdd').onclick = function () { rows.push({ name: '', pin: randPin(), role: 'Monitor', active: true, me: false, origPin: '' }); A.dirty = true; draw(); };
      $('#aSave').onclick = async function () {
        const pins = {};
        let admins = 0;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i], name = r.name.trim(), pin = r.pin.trim();
          if (!name) { showErr('Every user needs a name.'); return; }
          if (!/^\d{6,12}$/.test(pin)) { showErr(name + ': the PIN must be 6 to 12 digits.'); return; }
          if (pins[pin]) { showErr('Two users have the same PIN (' + name + ').'); return; }
          pins[pin] = 1;
          if (r.role === 'Admin' && r.active) admins++;
        }
        if (!admins) { showErr('Keep at least one active Admin.'); return; }
        const me = rows.filter(function (r) { return r.me; })[0];
        const out = rows.map(function (r) { return [r.name.trim(), r.pin.trim(), r.role, !!r.active, r.role === 'Monitor' && !!r.frozen]; });
        if (await save({ table: 'Users', rows: out })) {
          if (me && me.pin.trim() !== me.origPin) await g.Core.metaSet('pin', me.pin.trim());   // keep this phone signed in
          users();
        }
      };
    }
    draw();
  }

  g.Admin = { enter: enter, drainQueue: drainQueue };
})(self);
