# Open Source Status

Short version: **this project is already open source.** There is nothing to apply to and
no authority to register with. "Open source" is a property of the licence you attach to
the code, not a status somebody grants you.

Verified 2026-08-14 against the GitHub API.

## What makes it open source

| Requirement | State |
|---|---|
| Source publicly readable | ✅ `visibility: public` on `github.com/CarlosFranzetti/rekordbox-explorer` |
| An OSI-approved licence, in the repo | ✅ `LICENSE` — MIT, © 2026 Carlos Franzetti |
| GitHub detects and displays it | ✅ API reports `license.spdx_id: "MIT"` |
| Anyone may fork | ✅ `allow_forking: true` |

Those four are the whole test. A public repo with **no** licence file is *not* open source —
default copyright applies and nobody may legally reuse it. That is the single most common
mistake, and this repo does not make it.

## There is nothing to apply to

- **The OSI** approves *licence texts*, not projects. MIT was approved decades ago. You
  inherit that approval by using it; you never file anything.
- **The FSF** publishes a licence list. Same deal — no registration.
- **SPDX** is an identifier registry for licences (`MIT`), not a project directory.
- **A foundation** (Linux Foundation, Apache, Software Freedom Conservancy) is a
  *governance and fiscal-host* option for projects that want donations handled, trademarks
  held, and neutral ownership. It is a real thing you apply to, it takes months, and it is
  irrelevant at this scale. Skip it.

Anything charging a fee to "certify" or "register" your open-source project is a scam.

## Why MIT was the right pick here

MIT is permissive: anyone may use, modify, and ship the code, including commercially,
provided they keep the copyright notice. That suits a tool whose whole point is that DJs
and other developers can read it and trust it.

The alternative worth knowing: **AGPL-3.0** would force anyone who runs a modified version
as a network service to publish their changes. Relevant if you ever fear a competitor
hosting a closed fork of the editor. Changing licence later is possible while you are the
sole copyright holder — it gets hard once outside contributors hold copyright in merged
code, which is what a CLA or DCO exists to manage. Not needed yet.

## Housekeeping that makes it a *good* open-source project

Legally optional, practically what separates a usable project from a code dump.

Already done:

- `README.md` — what it is, how to run it
- `CONTRIBUTING.md` — how to get changes in
- `SECURITY.md` — how to report a vulnerability privately
- `PRIVACY.md` — what leaves the browser (page views only)
- `LICENSE` — MIT
- `package.json` carries `license`, `repository`, `homepage`, `bugs`

Note on `"private": true` in `package.json`: that flag only tells npm "never publish this
to the registry." It has nothing to do with the licence or repo visibility, and it is
correct for an app that ships as a website rather than as a package.

Still open:

- [ ] **Repo topics** — discoverability. Commands in `docs/TOPICS.md`.
- [ ] **Social preview image** — upload `public/og-image.png` under
      *Settings → General → Social preview*. GitHub does not read the `og:image` meta tag.
- [ ] **`CODE_OF_CONDUCT.md`** — GitHub will add the Contributor Covenant for you from
      *Insights → Community Standards*. Matters once strangers start filing issues.
- [ ] **Third-party attribution.** The `.pdb` format knowledge in this repo comes from
      other people's reverse engineering — Deep Symmetry's crate-digger (Kaitai spec),
      @henrybetts, @flesniak. None of it obliges us to anything (facts about a file format
      are not copyrightable), but crediting it in the README is both honest and how you
      stay welcome in that community. Partially done in `research_playlistHelp.md`; should
      be visible from the README too.
- [ ] **Release tags.** Cutting a `v0.2.0` tag and a GitHub Release gives people something
      citable and makes the changelog real.

## What being public does *not* mean

The GitHub repo is public. Whether the **deployed app** is reachable by a stranger is a
completely separate switch — Vercel Deployment Protection, not GitHub visibility. The
`for-later` preview is definitely gated behind Vercel SSO; production's status needs a
thirty-second check in an incognito window. See `memorystate.md` §1b.
