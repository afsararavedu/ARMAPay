'use strict';
// Password reset by one-time password. The OTP goes to the mobile number the account was registered with.
//
// Safeguards:
//  - 6 random digits, stored only as a salted hash, valid for OTP_TTL_MIN minutes, usable once;
//  - a wrong guess is counted before it is compared, so parallel guesses cannot beat the limit; after
//    OTP_MAX_ATTEMPTS wrong guesses the OTP is burned and a new one is needed;
//  - asking for an OTP looks the same for registered and unregistered numbers;
//  - a successful reset signs the account out everywhere. The UPI PIN is not touched, so someone who
//    swaps your SIM still cannot pay without it.
const crypto = require('crypto');
const { AppError } = require('./ledger');
const { SmsError } = require('./sms');

const hashCode = (salt, mobile, code) => crypto.createHash('sha256').update(salt + ':' + mobile + ':' + code).digest();

function createOtp(db, cfg, sender, sec) {
  const now = () => Date.now();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const tx = (fn) => db.transaction(fn).immediate();

  // Returns { delivered, code } where code is only meaningful to a caller that may show it (demo mode).
  async function request(mobile) {
    const u = one('SELECT id FROM users WHERE mobile = ?', mobile);
    if (!u) return { delivered: false, code: null };

    const last = one('SELECT created_at FROM otp_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1', u.id);
    if (last && now() - last.created_at < cfg.otpResendMs) {
      throw new AppError(429, 'OTP_WAIT', 'Please wait a moment before asking for another OTP.', { retryAfterMs: cfg.otpResendMs - (now() - last.created_at) });
    }
    const hourAgo = one('SELECT COUNT(*) c FROM otp_codes WHERE user_id = ? AND created_at >= ?', u.id, now() - 3600000).c;
    if (hourAgo >= cfg.otpPerHour) throw new AppError(429, 'OTP_LIMIT', 'Too many OTP requests for this number. Try again in an hour.');

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('hex');
    const t = now();
    const id = tx(() => {
      run('UPDATE otp_codes SET used = 1 WHERE user_id = ? AND used = 0', u.id); // only the newest OTP works
      return run(
        'INSERT INTO otp_codes(user_id,mobile,purpose,salt,code_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
        u.id, mobile, 'reset', salt, hashCode(salt, mobile, code).toString('hex'), t, t + cfg.otpTtlMs
      ).lastInsertRowid;
    });
    const mins = Math.round(cfg.otpTtlMs / 60000);
    try {
      await sender.send(mobile, `${code} is your ARMAPay password reset OTP. It is valid for ${mins} minutes. Never share it with anyone. ARMAPay will never ask for your OTP, PIN or password.`);
    } catch (e) {
      run('UPDATE otp_codes SET used = 1 WHERE id = ?', id);
      console.error('SMS send failed:', e instanceof SmsError ? e.message : e && e.message);
      throw new AppError(502, 'SMS_FAILED', 'We could not send the SMS right now. Please try again in a minute.');
    }
    run('INSERT INTO audit(ts,user_id,action,detail) VALUES(?,?,?,NULL)', t, u.id, 'otp_sent');
    return { delivered: true, code };
  }

  // Verifies the OTP and sets the new password in one step.
  async function reset({ mobile, otp, newPassword }) {
    if (!/^\d{6}$/.test(otp)) throw new AppError(400, 'BAD_OTP', 'Enter the 6-digit OTP from your SMS.');
    if (newPassword.length < 8 || newPassword.length > 128) throw new AppError(400, 'BAD_PASSWORD', 'Password must be at least 8 characters');

    const u = one('SELECT id FROM users WHERE mobile = ?', mobile);
    // A failed attempt must be saved, so the verdict is returned from the transaction and thrown after it commits.
    const outcome = tx(() => {
      if (!u) return { bad: true };
      const row = one('SELECT * FROM otp_codes WHERE user_id = ? AND used = 0 ORDER BY id DESC LIMIT 1', u.id);
      if (!row || row.expires_at <= now()) return { bad: true };
      if (row.attempts >= cfg.otpMaxAttempts) { run('UPDATE otp_codes SET used = 1 WHERE id = ?', row.id); return { burned: true }; }
      run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
      const ok = crypto.timingSafeEqual(hashCode(row.salt, mobile, otp), Buffer.from(row.code_hash, 'hex'));
      if (!ok) {
        const left = cfg.otpMaxAttempts - (row.attempts + 1);
        if (left <= 0) run('UPDATE otp_codes SET used = 1 WHERE id = ?', row.id);
        return { wrong: true, left };
      }
      run('UPDATE otp_codes SET used = 1 WHERE id = ?', row.id);
      run('UPDATE users SET password_hash = ? WHERE id = ?', sec.hashSecret(newPassword), u.id);
      run('DELETE FROM sessions WHERE user_id = ?', u.id); // sign out everywhere
      run('INSERT INTO audit(ts,user_id,action,detail) VALUES(?,?,?,NULL)', now(), u.id, 'password_reset');
      return { ok: true };
    });

    if (outcome.ok) {
      // Best effort security notice. A failure here must not undo the reset.
      sender.send(mobile, 'Your ARMAPay password was just changed. If this was not you, contact support now.').catch(() => { });
      return;
    }
    if (outcome.burned) throw new AppError(429, 'OTP_BURNED', 'Too many wrong tries. Ask for a new OTP.');
    if (outcome.wrong) {
      throw outcome.left > 0
        ? new AppError(400, 'OTP_WRONG', `That OTP is not right. ${outcome.left} ${outcome.left === 1 ? 'try' : 'tries'} left.`, { triesLeft: outcome.left })
        : new AppError(429, 'OTP_BURNED', 'Too many wrong tries. Ask for a new OTP.');
    }
    throw new AppError(400, 'OTP_INVALID', 'That OTP is wrong or has expired. Ask for a new one.');
  }

  return { request, reset };
}

module.exports = { createOtp };
