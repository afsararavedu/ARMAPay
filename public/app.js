(function () {
'use strict';

/* ---------- helpers ---------- */
var $ = function (s) { return document.querySelector(s); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// Money is integer paise everywhere except the amount text box.
function inr(paise) {
  var n = (Number(paise) || 0) / 100;
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: (Math.round(n * 100) % 100 ? 2 : 0), maximumFractionDigits: 2 });
}
function toPaise(text) { var n = parseFloat(text); return isFinite(n) ? Math.round(n * 100) : NaN; }
function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function hue(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }
function avatar(name, cls) {
  var ini = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  return '<span class="av ' + (cls || '') + '" style="--h:' + hue(String(name)) + '">' + esc(ini) + '</span>';
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
function fmtFull(ts) { return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function dayLabel(ts) {
  var d = new Date(ts), t = new Date();
  var sod = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
  var diff = Math.round((sod(t) - sod(d)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function greet() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }

var REASONS = [
  ['fraud', "I didn't authorise this (fraud)"],
  ['scam', 'I was pressured or tricked (scam)'],
  ['laundering', 'Looks like money laundering'],
  ['wrong', 'I sent it to the wrong person']
];
var REASON_LABEL = {}; REASONS.forEach(function (r) { REASON_LABEL[r[0]] = r[1]; });

var ICONS = {
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  at: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  request: '<path d="M17 7L7 17M7 9v8h8"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h3v3M20 14v6h-3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><path d="M3 19a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 5.5M18.5 19a5.5 5.5 0 0 0-3-4.9"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  back2: '<path d="M20 6H10l-6 6 6 6h10z"/><path d="M12 10l4 4M16 10l-4 4"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.4h.01"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  flip: '<path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 18l5-5 4 4 2-2 3 3"/>'
};
function icon(n) { return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>'; }

/* ---------- API ---------- */
function ApiError(status, code, message, extra) { this.status = status; this.code = code; this.message = message; this.extra = extra || {}; }
function api(method, path, body) {
  var opts = { method: method, credentials: 'same-origin', headers: { 'X-ARMAPay': '1' } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(path, opts).then(function (r) {
    return r.json().catch(function () { return null; }).then(function (data) {
      if (!r.ok) {
        var er = (data && data.error) || {};
        if (r.status === 401 && er.code === 'AUTH') sessionEnded();
        throw new ApiError(r.status, er.code || 'ERROR', er.message || 'Something went wrong', er);
      }
      return data;
    });
  }, function () {
    throw new ApiError(0, 'OFFLINE', "You're offline. Check your connection and try again.");
  });
}

/* ---------- state ---------- */
var S = null, skew = 0;
var ui = { route: 'home', stage: 'payee', mode: 'contact', flow: null, filter: 'all', q: '', search: '', sheet: null, sheetId: null, balShown: {}, auth: 'login', authErr: '', offline: false, expired: {}, pending: null };
var pinState = null, installEvt = null, resolveTimer = null, resolveSeq = 0;
var RISK_TEXT = {
  not_in_contacts: 'This person is not in your contacts.',
  reported: function (r) { return 'Other users reported this account ' + r.reports + ' time' + (r.reports > 1 ? 's' : '') + ' in the last ' + S.policy.abuseDays + ' days.'; },
  scam_words: 'The note uses words that scams often use (refund, receive, claim, reward).',
  large_amount: 'This is a large amount.'
};
function incomingById(id) { return S.incoming.filter(function (r) { return r.id === id; })[0]; }
function setAlert(on) {
  document.documentElement.toggleAttribute('data-alert', !!on);
  var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', on ? '#B84F00' : '#0A4A44');
}
// Money arriving never needs a PIN, and its screens keep the normal colours. Tell the user when it lands.
function noteNew(st) {
  var ids = {}, reqs = {};
  st.txns.forEach(function (t) { ids[t.id] = 1; });
  st.incoming.forEach(function (r) { reqs[r.id] = 1; });
  if (ui.seen) {
    st.txns.forEach(function (t) { if (t.dir === 'in' && t.status === 'SUCCESS' && !ui.seen[t.id]) toast('Received ' + inr(t.amount) + ' from ' + t.party.name + '. No PIN needed.', 'good'); });
    st.incoming.forEach(function (r) { if (!ui.seenReq[r.id]) toast('Payment request from ' + r.name + '. Approving it sends money out.', 'warn'); });
  }
  ui.seen = ids; ui.seenReq = reqs;
}
var nowS = function () { return Date.now() + skew; };
function applyState(st) {
  noteNew(st);
  S = st; skew = st.serverTime - Date.now();
  $('#ex-win').textContent = Math.round(st.policy.undoWindowMs / 60000);
  $('#ex-new').textContent = inr(st.policy.newPayeeLimit);
  $('#ex-abuse').textContent = st.policy.abuseLimit;
  $('#ex-days').textContent = st.policy.abuseDays;
}
function undoOpen(t) { return t.dir === 'out' && t.status === 'SUCCESS' && t.canUndo && t.undoUntil > nowS(); }
function disputable(t) { return t.dir === 'out' && t.status === 'SUCCESS' && !undoOpen(t); }
function txnById(id) { return S.txns.filter(function (t) { return t.id === id; })[0]; }
function contactById(id) { return S.contacts.filter(function (c) { return c.id === id; })[0]; }
function primaryBank() { return S.banks.filter(function (b) { return b.primary; })[0] || S.banks[0]; }
function bankById(id) { return S.banks.filter(function (b) { return b.id === id; })[0]; }
function undoWinMin() { return Math.round(S.policy.undoWindowMs / 60000); }

/* ---------- views ---------- */
function maskMobile(m) { return m ? m.slice(0, 2) + 'XXXXXX' + m.slice(-2) : ''; }
/* ---------- brand: logo, slogan, footer ---------- */
var SLOGAN = { line: 'Pay before your WayCup Chai cools.', sub: 'And if it isn’t right, Undo it.' };
// The logo sits on a white card in both themes: its navy lettering needs a light ground.
function logoImg(cls) {
  return '<img class="' + cls + '" src="/img/armapay-logo.webp" srcset="/img/armapay-logo-360.webp 360w, /img/armapay-logo.webp 720w" sizes="(max-width: 440px) 300px, 340px" width="720" height="645" alt="ARMAPay UPI. Pay Smart, Stay Safe, Undo If Needed." decoding="async">';
}
function authV() {
  var m = ui.auth, reg = m === 'register';
  var brand = '<div class="logo-card sm">' + logoImg('logo') + '</div>';
  var hl = ui.health || {};
  if (m === 'forgot') {
    return '<section class="auth">' + brand + '<h1>Reset your password</h1><p class="lead">Enter the mobile number you registered with. We will text a 6-digit OTP to it.</p>' +
      '<form id="authform" novalidate><label class="field"><span>Registered mobile number</span><input id="a_mobile" type="tel" inputmode="numeric" autocomplete="username" maxlength="10" placeholder="10 digits" required></label>' +
      '<p class="err" id="autherr">' + esc(ui.authErr) + '</p><button class="btn" type="submit" id="authbtn">Send OTP</button>' +
      '<button class="link-btn" type="button" data-act="authmode" data-m="login">Back to sign in</button></form>'  + '</section>';
  }
  if (m === 'reset') {
    var rs = ui.reset || {};
    var demo = rs.demoOtp ? '<div class="demo-otp"><b>Demo mode: no real SMS is sent</b><span>Your OTP would arrive by SMS as</span><span class="code">' + esc(rs.demoOtp) + '</span><button class="btn small ghost" type="button" data-act="fillotp">Fill it in</button></div>' : '';
    var nosms = (!rs.demoOtp && hl.sms === 'console') ? '<div class="note-box">No text message was sent because this server has no SMS service connected yet. The site owner can connect one (see DEPLOY-HOSTINGER.md, section 3).</div>' : '';
    return '<section class="auth">' + brand + '<h1>Enter the OTP</h1><p class="lead">We sent a 6-digit OTP to ' + esc(maskMobile(rs.mobile)) + '. It is valid for ' + esc(rs.expiresInMin || 10) + ' minutes.</p>' +
      '<form id="authform" novalidate>' + demo + nosms +
      '<label class="field"><span>6-digit OTP</span><input id="a_otp" class="otp-in" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="------" required></label>' +
      '<label class="field"><span>New password</span><input id="a_pass" type="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>' +
      '<label class="field"><span>Confirm new password</span><input id="a_pass2" type="password" autocomplete="new-password" required></label>' +
      '<p class="err" id="autherr">' + esc(ui.authErr) + '</p><button class="btn" type="submit" id="authbtn">Reset password</button>' +
      '<div class="row-links"><button class="link-btn" type="button" id="resendbtn" data-act="resendotp" disabled>Resend OTP</button><button class="link-btn" type="button" data-act="authmode" data-m="login">Back to sign in</button></div></form>' +
      '<p class="fine">ARMAPay will never ask you for your OTP, PIN or password by phone, SMS or chat.</p>'  + '</section>';
  }
  var head = reg
    ? brand + '<h1>Open your ARMAPay account</h1>'
    : '<div class="logo-hero"><div class="logo-card">' + logoImg('logo') + '</div><h1 class="slogan"><b>' + SLOGAN.line + '</b><span>' + SLOGAN.sub + '</span></h1></div>';
  return '<section class="auth">' + head +
    '<p class="lead">' + (reg ? 'Takes a minute. You will set a password for signing in and a 4-digit UPI PIN for payments.' : 'Sign in with your mobile number.') + '</p>' +
    (ui.authInfo ? '<p class="ok-note" role="status">' + esc(ui.authInfo) + '</p>' : '') +
    '<div class="seg"><button data-act="authmode" data-m="login" aria-pressed="' + !reg + '">Sign in</button><button data-act="authmode" data-m="register" aria-pressed="' + reg + '">Create account</button></div>' +
    '<form id="authform" novalidate>' +
    (reg ? '<label class="field"><span>Full name</span><input id="a_name" autocomplete="name" maxlength="60" required></label>' : '') +
    '<label class="field"><span>Mobile number</span><input id="a_mobile" type="tel" inputmode="numeric" autocomplete="username" maxlength="10" placeholder="10 digits" required></label>' +
    (reg ? '<label class="field"><span>UPI handle (optional)</span><input id="a_handle" autocomplete="off" autocapitalize="off" maxlength="20" placeholder="e.g. afsar"><small>You will be paid at handle@armapay. Leave empty to use your mobile number.</small></label>' : '') +
    '<label class="field"><span>Password</span><input id="a_pass" type="password" autocomplete="' + (reg ? 'new-password' : 'current-password') + '" minlength="8" required>' + (reg ? '<small>At least 8 characters.</small>' : '') + '</label>' +
    (reg ? '<label class="field"><span>UPI PIN (4 digits)</span><input id="a_pin" type="password" inputmode="numeric" autocomplete="off" maxlength="4" required></label>' : '<div class="row-links"><button class="link-btn" type="button" data-act="forgot">Forgot password?</button></div>') +
    '<p class="err" id="autherr">' + esc(ui.authErr) + '</p>' +
    '<button class="btn" type="submit" id="authbtn">' + (reg ? 'Create account' : 'Sign in') + '</button></form>'  + '</section>';
}
function offlineV() {
  return '<div class="auth"><div class="brand"><img src="/icons/icon.svg" alt="" width="48" height="48"><b>ARMAPay</b></div><h1>You’re offline</h1><p class="lead">ARMAPay needs a connection to show your balance and make payments. Nothing about your account is stored on this device.</p><button class="btn" data-act="retry">Try again</button></div>';
}
function statusBadge(t) {
  if (t.dir === 'in' && t.reversedBySender) return '<span class="badge warn">Reversed by sender</span>';
  if (t.status === 'REVERSED') return '<span class="badge warn">Reversed</span>';
  if (t.status === 'PARTIAL') return '<span class="badge warn">Part reversed</span>';
  if (t.status === 'DISPUTED') return '<span class="badge bad">Dispute open</span>';
  return '';
}
function txnRow(t) {
  var out = t.dir === 'out', elig = undoOpen(t), void_ = t.status === 'REVERSED';
  var amt = '<span class="amt ' + (out ? '' : 'in') + (void_ || t.reversedBySender ? ' void' : '') + '">' + (out ? '−' : '+') + inr(t.amount) + '</span>';
  var extra = elig ? '<span class="chip-undo" data-until="' + t.undoUntil + '">' + mmss(t.undoUntil - nowS()) + '</span>' : statusBadge(t);
  return '<button class="row" data-act="txn" data-id="' + esc(t.id) + '">' + avatar(t.party.name, 'sm') +
    '<span class="row-m"><b>' + esc(t.party.name) + '</b><small>' + (out ? 'Paid' : 'Received') + ' · ' + fmtTime(t.ts) + (t.note ? ' · ' + esc(t.note) : '') + '</small></span>' +
    '<span class="row-r">' + amt + extra + '</span></button>';
}
function tile(ic, label, act, extra, cls) { return '<button class="tile ' + (cls || '') + '" data-act="' + act + '" ' + (extra || '') + '><i>' + icon(ic) + '</i><span>' + label + '</span></button>'; }
function homeV() {
  var open = S.txns.filter(undoOpen);
  var pend = S.requests.filter(function (r) { return r.status === 'PENDING'; });
  var inc = S.incoming.length ? '<section class="sec"><div class="sec-h"><h2>Requests asking you to pay</h2></div><div class="card list incoming">' + S.incoming.map(function (r) { return '<button class="row" data-act="collect" data-id="' + r.id + '">' + avatar(r.name, 'sm') + '<span class="row-m"><b>' + esc(r.name) + '</b><small>Wants ' + inr(r.amount) + '. Approving sends money out.</small></span><span class="row-r"><span class="badge warn">Review</span></span></button>'; }).join('') + '</div></section>' : '';
  var banner = open.length ? '<button class="undo-banner" data-act="txn" data-id="' + esc(open[0].id) + '"><span class="ub-ic">' + icon('undo') + '</span><span class="ub-t"><b>Undo window open</b><small>' + inr(open[0].amount) + ' to ' + esc(open[0].party.name) + (open.length > 1 ? ' · +' + (open.length - 1) + ' more' : '') + '</small></span><span class="ub-time" data-until="' + open[0].undoUntil + '">' + mmss(open[0].undoUntil - nowS()) + '</span></button>'
    : '<p class="hero-note">Every payment you make can be undone for ' + undoWinMin() + ' minutes.</p>';
  var people = S.contacts.map(function (c) { return '<button class="person" data-act="payc" data-id="' + c.id + '">' + avatar(c.name) + '<span>' + esc(c.name.split(' ')[0]) + '</span></button>'; }).join('');
  var recent = S.txns.slice(0, 5).map(txnRow).join('');
  var reqs = pend.length ? '<section class="sec"><div class="sec-h"><h2>Requests you sent</h2></div><div class="card list">' + pend.map(function (r) {
    return '<div class="row">' + avatar(r.name, 'sm') + '<span class="row-m"><b>' + esc(r.name) + '</b><small>' + esc(r.note || 'Payment request') + '</small></span><span class="row-r"><span class="amt">' + inr(r.amount) + '</span>' + (S.policy.sandbox && r.external ? '<button class="btn small ghost" data-act="reqpaid" data-id="' + r.id + '">Sandbox: mark paid</button>' : '<span class="badge">Waiting</span>') + '</span></div>';
  }).join('') + '</div></section>' : '';
  return '<section class="brandcard"><div class="logo-card sm">' + logoImg('logo') + '</div><p class="slogan"><b>' + SLOGAN.line + '</b><span>' + SLOGAN.sub + '</span></p></section>' +
    '<section class="hero"><p class="eyebrow">' + greet() + '</p><h1>' + esc(S.me.name) + '</h1>' +
    '<button class="upi-chip" data-act="copy" data-t="' + esc(S.me.vpa) + '" aria-label="Copy UPI ID">' + esc(S.me.vpa) + ' ' + icon('copy') + '</button>' + banner + '</section>' + inc +
    '<section class="tiles">' + tile('scan', 'Scan & pay', 'scanqr') + tile('user', 'To contact', 'topay', 'data-mode="contact"') + tile('phone', 'To mobile', 'topay', 'data-mode="mobile"') + tile('at', 'To UPI ID', 'topay', 'data-mode="upi"') +
    tile('bank', 'Balance', 'balance') + tile('request', 'Request', 'request') + tile('qr', 'My QR', 'myqr') + tile('undo', 'Undo', 'undohist', '', 'warn') + '</section>' +
    '<section class="sec"><div class="sec-h"><h2>People</h2><button class="link" data-act="tab" data-r="contacts">All</button></div><div class="people">' + people + '</div></section>' +
    reqs +
    '<section class="sec"><div class="sec-h"><h2>Recent</h2><button class="link" data-act="tab" data-r="history">See all</button></div><div class="card list">' + (recent || '<p class="empty">No payments yet.</p>') + '</div></section>';
}
function contactRowHtml(c) {
  return '<button class="row" data-act="payc" data-id="' + c.id + '">' + avatar(c.name, 'sm') + '<span class="row-m"><b>' + esc(c.name) + (c.type === 'merchant' ? '<span class="tag">Merchant</span>' : '') + (c.reports ? '<span class="tag new">Reported ' + c.reports + '×</span>' : '') + '</b><small class="mono">' + esc(c.vpa) + '</small></span></button>';
}
function filterContacts(q) {
  q = (q || '').trim().toLowerCase();
  return S.contacts.filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) > -1 || c.vpa.toLowerCase().indexOf(q) > -1 || (c.mobile || '').indexOf(q) > -1; });
}
function payeeList(q, found) {
  var list = filterContacts(q);
  var out = '';
  if (found && found.error) out = '<p class="empty">' + esc(found.error) + '</p>';
  else if (found && found.party && !found.party.saved) {
    var p = found.party;
    out = '<button class="row" data-act="paynew"><span class="av sm" style="--h:' + hue(p.name) + '">' + esc(p.name[0]) + '</span><span class="row-m"><b>' + esc(p.name) + '<span class="tag new">New payee</span></b><small>Pay to ' + esc(p.mobile || p.vpa) + '</small></span></button>';
  }
  var html = list.map(contactRowHtml).join('');
  if (!html && !out) return '<p class="empty">No saved contacts match.</p>';
  return '<div class="card list">' + out + html + '</div>';
}
var MODE_HINT = { contact: ['Name, mobile or UPI ID', 'text'], mobile: ['10-digit mobile number', 'tel'], upi: ['name@bank', 'text'] };
function payV() {
  var f = ui.flow;
  if (ui.stage === 'payee') {
    var h = MODE_HINT[ui.mode] || MODE_HINT.contact;
    return '<div class="screen-head"><button class="icon-btn" data-act="payback" aria-label="Back">' + icon('back') + '</button><h1>Pay</h1></div>' +
      '<label class="field"><span>To</span><input id="q" value="' + esc(ui.q) + '" placeholder="' + h[0] + '" inputmode="' + h[1] + '" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
      '<p class="err" id="qerr"></p><div id="plist">' + payeeList(ui.q, ui.found) + '</div>';
  }
  if (ui.stage === 'amount') {
    var p = f.party;
    var opts = S.banks.map(function (b) { return '<option value="' + b.id + '"' + (b.id === f.bankId ? ' selected' : '') + '>' + esc(b.name) + ' ••' + b.last4 + '</option>'; }).join('');
    return '<div class="screen-head"><button class="icon-btn" data-act="payback" aria-label="Back">' + icon('back') + '</button><h1>Pay ' + esc(p.name.split(' ')[0]) + '</h1></div>' +
      '<div class="card payee-card">' + avatar(p.name, 'lg') + '<div class="row-m"><b>' + esc(p.name) + (p.saved ? '' : '<span class="tag new">New payee</span>') + '</b><small class="mono">' + esc(p.vpa) + '</small></div></div>' +
      (f.qr && f.qr.level === 'high' ? '<div class="alert-hero"><span class="alert-ic">' + icon('alert') + '</span><div><b>Flagged as possible fraud</b><p>Risk ' + f.qr.score + ' of 99. You chose to continue. You can still undo this payment for ' + undoWinMin() + ' minutes.</p></div></div>' : '') +
      (p.reports ? '<div class="note-box" style="background:var(--bad-soft);color:var(--bad)"><b>Be careful.</b> Other users reported this account ' + p.reports + ' time' + (p.reports > 1 ? 's' : '') + ' in the last ' + S.policy.abuseDays + ' days.</div>' : '') +
      (p.saved ? '<div class="note-box info">Saved contact. Payment goes through instantly after your PIN.</div>' : '<div class="note-box">Not in your contacts. Verified bank name: <b>' + esc(p.verifiedName || p.name) + '</b>. Limit ' + inr(S.policy.newPayeeLimit) + ' per payment.</div>') +
      '<div class="amount-in"><span>₹</span><input id="amt" inputmode="decimal" placeholder="0" value="' + esc(f.amount) + '" aria-label="Amount" autocomplete="off"></div>' +
      '<label class="field"><span>Note (optional)</span><input id="note" maxlength="50" placeholder="What is this for?" value="' + esc(f.note) + '"></label>' +
      '<label class="field"><span>Pay from</span><select id="bank">' + opts + '</select></label>' +
      (p.saved ? '' : '<label class="check"><input type="checkbox" id="savec"' + (f.save ? ' checked' : '') + '> Save to my contacts after paying</label>') +
      '<p class="err" id="amterr">' + esc(f.err || '') + '</p>' +
      '<button class="btn" data-act="paygo">Pay securely</button>';
  }
  var t = txnById(f.txnId);
  if (!t) return '<div class="result"><h2>Payment sent</h2></div><button class="btn ghost" data-act="paydone">Done</button>';
  var elig = undoOpen(t);
  return '<div class="result"><div class="seal">' + icon('check') + '</div><p class="muted">Paid to ' + esc(t.party.name) + '</p><h2>' + inr(t.amount) + '</h2><p class="muted mono">' + esc(t.party.vpa) + '</p></div>' +
    '<div class="card kv"><div><span>From</span><span>' + esc(t.bankLabel) + '</span></div><div><span>UPI Ref No.</span><span class="mono">' + esc(t.rrn) + '</span></div><div><span>Time</span><span>' + fmtFull(t.ts) + '</span></div></div>' +
    (elig ? '<div class="undo-card"><p><b>Not right? Undo it.</b> The money returns to your account straight away while the window is open.</p><button class="btn warn" data-act="undo" data-id="' + esc(t.id) + '">' + icon('undo') + ' Undo this payment <span class="mono" data-until="' + t.undoUntil + '">' + mmss(t.undoUntil - nowS()) + '</span></button></div>' : '') +
    '<button class="btn ghost" data-act="paydone">Done</button>';
}
function collectV() {
  var r = incomingById(ui.collectId);
  var head = '<div class="screen-head"><button class="icon-btn" data-act="collectback" aria-label="Back">' + icon('back') + '</button><h1>Payment request</h1></div>';
  if (!r) return head + '<div class="card"><p class="empty">This request is no longer available. It may have expired or been handled.</p></div>';
  var flags = r.risk.map(function (k) { var t = RISK_TEXT[k]; return '<li>' + icon('alert') + '<span>' + esc(typeof t === 'function' ? t(r) : t) + '</span></li>'; }).join('');
  if (!r.risk.length) flags = '<li class="calm">' + icon('check') + '<span>This person is in your contacts. Still make sure you expect this request.</span></li>';
  var opts = S.banks.map(function (b) { return '<option value="' + b.id + '"' + (b.primary ? ' selected' : '') + '>' + esc(b.name) + ' \u2022\u2022' + b.last4 + '</option>'; }).join('');
  return head +
    '<div class="alert-hero"><span class="alert-ic">' + icon('alert') + '</span><div><b>This takes money OUT of your account</b><p>You never need your PIN to receive money. If someone told you that you will receive money, stop. That is a scam.</p></div></div>' +
    '<div class="card payee-card">' + avatar(r.name, 'lg') + '<div class="row-m"><b>' + esc(r.name) + (r.saved ? '' : '<span class="tag new">Not saved</span>') + '</b><small class="mono">' + esc(r.vpa) + '</small></div></div>' +
    '<div class="pay-amount"><span>You will pay</span><b>' + inr(r.amount) + '</b>' + (r.note ? '<small>Their note: \u201C' + esc(r.note) + '\u201D</small>' : '') + '</div>' +
    '<ul class="risk">' + flags + '</ul>' +
    '<label class="field"><span>Pay from</span><select id="cbank">' + opts + '</select></label>' +
    '<label class="check ack"><input type="checkbox" id="cack"><span>I understand this request will deduct ' + inr(r.amount) + ' from my account, and I feel it is safe to proceed.</span></label>' +
    '<button class="btn" id="capprove" data-act="collectapprove" disabled>Approve and enter PIN</button>' +
    '<div class="btn-row"><button class="btn ghost" data-act="collectdecline">Decline</button><button class="btn ghost" data-act="collectreport">Decline and report</button></div>';
}
/* ---------- scan & pay: camera, QR check, risk meter ---------- */
var cam = { stream: null, timer: null, idle: null, decoder: null, canvas: null, seq: 0 };
function camSupported() { return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
function stopStream(st) { if (st) st.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } }); }
// Switches the camera fully off: every track is stopped, so the camera light goes out.
function stopCamera() {
  cam.seq++;
  clearTimeout(cam.timer); clearTimeout(cam.idle); cam.timer = cam.idle = null;
  var v = document.getElementById('camvideo'); if (v) { try { v.pause(); } catch (e) { } v.srcObject = null; }
  stopStream(cam.stream); cam.stream = null;
}
function scanV() {
  var s = ui.scan, head = '<div class="screen-head"><button class="icon-btn" data-act="scanback" aria-label="Back">' + icon('back') + '</button><h1>Scan &amp; pay</h1></div>';
  var file = '<input type="file" id="scfile" accept="image/*" hidden>';
  if (s.stage === 'checking') return head + '<div class="checking" role="status"><div class="spin"></div><p>Checking this QR code for fraud reports…</p></div>';
  if (s.stage === 'live') {
    return head + '<div class="viewfinder"><video id="camvideo" playsinline muted autoplay></video><div class="reticle"></div><span class="cam-pill"><i></i>Camera on</span><p class="vf-hint">Point at a payment QR code</p></div>' +
      '<div class="btn-row">' + (s.canFlip ? '<button class="btn ghost" data-act="camflip">' + icon('flip') + ' Switch camera</button>' : '') + '<button class="btn ghost" data-act="camstop">Stop camera</button></div>' +
      '<p class="fine" style="text-align:center">The camera switches off as soon as a code is read.</p>' + file;
  }
  var errBox = s.err ? '<div class="note-box" role="alert" style="background:var(--bad-soft);color:var(--bad)">' + esc(s.err) + '</div>' : '';
  var tick = icon('check');
  return head + errBox +
    '<div class="card consent"><span class="big-ic">' + icon('camera') + '</span><h2>Allow the camera for this scan?</h2>' +
    '<p>ARMAPay will open your camera only to read a payment QR code. Before any money moves, the QR is checked for fraud reports.</p>' +
    '<ul><li>' + tick + '<span>Only while this screen is open. It switches off the moment a code is read, or when you leave.</span></li>' +
    '<li>' + tick + '<span>Nothing is recorded or uploaded. The picture is read on your device. Only the text inside the QR code is sent to ARMAPay.</span></li>' +
    '<li>' + tick + '<span>We ask every time. There is no always-on camera.</span></li></ul>' +
    '<button class="btn" data-act="camallow">' + icon('camera') + ' Allow camera for this scan</button></div>' +
    '<div class="btn-row"><label class="btn ghost file-btn" for="scfile">' + icon('image') + ' Upload image</label><button class="btn ghost" data-act="scan">' + icon('at') + ' Paste link</button></div>' +
    '<p class="fine">Your browser may ask for permission as well. You can take it back at any time in the browser’s site settings.</p>' + file;
}
function scanFail(msg) { stopCamera(); ui.scan = { stage: 'consent', err: msg, facing: (ui.scan && ui.scan.facing) || 'environment' }; render(); }
function loadScript(src) {
  return new Promise(function (ok, no) {
    if (window.jsQR) return ok();
    var el = document.createElement('script'); el.src = src; el.onload = function () { ok(); }; el.onerror = function () { no(new Error('load')); };
    document.head.appendChild(el);
  });
}
// Uses the browser's own QR reader when it has one, otherwise the bundled jsQR.
function loadDecoder() {
  if (cam.decoder) return Promise.resolve(cam.decoder);
  var native = (window.BarcodeDetector && BarcodeDetector.getSupportedFormats)
    ? BarcodeDetector.getSupportedFormats().then(function (f) { return f.indexOf('qr_code') >= 0; }, function () { return false; }) : Promise.resolve(false);
  return native.then(function (yes) {
    if (yes) { cam.decoder = { kind: 'native', det: new BarcodeDetector({ formats: ['qr_code'] }) }; return cam.decoder; }
    return loadScript('/vendor/jsqr.js').then(function () { cam.decoder = { kind: 'jsqr' }; return cam.decoder; });
  });
}
function frameToText(src, w, h, both) {
  if (!cam.canvas) cam.canvas = document.createElement('canvas');
  var c = cam.canvas; c.width = w; c.height = h;
  var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(src, 0, 0, w, h);
  var r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' });
  return r ? r.data : null;
}
function startCamera() {
  if (!camSupported()) { scanFail(window.isSecureContext === false ? 'The camera needs a secure (HTTPS) connection. You can upload a QR image or paste a link instead.' : 'This browser cannot use the camera. You can upload a QR image or paste a link instead.'); return; }
  stopCamera();
  var tok = cam.seq, facing = ui.scan.facing || 'environment';
  ui.scan = { stage: 'live', err: '', facing: facing, canFlip: false }; render();
  navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } }).then(function (stream) {
    if (tok !== cam.seq || ui.route !== 'scan' || ui.scan.stage !== 'live') { stopStream(stream); return; } // the user left while the permission prompt was open
    cam.stream = stream;
    var v = $('#camvideo'); if (v) { v.srcObject = stream; var pp = v.play(); if (pp && pp.catch) pp.catch(function () { }); }
    if (navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(function (d) {
      var n = d.filter(function (x) { return x.kind === 'videoinput'; }).length;
      if (tok === cam.seq && n > 1) { ui.scan.canFlip = true; var b = $('.btn-row'); if (b && !b.querySelector('[data-act="camflip"]')) b.insertAdjacentHTML('afterbegin', '<button class="btn ghost" data-act="camflip">' + icon('flip') + ' Switch camera</button>'); }
    }, function () { });
    cam.idle = setTimeout(function () { scanFail('The camera was switched off because no QR code was read for a minute.'); }, 60000);
    return loadDecoder().then(function () { if (tok === cam.seq) scanTick(tok); });
  }, function (e) {
    if (tok !== cam.seq) return;
    var n = e && e.name;
    scanFail(n === 'NotAllowedError' || n === 'SecurityError' ? 'Camera permission was not given. You can allow it in the browser’s site settings, or upload a QR image instead.'
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No camera was found on this device. You can upload a QR image or paste a link instead.'
      : n === 'NotReadableError' ? 'The camera is being used by another app.' : 'The camera could not be started.');
  }).catch(function () { if (tok === cam.seq) scanFail('The scanner could not be loaded. Check your connection, or upload a QR image instead.'); });
}
function scanTick(tok) {
  if (tok !== cam.seq || !cam.stream) return;
  var v = $('#camvideo');
  if (!v || v.readyState < 2 || !v.videoWidth) { cam.timer = setTimeout(function () { scanTick(tok); }, 200); return; }
  var job;
  if (cam.decoder.kind === 'native') job = cam.decoder.det.detect(v).then(function (r) { return r.length ? r[0].rawValue : null; });
  else { var k = Math.min(1, 640 / v.videoWidth); job = Promise.resolve(frameToText(v, Math.round(v.videoWidth * k), Math.round(v.videoHeight * k), false)); }
  job.then(function (val) { if (tok !== cam.seq) return; if (val) onQr(val); else cam.timer = setTimeout(function () { scanTick(tok); }, 120); },
    function () { if (tok === cam.seq) cam.timer = setTimeout(function () { scanTick(tok); }, 250); });
}
// A QR was read (camera, image, pasted link or demo). Camera off first, then the safety check, then the result screen.
function onQr(val) {
  stopCamera();
  try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { }
  ui.route = 'scan'; ui.scan = { stage: 'checking', err: '', facing: (ui.scan && ui.scan.facing) || 'environment' };
  render(); window.scrollTo(0, 0);
  api('POST', '/api/qr/check', { payload: String(val) }).then(function (res) {
    ui.qr = { res: res, payload: String(val) }; ui.route = 'qrcheck'; render(); window.scrollTo(0, 0);
  }, function (e) { scanFail(e.message); });
}
function decodeImageFile(file) {
  if (!file || !/^image\//.test(file.type)) { scanFail('Choose an image file.'); return; }
  if (file.size > 12 * 1024 * 1024) { scanFail('That image is too large. Choose one under 12 MB.'); return; }
  ui.scan = { stage: 'checking', err: '', facing: ui.scan.facing }; render();
  var fromBitmap = window.createImageBitmap ? createImageBitmap(file) : Promise.reject(new Error('no bitmap'));
  fromBitmap.catch(function () {
    return new Promise(function (ok, no) {
      var fr = new FileReader(); fr.onload = function () { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = no; im.src = fr.result; }; fr.onerror = no; fr.readAsDataURL(file);
    });
  }).then(function (img) {
    var w = img.width, h = img.height, k = Math.min(1, 1600 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
    return loadDecoder().then(function (dec) {
      if (dec.kind === 'native') { var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); return dec.det.detect(c).then(function (r) { return r.length ? r[0].rawValue : null; }); }
      return frameToText(img, w, h, true);
    });
  }).then(function (val) { if (val) onQr(val); else scanFail('No QR code was found in that image. Try a clearer, closer photo.'); },
    function () { scanFail('That image could not be read.'); });
}
function gaugeSvg(score) {
  var cx = 120, cy = 118, r = 92;
  function pt(p, rad) { var a = Math.PI * (1 - p / 100); return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)]; }
  function arc(p1, p2, cls) { var a = pt(p1 + 0.7, r), b = pt(p2 - 0.7, r); return '<path class="gz ' + cls + '" d="M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' A' + r + ' ' + r + ' 0 0 1 ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + '"/>'; }
  var ticks = [[0, '0'], [30, '30'], [50, '50'], [99, '99']].map(function (t) {
    var i = pt(t[0], r - 15), o = pt(t[0], r + 13), l = pt(t[0], r + 25);
    return '<line class="tk" x1="' + i[0].toFixed(1) + '" y1="' + i[1].toFixed(1) + '" x2="' + o[0].toFixed(1) + '" y2="' + o[1].toFixed(1) + '"/><text x="' + l[0].toFixed(1) + '" y="' + (l[1] + 4).toFixed(1) + '">' + t[1] + '</text>';
  }).join('');
  var deg = (Math.max(0, Math.min(100, score)) / 100) * 180 - 90;
  return '<svg class="gauge" viewBox="0 0 240 140" role="img" aria-label="Risk meter: ' + score + ' out of 99">' +
    arc(0, 30, 'z-low') + arc(30, 50, 'z-mid') + arc(50, 100, 'z-high') + ticks +
    '<g class="needle" style="--rot:' + deg.toFixed(1) + 'deg"><line x1="120" y1="118" x2="120" y2="40"/><circle cx="120" cy="118" r="8"/></g></svg>';
}
function qrcheckV() {
  var q = ui.qr.res, k = q.risk, lv = k.level, h = q.history;
  var head = '<div class="screen-head"><button class="icon-btn" data-act="qrback" aria-label="Back">' + icon('back') + '</button><h1>Check before you pay</h1></div>';
  var lab = '<span class="g-label ' + lv + '">' + icon(lv === 'low' ? 'check' : 'alert') + k.label + '</span>';
  var zones = '<div class="zones"><span class="z1' + (lv === 'low' ? ' on' : '') + '"><i></i>0–29 Low</span><span class="z2' + (lv === 'caution' ? ' on' : '') + '"><i></i>30–49 Careful</span><span class="z3' + (lv === 'high' ? ' on' : '') + '"><i></i>50–99 Fraud alert</span></div>';
  var banner = lv === 'high'
    ? '<div class="alert-hero"><span class="alert-ic">' + icon('alert') + '</span><div><b>Fraud detected</b><p>' + esc(k.summary) + '</p></div></div>'
    : '<div class="note-box' + (lv === 'low' ? ' info' : '') + '">' + esc(k.summary) + '</div>';
  var diff = q.payee.qrName && q.payee.verifiedName && q.payee.qrName.toLowerCase() !== q.payee.verifiedName.toLowerCase();
  var payee = '<div class="card payee-card">' + avatar(q.payee.name, 'lg') + '<div class="row-m"><b>' + esc(q.payee.name) + (q.payee.saved ? '' : '<span class="tag new">New payee</span>') + '</b><small class="mono">' + esc(q.payee.vpa) + '</small>' +
    (diff ? '<small>QR says “' + esc(q.payee.qrName) + '”</small>' : '') + '</div></div>';
  var amt = q.amount ? '<div class="pay-amount"><span>This QR asks for</span><b>' + inr(q.amount) + '</b>' + (q.note ? '<small>Note: “' + esc(q.note) + '”</small>' : '') + '</div>' : (q.note ? '<p class="muted" style="text-align:center">Note: “' + esc(q.note) + '”</p>' : '');
  var why = k.reasons.length ? '<section class="sec"><div class="sec-h"><h2>Why this score</h2></div><ul class="reasons">' + k.reasons.map(function (r) { return '<li class="' + r.kind + '">' + icon(r.kind === 'good' ? 'check' : 'alert') + '<span>' + esc(r.text) + '</span></li>'; }).join('') + '</ul></section>' : '';
  var hist = '<div class="hist"><span>Scanned before <b>' + h.scans + '</b></span><span>Reports <b>' + h.reports + '</b></span><span>Paid by <b>' + h.paidBy + '</b> users</span></div>';
  var go = lv === 'high'
    ? '<label class="check ack"><input type="checkbox" id="qack"><span>I understand this QR was flagged as possible fraud, and I still want to continue.</span></label>' +
      '<button class="btn" data-act="qrcancel">Don’t pay</button><button class="btn ghost" id="qgo" data-act="qrgo" disabled>Continue anyway</button>'
    : '<button class="btn" id="qgo" data-act="qrgo">Continue to pay</button>';
  return head + '<div class="gauge-wrap">' + gaugeSvg(k.score) + '<div class="gauge-read"><b class="g-score">' + k.score + '</b>' + lab + '</div></div>' + zones + banner + payee + amt + why + hist + go +
    '<button class="btn ghost small" style="align-self:center" data-act="qrreport">' + icon('alert') + ' Report this QR</button>';
}
function qrReportSheet(err) {
  openSheet('qrreport', '<h2>Report this QR</h2><p class="muted">Tell us what happened. Reports count against the payee and warn other people before they pay.</p><div class="radio-list">' +
    [['fraud', 'It is a fraud'], ['scam', 'It is a scam'], ['cheating', 'The seller cheated me'], ['other', 'Something else']].map(function (r, i) { return '<label><input type="radio" name="qrr" value="' + r[0] + '"' + (i === 0 ? ' checked' : '') + '> ' + r[1] + '</label>'; }).join('') +
    '</div><p class="err">' + esc(err || '') + '</p><button class="btn" data-act="qrreportgo">Submit report</button>');
}
function demoQrSheet() {
  var lab = { low: ['ok', 'Low risk'], caution: ['warn', 'Be careful'], high: ['bad', 'Fraud alert'] };
  openSheet('demoqr', '<h2>Demo QR codes</h2><p class="muted">One for each zone of the risk meter. Scan one from another screen, or tap Use this QR.</p>' + ui.demoQrs.map(function (q, i) {
    return '<div class="card demo-qr"><div class="qrs" data-qr="' + i + '"></div><div class="meta"><b>' + esc(q.title) + '</b><span class="badge ' + lab[q.kind][0] + '" style="align-self:flex-start">' + lab[q.kind][1] + '</span><small class="muted">' + esc(q.note) + '</small><button class="btn small ghost" data-act="useqr" data-i="' + i + '">Use this QR</button></div></div>';
  }).join('') + '<button class="btn ghost" data-act="closesheet">Close</button>');
  ui.demoQrs.forEach(function (q, i) {
    try { var g = qrcode(0, 'M'); g.addData(q.payload); g.make(); document.querySelector('[data-qr="' + i + '"]').innerHTML = g.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); } catch (e) { }
  });
}
function tickResend() {
  var b = document.getElementById('resendbtn'); if (!b || !ui.reset) return;
  var left = Math.ceil((ui.reset.resendAt - Date.now()) / 1000);
  b.disabled = left > 0; b.textContent = left > 0 ? 'Resend OTP in ' + left + 's' : 'Resend OTP';
}
function historyV() {
  var fl = ui.filter;
  var list = S.txns.filter(function (t) {
    if (fl === 'sent') return t.dir === 'out';
    if (fl === 'in') return t.dir === 'in';
    if (fl === 'issues') return t.status === 'REVERSED' || t.status === 'PARTIAL' || t.status === 'DISPUTED';
    if (fl === 'undo') return undoOpen(t);
    return true;
  });
  var chips = [['all', 'All'], ['undo', 'Undo window'], ['sent', 'Sent'], ['in', 'Received'], ['issues', 'Reversed & disputed']].map(function (c) { return '<button data-act="filter" data-f="' + c[0] + '" aria-pressed="' + (fl === c[0]) + '">' + c[1] + '</button>'; }).join('');
  var html = '', last = '';
  list.forEach(function (t, i) {
    var d = dayLabel(t.ts);
    if (d !== last) { html += '<p class="day">' + d + '</p><div class="card list">'; last = d; }
    html += txnRow(t);
    var nx = list[i + 1];
    if (!nx || dayLabel(nx.ts) !== d) html += '</div>';
  });
  return '<div class="screen-head"><h1>History</h1></div><div class="seg">' + chips + '</div>' + (html || '<div class="card"><p class="empty">' + (fl === 'undo' ? 'No payments are inside the undo window right now.' : 'Nothing here yet.') + '</p></div>');
}
function contactList(q) {
  var list = filterContacts(q);
  if (!list.length) return '<div class="card"><p class="empty">No contacts match.</p></div>';
  return '<div class="card list">' + list.map(contactRowHtml).join('') + '</div>';
}
function contactsV() {
  return '<div class="screen-head"><h1>Contacts</h1><button class="btn small" data-act="addc">' + icon('plus') + ' Add</button></div>' +
    '<label class="field"><span>Search</span><input id="csearch" value="' + esc(ui.search) + '" placeholder="Name, mobile or UPI ID" autocomplete="off"></label><div id="clist">' + contactList(ui.search) + '</div>';
}
function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
function installBlock() {
  if (isStandalone()) return '';
  if (installEvt) return '<section class="sec"><div class="sec-h"><h2>Install</h2></div><button class="btn ghost" data-act="install">' + icon('download') + ' Install ARMAPay on this device</button></section>';
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return '<section class="sec"><div class="sec-h"><h2>Install</h2></div><div class="note-box info">On iPhone: tap Share, then Add to Home Screen.</div></section>';
  return '';
}
function meV() {
  var pol = S.policy;
  var banks = S.banks.map(function (b) {
    return '<div class="row"><span class="av sm" style="--h:' + hue(b.name) + '">' + icon('bank').replace('class="ic"', 'class="ic" style="width:18px;height:18px"') + '</span><span class="row-m"><b>' + esc(b.name) + '</b><small class="mono">•••• ' + b.last4 + '</small></span>' + (b.primary ? '<span class="badge ok">Primary</span>' : '<button class="btn small ghost" data-act="setprimary" data-id="' + b.id + '">Make primary</button>') + '</div>';
  }).join('');
  return '<div class="screen-head"><h1>Profile</h1></div>' +
    '<div class="card payee-card">' + avatar(S.me.name, 'lg') + '<div class="row-m"><b>' + esc(S.me.name) + '</b><small class="mono">' + esc(S.me.vpa) + ' · ' + esc(S.me.mobile) + '</small></div><button class="icon-btn" data-act="copy" data-t="' + esc(S.me.vpa) + '" aria-label="Copy UPI ID">' + icon('copy') + '</button></div>' +
    '<section class="sec"><div class="sec-h"><h2>Linked banks</h2></div><div class="card list">' + banks + '</div></section>' +
    '<section class="sec"><div class="sec-h"><h2>Undo protection</h2></div><div class="card kv">' +
    '<div><span>Undo window</span><span>' + undoWinMin() + ' minutes</span></div>' +
    '<div><span>Undos used (' + pol.abuseDays + ' days)</span><span class="num">' + S.stats.undoUsed + ' of ' + pol.abuseLimit + '</span></div>' +
    '<div><span>Per payment limit</span><span class="num">' + inr(pol.txnLimit) + '</span></div>' +
    '<div><span>Daily limit</span><span class="num">' + inr(pol.dailyLimit) + '</span></div>' +
    '<div><span>Limit for new payees</span><span class="num">' + inr(pol.newPayeeLimit) + '</span></div>' +
    '<div><span>Spent today</span><span class="num">' + inr(S.stats.spentToday) + '</span></div></div></section>' +
    '<section class="sec"><div class="sec-h"><h2>Security</h2></div><div class="btn-row"><button class="btn ghost" data-act="myqr">' + icon('qr') + ' My QR</button><button class="btn ghost" data-act="changepin">' + icon('shield') + ' Change PIN</button></div></section>' +
    installBlock() +
    (pol.sandbox ? '<section class="sec"><div class="sec-h"><h2>Sandbox tools</h2></div><button class="btn ghost" data-act="addmoney">Add ₹10,000 test money</button><button class="btn ghost" data-act="simcollect" data-kind="scam">Simulate a suspicious “refund” request</button><button class="btn ghost" data-act="simcollect" data-kind="contact">Simulate a bill from a saved contact</button><button class="btn ghost" data-act="demoqrs">Show demo QR codes (low, careful, fraud)</button><p class="muted" style="font-size:13px">Sandbox mode: bank balances and outside UPI IDs are simulated. Payments between ARMAPay users are real ledger entries. The simulated requests open the orange warning screen.</p></section>' : '') +
    '<button class="btn ghost" data-act="logout">' + icon('logout') + ' Sign out</button>';
}
function render() {
  var v = $('#view'), tb = $('#tabbar');
  if (!S) {
    setAlert(false); stopCamera();
    v.innerHTML = ui.offline ? offlineV() : authV();
    tb.hidden = true;
    if (ui.prefillMobile && $('#a_mobile')) { $('#a_mobile').value = ui.prefillMobile; ui.prefillMobile = ''; }
    tickResend(); return;
  }
  var r = ui.route;
  // Orange whenever money could be taken by something suspicious: a pay-me request, or a QR flagged as fraud.
  setAlert(r === 'collect' || (r === 'qrcheck' && ui.qr && ui.qr.res.risk.level === 'high') || (r === 'pay' && ui.stage === 'amount' && ui.flow && ui.flow.qr && ui.flow.qr.level === 'high'));
  if (!(r === 'scan' && ui.scan && ui.scan.stage === 'live')) stopCamera();
  v.innerHTML = (r === 'home' ? homeV() : r === 'pay' ? payV() : r === 'collect' ? collectV() : r === 'scan' ? scanV() : r === 'qrcheck' ? qrcheckV() : r === 'history' ? historyV() : r === 'contacts' ? contactsV() : meV());
  tb.hidden = (r === 'pay' || r === 'collect' || r === 'scan' || r === 'qrcheck');
  if (r === 'scan' && ui.scan.stage === 'live' && cam.stream) { var cv = $('#camvideo'); if (cv) { cv.srcObject = cam.stream; var pl = cv.play(); if (pl && pl.catch) pl.catch(function () { }); } }
  if (r === 'qrcheck') setTimeout(function () { var n = document.querySelector('.needle'); if (n) n.classList.add('go'); }, 60);
  tb.innerHTML = [['home', 'Home', 'home'], ['history', 'History', 'clock'], ['contacts', 'Contacts', 'users'], ['me', 'Profile', 'shield']].map(function (t) {
    return '<button class="tab" data-act="tab" data-r="' + t[0] + '" ' + (r === t[0] ? 'aria-current="page"' : '') + '>' + icon(t[2]) + '<span>' + t[1] + '</span></button>';
  }).join('');
  if (r === 'pay' && ui.stage === 'payee') { var q = $('#q'); if (q) q.focus(); }
}
// Never redraw while the user is mid-payment or reading a payment request: it would clear the checkbox they ticked.
function softRender() { if (S && ui.sheet == null && !pinState && ui.route !== 'pay' && ui.route !== 'collect' && ui.route !== 'scan' && ui.route !== 'qrcheck') render(); }

