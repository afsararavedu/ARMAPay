# ARMAPay

A UPI-style payments app that runs in a mobile or desktop browser and installs to the home screen without an app store. It adds one thing existing UPI apps do not have: **Undo**. A payer can reverse a successful payment within a set window if they believe it is fraud or money laundering.

This build is a **sandbox**. Bank balances and outside UPI IDs are simulated. Payments between two ARMAPay users are real ledger entries in a real database. Read "Before real money" before pointing it at anything else.

## Run it

```bash
npm install
npm run seed      # optional: creates Afsar (9876500001) and Kavya (9876500002), password "armapay-demo", PIN 1234
npm run dev       # http://127.0.0.1:3000, database in ./data
npm test          # 23 backend tests
```

Open the URL on your phone (same network, `HOST=0.0.0.0`) or in a desktop browser. Create an account, or sign in with a seeded user. To see both sides of a payment, sign in as Afsar in one browser and Kavya in a private window.

Requires Node 22 or newer. There is one optional dependency, `better-sqlite3`. If it cannot be installed (some shared hosts cannot build native modules), the app uses the SQLite built into Node itself.

To put it online, see **DEPLOY-HOSTINGER.md**. `npm start` runs the hosted entry file (`server.js`); `npm run dev` is the local one.

## How Undo works

1. Every outgoing payment can be undone for `UNDO_WINDOW_MIN` minutes (default 15). The app shows a live countdown on Home, on the payment result and in the payment detail.
2. The payer picks a reason (fraud, scam, laundering, wrong person) and enters the UPI PIN.
3. One database transaction then does the following:
   - moves the money from the recipient's account back to the bank account the payer used;
   - if the recipient already spent part of it, recovers what is there and records a **lien** for the rest;
   - writes the reversal to the ledger, logs the reason and counts the report against the recipient account.
4. A lien is paid from the recipient's next incoming credits, automatically. When it reaches zero the payment's status becomes `REVERSED`.
5. Abuse guard: after `UNDO_ABUSE_LIMIT` undos (default 3) in `UNDO_ABUSE_DAYS` days (default 30), the next undo opens a manual review instead of reversing.
6. After the window closes, the same button opens a dispute. No money moves automatically.
7. The recipient sees "reversed by sender", not the reason. Anyone about to pay an account with reports against it sees a warning.

Saved contacts pay instantly after the PIN. A payee who is not in your contacts is verified by name first and capped at ₹5,000 per payment. Everyone is capped at ₹1,00,000 per payment and per day.

## Collect-request scams (the orange screen)

A "collect" request is someone asking *you* to pay *them*. Scammers pose as a buyer, seller or customer support and say you will **receive** money. Approving the request with your PIN actually **deducts** it.

- A request shows up on Home under "Requests asking you to pay", with an amber badge.
- Opening it turns the whole screen **orange** (`<html data-alert>`: every colour token is overridden, in light and dark mode, and the browser `theme-color` changes too). The tab bar is hidden so nothing distracts from the decision.
- The screen says plainly that this takes money out, shows the sender, the amount and the note, and lists why it looks risky: sender not in your contacts, reported by other users, scam words in the note (refund, prize, KYC, receive, claim, and similar), large amount.
- **Approve stays disabled until the user ticks the box:** "I understand this request will deduct ₹X from my account, and I feel it is safe to proceed." The server enforces this too: `POST /api/requests/:id/approve` rejects anything without `ack: true`, then checks the PIN.
- Decline, or "Decline and report". Reports count against the sender and warn future payers.
- Requests expire after `COLLECT_TTL_HOURS` (default 24).
- A payment approved this way is still an ordinary payment: it keeps the Undo window.
- **Money you receive** never shows this screen, never asks for a PIN, and keeps the normal colours. You get a green "Received ₹X from Y. No PIN needed." message.

In the sandbox, Profile has two buttons that add a suspicious "refund" request and a bill from a saved contact so you can see both versions.

