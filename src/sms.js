'use strict';
// SMS sender. The app only ever calls sender.send(mobile, text). Pick the transport with SMS_PROVIDER:
//
//   console  (default)  prints the message to the server log. Nothing leaves the machine. For development.
//   twilio              TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID
//   webhook             POSTs {"to":"+91...","mobile":"...","message":"..."} as JSON to SMS_WEBHOOK_URL.
//                       Optional SMS_WEBHOOK_TOKEN is sent as "Authorization: Bearer ...". Use it to reach any
//                       Indian gateway (MSG91, Fast2SMS, Kaleyra...) through a few lines of glue, or Zapier/Make.
//
// India: transactional SMS must go out through a gateway with a registered DLT sender ID and approved template.
// Your gateway account handles that registration; this code only hands it the text.

class SmsError extends Error {}

function createSender(cfg, { fetchImpl = globalThis.fetch, log = console, env = process.env } = {}) {
  const provider = cfg.smsProvider || 'console';
  const e164 = (mobile) => '+91' + mobile;

  if (provider === 'console') {
    return {
      provider, real: false,
      async send(mobile, text) { log.log('[sms:console] to ' + e164(mobile) + ': ' + text); },
    };
  }

  if (provider === 'twilio') {
    const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM, svc = env.TWILIO_MESSAGING_SERVICE_SID;
    if (!sid || !token || !(from || svc)) throw new Error('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID)');
    return {
      provider, real: true,
      async send(mobile, text) {
        const form = new URLSearchParams({ To: e164(mobile), Body: text });
        if (svc) form.set('MessagingServiceSid', svc); else form.set('From', from);
        const r = await fetchImpl('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(sid) + '/Messages.json', {
          method: 'POST',
          headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new SmsError('Twilio answered ' + r.status);
      },
    };
  }

  if (provider === 'webhook') {
    const url = env.SMS_WEBHOOK_URL, token = env.SMS_WEBHOOK_TOKEN;
    if (!url) throw new Error('SMS_PROVIDER=webhook needs SMS_WEBHOOK_URL');
    let u;
    try { u = new URL(url); } catch { throw new Error('SMS_WEBHOOK_URL is not a valid URL'); }
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('SMS_WEBHOOK_URL must use https');
    return {
      provider, real: true,
      async send(mobile, text) {
        const r = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
          body: JSON.stringify({ to: e164(mobile), mobile, message: text }),
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new SmsError('SMS webhook answered ' + r.status);
      },
    };
  }

  throw new Error('Unknown SMS_PROVIDER "' + provider + '". Use console, twilio or webhook.');
}

module.exports = { createSender, SmsError };