/* ---------- sheets, toast, PIN ---------- */
function openSheet(kind, html, id) { ui.sheet = kind; ui.sheetId = id || null; $('#sheet .sheet-body').innerHTML = html; $('#sheet').hidden = false; document.body.classList.add('noscroll'); }
function closeSheet() { ui.sheet = null; ui.sheetId = null; $('#sheet').hidden = true; if ($('#pin').hidden) document.body.classList.remove('noscroll'); }
function toast(msg, kind) { var t = $('#toast'); t.textContent = msg; t.className = 'toast' + (kind === 'bad' || kind === 'good' || kind === 'warn' ? ' ' + kind : ''); t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3200); }
function pinHtml(err) {
  var p = pinState;
  var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(function (k) { return k === '' ? '<span></span>' : '<button data-act="pinkey" data-k="' + k + '" aria-label="' + (k === 'del' ? 'Delete' : k) + '">' + (k === 'del' ? icon('back2') : k) + '</button>'; }).join('');
  return '<h2>' + esc(p.title) + '</h2><p class="muted">' + esc(p.sub) + '</p><div class="dots' + (p.busy ? ' pin-dots-busy' : '') + '" id="dots">' + [0, 1, 2, 3].map(function (i) { return '<i class="' + (i < p.buf.length ? 'on' : '') + '"></i>'; }).join('') + '</div><p class="err" id="pinerr" style="text-align:center">' + esc(err || '') + '</p><div class="keypad">' + keys + '</div>';
}
// exec(pin) must return a promise. A wrong PIN keeps the keypad open; any other failure closes it and calls fail(err).
function askPin(title, sub, exec, done, fail) {
  pinState = { title: title, sub: sub, exec: exec, done: done, fail: fail, buf: '', busy: false };
  $('#pin .sheet-body').innerHTML = pinHtml('');
  $('#pin').hidden = false; document.body.classList.add('noscroll');
}
function closePin() { $('#pin').hidden = true; pinState = null; if ($('#sheet').hidden) document.body.classList.remove('noscroll'); }
function pinKey(k) {
  var p = pinState; if (!p || p.busy) return;
  if (k === 'del') p.buf = p.buf.slice(0, -1); else if (p.buf.length < 4) p.buf += k;
  if (p.buf.length < 4) { $('#pin .sheet-body').innerHTML = pinHtml(''); return; }
  p.busy = true; $('#pin .sheet-body').innerHTML = pinHtml('');
  p.exec(p.buf).then(function (data) {
    closePin();
    try { p.done(data); } catch (e) { console.error(e); }
  }, function (err) {
    p.busy = false; p.buf = '';
    if (err.code === 'WRONG_PIN') {
      var n = err.extra.triesLeft;
      $('#pin .sheet-body').innerHTML = pinHtml('Wrong PIN. ' + n + ' ' + (n === 1 ? 'try' : 'tries') + ' left.');
      var d = $('#dots'); if (d) d.classList.add('shake');
      return;
    }
    closePin();
    if (err.code === 'AUTH') return;
    if (err.code === 'PIN_LOCKED') { toast('PIN locked. Try again in ' + Math.ceil((err.extra.retryAfterMs || 30000) / 1000) + 's', 'bad'); return; }
    if (p.fail) p.fail(err); else toast(err.message, 'bad');
  });
}