## Forgot password (OTP by SMS)

Sign in → **Forgot password?** → enter the registered mobile number → enter the 6-digit OTP and a new password.

- The OTP is 6 random digits, stored only as a salted hash, valid for `OTP_TTL_MIN` minutes (10), usable once. Only the newest OTP works.
- 5 wrong guesses (`OTP_MAX_ATTEMPTS`) burn the OTP. Each guess is counted *before* it is compared, so parallel guesses cannot beat the limit.
- A new OTP can be asked for every 30 seconds and 5 times an hour per number, plus a per-IP limit.
- The reply is the same for registered and unregistered numbers, so the form cannot be used to find out who has an account.
- A successful reset **signs the account out everywhere**, texts a "your password was changed" notice, and does **not** change the UPI PIN. Someone who swaps your SIM still cannot pay without it.
- `SMS_PROVIDER` picks how the text is sent: `console` (default; writes it to the server log, for development), `twilio`, or `webhook` (POSTs JSON to any gateway). See `.env.example` and DEPLOY-HOSTINGER.md. In India, transactional SMS must go through a gateway with a registered DLT sender ID and approved template; your gateway account handles that.
- `DEMO_SHOW_OTP=1` shows the OTP on the screen so you can try the flow without an SMS service. `npm run dev` turns it on; the hosted `server.js` does not. **Never enable it on a public site**: anyone could then reset any account.

## Scan & pay, and the risk meter

Home → **Scan & pay**.

**Camera consent, every time.** The camera is never opened on its own. The screen first explains what it will do, and nothing is requested from the browser until the user taps **Allow camera for this scan** (the browser then shows its own permission prompt too). It uses the back camera, with a button to switch to the front one when the device has more than one. The camera is switched off the moment a code is read, when the user taps Stop or leaves the screen, when the app goes to the background, and after 60 seconds without a read. No video is recorded or uploaded; the picture is decoded on the device and only the text inside the QR is sent to the server. Without a camera, or when permission is refused, the user can upload a QR image or paste a link. The camera needs HTTPS (or localhost), as every browser requires.

**Safety check before any money moves.** The QR text goes to `POST /api/qr/check`, which parses it (UPI links and BharatQR), looks up the payee's history and returns a score from 0 to 99. A speedometer shows it:

| Score | Zone | What the app does |
|---|---|---|
| 0–29 | Low risk (green) | Normal screens |
| 30–49 | Be careful (amber) | Warning with the reasons, one tap to continue |
| **50–99** | **Fraud detected (red)** | Orange alert screen. "Continue anyway" stays locked until the user ticks that they understand. The server enforces this too (`riskAck`), then asks for the PIN as usual |

What feeds the score (each shown to the user under "Why this score"):

- **Reports against the payee** (the strongest signal): other people who reported the QR, people who used Undo on a payment to it and picked fraud, scam or laundering, and reported collect requests. Counted per distinct person. One report gives "Be careful" at most; two or more different people give 50 or more. Good signals can soften a report but never hide it.
- Nobody on ARMAPay has scanned or paid this payee before; account opened within 7 days; QR name differs from the bank-verified name; name cannot be verified; not in your contacts; scam words in the name or note (refund, cashback, prize, receive...); a large amount.
- Lowers the score: the payee is in your contacts; paid by 5 or more users with no reports.

Every check is saved, so a QR's scan history builds up. The check is tied to the payment: `POST /api/pay` with `qrCheck` must carry a check made by the same user, not older than `QR_CHECK_TTL_MIN`, for the same UPI ID. A paid QR payment can still be undone.

**What this history is, honestly.** The score uses what ARMAPay itself knows. It cannot see fraud reports held by NPCI or banks, because no such public feed exists for a standalone app. A QR nobody on ARMAPay has met scores as "first seen", not "safe". Reports can be abused (fake accounts smearing a merchant), so set `QR_REPORTER_MIN_HOURS=24` or more in production, one report counts once per person, and plan a moderation process for contested merchants.

