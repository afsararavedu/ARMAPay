'use strict';
// All money is stored as integer paise (1 rupee = 100 paise). Never use floats for balances.
const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

module.exports = {
  port: num(env.PORT, 3000),
  host: env.HOST || '127.0.0.1',
  dbFile: env.DB_FILE || 'data/armapay.db',

  // Sandbox mode creates simulated bank balances, demo contacts and unknown external UPI IDs.
  // Turn it off (SANDBOX=0) only when a real bank/PSP integration replaces the simulated accounts.
  sandbox: env.SANDBOX !== '0',

  // Undo policy
  undoWindowMs: num(env.UNDO_WINDOW_MIN, 15) * 60000,
  abuseLimit: num(env.UNDO_ABUSE_LIMIT, 3), // undos allowed per rolling window before manual review
  abuseWindowMs: num(env.UNDO_ABUSE_DAYS, 30) * 86400000,

  // Collect requests ("pay me" requests) expire if the payer does nothing
  collectTtlMs: num(env.COLLECT_TTL_HOURS, 24) * 3600000,

  // Limits (paise)
  txnLimit: 100000 * 100,
  dailyLimit: 100000 * 100,
  newPayeeLimit: 5000 * 100,
  tzOffsetMin: num(env.TZ_OFFSET_MIN, 330), // IST, used for the "daily" limit boundary

  // Password reset by OTP (sent by SMS to the registered mobile number)
  otpTtlMs: num(env.OTP_TTL_MIN, 10) * 60000,
  otpMaxAttempts: num(env.OTP_MAX_ATTEMPTS, 5), // wrong guesses allowed per OTP before it is burned
  otpResendMs: num(env.OTP_RESEND_SEC, 30) * 1000,
  otpPerHour: num(env.OTP_PER_HOUR, 5), // OTPs one mobile number can request per hour
  smsProvider: (env.SMS_PROVIDER || 'console').toLowerCase(), // console | twilio | webhook
  // Show the OTP on screen instead of sending an SMS. For local demos only: anyone could then reset any account.
  showDemoOtp: env.DEMO_SHOW_OTP === '1',

  // QR safety check
  qrCheckTtlMs: num(env.QR_CHECK_TTL_MIN, 15) * 60000, // how long a QR check stays valid for paying
  qrHighRisk: 50, // score 50..99 = "fraud detected"
  qrCaution: 30,
  qrReporterMinAgeMs: num(env.QR_REPORTER_MIN_HOURS, 0) * 3600000, // production: 24+, so fresh sybil accounts cannot smear a merchant

  // PIN and sessions
  pinMaxFails: num(env.PIN_MAX_FAILS, 3),
  pinLockMs: num(env.PIN_LOCK_SEC, 30) * 1000, // production banks lock for hours; keep short for demos
  sessionTtlMs: num(env.SESSION_DAYS, 7) * 86400000,
  cookieSecure: env.COOKIE_SECURE === '1', // set to 1 when served over HTTPS

  // How many reverse proxies sit in front of this server (Hostinger: 1). The client IP is then read from
  // X-Forwarded-For, counting that many hops from the right. 0 = connect directly, ignore the header.
  trustProxy: num(env.TRUST_PROXY, 0),

  openingBalances: [50000 * 100, 12000 * 100], // sandbox only
};
