# Budget Tracker PWA

## Install on iPhone

The PWA must open from HTTPS to install and use the service worker. `http://127.0.0.1:4173/` is useful for testing on your Mac, but it cannot be installed as an iPhone app.

Recommended publishing flow:

1. Publish the `pwa/` folder to HTTPS static hosting, such as GitHub Pages, Cloudflare Pages, Netlify, or Vercel.
2. Open the HTTPS URL in iPhone Safari.
3. Tap Share.
4. Tap Add to Home Screen.
5. Open the app from the new icon.

## Import current Scriptable data

1. Open the current tracker in Scriptable.
2. Export the full JSON file.
3. Save the file to iCloud Drive or share it to your iPhone.
4. Open the PWA.
5. Go to Account.
6. Tap Import JSON and choose the exported file.

## Cloud saving

The app saves locally first so it works offline. It also syncs with Supabase after you sign in with an email OTP code.

Connected project:

1. Supabase project: `budget-tracker`.
2. Table: `public.budget_sync`.
3. Auth: email OTP code.
4. Published PWA: `https://ezratawachi.github.io/scriptable-budget-tracker/pwa/`.

When you connect your email for the first time, the PWA uploads your current data to Supabase if there is not already a cloud copy. After that, every expense, budget, preset, or wish syncs automatically.
