# GitHub Handoff — First Commit and Push

A step-by-step guide to put this project on GitHub **yourself**, from your own
machine. Nothing in this repository is connected to a remote yet, and this
guide avoids anything destructive (no force pushes, no history rewrites).

Current Git state (verified 2026-10-16):

- There is a Git repository at `C:\Users\justi\.git` (your home directory), but
  it is **empty** — zero commits, zero tracked files, no remotes. Nothing to
  preserve or lose.
- Git 2.54 (Windows) is installed; your identity is configured
  (`user.name` / `user.email` are set — no action needed).
- The project has a `.gitignore` already prepared. No files are tracked yet.

Because the home-directory repo is empty, initializing Git **inside the
project folder** is safe: the new repo is independent, and it shadows the
parent one for everything under the project. That is the recommended path
below.

---

## 1. Create the GitHub repository

1. On github.com: **New repository**.
2. Name it (e.g. `smb-website-design-program`).
3. Set visibility to **Private** — preview tooling and docs are business
   material; keep it private until you decide otherwise.
4. **Do NOT initialize with a README, .gitignore, or license.** You are
   starting from an existing local project — any file GitHub creates becomes
   a commit on the remote that your local history does not have, and your
   first push will be rejected (non-fast-forward).
5. Do not add a remote to your local repo yet — copy the repository URL after
   creating it. You'll use it in step 5.

## 2. Initialize Git in the project (one time)

Open PowerShell or CMD:

```bat
cd C:\Users\justi\Workspace\smb_website_design_program
git init
```

`init.defaultbranch` on this machine is `master`; step 6 renames the branch
to `main` before pushing, so nothing else is needed now.

> Alternative (not recommended): track the project from the existing home
> repo at `C:\Users\justi`. That repo is empty today, but committing from
> `C:\Users\justi` would scope the repo to your whole home directory — paths
> like `Workspace/smb_website_design_program/...`, plus home-directory files
> drifting into every `git status`. An independent repo in the project folder
> keeps the boundary clean.

## 3. Inspect what would be tracked (before staging)

```bat
git status
```

Expected: everything under the project listed as untracked **except** the
ignored paths (`dist\`, `records\`, `.workshop\`, `plans\`, which should not
appear at all).

List the exact candidate files:

```bat
git ls-files --others --exclude-standard
```

Verify the ignore rules do what they claim — every path below should echo
the rule that matched (a rule line per path means it IS ignored):

```bat
git check-ignore -v dist\previews records\smith-plumbing.json .workshop\context.md plans debug.log foo.private.json
```

And the inverse — these must **not** be ignored (prints nothing, exit code 1
is expected):

```bat
git check-ignore records\LOCAL-ONLY.md examples\preview-site.example.json
```

And confirm nothing is already tracked from before (expected: no output):

```bat
git ls-files
```

**Review the candidate list before going further.** It should contain only
source, tests, scripts, docs, and the two synthetic fixtures in `examples\`.
No `dist\`, no `records\`, no `.workshop\`, no `plans\`. If a real prospect
record ever appears in the list, stop — it belongs in `records\` (see
`records\LOCAL-ONLY.md`).

## 4. Stage and review the diff

```bat
git add .
git status
git diff --staged --stat
```

Skim `git status` once more: the staged set should match the candidate list
from step 3. (`git diff --staged` shows full content; `--stat` is usually
enough for a first commit.)

## 5. Commit, rename the branch, add the remote, push

```bat
git commit -m "Initial commit: Preview Site Generator MVP (template, wizard, generator, QA gate, indexing protection)"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

Replace `<your-username>` and `<your-repo-name>` with your values — nothing
else in the URL. Do **not** put a token in the URL; when pushing over HTTPS,
Git Credential Manager opens a browser sign-in and stores the credential in
Windows Credential Manager.

## 6. Verify on GitHub

Open the repository page and confirm:

- Present: `README.md`, `index.html`, `css\`, `js\`, `wizard\`, `scripts\`,
  `test\`, `docs\`, `examples\` (2 JSON fixtures), `src\`, `.gitignore`,
  `records\LOCAL-ONLY.md`.
- **Absent:** `dist\`, `records\*.json`, `.workshop\`, `plans\`, any
  `*.log`/temp files.

If `dist\` or `records\` content shows up, do not push more commits — open an
issue with yourself: remove the paths from tracking (and, if a private record
was pushed, rotate/remove it on GitHub Support as well, since history keeps
deleted files).

## 7. Branch protection (as available)

- If your plan supports rulesets/branch protection for private repos
  (GitHub Pro/Team): protect `main` — require a pull request, or at minimum
  **block force pushes and deletions**.
- If not available on your plan: skip it. As a solo developer the practical
  equivalent is convention — never `git push --force`, and keep `main` the
  only long-lived branch.

## Troubleshooting

- **`git push` rejected with `fetch first` / non-fast-forward on the first
  push:** the remote was created with a README/license/.gitignore after all.
  The safe fix is to recreate the repository on GitHub without those files
  and push again. (Force-pushing would also "work" — do not; it is the habit
  this guide is designed to avoid.)
- **`git push` asks for credentials repeatedly:** sign in through the
  Credential Manager browser prompt; check Windows Credential Manager for a
  `git:https://github.com` entry afterwards.
- **Wrong identity on the first commit:** set repo-local values before
  committing:
  ```bat
  git config user.name  "<your name>"
  git config user.email "<your email>"
  ```
  (Use the email you want visible on GitHub; a `users.noreply.github.com`
  address keeps your real one out of public history if the repo ever goes
  public.)

## Going forward

- Real prospect records → `records\` only (already ignored). Synthetic
  fixtures → `examples\` only.
- Never commit `dist\` — it is generated (and embeds record data).
- Commit early and often; feature branches for anything non-trivial.
