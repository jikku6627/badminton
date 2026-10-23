# Home Badminton Tournament 2026: setup with no laptop needed

Everything here is done in a **web browser**, on your personal phone or any personal computer, signed in with a **personal Gmail**. Nothing needs to be installed, and it's all free.

- **Firebase (Google):** the live database and organiser logins.
- **GitHub Pages:** hosts the app at a link like `https://yourname.github.io/badminton/`.

It takes about 45 minutes, once. A computer's browser is easiest for Part B, but a phone works too.

---

## Part A: Firebase (database and logins)

1. Go to https://console.firebase.google.com, sign in with your personal Gmail, and choose **Create a project** (e.g. `central-club-badminton`). You can turn Analytics off.
2. **Turn on sign-in:** go to **Build → Authentication → Get started → Sign-in method → Google → Enable → Save**.
3. **Create the database:** go to **Build → Firestore Database → Create database**. Pick location **asia-south1 (Mumbai)**, then **Start in production mode**.
4. **Set the security rules:** in Firestore Database, open the **Rules** tab and delete what's there. Open `firestore-rules.txt` from this package and copy all of it in. Change `paste_your_gmail@gmail.com` to **your Gmail in lowercase**, then click **Publish**.
5. **Get your app settings:** click the ⚙ gear, then **Project settings**. Under **Your apps**, click the **Web** icon `</>`, name it `Badminton app` and click **Register**. Keep the `firebaseConfig` values on screen; you'll need them in Part B.

## Part B: GitHub Pages (hosting)

1. Go to https://github.com and sign up with your personal Gmail. Choose a username, which becomes part of the link.
2. Click **+ → New repository**. Name it `badminton`, set it to **Public**, tick **Add a README file**, and click **Create repository**.
3. Click **Add file → Upload files**. Select **all the files in this package** (they're all in one folder, with no subfolders), then click **Commit changes**.
4. **Paste your Firebase settings:** in the repository, click **config.js**, then the ✏ pencil icon. Replace every `PASTE_...` value with the matching value from Part A step 5, and set `OWNER_EMAIL` to your Gmail. Click **Commit changes**.
5. **Switch on hosting:** go to **Settings → Pages**. Under "Build and deployment", set **Source: Deploy from a branch**, **Branch: main**, folder **/(root)**, and click **Save**.
6. After a minute or two, the page shows your link: **`https://YOURNAME.github.io/badminton/`**.

## Part C: Connect the two

1. Back in Firebase, go to **Authentication → Settings → Authorized domains → Add domain**.
2. Type **`YOURNAME.github.io`**, without `https://` or `/badminton`, and click **Add**.

## Part D: Start using it

1. Open your link on your phone and tap **Organiser sign-in**, using your Gmail. You're the **Admin**.
2. Tap **Load the final fixtures**. All 72 league matches and the knockouts appear.
3. In the **People** tab, add each organiser's Gmail as **Scorer** or **Admin**.
4. **Install on phones:**
   - **Android (Chrome):** ⋮ menu, then **Install app**.
   - **iPhone (Safari):** **Share**, then **Add to Home Screen**.
5. Post the link in the WhatsApp group. Viewers don't need to sign in.

**iPhone organisers:** if Google sign-in doesn't come back to the installed app, sign in once by opening the link in **Safari** itself and score from there. Viewing works fine in the installed app.

---

## Using it
- **Enter a result:** tap the match, type both scores and tap **Save**. Every phone updates within seconds.
- **Scorer tab:** tap a team's side for each point. It shows "Change ends" at 15 and ends at 30 (league), or plays best of three to 15 (knockouts). Then tap **Save result for everyone**.
- **Reschedule (Admin):** tap the match and change the day, time or court. The app checks for clashes, offers swaps, and logs every change with who made it.
- **Weak signal:** results entered offline sync automatically when the connection returns.

## Changing the app later
Edit a file in GitHub (✏ pencil, then **Commit changes**). The site updates in a minute or two, and your results stay safe in Firebase.

## If something goes wrong
- **"You don't have permission":** your Gmail must match exactly, in lowercase, in the Firestore Rules, `config.js` and the People tab.
- **Sign-in error "unauthorized domain":** recheck Part C.
- **Page shows "Demo mode":** `config.js` still has `PASTE_...` values.
