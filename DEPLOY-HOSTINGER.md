# Deploy ARMAPay on Hostinger (Node.js Web App)

This build is a **demo sandbox**: simulated bank balances, no real money. Hosting it publicly is fine for demos, pilots and investor walk-throughs. It is not a licensed payments service. See "Before real money" in README.md.

## 0. What you need

- A Hostinger **Business Web Hosting** or **Cloud** plan (Cloud Startup, Professional, Enterprise). Hostinger lists only these plans for Node.js Web Apps. The Agency plan runs static Node projects only.
- A domain or subdomain on that plan, for example `pay.yourdomain.com`.
- Node.js app websites must be created as **new websites**. If the domain already has a site on your plan, either remove that site first or use a subdomain.
- `armapay-hostinger.zip` (this project). `package.json` is at the top level of the zip, which Hostinger requires. Do not unzip and re-zip it inside a folder.

## 1. Create the Node.js app

1. hPanel → **Websites** → **Add Website** → **Node.js Apps**.
2. Choose **Upload your website files** and upload `armapay-hostinger.zip`.
3. Build settings:

| Setting | Value |
|---|---|
| Framework preset | **Other** |
| Node.js version | **22.x** (24.x also works; the app needs 22 or newer). Node 22 or newer has SQLite built in, which this app uses if the native module cannot install |
| Root directory | leave empty |
| Package manager | npm |
| Build command | leave empty (there is no build step) |
| Entry file | `server.js` |
| Start command (if shown) | `npm start` |

4. Environment variables (add before the first deploy, or later under **Environment variables** in the site dashboard; saving redeploys):

| Name | Value | Why |
|---|---|---|
| `COOKIE_SECURE` | `1` | Session cookie is sent over HTTPS only. Without it, you stay logged out on HTTPS-only setups |
| `TRUST_PROXY` | `1` | Reads the real visitor IP from the proxy, so rate limits are per visitor and not shared by everyone |
| `SANDBOX` | `1` | Simulated banks. Leave it |
| `PIN_LOCK_SEC` | `300` | Lock a wrong-PIN attempt for 5 minutes (the default is 30 seconds, for demos) |
| `SMS_PROVIDER` and its keys | see section 3 | Sends the OTP for Forgot password |

Optional: `DB_FILE`, `UNDO_WINDOW_MIN`, `UNDO_ABUSE_LIMIT`, `COLLECT_TTL_HOURS`, `QR_REPORTER_MIN_HOURS`. See `.env.example`.

5. Click **Deploy**. The first build takes a minute or two.

## 2. Turn on HTTPS

Dashboard → **SSL** → install the certificate for the domain, then choose **Force HTTPS**. The app needs HTTPS for the install-to-home-screen feature (service worker) and for the secure cookie.

## 3. Connect SMS (needed for "Forgot password")

The forgot-password flow texts a 6-digit OTP to the registered mobile number. A web host cannot send SMS by itself, so you connect an SMS service. Until you do, the app still runs, but the OTP is only written to the server log and nobody can reset a password. The reset screen tells the user so.

Add these under **Environment variables** (saving redeploys). Pick one provider.

**Option A: Twilio**

| Name | Value |
|---|---|
| `SMS_PROVIDER` | `twilio` |
| `TWILIO_ACCOUNT_SID` | your Account SID |
| `TWILIO_AUTH_TOKEN` | your Auth Token |
| `TWILIO_FROM` | your Twilio sender number (or set `TWILIO_MESSAGING_SERVICE_SID` instead) |

**Option B: any other SMS gateway, through a webhook**

| Name | Value |
|---|---|
| `SMS_PROVIDER` | `webhook` |
| `SMS_WEBHOOK_URL` | an `https://` address that accepts the message |
| `SMS_WEBHOOK_TOKEN` | optional secret, sent as `Authorization: Bearer <token>` |

ARMAPay POSTs `{"to":"+919876500001","mobile":"9876500001","message":"..."}` as JSON and treats any 2xx answer as sent. Point it at a small function or automation (Zapier, Make, a serverless function) that passes the text to your gateway's API. This is how you reach Indian gateways such as MSG91, Fast2SMS or Kaleyra without changing the app.

**India:** transactional SMS (OTPs) must be sent through a gateway with a **DLT-registered sender ID and approved message template**, or the operators will block it. Register on your gateway's portal and use the OTP wording from `src/otp.js` as the template text (the code and the number of minutes are the variables). Twilio's India routes have DLT requirements as well. Check your provider's current India rules before launch.

