# Cravings Hunt

Scan. Order. Pay. Multi-restaurant QR table ordering.

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render > New > Blueprint > pick the repo (it reads render.yaml).
3. After deploy, open the service > Environment and read SUPER_PASSWORD and DEMO_PIN.
4. Open https://YOUR-APP.onrender.com/#/super and sign in with SUPER_PASSWORD.
5. Demo restaurant: ID spice-route, PIN = DEMO_PIN. Delete it before going live.

## Settings (environment variables)
- SUPER_PASSWORD  owner login (required)
- APP_SECRET      signs logins (required, keep it stable)
- DATA_FILE       JSON file on the persistent disk, or use DATABASE_URL for Postgres
- RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET  turns on real payments. Without them payment is demo mode.

## Run locally
npm install
SUPER_PASSWORD=choose-one APP_SECRET=anything npm start   # http://localhost:3000
