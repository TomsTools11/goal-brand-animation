# GOAL brand animation

A 45 second, self-contained HTML explainer of how a GOAL campaign works: paid clicks, clicks that become leads, and leads that completed the agency's full form.

## Layout

- `src/` is the source: `index.html`, `styles.css`, `main.js`. The logos are referenced by relative path to the PNGs at the repo root.
- `assets/` holds pre-resized copies of the logos that the build inlines, so the build runs the same on macOS and on Vercel.
- `build.mjs` inlines the CSS, JS and logos into single-file pages:
  - `dist/goal-explainer.html`, the full player with controls and captions
  - `dist/goal-explainer-autoplay.html`, the clean version with no controls and no captions
  - `public/index.html` and `public/player.html`, the deploy output (clean build at the root, full player at `/player`)
- `dist/goal-explainer-shot-list.md` is the shot list for rebuilding the piece as video.
- `dist/screenshots/` holds the verification captures.

## Build

```bash
node build.mjs
```

No dependencies. Node 20 or newer.

## Deploy

The repo is set up for Vercel as a static site: `vercel.json` runs `node build.mjs` and serves `public/`. The clean autoplay build is the site root. The full player is at `/player`. Either page also accepts `?controls=0` and `?captions=0` in the URL.

## Mobile

The stage is designed twice: landscape 1920 by 1080 and portrait 1080 by 1920. The player picks the one that matches the viewport's orientation and switches live on rotation, re-measuring every travel path for the new layout. Screens narrower than 700px show icon-only controls.

## Playback

Space plays or pauses. Left and Right arrows step between scenes. R replays. C toggles captions. The progress segments at the top are clickable. With `prefers-reduced-motion` the piece does not auto-advance and shows each scene in its final state with Previous and Next.

## Copy and brand rules

The copy is final. Twelve words or fewer per on-screen beat, no dashes, no hype words, no "cost per lead". The only figure in the piece is "6 in 10". Paid marks belong to clicks, never to leads.