/* ---------- transaction sheets ---------- */
function txnSheet(id) {
  var t = txnById(id); if (!t) return;
  var out = t.dir === 'out';
  var rows = '<div><span>' + (out ? 'Paid to' : 'Received from') + '</span><span>' + esc(t.party.name) + '</span></div><div><span>UPI ID</span><span class="mono">' + esc(t.party.vpa) + '</span></div>' +
    (out ? '<div><span>Bank</span><span>' + esc(t.bankLabel) + '</span></div>' : '') +
    '<div><span>UPI Ref No.</span><span class="mono">' + esc(t.rrn) + '</span></div><div><span>Time</span><span>' + fmtFull(t.ts) + '</span></div>' + (t.note ? '<div><span>Note</span><span>' + esc(t.note) + '</span></div>' : '');
  var extra = '';
  if (t.reversal) {
    extra += '<div class="note-box"><b>' + (t.status === 'PARTIAL' ? 'Partly reversed' : 'Reversed') + '</b> ' + fmtFull(t.reversal.ts) + '. ' + inr(t.reversal.recovered) + ' returned to ' + esc(t.bankLabel) + '.' +
      (t.reversal.lien > 0 ? ' ' + inr(t.reversal.lien) + ' is on hold. It comes back to you as the recipient receives new payments.' : '') +
      '<br>Reversal Ref <span class="mono">' + esc(t.reversal.rrn) + '</span> · Reason: ' + esc(REASON_LABEL[t.reversal.reason] || t.reversal.reason) + '</div>';
  }
  if (t.dispute) extra += '<div class="note-box"><b>' + (t.dispute.review ? 'Sent for manual review' : 'Dispute open') + '</b> Ticket <span class="mono">' + esc(t.dispute.ticket) + '</span>. ARMAPay replies within 48 hours.</div>';
  if (!out && t.status === 'SUCCESS' && !t.reversedBySender) extra += '<div class="note-box info">Money received. You never enter a PIN to receive money.</div>';
  if (!out && t.reversedBySender) extra += '<div class="note-box"><b>The sender reversed this payment.</b> The money was taken back from your account.</div>';
  var act = '';
  if (undoOpen(t)) {
    act = '<button class="btn warn" data-act="undo" data-id="' + esc(t.id) + '">' + icon('undo') + ' Undo this payment <span class="mono" data-until="' + t.undoUntil + '">' + mmss(t.undoUntil - nowS()) + '</span></button>' +
      (S.policy.sandbox ? '<button class="btn ghost small" data-act="spend" data-id="' + esc(t.id) + '">Sandbox: recipient spends the money</button>' : '');
  } else if (disputable(t)) {
    act = '<button class="btn ghost" data-act="dispute" data-id="' + esc(t.id) + '">Report a problem</button><p class="muted" style="font-size:13px">The ' + undoWinMin() + '-minute undo window has closed. A dispute is reviewed by ARMAPay.</p>';
  }
  var void_ = t.status === 'REVERSED' || (!out && t.reversedBySender);
  openSheet('txn', '<div style="display:flex;align-items:center;gap:12px">' + avatar(t.party.name, 'lg') + '<div class="row-m"><b>' + esc(t.party.name) + '</b><span class="num" style="font:700 28px var(--font-display);' + (void_ ? 'text-decoration:line-through;color:var(--muted)' : '') + '">' + (out ? '−' : '+') + inr(t.amount) + '</span></div>' + statusBadge(t) + '</div>' + extra + '<div class="card kv">' + rows + '</div>' + act, id);
}
function undoSheet(id, mode) {
  var t = txnById(id); if (!t) return;
  var isUndo = (mode === 'undo' && undoOpen(t));
  var reasons = '<div class="reasons">' + REASONS.map(function (r, i) { return '<label><input type="radio" name="reason" value="' + r[0] + '"' + (i === 0 ? ' checked' : '') + '>' + esc(r[1]) + '</label>'; }).join('') + '</div>';
  var body = isUndo ?
    '<h2>Undo ' + inr(t.amount) + ' to ' + esc(t.party.name) + '?</h2><p class="muted">We will return the money to ' + esc(t.bankLabel) + ' right now. Tell us why.</p>' + reasons +
    '<ol class="steps"><li>Money moves back from the recipient immediately.</li><li>Anything already spent is held against their account.</li><li>The report is added to the recipient account as a warning for other users.</li></ol>' +
    '<button class="btn danger" data-act="undoconfirm" data-id="' + esc(id) + '" data-mode="undo">Undo payment</button>'
    : '<h2>Report a problem with ' + inr(t.amount) + '</h2><p class="muted">This opens a dispute that ARMAPay reviews. No automatic reversal.</p>' + reasons + '<button class="btn" data-act="undoconfirm" data-id="' + esc(id) + '" data-mode="dispute">Raise dispute</button>';
  openSheet('undo', body, id);
}
function undoResult(res) {
  if (res.error) { openSheet('undores', '<h2>Could not undo</h2><p class="muted">' + esc(res.error) + '</p><button class="btn ghost" data-act="closesheet">Close</button>'); return; }
  var t = res.txn, h, p, cls = '', ic = 'check';
  if (res.mode === 'full') { h = inr(t.reversal.recovered) + ' is back'; p = 'Returned to ' + t.bankLabel + '. The recipient account now carries your report.'; ic = 'undo'; }
  else if (res.mode === 'partial') { h = inr(t.reversal.recovered) + ' recovered'; p = inr(t.reversal.lien) + ' had already been spent. It is held against the recipient and returns to you as they receive new payments.'; cls = 'warn'; ic = 'undo'; }
  else if (res.mode === 'review') { h = 'Sent for review'; p = 'You have used all ' + S.policy.abuseLimit + ' undos for the last ' + S.policy.abuseDays + ' days, so this one needs a manual check. Ticket ' + res.ticket + '.'; cls = 'warn'; }
  else { h = 'Dispute raised'; p = 'Ticket ' + res.ticket + '. ARMAPay replies within 48 hours.'; cls = 'warn'; }
  var ref = t.reversal ? '<div class="card kv"><div><span>Reversal Ref</span><span class="mono">' + esc(t.reversal.rrn) + '</span></div><div><span>Reason</span><span>' + esc(REASON_LABEL[t.reversal.reason]) + '</span></div></div>' : '';
  openSheet('undores', '<div class="result"><div class="seal ' + cls + '">' + icon(ic) + '</div><h2>' + h + '</h2><p class="muted">' + esc(p) + '</p></div>' + ref + '<button class="btn" data-act="closesheet">Done</button>');
  render();
}

