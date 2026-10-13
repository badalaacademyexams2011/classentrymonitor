const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8');

function runDigest(config, report) {
  const sent = [];
  const context = vm.createContext({
    Date: Date,
    MailApp: { sendEmail: function (message) { sent.push(message); } },
    Session: { getScriptTimeZone: function () { return 'UTC'; } },
    Utilities: { formatDate: function () { return '2027-03-20'; } },
  });
  vm.runInContext(source, context, { filename: 'Code.gs' });
  context.cfgMap_ = function () { return config; };
  context.reportData_ = function () { return report; };
  context.utcDay_ = function (date) { return Date.parse(date + 'T12:00:00Z'); };
  context.fmtDay_ = function (time) { return new Date(time).toISOString().slice(0, 10); };
  context.weeklyDigest();
  return sent;
}

const report = {
  ok: true,
  byTeacher: [{ name: '<img src=x onerror=alert(1)>', late: 2, minsLate: 7 }],
  byClass: [{ cls: '"><script>alert(1)</script>', late: 1, abs: 1 }],
  totals: { observed: 20, pct: 90, late: 2, abs: 1 },
};

test('weekly digest escapes report data and app-link attributes', function () {
  const sent = runDigest({
    PrincipalEmail: 'principal@example.org',
    AppUrl: 'https://school.example/reports?a=1&b=2',
  }, report);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'principal@example.org');
  assert.match(sent[0].htmlBody, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(sent[0].htmlBody, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(sent[0].htmlBody, /href="https:\/\/school\.example\/reports\?a=1&amp;b=2"/);
  assert.doesNotMatch(sent[0].htmlBody, /<script|<img|href="[^"]*onmouseover=/);
  assert.match(sent[0].body, /Most late teachers/);
});

test('weekly digest omits malformed configured app links', function () {
  const sent = runDigest({
    PrincipalEmail: 'principal@example.org',
    AppUrl: 'https://school.example/" onmouseover="alert(1)',
  }, report);

  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].htmlBody, /href=|onmouseover=/);
  assert.doesNotMatch(sent[0].body, /Open Reports:/);
});

test('weekly digest rejects an invalid recipient before sending', function () {
  assert.throws(function () {
    runDigest({
      PrincipalEmail: 'principal@example.org\r\nBcc: attacker@example.org',
      AppUrl: '',
    }, report);
  }, /PrincipalEmail is invalid/);
});
