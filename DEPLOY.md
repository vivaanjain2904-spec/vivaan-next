# Deploy to Vercel — No CLI, No Node Required

You only need a browser. Total time: ~5 min.

## 1. Push to GitHub (2 min)

You already committed the repo locally. Now push it:

```bash
# Create an empty repo on github.com first (call it "vivaan-next").
# Don't add a README/license — your local commit has those.

# Then in your terminal (you're already in vivaan-next):
git remote add origin https://github.com/YOUR-USERNAME/vivaan-next.git
git branch -M main
git push -u origin main
```

If you don't want to use the terminal at all, install **GitHub Desktop** ([desktop.github.com](https://desktop.github.com)), open the folder, click "Publish repository". Done.

## 2. Import to Vercel (1 min)

1. Go to **[vercel.com/new](https://vercel.com/new)** → sign in with GitHub
2. Find `vivaan-next` in the list → click **Import**
3. Don't touch any settings → click **Deploy**
4. Wait ~90 seconds for the build

You'll get a URL like `https://vivaan-next-xyz.vercel.app`. It won't work yet — needs a database.

## 3. Add the Database (1 min)

1. In your Vercel project dashboard → **Storage** tab
2. **Create Database** → pick **Postgres** (free Hobby tier) → **Create**
3. Click **Connect Project** → pick your `vivaan-next` project → **Connect**

Vercel automatically injects all the `POSTGRES_*` environment variables.

## 4. Add JWT Secret (30 sec)

1. **Settings** tab → **Environment Variables**
2. Add one variable:
   - **Key:** `JWT_SECRET`
   - **Value:** any random string ≥ 32 chars (e.g. `vivaan-portfolio-2026-super-secret-xyz`)
   - **Environments:** check all three (Production, Preview, Development)
3. **Save**

## 5. Redeploy (30 sec)

1. **Deployments** tab → click the **⋯** menu on the latest deployment
2. **Redeploy** → confirm

## 6. Initialise the database (one click)

Open this URL in your browser, once:

```
https://YOUR-URL.vercel.app/api/setup
```

You should see:
```json
{ "ok": true, "tables_created": true, "seeded_demo_user": true,
  "message": "Setup complete! …" }
```

## 7. You're live 🎉

Open `https://YOUR-URL.vercel.app` and sign in as **Vivaan / vivaan**, or click *Create Account* to make your own.

Share the URL with friends — every person who signs up gets their own portfolio, cash, watchlist, and notification settings.

---

## Adding phone push notifications (per user, takes 30 sec)

1. User goes to **Settings** in the app
2. Picks a unique ntfy topic (e.g. `alex-stocks-7x9k`)
3. Installs the free **ntfy** app on their phone ([iOS](https://apps.apple.com/us/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy))
4. In the ntfy app: subscribe to their topic
5. Hits **Send Test** in the dashboard → instant phone notification

Vercel Cron runs every 5 min and fires push notifications whenever a stop-loss, take-profit, watchlist threshold, or ML signal trips.

---

## Optional: Get ML signals into the cloud

The ML training/screener stays local (Python). Sync the latest scores to Vercel Postgres:

```bash
cd ~/ai-portfolio-agent
source venv/bin/activate
python screener.py           # produces a CSV

cd ../vivaan-next/scripts
pip install psycopg2-binary pandas python-dotenv
# Get POSTGRES_URL_NON_POOLING from Vercel → Storage → .env.local
echo "POSTGRES_URL_NON_POOLING=postgres://..." > .env
python upload-screener.py
```

Now your live dashboard shows ML risk per stock and the cron job sends ML alerts.

Set it to run daily with `launchd` or `cron` to keep scores fresh.