/* ---------- other sheets ---------- */
function balanceSheet() {
  var rows = S.banks.map(function (b) {
    var shown = ui.balShown[b.id];
    return '<div class="row"><span class="row-m"><b>' + esc(b.name) + '</b><small class="mono">•••• ' + b.last4 + (b.primary ? ' · Primary' : '') + '</small></span>' + (shown != null ? '<span class="amt num">' + inr(shown) + '</span>' : '<button class="btn small ghost" data-act="checkbal" data-id="' + b.id + '">Check</button>') + '</div>';
  }).join('');
  openSheet('balance', '<h2>Bank balance</h2><p class="muted">Enter your UPI PIN to see a balance. It hides again in 10 seconds.</p><div class="card list">' + rows + '</div>');
}
function requestSheet(err) {
  openSheet('request', '<h2>Request money</h2><label class="field"><span>From</span><input id="rq_who" placeholder="Name, mobile or UPI ID" autocomplete="off"></label><label class="field"><span>Amount</span><input id="rq_amt" inputmode="decimal" placeholder="₹ 0"></label><label class="field"><span>Note</span><input id="rq_note" maxlength="50" placeholder="Optional"></label><p class="err">' + esc(err || '') + '</p><button class="btn" data-act="reqgo">Send request</button>');
}
function scanSheet(err) {
  openSheet('scan', '<h2>Paste a payment link</h2><p class="muted">Paste the UPI link or the text from a QR code. It gets the same fraud check as a scan.</p><label class="field"><span>UPI link</span><textarea id="sc_txt" rows="3" placeholder="upi://pay?pa=greenroots@okhdfc&amp;pn=Green%20Roots&amp;am=500"></textarea></label><p class="err">' + esc(err || '') + '</p><button class="btn" data-act="scango">Continue</button>');
}
function qrSheet() {
  var link = 'upi://pay?pa=' + encodeURIComponent(S.me.vpa) + '&pn=' + encodeURIComponent(S.me.name) + '&cu=INR';
  openSheet('qr', '<h2>Your ARMAPay QR</h2><div class="qrbox" id="qrbox"></div><p class="mono" style="text-align:center">' + esc(S.me.vpa) + '</p><p class="muted" style="text-align:center;font-size:13px">Anyone with a UPI app can scan this to pay you.</p><button class="btn ghost" data-act="copy" data-t="' + esc(link) + '">Copy payment link</button>');
  try { var qr = qrcode(0, 'M'); qr.addData(link); qr.make(); $('#qrbox').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  catch (e) { $('#qrbox').innerHTML = '<span class="mono" style="line-height:1.4;color:#000">' + esc(link) + '</span>'; }
}
function addContactSheet(step, err) {
  if (step === 'verify') {
    var p = ui.pending;
    openSheet('addc', '<h2>Confirm contact</h2><div class="card payee-card">' + avatar(p.name, 'lg') + '<div class="row-m"><b>' + esc(p.name) + '</b><small class="mono">' + esc(p.vpa) + '</small></div></div><label class="field"><span>Type</span><select id="ac_type"><option value="person">Person</option><option value="merchant">Merchant</option></select></label><p class="err">' + esc(err || '') + '</p><button class="btn" data-act="addsave">Save contact</button>');
    return;
  }
  openSheet('addc', '<h2>Add contact</h2><p class="muted">Contacts you add pay instantly with your PIN, with no new-payee limit.</p><label class="field"><span>UPI ID or mobile number</span><input id="ac_id" placeholder="name@bank or 10-digit number" autocomplete="off" autocapitalize="off"></label><p class="err">' + esc(err || '') + '</p><button class="btn" data-act="addverify">Verify name</button>');
}
function changePinSheet(err) {
  openSheet('pinch', '<h2>Change UPI PIN</h2><label class="field"><span>Current PIN</span><input id="pc_old" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label><label class="field"><span>New 4-digit PIN</span><input id="pc_new" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label><p class="err">' + esc(err || '') + '</p><button class="btn" data-act="pcsave">Update PIN</button>');
}

/* ---------- flow control ---------- */
function startPay(mode) { ui.route = 'pay'; ui.stage = 'payee'; ui.mode = mode || 'contact'; ui.q = ''; ui.found = null; ui.flow = { party: null, amount: '', note: '', bankId: primaryBank().id, save: false, err: '', txnId: null, idem: null }; render(); }
function toAmount(party, amount, note) {
  ui.route = 'pay'; ui.stage = 'amount';
  ui.flow = { party: party, amount: amount || '', note: note || '', bankId: primaryBank().id, save: false, err: '', txnId: null, idem: null };
  render(); var a = $('#amt'); if (a && !amount) a.focus();
}
function partyFromResolve(r) { return { name: r.name, verifiedName: r.verifiedName, vpa: r.vpa, mobile: r.mobile, saved: r.saved, type: r.type, reports: r.reports }; }
function readAmountForm() { var f = ui.flow; f.amount = $('#amt').value; f.note = $('#note').value.trim(); f.bankId = Number($('#bank').value); var sc = $('#savec'); f.save = !!(sc && sc.checked); }
function copyText(t) { var ok = function () { toast('Copied'); }; try { navigator.clipboard.writeText(t).then(ok, function () { toast(t); }); } catch (e) { toast(t); } }
function showAmtErr(msg) { if (ui.flow) ui.flow.err = msg; var e = $('#amterr'); if (e) e.textContent = msg; }
function payGo() {
  readAmountForm();
  var f = ui.flow, amt = toPaise(f.amount);
  if (!(amt > 0)) { showAmtErr('Enter an amount'); return; }
  showAmtErr('');
  if (!f.idem) f.idem = uuid(); // a retry after a dropped connection reuses this key, so it can never pay twice
  askPin('Enter UPI PIN', 'Paying ' + inr(amt) + ' to ' + f.party.name,
    function (pin) { var body = { to: f.party.vpa, amount: amt, note: f.note, accountId: f.bankId, pin: pin, idemKey: f.idem, saveContact: f.save }; if (f.qr) { body.qrCheck = f.qr.checkId; body.riskAck = !!f.riskAck; } return api('POST', '/api/pay', body); },
    function (data) { applyState(data.state); f.txnId = data.txn.id; ui.stage = 'result'; render(); window.scrollTo(0, 0); },
    function (err) { showAmtErr(err.message); });
}
function resolveTyped() {
  var q = ui.q.trim(), seq = ++resolveSeq;
  if (q.length < 3) { ui.found = null; var l = $('#plist'); if (l) l.innerHTML = payeeList(ui.q, null); return; }
  api('POST', '/api/resolve', { q: q }).then(function (r) { return { party: partyFromResolve(r) }; }, function (e) { return { error: e.code === 'OFFLINE' ? e.message : (e.status === 400 ? (q.length > 6 ? e.message : null) : e.message) }; })
    .then(function (found) {
      if (seq !== resolveSeq || ui.stage !== 'payee' || ui.route !== 'pay') return;
      ui.found = found; var l = $('#plist'); if (l) l.innerHTML = payeeList(ui.q, found);
    });
}
function goPayee(q) {
  api('POST', '/api/resolve', { q: q }).then(function (r) { toAmount(partyFromResolve(r)); }, function (e) { var el = $('#qerr'); if (el) el.textContent = e.message; });
}
function logoutNow() {
  api('POST', '/api/logout', {}).then(function () { }, function () { }).then(function () { S = null; ui.seen = null; ui.route = 'home'; ui.auth = 'login'; ui.authErr = ''; closeSheet(); closePin(); render(); });
}
function sessionEnded() {
  if (!S) return;
  S = null; ui.seen = null; closeSheet(); closePin(); ui.authErr = 'Your session ended. Please sign in again.'; render();
}
function refresh() {
  if (!S) return;
  return api('GET', '/api/state').then(function (st) { applyState(st); softRender(); }, function () { });
}
function launch() {
  var p = new URLSearchParams(location.search), a = p.get('action');
  ui.route = 'home';
  if (a === 'pay') startPay('contact');
  else if (a === 'undo') { ui.route = 'history'; ui.filter = 'undo'; render(); }
  else render();
  if (a || p.get('source')) try { history.replaceState(null, '', '/'); } catch (e) { }
}

function act(a, d) {
  switch (a) {
    case 'authmode': ui.auth = d.m; ui.authErr = ''; ui.authInfo = ''; render(); break;
    case 'retry': boot(); break;
    case 'logout': logoutNow(); break;
    case 'install': if (installEvt) { installEvt.prompt(); installEvt.userChoice.then(function () { installEvt = null; softRender(); }); } break;
    case 'tab': ui.route = d.r; ui.search = ''; render(); window.scrollTo(0, 0); break;
    case 'topay': startPay(d.mode); break;
    case 'payc': { var c = contactById(Number(d.id)); if (c) toAmount({ name: c.name, vpa: c.vpa, mobile: c.mobile, saved: true, type: c.type, reports: c.reports }); break; }
    case 'paynew': if (ui.found && ui.found.party) toAmount(ui.found.party); break;
    case 'payback':
      if (ui.stage === 'amount') { ui.stage = 'payee'; ui.q = ''; ui.found = null; render(); }
      else { ui.route = 'home'; refresh(); render(); }
      break;
    case 'paygo': payGo(); break;
    case 'paydone': ui.route = 'home'; render(); window.scrollTo(0, 0); break;
    case 'scanqr': ui.route = 'scan'; ui.scan = { stage: 'consent', err: '', facing: 'environment' }; ui.qr = null; render(); window.scrollTo(0, 0); break;
    case 'scanback': case 'qrcancel': stopCamera(); ui.route = 'home'; ui.qr = null; render(); break;
    case 'camallow': startCamera(); break;
    case 'camstop': stopCamera(); ui.scan = { stage: 'consent', err: '', facing: ui.scan.facing }; render(); break;
    case 'camflip': ui.scan.facing = ui.scan.facing === 'user' ? 'environment' : 'user'; startCamera(); break;
    case 'qrback': ui.route = 'scan'; ui.scan = { stage: 'consent', err: '', facing: 'environment' }; render(); break;
    case 'qrgo': {
      var qr = ui.qr.res;
      if (qr.risk.level === 'high') { var kk = $('#qack'); if (!kk || !kk.checked) { toast('Tick the box to confirm you understand', 'bad'); return; } }
      var qparty = { name: qr.payee.name, verifiedName: qr.payee.verifiedName || qr.payee.name, vpa: qr.payee.vpa, mobile: '', saved: qr.payee.saved, type: 'person', reports: qr.history.reports };
      toAmount(qparty, qr.amount ? String(qr.amount / 100) : '', qr.note);
      ui.flow.qr = { checkId: qr.checkId, level: qr.risk.level, score: qr.risk.score }; ui.flow.riskAck = qr.risk.level === 'high';
      render(); window.scrollTo(0, 0); break;
    }
    case 'qrreport': qrReportSheet(); break;
    case 'qrreportgo': {
      var chosen = document.querySelector('input[name="qrr"]:checked');
      api('POST', '/api/qr/report', { vpa: ui.qr.res.payee.vpa, reason: chosen ? chosen.value : 'fraud' }).then(function () {
        closeSheet(); toast('Thank you. Your report will warn others.', 'good');
        return api('POST', '/api/qr/check', { payload: ui.qr.payload }).then(function (res) { ui.qr.res = res; render(); }, function () { });
      }, function (e) { qrReportSheet(e.message); });
      break;
    }
    case 'demoqrs': api('POST', '/api/sandbox/demo-qrs', {}).then(function (r) { ui.demoQrs = r.items; demoQrSheet(); }, function (e) { toast(e.message, 'bad'); }); break;
    case 'useqr': closeSheet(); onQr(ui.demoQrs[Number(d.i)].payload); break;
    case 'forgot': ui.auth = 'forgot'; ui.authErr = ''; ui.authInfo = ''; render(); break;
    case 'fillotp': if (ui.reset && $('#a_otp')) { $('#a_otp').value = ui.reset.demoOtp; $('#a_pass').focus(); } break;
    case 'resendotp': {
      if (!ui.reset || Date.now() < ui.reset.resendAt) break;
      api('POST', '/api/password/forgot', { mobile: ui.reset.mobile }).then(function (r) {
        ui.reset.demoOtp = r.demoOtp || ''; ui.reset.resendAt = Date.now() + (r.resendAfterSec || 30) * 1000; ui.authErr = ''; render(); toast('A new OTP was sent', 'good');
      }, function (er) { ui.authErr = er.message; var el = $('#autherr'); if (el) el.textContent = er.message; });
      break;
    }
    case 'scan': scanSheet(); break;
    case 'scango': {
      var txt = ($('#sc_txt').value || '').trim();
      if (!txt) { scanSheet('Paste a link first.'); return; }
      closeSheet(); onQr(txt); break;
    }
    case 'balance': balanceSheet(); break;
    case 'checkbal': {
      var bid = Number(d.id);
      askPin('Enter UPI PIN', 'To view your balance',
        function (pin) { return api('POST', '/api/balance', { accountId: bid, pin: pin }); },
        function (data) { ui.balShown[bid] = data.balance; balanceSheet(); setTimeout(function () { delete ui.balShown[bid]; if (ui.sheet === 'balance') balanceSheet(); }, 10000); },
        function (err) { toast(err.message, 'bad'); });
      break;
    }
    case 'request': requestSheet(); break;
    case 'reqgo': {
      var amt = toPaise($('#rq_amt').value);
      if (!(amt > 0)) { requestSheet('Enter an amount'); return; }
      api('POST', '/api/requests', { to: $('#rq_who').value, amount: amt, note: $('#rq_note').value.trim() }).then(function (r) {
        applyState(r.state); closeSheet(); toast('Request sent'); render();
      }, function (e) { requestSheet(e.message); });
      break;
    }
    case 'reqpaid': api('POST', '/api/sandbox/request-paid', { id: Number(d.id) }).then(function (st) { applyState(st); toast('Payment received'); render(); }, function (e) { toast(e.message, 'bad'); }); break;
    case 'myqr': qrSheet(); break;
    case 'undohist': ui.route = 'history'; ui.filter = 'undo'; render(); window.scrollTo(0, 0); break;
    case 'filter': ui.filter = d.f; render(); break;
    case 'txn': txnSheet(d.id); break;
    case 'undo': undoSheet(d.id, 'undo'); break;
    case 'dispute': undoSheet(d.id, 'dispute'); break;
    case 'undoconfirm': {
      var chk = document.querySelector('input[name="reason"]:checked'), reason = chk ? chk.value : 'fraud', id = d.id, md = d.mode;
      askPin('Enter UPI PIN', md === 'undo' ? 'To undo this payment' : 'To raise a dispute',
        function (pin) { return api('POST', '/api/txns/' + encodeURIComponent(id) + '/undo', { reason: reason, pin: pin, mode: md }); },
        function (data) { applyState(data.state); undoResult(data); },
        function (err) { undoResult({ error: err.message }); refresh(); });
      break;
    }
    case 'spend': api('POST', '/api/sandbox/spend', { ref: d.id }).then(function (r) { toast('Recipient now holds only ' + inr(r.kept)); }, function (e) { toast(e.message, 'bad'); }); break;
    case 'addc': addContactSheet(); break;
    case 'addverify':
      api('POST', '/api/resolve', { q: $('#ac_id').value }).then(function (r) {
        if (r.saved) { addContactSheet('', 'Already in your contacts as ' + r.name); return; }
        ui.pending = partyFromResolve(r); addContactSheet('verify');
      }, function (e) { addContactSheet('', e.message); });
      break;
    case 'addsave':
      api('POST', '/api/contacts', { q: ui.pending.vpa, type: $('#ac_type').value }).then(function (r) {
        applyState(r.state); closeSheet(); toast(ui.pending.name + ' added'); render();
      }, function (e) { addContactSheet('verify', e.message); });
      break;
    case 'setprimary': api('POST', '/api/primary', { accountId: Number(d.id) }).then(function (st) { applyState(st); render(); }, function (e) { toast(e.message, 'bad'); }); break;
    case 'changepin': changePinSheet(); break;
    case 'pcsave':
      api('POST', '/api/pin/change', { oldPin: $('#pc_old').value, newPin: $('#pc_new').value }).then(function () { closeSheet(); toast('PIN updated'); }, function (e) { changePinSheet(e.code === 'WRONG_PIN' ? 'Current PIN is wrong' : e.message); });
      break;
    case 'addmoney': api('POST', '/api/sandbox/add-money', { amount: 1000000 }).then(function () { toast('₹10,000 added to your primary bank'); }, function (e) { toast(e.message, 'bad'); }); break;
    case 'collect': ui.collectId = Number(d.id); ui.collectIdem = null; ui.route = 'collect'; $('#toast').hidden = true; render(); window.scrollTo(0, 0); break;
    case 'collectback': ui.route = 'home'; ui.collectId = null; render(); break;
    case 'collectapprove': {
      var cr = incomingById(ui.collectId); if (!cr) break;
      var ck = $('#cack');
      if (!ck || !ck.checked) { toast('Tick the box to confirm you understand', 'bad'); return; }
      var cb = Number($('#cbank').value), idem = ui.collectIdem || (ui.collectIdem = uuid());
      askPin('Enter UPI PIN', 'This PAYS ' + inr(cr.amount) + ' to ' + cr.name,
        function (pin) { return api('POST', '/api/requests/' + cr.id + '/approve', { pin: pin, ack: true, accountId: cb, idemKey: idem }); },
        function (data) {
          applyState(data.state);
          ui.flow = { party: null, amount: '', note: '', bankId: primaryBank().id, save: false, err: '', txnId: data.txn.id, idem: null };
          ui.collectId = null; ui.collectIdem = null; ui.route = 'pay'; ui.stage = 'result'; render(); window.scrollTo(0, 0);
        },
        function (err) { toast(err.message, 'bad'); api('GET', '/api/state').then(function (st) { applyState(st); render(); }, function () { }); });
      break;
    }
    case 'collectdecline': case 'collectreport': {
      var rep = a === 'collectreport';
      api('POST', '/api/requests/' + ui.collectId + '/decline', { report: rep }).then(function (st) {
        applyState(st); ui.route = 'home'; ui.collectId = null; render(); toast(rep ? 'Declined and reported' : 'Request declined');
      }, function (e) { toast(e.message, 'bad'); });
      break;
    }
    case 'simcollect': api('POST', '/api/sandbox/incoming-collect', { kind: d.kind }).then(function (st) { applyState(st); toast('Request added to Home'); }, function (e) { toast(e.message, 'bad'); }); break;
    case 'copy': copyText(d.t); break;
    case 'closesheet': closeSheet(); break;
    case 'closepin': if (!pinState || !pinState.busy) closePin(); break;
    case 'pinkey': pinKey(d.k); break;
  }
}

/* ---------- events ---------- */
document.addEventListener('click', function (e) { var el = e.target.closest('[data-act]'); if (el) act(el.dataset.act, el.dataset); });
document.addEventListener('submit', function (e) {
  e.preventDefault();
  if (e.target.id !== 'authform') return;
  var btn = $('#authbtn'), err = $('#autherr');
  var fail = function (m) { ui.authErr = m; err.textContent = m; };
  if (ui.auth === 'forgot') {
    var mob = $('#a_mobile').value.trim();
    if (!/^[6-9]\d{9}$/.test(mob)) { fail('Enter a valid 10-digit mobile number'); return; }
    btn.disabled = true; err.textContent = '';
    api('POST', '/api/password/forgot', { mobile: mob }).then(function (r) {
      ui.reset = { mobile: mob, demoOtp: r.demoOtp || '', resendAt: Date.now() + (r.resendAfterSec || 30) * 1000, expiresInMin: r.expiresInMin };
      ui.auth = 'reset'; ui.authErr = ''; render();
    }, function (er) { btn.disabled = false; fail(er.message); });
    return;
  }
  if (ui.auth === 'reset') {
    var otp = $('#a_otp').value.trim(), p1 = $('#a_pass').value, p2 = $('#a_pass2').value;
    if (!/^\d{6}$/.test(otp)) { fail('Enter the 6-digit OTP from the SMS'); return; }
    if (p1.length < 8) { fail('Password must be at least 8 characters'); return; }
    if (p1 !== p2) { fail('The two passwords do not match'); return; }
    btn.disabled = true; err.textContent = '';
    api('POST', '/api/password/reset', { mobile: ui.reset.mobile, otp: otp, newPassword: p1 }).then(function () {
      ui.prefillMobile = ui.reset.mobile; ui.reset = null; ui.auth = 'login'; ui.authErr = ''; ui.authInfo = 'Password changed. Sign in with your new password.'; render();
    }, function (er) { btn.disabled = false; fail(er.message); });
    return;
  }
  var reg = ui.auth === 'register';
  var body = { mobile: $('#a_mobile').value.trim(), password: $('#a_pass').value };
  if (reg) { body.name = $('#a_name').value.trim(); body.handle = $('#a_handle').value.trim(); body.pin = $('#a_pin').value; }
  btn.disabled = true; err.textContent = '';
  api('POST', reg ? '/api/register' : '/api/login', body).then(function (st) {
    ui.authErr = ''; applyState(st); launch();
  }, function (er) { btn.disabled = false; ui.authErr = er.message; err.textContent = er.message; });
});
document.addEventListener('input', function (e) {
  var id = e.target.id;
  if (id === 'q') { ui.q = e.target.value; $('#qerr').textContent = ''; $('#plist').innerHTML = payeeList(ui.q, null); clearTimeout(resolveTimer); resolveTimer = setTimeout(resolveTyped, 350); }
  else if (id === 'csearch') { ui.search = e.target.value; $('#clist').innerHTML = contactList(ui.search); }
  else if (id === 'amt' || id === 'rq_amt') {
    var v = e.target.value.replace(/[^\d.]/g, ''), p = v.split('.');
    if (p.length > 2) v = p[0] + '.' + p.slice(1).join('');
    if (p[1] !== undefined) v = p[0] + '.' + p[1].slice(0, 2);
    if (v !== e.target.value) e.target.value = v;
  } else if (id === 'a_mobile' || id === 'a_pin' || id === 'a_otp' || id === 'pc_old' || id === 'pc_new') {
    var d = e.target.value.replace(/\D/g, ''); if (d !== e.target.value) e.target.value = d;
  }
});
document.addEventListener('change', function (e) {
  if (e.target.id === 'cack') { var b = $('#capprove'); if (b) b.disabled = !e.target.checked; }
  if (e.target.id === 'qack') { var g = $('#qgo'); if (g) g.disabled = !e.target.checked; }
  if (e.target.id === 'scfile') { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) decodeImageFile(f); }
});
// The camera never stays on in the background.
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && cam.stream) scanFail('The camera was switched off because you left the app. Tap Allow to scan again.');
});
window.addEventListener('pagehide', stopCamera);
document.addEventListener('keydown', function (e) {
  if (!$('#pin').hidden) {
    if (/^\d$/.test(e.key)) { pinKey(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { pinKey('del'); e.preventDefault(); }
    else if (e.key === 'Escape' && pinState && !pinState.busy) closePin();
    return;
  }
  if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  if (e.key === 'Enter' && e.target.id === 'q') { e.preventDefault(); clearTimeout(resolveTimer); goPayee(ui.q); }
});
setInterval(function () {
  tickResend();
  var expired = null;
  document.querySelectorAll('[data-until]').forEach(function (el) {
    var ms = +el.dataset.until - nowS();
    if (ms <= 0) expired = el.dataset.until; else el.textContent = mmss(ms);
  });
  if (expired && !ui.expired[expired]) {
    ui.expired[expired] = 1;
    render();
    if (ui.sheet === 'txn' && ui.sheetId) txnSheet(ui.sheetId);
  }
}, 1000);
setInterval(function () { if (S && document.visibilityState === 'visible') refresh(); }, 20000);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('online', function () { $('#offbar').hidden = true; refresh(); });
window.addEventListener('offline', function () { $('#offbar').hidden = false; });
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (S && ui.route === 'me') render(); });
if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () { }); });

// The strip stays visible unless the server says it is running against real banks (SANDBOX=0).
function demoBar() {
  fetch('/api/health', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (h) { ui.health = h; if (h && h.sandbox === false) $('#demobar').hidden = true; if (!S && ui.auth === 'reset') render(); }, function () { });
}
function boot() {
  demoBar();
  var yr = document.getElementById('foot-year'); if (yr) yr.textContent = String(new Date().getFullYear());
  ui.offline = false;
  api('GET', '/api/state').then(function (st) { applyState(st); launch(); }, function (e) {
    S = null;
    if (e.code === 'OFFLINE') ui.offline = true; else if (e.code !== 'AUTH') ui.authErr = e.message;
    render();
  });
}
boot();
})();
