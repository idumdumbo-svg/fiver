# Deploying Fiver to GitHub Pages

One-time setup, then every push to `main` deploys itself.

---

## 1. Create the repo

On **github.com** → **New repository** → name it `fiver` → **Public** →
**don't** add a README or `.gitignore`, this folder already has them →
**Create**.

**It has to be public.** On GitHub's free plan, Pages only serves public
repositories — a private one prompts you to start a Pro trial. There's nothing
worth hiding in here: no keys, no personal data, and your spending never leaves
your browser. If you'd rather keep the code private, use Cloudflare Pages
instead, which doesn't care about repo visibility.

## 2. Push this folder

Either way works. GitHub Desktop is easier the first time because it handles
sign-in for you.

### With GitHub Desktop

1. Extract the zip somewhere that **isn't** inside OneDrive, Dropbox or
   Creative Cloud — a synced folder fighting with git causes file-lock errors.
   `C:\Users\<you>\fiver` is fine. Check the files sit directly inside that
   folder, not in a second folder nested within it.
2. GitHub Desktop → **File → Add local repository…** → pick the folder.
   It'll say the directory isn't a git repository; click the
   **create a repository** link in that message.
3. In the dialog: Name `fiver`, **Git ignore: None** (this folder already has
   one — adding another creates a mess), License None → **Create repository**.
4. Every file shows up as a change. Summary: `Fiver: round-up spending tracker`
   → **Commit to main**.
5. **Publish repository** in the top bar → keep the name `fiver` →
   **untick "Keep this code private"** → **Publish repository**.

If Desktop shows thousands of files to commit, `node_modules` is being picked
up — make sure `.gitignore` is present in the folder before you commit.

### With the command line

From inside the unzipped folder:

```bash
git init
git add .
git commit -m "Fiver: round-up spending tracker"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/fiver.git
git push -u origin main
```

If git asks for a password, it wants a personal access token, not your account
password — GitHub stopped accepting passwords over HTTPS. Either use GitHub
Desktop instead, or install the GitHub CLI and run `gh auth login`.

## 3. Turn Pages on

Repo → **Settings** → **Pages** → under *Build and deployment*, set
**Source: GitHub Actions**.

That's the important bit. The default is "Deploy from a branch", which would
serve the raw repo instead of the built site.

## 4. Watch the first run

Repo → **Actions** → the *Build, test and deploy* run. It installs Chromium,
builds, runs all three test suites, and only then publishes. Two to three
minutes the first time.

Your URL: **`https://YOUR-USERNAME.github.io/fiver/`**

The trailing slash matters. Everything in the app uses relative paths, so
serving from a subfolder is fine.

---

## 5. On your phone — do this the same day

1. Open the URL in **Safari**.
2. **Share** → **Add to Home Screen**.
3. Open it from the home screen icon, go to **Setup → Keep it on your phone**,
   and check it says *Storage is protected*.
4. **Setup → Export backup** once, so you know where that lives.

Step 2 is the one that matters. An uninstalled site can have its data cleared by
Safari after about a week of not being opened. Installed web apps get durable
storage, open fullscreen, and work with no signal.

---

## Making changes later

Drop the new files into the folder, overwriting what's there. Then:

- **GitHub Desktop** — the changed files appear automatically. Write a summary,
  **Commit to main**, then **Push origin**.
- **Command line** — `git add -A && git commit -m "what changed" && git push`

CI rebuilds, re-runs the tests, redeploys. If a test fails, nothing ships — the
old version stays live. The service worker is stamped with a fresh version each
build, so an already-installed copy on your phone notices and offers a
**Reload** toast instead of silently serving stale code.

To check a change before pushing: `npm run build && npm test`.

---

## If something goes wrong

**Actions run fails on `npx playwright install`** — usually a transient runner
issue. Re-run the job.

**Page loads but is unstyled, or 404s on `sw.js`** — Pages Source is still set
to "Deploy from a branch". Fix it in Settings → Pages.

**GitHub asks you to start a trial** — the repo is private. Settings → scroll to
*Danger Zone* → **Change repository visibility** → make it public. Free Pages
needs a public repo.

**Changes don't appear on your phone** — the installed copy is serving its
cache. It should offer a Reload toast within a few seconds of opening; if not,
close the app fully and reopen.

**"Storage is protected" never appears** — you're running the browser tab, not
the installed app. Add to Home Screen and open it from there.

---

## Custom domain (optional, ~$15–30/yr)

Repo → Settings → Pages → **Custom domain**, then point a `CNAME` record at
`YOUR-USERNAME.github.io`. GitHub provisions the certificate.

Before buying a name: **Fiverr** is a large, well-defended trademark and app
stores are conservative about near-identical names even in unrelated
categories. Worth ten minutes on the IPONZ trade mark search first. Fine to keep
using the name for yourself either way.
