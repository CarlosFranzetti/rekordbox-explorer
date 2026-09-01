# GitHub repository topics

Topics are how people find this. The set below covers the three ways someone would search:
the hardware (`cdj`, `pioneer-dj`), the file format (`pdb`, `devicesql`), and the job
(`dj-tools`, `playlist-manager`).

## Set them with the `gh` CLI

One command, replaces the current set:

```bash
gh repo edit CarlosFranzetti/rekordbox-explorer \
  --add-topic rekordbox \
  --add-topic dj \
  --add-topic dj-tools \
  --add-topic pioneer-dj \
  --add-topic alphatheta \
  --add-topic cdj \
  --add-topic cdj-3000 \
  --add-topic xdj \
  --add-topic pdb \
  --add-topic devicesql \
  --add-topic binary-parser \
  --add-topic reverse-engineering \
  --add-topic file-system-access-api \
  --add-topic local-first \
  --add-topic no-backend \
  --add-topic playlist-manager \
  --add-topic music-library \
  --add-topic usb \
  --add-topic react \
  --add-topic typescript
```

Also worth setting the description and homepage while you're there:

```bash
gh repo edit CarlosFranzetti/rekordbox-explorer \
  --description "Open your rekordbox USB in a browser. Browse it, audition tracks, rescue a drive that died, print setlists. No uploads, no installs." \
  --homepage "https://rekordbox-explorer.vercel.app"
```

## Or via the REST API

```bash
gh api -X PUT repos/CarlosFranzetti/rekordbox-explorer/topics \
  -f 'names[]=rekordbox' -f 'names[]=dj' -f 'names[]=dj-tools' \
  -f 'names[]=pioneer-dj' -f 'names[]=alphatheta' -f 'names[]=cdj' \
  -f 'names[]=cdj-3000' -f 'names[]=xdj' -f 'names[]=pdb' \
  -f 'names[]=devicesql' -f 'names[]=binary-parser' \
  -f 'names[]=reverse-engineering' -f 'names[]=file-system-access-api' \
  -f 'names[]=local-first' -f 'names[]=no-backend' \
  -f 'names[]=playlist-manager' -f 'names[]=music-library' \
  -f 'names[]=usb' -f 'names[]=react' -f 'names[]=typescript'
```

## Or in the browser

Repo home → the ⚙️ next to **About** → **Topics**.

## Why these

| Topic | Who finds you |
|---|---|
| `rekordbox`, `pioneer-dj`, `alphatheta`, `cdj`, `cdj-3000`, `xdj` | DJs searching by their gear — the largest audience |
| `pdb`, `devicesql`, `binary-parser`, `reverse-engineering` | Developers looking for a format implementation. Small but high-value: these are your contributors |
| `dj`, `dj-tools`, `playlist-manager`, `music-library`, `usb` | The job-to-be-done |
| `local-first`, `no-backend`, `file-system-access-api` | The architecture, and a real differentiator |
| `react`, `typescript` | Stack filters |

GitHub allows 20 topics. This is exactly 20.

Deliberately omitted: `vite`, `tailwindcss`, `shadcn-ui` — build-tool topics attract
scaffolding traffic, not users, and they would cost slots that `pdb` and `cdj` earn back.