In the sandbox, Profile → **Show demo QR codes** shows one QR for each zone. Scan one from another screen to see the meter move.

## Branding

The logo is in `public/img/` (`armapay-logo.webp`, plus a 360 px version). It appears once in the app: on the sign-in page and in the Home brand card, always on a white card because its navy lettering needs a light background. The slogan ("Pay before your WayCup Chai cools. And if it isn't right, Undo it.") is defined near the top of `public/app.js` (`SLOGAN`).

The footer ("Developed By Afser & Srikanth J." and "Copyright © year WayCup Chai · waycupchai.com", linked to https://waycupchai.com) is one element in `public/index.html` (`<footer class="site-foot">`), so it appears at the bottom of every screen. Edit the text there. The year updates by itself.

## Layout

```
src/config.js     all limits and policy, read from environment variables
src/sqlite.js     SQLite driver: better-sqlite3, or Node's built-in SQLite when that is missing
src/db.js         SQLite schema (integer paise, CHECK balance >= 0)
src/ledger.js     pay, undo, liens, disputes, limits, PIN lockout, state for the app
src/security.js   scrypt hashing, session tokens, rate limiter
src/server.js     HTTP server: JSON API, sessions, security headers, static files
src/otp.js        password-reset OTPs
src/sms.js        SMS sending: console, Twilio or webhook
src/qr.js         QR parsing (UPI, BharatQR), history and risk score
src/seed.js       two demo users
server.js         entry file for hosting (listens on all interfaces, keeps the database outside the app folder)
scripts/backup.js consistent copy of the live database
public/           the app: index.html, app.js, styles.css, manifest, service worker, icons, self-hosted fonts, vendor/ (QR generator, jsQR decoder)
test/             backend tests (node:test)
```

Every balance change writes a row to `ledger_entries`. `ledger.checkInvariants()` confirms each account's balance equals the sum of its entries. The tests run it after every scenario.

## API

All write requests need the header `X-ARMAPay: 1` and `Content-Type: application/json`. Sessions use an `HttpOnly`, `SameSite=Strict` cookie. Money is integer paise.

| Method and path | Purpose |
|---|---|
| `POST /api/register`, `/api/login`, `/api/logout` | Account and session |
| `POST /api/password/forgot` | Send a reset OTP to a registered mobile. Same reply for unknown numbers |
| `POST /api/password/reset` | `mobile`, `otp`, `newPassword`. Signs the account out everywhere |
| `POST /api/qr/check` | `payload` (text of a QR). Returns the payee, amount, risk score 0–99, reasons and history, and a `checkId` |
| `POST /api/qr/report` | Report a payee you have scanned or paid (`vpa`, `reason`: fraud, scam, cheating, other) |
| `GET /api/state` | Profile, banks, contacts, payments, requests, policy |
| `POST /api/resolve` | Verify a name, mobile or UPI ID; returns saved/new status and report count |
| `POST /api/pay` | Pay. Needs `pin`. Send `idemKey` so a retry never pays twice. For a scanned QR also send `qrCheck`, and `riskAck: true` when the score was 50 or more |
| `POST /api/txns/:id/undo` | Undo or dispute. Needs `pin` and `reason`. `mode: "dispute"` forces a dispute |
| `POST /api/balance` | Balance of one bank account. Needs `pin` |
| `POST /api/requests` | Ask another person to pay you (creates a collect request for them) |
| `POST /api/requests/:id/approve` | Pay a collect request. Needs `pin` and `ack: true`. Send `idemKey` |
| `POST /api/requests/:id/decline` | Decline. `report: true` also reports the sender |
| `POST /api/contacts`, `/api/primary`, `/api/pin/change` | Account management |
| `POST /api/sandbox/*` | Test money, simulate the recipient spending, mark a request paid, simulate an incoming collect request (`incoming-collect`, `kind: "scam" or "contact"`), demo QR codes (`demo-qrs`). Return 404 when `SANDBOX=0` |

## Install as an app (PWA)

Browsers only install a web app from **HTTPS** (or localhost). Put the server behind a TLS reverse proxy (Caddy, nginx, a cloud load balancer), set `COOKIE_SECURE=1`, and open the site on a phone:

- Android / Chrome: an Install button appears in Profile, or use the browser menu.
- iPhone / Safari: Share, then Add to Home Screen.

The service worker caches only the app shell (pages, scripts, fonts, icons). It never caches `/api/` responses, so no balances or payments are stored on the device. Offline, the app shows a "you're offline" screen instead of stale data.

Docker: `docker build -t armapay . && docker run -p 3000:3000 -v armapay-data:/data armapay`.

## Configuration

See `.env.example`. The ones that matter: `SANDBOX`, `UNDO_WINDOW_MIN`, `UNDO_ABUSE_LIMIT`, `COLLECT_TTL_HOURS`, `PIN_LOCK_SEC`, `COOKIE_SECURE`, `SMS_PROVIDER` (and its keys), `QR_REPORTER_MIN_HOURS`.

## Security measures in this build

- Passwords and UPI PINs are hashed with scrypt and a per-user salt. Login takes the same time for unknown mobiles.
- PIN lockout after `PIN_MAX_FAILS` wrong tries, enforced in the database, so restarting the server does not reset it.
- Strict Content-Security-Policy (scripts, fonts and connections from the same origin only), `frame-ancestors 'none'`, `nosniff`, no referrer.
- CSRF protection through `SameSite=Strict` plus the required custom header.
- Login, sign-up and payment rate limits.
- Payments and undo run in `BEGIN IMMEDIATE` transactions. The database refuses a negative balance even if application code has a bug.
- Password-reset OTPs: salted hash, expiry, attempt counting before comparison, resend cooldown and hourly cap, identical replies for unknown numbers, sessions revoked on reset, PIN untouched.
- QR safety: the QR text is parsed strictly (duplicate `pa`/`am` parameters, `mandate` links, web URLs, bad amounts and over-long payloads are refused; zero-width and bidi characters are stripped). The payee and amount shown are the ones the server parsed, and `/api/pay` only accepts a QR check that belongs to the same user and payee. The fraud acknowledgement is checked on the server.
- The camera is allowed only for the page itself (`Permissions-Policy: camera=(self)`) and is released on every exit path.
- Idempotency keys on payments and collect approvals. Collect approvals also need an explicit acknowledgement, checked on the server.

## Before real money

This is the part that is not code.

- **Licence and partners.** UPI payments in India go through NPCI. You need a licensed PSP bank or a TPAP arrangement with one, and the RBI payment-system rules apply. Direct integration is not available to a standalone app.
- **Undo versus UPI finality.** UPI payments are final. NPCI reversals today go through the bank dispute process. An instant, payer-triggered reversal needs the sponsor bank's and NPCI's explicit approval, and the recipient's bank must support a debit-back or hold. Plan this conversation before building further.
- **PIN handling.** Real UPI PINs are captured in NPCI's Common Library and sent encrypted to the issuing bank. They are never handled by your server. The PIN here is a sandbox stand-in.
- **Identity and fraud controls.** KYC, mobile SIM and device binding, OTP, transaction monitoring, and a process for filing suspicious transaction reports when users flag laundering.
- **Scale and operations.** SQLite is single-writer. Move to PostgreSQL with the same schema before real traffic. Replace the in-memory rate limiter with a shared store if you run more than one process. Add backups, audit retention and monitoring.
- **A short PIN can be guessed offline** if the database leaks, because 4 digits have only 10,000 combinations. This is another reason real PINs stay with the bank.