**Check it:** open `https://your-domain/api/health`. `"sms":"live"` means a provider is set. Then use Forgot password with your own number.

**Do not set `DEMO_SHOW_OTP`** on a public site. It prints the OTP on the screen so a demo works without SMS, which would let anyone reset any account. Only use it on a private demo, and remove it afterwards. Optional tuning: `OTP_TTL_MIN` (10), `OTP_MAX_ATTEMPTS` (5), `OTP_RESEND_SEC` (30), `OTP_PER_HOUR` (5).

**Scan & pay on a phone** needs HTTPS (browsers refuse the camera on plain `http://`), which section 2 already sets up. For a public pilot also set `QR_REPORTER_MIN_HOURS=24`, so brand-new accounts cannot flood a merchant with fraud reports.

## 4. Check it works

1. Open `https://your-domain/api/health`. You should see `{"ok":true,"sandbox":true}`.
2. Open `https://your-domain/`, create an account, make a payment, press Undo.
3. Forgot password: sign out, tap **Forgot password?**, enter your number, enter the OTP from the SMS, set a new password.
4. Scan & pay: Profile → **Show demo QR codes**. On a phone, Home → **Scan & pay** → **Allow camera for this scan** and point the camera at a demo QR on another screen. The red zone (50–99) shows the orange "Fraud detected" screen.
5. On a phone: Chrome menu → **Install app** (Android) or Share → **Add to Home Screen** (iPhone).

## 5. Where your data lives (important)

Hostinger **replaces the app folder on every deployment** (`hbuilds/` and `public_html`). So `server.js` keeps the database outside it, at:

```
~/armapay-data/armapay.db      (your hosting account home folder, for example /home/u123456789/armapay-data/)
```

Redeploys, restarts and idle sleep do not touch this folder.

- **Back up** before every redeploy: File Manager → `armapay-data` → download `armapay.db`. Or over SSH, if your plan gives you SSH access: `node ~/domains/<your-domain>/hbuilds/current/nodejs/scripts/backup.js` writes a safe copy into `armapay-data/backups/` and keeps the newest 14.
- **First redeploy:** make a backup first, redeploy, and confirm your test account still signs in. That proves the folder survives on your plan.
- To restore: stop the app (dashboard), replace `armapay.db`, start it.

## 6. Updating the app

Dashboard → **Redeploy** → **Upload new files** → pick the new zip → **Redeploy**. Environment variables stay. With GitHub import, pushing to the branch redeploys automatically.

## 7. If something goes wrong

| Symptom | Fix |
|---|---|
| Build fails: `package.json` not found | The zip has a folder inside it. Zip the *contents* of the project so `package.json` is at the top |
| Build fails during install | Use Node 22. `better-sqlite3` is optional, so a failed native build does not stop the app: it falls back to Node's built-in SQLite |
| Site shows 503 or "app not running" | File Manager → your domain's `nodejs` folder → `stderr.log` (the app's error log). The last lines name the cause. Build errors are under Deployments → the failed build → Build logs |
| `Cannot write to the database folder` | Set `DB_FILE` to a writable path outside the app, for example `/home/u123456789/armapay-data/armapay.db` |
| `Port already in use` / port errors | Do not set a custom `PORT`. The app uses the one Hostinger provides, or 3000 |
| You are logged out right after login | Force HTTPS is off, or `COOKIE_SECURE=1` is set while you browse over plain `http://` |
| "Too many attempts" for everyone | Set `TRUST_PROXY=1` (or `2` if there is also a CDN in front) |
| Forgot password: "We could not send the SMS" | The SMS provider refused it. `stderr.log` has the reason (wrong keys, no balance, sender not registered). Check `SMS_PROVIDER` and the keys |
| Forgot password: "no SMS service connected" note | `SMS_PROVIDER` is not set. See section 3 |
| Camera does not open | Open the site over `https://`, tap Allow in the browser prompt, and check the site's camera permission in browser settings. Upload and Paste link work without a camera |
| First request after a quiet period is slow | Hostinger stops idle Node apps and starts them on the next visit. Data is safe on disk |

## 8. Limits to know about

- One SQLite file means one server and one writer at a time. That is fine for a demo or pilot, not for a payments service. For real volume, move the ledger to PostgreSQL or MySQL (the schema in `src/db.js` is plain SQL, so it ports with small changes).
- The in-memory rate limiter resets whenever the app restarts.
- Hostinger's Node.js hosting runs your app on shared resources with CPU, memory and process limits that depend on the plan. If the app is killed under load, upgrade the plan or move to a VPS.
