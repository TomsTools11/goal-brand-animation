/* GOAL explainer. One master clock drives every scene. */

const CONFIG = {
  ctaText: "Talk with your GOAL team",
  controls: true,  // false hides the control bar so the piece just plays (keys and progress segments still work)
  captions: true   // false starts with the caption bar hidden (C still toggles it)
};

(function () {
  'use strict';

  // ---------- Easing ----------
  const E = {
    linear: p => p,
    out: p => 1 - Math.pow(1 - p, 3),
    outQuint: p => 1 - Math.pow(1 - p, 5),
    inOut: p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    inQuad: p => p * p,
    pulse: p => Math.sin(p * Math.PI)
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  // ---------- DOM ----------
  const stageWrap = q('#stage-wrap');
  const stage = q('#stage');
  const sceneEls = qa('.scene');
  const captionEl = q('#caption');
  const segs = qa('.seg');
  const replayInline = q('#replay-inline');
  const btn = {
    prev: q('#btn-prev'), play: q('#btn-play'), playText: q('#btn-play-text'), next: q('#btn-next'),
    replay: q('#btn-replay'), captions: q('#btn-captions'), scroll: q('#btn-scroll')
  };
  q('#cta').textContent = CONFIG.ctaText;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scale = 1;
  // Two stage designs: landscape 1920 by 1080, portrait 1080 by 1920 for phones held upright.
  let STAGE_W = 1920, STAGE_H = 1080, orient = 'landscape';

  // ---------- Track helpers ----------
  // A track is {t0, dur, ease, apply(p)}. Base CSS is the final state; tracks
  // are applied in order once their start time has passed, so later tracks
  // override earlier ones. On scene entry, tracks are applied at p = 0 in
  // reverse order, which leaves every element in its first track's start state.
  function tr(t0, dur, ease, apply) { return { t0: t0, dur: dur, ease: ease, apply: apply }; }
  function loop(t0, t1, period, apply, finalPhase) {
    return { loop: true, t0: t0, t1: t1, period: period, apply: apply, finalPhase: finalPhase };
  }
  function setXf(el, x, y, s) {
    el.style.transform = 'translate(' + (x || 0).toFixed(2) + 'px,' + (y || 0).toFixed(2) + 'px)' + (s == null ? '' : ' scale(' + s.toFixed(4) + ')');
  }
  function rise(el, t0, dur, dy) {
    dur = dur || 450; dy = dy == null ? 12 : dy;
    return tr(t0, dur, E.out, function (p) { el.style.opacity = p; el.style.transform = 'translateY(' + ((1 - p) * dy).toFixed(2) + 'px)'; });
  }
  function fadeOut(el, t0, dur, dy) {
    dur = dur || 350; dy = dy == null ? -10 : dy;
    return tr(t0, dur, E.out, function (p) { el.style.opacity = 1 - p; el.style.transform = 'translateY(' + (p * dy).toFixed(2) + 'px)'; });
  }
  function fade(el, t0, dur) {
    dur = dur || 450;
    return tr(t0, dur, E.out, function (p) { el.style.opacity = p; });
  }
  function stagger(els, t0, gap, dur, dy) {
    return els.map(function (el, i) { return rise(el, t0 + i * (gap || 80), dur, dy); });
  }
  // Quadratic arc from offset `from` to offset `to`, lifted by `lift` px at the midpoint.
  function arcPoint(from, to, lift, p) {
    const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2 - lift;
    const u = 1 - p;
    return { x: u * u * from.x + 2 * u * p * cx + p * p * to.x, y: u * u * from.y + 2 * u * p * cy + p * p * to.y };
  }
  function count(el, t0, from, to) {
    return tr(t0, 320, E.out, function (p) {
      el.textContent = p > 0 ? String(to) : String(from);
      el.style.transform = 'scale(' + (1 + 0.08 * (1 - p)).toFixed(4) + ')';
    });
  }
  function draw(path, t0, dur) {
    dur = dur || 420;
    return tr(t0, dur, E.out, function (p) { path.style.strokeDashoffset = (1 - p).toFixed(4); });
  }
  function mixBlueToGray(p) {
    // primary blue to dim gray, for clicks that never submit the form
    const a = [5, 123, 229], b = [71, 85, 105];
    return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * p); }).join(',') + ')';
  }
  function typeText(el, t0, dur, text) {
    return tr(t0, dur, E.linear, function (p) {
      const n = Math.round(p * text.length);
      el.textContent = text.slice(0, n);
      el.classList.toggle('is-focus', p > 0 && p < 1);
    });
  }

  // Geometry in stage pixels (viewport rect divided by the current scale).
  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2) / scale, y: (r.top + r.height / 2) / scale };
  }
  function size(el) {
    const r = el.getBoundingClientRect();
    return { w: r.width / scale, h: r.height / scale };
  }
  function delta(fromEl, toEl) {
    const a = center(fromEl), b = center(toEl);
    return { x: a.x - b.x, y: a.y - b.y };
  }
  // A point inside an element at fractions (fx, fy) of its box, in stage pixels.
  function pointIn(el, fx, fy) {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width * fx) / scale, y: (r.top + r.height * fy) / scale };
  }
  // Pin an absolutely positioned helper (tap ripple, flying chip, cursor) to a stage point inside a parent.
  function pinAt(el, pt, parentEl) {
    const pr = parentEl.getBoundingClientRect();
    el.style.left = (pt.x - pr.left / scale).toFixed(2) + 'px';
    el.style.top = (pt.y - pr.top / scale).toFixed(2) + 'px';
  }
  function pinTo(el, targetEl, parentEl) { pinAt(el, center(targetEl), parentEl); }
  // Cursor travel: from offset `from` to offset `to` on a shallow arc, ease in-out.
  function cursorMove(cursor, t0, dur, from, to) {
    return tr(t0, dur, E.inOut, function (p) { const pt = arcPoint(from, to, 24, p); setXf(cursor, pt.x, pt.y, 1); });
  }
  function cursorPress(cursor, t0, at) {
    return tr(t0, 240, E.out, function (p) { setXf(cursor, at.x, at.y, 1 - 0.15 * E.pulse(p)); });
  }
  function tapTracks(tap, t0) {
    const dot = q('.tap-dot', tap), ring = q('.tap-ring', tap);
    return [
      tr(t0, 220, E.out, function (p) { dot.style.opacity = p; setXf(dot, 0, 0, 0.4 + 0.6 * p); }),
      tr(t0 + 40, 700, E.out, function (p) { ring.style.opacity = p <= 0 ? 0 : (1 - p) * 0.6; setXf(ring, 0, 0, 0.25 + 0.95 * p); }),
      tr(t0 + 900, 300, E.out, function (p) { dot.style.opacity = 1 - p; setXf(dot, 0, 0, 1 - 0.4 * p); })
    ];
  }

  // ---------- Scenes ----------
  const SCENES = [
    {
      id: 'intro', durationMs: 5000, theme: 'navy',
      captions: [{ at: 0, text: 'How your GOAL campaign works.' }],
      build: function (root) {
        const mark = q('.mark', root), ringA = q('.ring-a', root), ringB = q('.ring-b', root), h = q('.beat', root);
        function ringApply(ring, base) {
          return function (ph, on) {
            ring.style.opacity = on ? ((1 - ph) * base).toFixed(3) : 0;
            setXf(ring, 0, 0, 1 + ph * 1.0);
          };
        }
        return [
          tr(0, 900, E.out, function (p) { mark.style.opacity = p; setXf(mark, 0, 0, 0.92 + 0.08 * p); }),
          loop(500, 5000, 2400, ringApply(ringA, 0.45), 0.25),
          loop(1700, 5000, 2400, ringApply(ringB, 0.45), 0.6),
          rise(h, 1100, 600, 14)
        ];
      }
    },
    {
      id: 'ad', durationMs: 8000, theme: 'light',
      captions: [
        { at: 0, text: 'Your branded ad runs in digital campaigns.' },
        { at: 1500, text: 'Your ad takes the top result on desktop and phone.' },
        { at: 3800, text: 'You pay GOAL for each click.' },
        { at: 4600, text: 'A click on either screen adds one paid click.' }
      ],
      build: function (root) {
        const eb = q('.eyebrow', root), beatA = q('.beat-a', root), beatB = q('.beat-b', root);
        const panel = q('.counter-panel', root), num = q('#s2-num'), duo = q('.duo', root);
        const desktop = q('#s2-desktop'), phone = q('#s2-phone');
        const devices = [
          { ad: q('#s2-ad-d'), rows: qa('#s2-desktop .result'), btn: q('#s2-btn-d'), tap: q('#s2-tap-d'), fly: q('#s2-fly-d'), adAt: 1500, gap: 20 },
          { ad: q('#s2-ad-p'), rows: qa('#s2-phone .result'), btn: q('#s2-btn-p'), tap: q('#s2-tap-p'), fly: q('#s2-fly-p'), adAt: 1650, gap: 16 }
        ];
        const cursor = q('#s2-cursor');
        const tracks = [rise(eb, 0), rise(beatA, 80), rise(desktop, 160, 600, 16), rise(phone, 280, 600, 16), rise(panel, 240)];
        devices.forEach(function (d) {
          const shift = size(d.ad).h + d.gap;
          pinTo(d.tap, d.btn, duo);
          pinTo(d.fly, d.btn, duo);
          d.toNum = delta(num, d.fly);
          d.rows.forEach(function (r, i) {
            tracks.push(tr(500 + i * 90, 450, E.out, function (p) { r.style.opacity = p; setXf(r, 0, -shift + (1 - p) * 10); }));
          });
          tracks.push(tr(d.adAt, 650, E.inOut, function (p) { d.ad.style.opacity = Math.min(1, p * 1.6); setXf(d.ad, 0, -30 * (1 - p), 0.98 + 0.02 * p); }));
          d.rows.forEach(function (r) {
            tracks.push(tr(d.adAt, 650, E.inOut, function (p) { setXf(r, 0, -shift * (1 - p)); }));
          });
        });
        tracks.push(fadeOut(beatA, 3450), rise(beatB, 3800));
        // Desktop: the cursor arrives from the lower right and clicks the ad button.
        pinAt(cursor, pointIn(devices[0].btn, 0.56, 0.5), duo);
        const cFrom = { x: 230, y: 200 };
        tracks.push(tr(3900, 260, E.out, function (p) { cursor.style.opacity = p; setXf(cursor, cFrom.x, cFrom.y, 1); }));
        tracks.push(cursorMove(cursor, 4000, 750, cFrom, { x: 0, y: 0 }));
        tracks.push(cursorPress(cursor, 4750, { x: 0, y: 0 }));
        function clickCycle(d, t0, from, to) {
          tracks.push.apply(tracks, tapTracks(d.tap, t0));
          tracks.push(tr(t0 + 300, 950, E.inOut, function (p) {
            const pt = arcPoint({ x: 0, y: 0 }, d.toNum, 140, p);
            d.fly.style.opacity = p < 0.12 ? p / 0.12 : (p > 0.86 ? (1 - p) / 0.14 : 1);
            d.fly.style.transform = 'translate(-50%,-50%) translate(' + pt.x.toFixed(2) + 'px,' + pt.y.toFixed(2) + 'px) scale(' + (0.7 + 0.3 * Math.min(1, p * 4)).toFixed(3) + ')';
          }));
          tracks.push(count(num, t0 + 1200, from, to));
        }
        clickCycle(devices[0], 4750, 0, 1);
        clickCycle(devices[1], 5700, 1, 2);
        return tracks;
      }
    },
    {
      id: 'leads', durationMs: 12000, theme: 'light',
      captions: [
        { at: 0, text: 'About 6 in 10 clicks become leads, on average.' },
        { at: 1400, text: 'Ten paid clicks travel to your form.' },
        { at: 7100, text: 'Every click is paid, lead or not.' }
      ],
      build: function (root) {
        const eb = q('.eyebrow', root), beatA = q('.beat-a', root), beatB = q('.beat-b', root);
        const ratio = q('.ratio', root), num = q('#s3-num'), clicksRow = q('.clicks-row', root);
        const form = q('#s3-form'), submit = q('#s3-submit');
        const labels = qa('.col-groups .group-label', root), faces = qa('.card-face', root), cards = qa('.lead-card', root);
        const slots = qa('.slot', root);
        const leadDots = qa('.dot.click[data-kind="lead"]', root), noneDots = qa('.dot.click[data-kind="none"]', root);
        const order = ['L', 'L', 'N', 'L', 'L', 'N', 'L', 'N', 'L', 'N'];
        const tracks = [rise(eb, 0), rise(beatA, 80), rise(ratio, 160), rise(clicksRow, 240), rise(form, 320, 500), rise(labels[0], 400), rise(labels[1], 480)];
        let li = 0, ni = 0, leads = 0;
        order.forEach(function (kind, k) {
          const dot = kind === 'L' ? leadDots[li++] : noneDots[ni++];
          const card = kind === 'L' ? cards[li - 1] : null;
          const face = kind === 'L' ? faces[li - 1] : null;
          const slot = slots[k];
          const fromSlot = delta(slot, dot);
          const atForm = delta(submit, dot);
          atForm.y -= 60;
          const start = 1000 + k * 520;
          // The dot waits on its receipt slot, then travels to the form and on to its group.
          tracks.push(tr(start, 620, E.inOut, function (p) {
            const pt = arcPoint(fromSlot, atForm, 90, p); setXf(dot, pt.x, pt.y, 1);
          }));
          tracks.push(draw(q('path', slot), start + 80, 350));
          if (kind === 'L') {
            tracks.push(tr(start + 580, 320, E.out, function (p) { setXf(submit, 0, 0, 1 + 0.05 * E.pulse(p)); }));
          }
          const lift2 = kind === 'L' ? 50 : -190;  /* leads arc up to the stack, others dip well below it */
          tracks.push(tr(start + 640, 560, E.out, function (p) {
            const pt = arcPoint(atForm, { x: 0, y: 0 }, lift2, p); setXf(dot, pt.x, pt.y, 1);
          }));
          const arrive = start + 1180;
          if (kind === 'L') {
            const n = ++leads;
            const lines = qa('.sk', card);
            tracks.push(tr(arrive - 60, 420, E.out, function (p) {
              face.style.opacity = p; setXf(face, 0, 0, 0.6 + 0.4 * p);
              lines.forEach(function (l) { l.style.opacity = p; });
            }));
            tracks.push(count(num, arrive + 60, n - 1, n));
          } else {
            tracks.push(tr(arrive, 500, E.out, function (p) { dot.style.backgroundColor = p >= 1 ? '' : mixBlueToGray(p); }));
          }
          // Beat B: the receipts pulse once, in order, to say every click was paid.
          tracks.push(tr(7300 + k * 60, 520, E.out, function (p) { setXf(slot, 0, 0, 1 + 0.12 * E.pulse(p)); }));
        });
        tracks.push(fadeOut(beatA, 6750), rise(beatB, 7100));
        return tracks;
      }
    },
    {
      id: 'lead', durationMs: 12000, theme: 'light',
      captions: [
        { at: 0, text: 'Every lead saw your ad.' },
        { at: 900, text: 'Shoppers fill in your form on a phone or desktop.' },
        { at: 4750, text: 'Then completed your full form, often on a phone.' },
        { at: 6900, text: 'Each lead lands in your inbox.' },
        { at: 9000, text: 'Rarely, a shopper mistypes a detail or enters false info.' }
      ],
      build: function (root) {
        const eb = q('.eyebrow', root), beatA = q('.beat-a', root), beatB = q('.beat-b', root);
        const desktop = q('#s4-desktop'), phone = q('#s4-phone'), inbox = q('.inbox', root), duo = q('.duo', root);
        const fieldsP = qa('#s4-phone .f-input'), fieldsD = qa('#s4-desktop .f-input');
        const submitP = q('#s4-submit-p'), submitD = q('#s4-submit-d');
        const tapP = q('#s4-tap-p'), tapD = q('#s4-tap-d'), cursor = q('#s4-cursor');
        const cardP = q('#s4-card-p'), cardD = q('#s4-card-d');
        const checks = qa('.check-item', root), foot = q('#s4-foot'), under = q('#s4-under');
        pinTo(tapP, submitP, duo);
        pinTo(tapD, submitD, duo);
        const fromP = delta(submitP, cardP), fromD = delta(submitD, cardD);
        const tracks = [rise(eb, 0), rise(beatA, 80), rise(desktop, 160, 600, 16), rise(phone, 280, 600, 16), rise(inbox, 4900, 500)];
        // Phone: fields type in one by one.
        const timesP = [[700, 850], [1650, 950], [2700, 900], [3700, 650]];
        fieldsP.forEach(function (f, i) { tracks.push(typeText(f, timesP[i][0], timesP[i][1], f.getAttribute('data-value'))); });
        // Desktop: the cursor clicks into each field before it fills.
        const targets = fieldsD.map(function (f) { return pointIn(f, 0.18, 0.5); }).concat([pointIn(submitD, 0.5, 0.5)]);
        pinAt(cursor, targets[0], duo);
        const rel = targets.map(function (t) { return { x: t.x - targets[0].x, y: t.y - targets[0].y }; });
        const cFrom = { x: 260, y: 220 };
        tracks.push(tr(600, 260, E.out, function (p) { cursor.style.opacity = p; setXf(cursor, cFrom.x, cFrom.y, 1); }));
        const moveAt = [700, 1850, 3050, 4150], typeDur = [800, 850, 800, 520];
        fieldsD.forEach(function (f, i) {
          const from = i === 0 ? cFrom : rel[i - 1];
          tracks.push(cursorMove(cursor, moveAt[i], 350, from, rel[i]));
          tracks.push(cursorPress(cursor, moveAt[i] + 360, rel[i]));
          tracks.push(typeText(f, moveAt[i] + 440, typeDur[i], f.getAttribute('data-value')));
        });
        tracks.push(cursorMove(cursor, 5150, 350, rel[3], rel[4]));
        tracks.push(cursorPress(cursor, 5520, rel[4]));
        tracks.push(fadeOut(beatA, 4400), rise(beatB, 4750));
        // Submits: phone first, desktop a beat later.
        tracks.push(tr(5200, 260, E.out, function (p) { submitP.classList.toggle('is-pressed', p > 0 && p < 1); setXf(submitP, 0, 0, 1 - 0.03 * E.pulse(p)); }));
        tracks.push.apply(tracks, tapTracks(tapP, 5200));
        tracks.push(tr(5520, 260, E.out, function (p) { submitD.classList.toggle('is-pressed', p > 0 && p < 1); setXf(submitD, 0, 0, 1 - 0.03 * E.pulse(p)); }));
        tracks.push.apply(tracks, tapTracks(tapD, 5520));
        function flyCard(card, from, t0) {
          tracks.push(tr(t0, 950, E.inOut, function (p) {
            const pt = arcPoint(from, { x: 0, y: 0 }, 120, p);
            card.style.opacity = Math.min(1, p * 2.5);
            setXf(card, pt.x, pt.y, 0.35 + 0.65 * p);
          }));
        }
        flyCard(cardP, fromP, 5750);
        flyCard(cardD, fromD, 6150);
        checks.forEach(function (c, i) {
          const path = q('path', c), text = q('.check-text', c);
          const t0 = 7400 + i * 650;
          tracks.push(draw(path, t0, 450));
          tracks.push(rise(text, t0 + 60, 450, 8));
        });
        tracks.push(fade(foot, 9000, 700));
        tracks.push(tr(9000, 700, E.out, function (p) { under.style.setProperty('--ul', p.toFixed(3)); }));
        return tracks;
      }
    },
    {
      id: 'close', durationMs: 8000, theme: 'navy',
      captions: [
        { at: 0, text: 'You pay per click.' },
        { at: 1000, text: 'Clicks become leads.' },
        { at: 1700, text: 'Every lead saw your ad.' },
        { at: 4300, text: 'Your ads. Your leads. Your customers.' }
      ],
      build: function (root) {
        const items = qa('.recap-item', root), wm = q('.wordmark-white', root), tag = q('.tagline', root), cta = q('.cta', root);
        const tracks = [];
        items.forEach(function (it, i) {
          const t0 = 300 + i * 700;
          tracks.push(draw(q('path', it), t0, 450));
          tracks.push(rise(q('.recap-text', it), t0 + 60, 500, 10));
        });
        tracks.push(tr(3600, 800, E.out, function (p) { wm.style.opacity = p; setXf(wm, 0, 0, 0.96 + 0.04 * p); }));
        tracks.push(rise(tag, 4300, 500));
        tracks.push(rise(cta, 5000, 500));
        return tracks;
      }
    }
  ];

  const TOTAL = SCENES.reduce(function (s, sc) { return s + sc.durationMs; }, 0);
  const STARTS = SCENES.map(function (sc, i) { return SCENES.slice(0, i).reduce(function (s, x) { return s + x.durationMs; }, 0); });

  // ---------- Applying tracks ----------
  function applyAt(tracks, local) {
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (local < t.t0) continue;
      if (t.loop) {
        if (local >= t.t1) { t.apply(t.finalPhase, true); continue; }
        t.apply(((local - t.t0) % t.period) / t.period, true);
      } else {
        t.apply(t.ease(clamp((local - t.t0) / t.dur, 0, 1)));
      }
    }
  }
  function applyInitial(tracks) {
    for (let i = tracks.length - 1; i >= 0; i--) {
      const t = tracks[i];
      if (t.loop) t.apply(0, false); else t.apply(0);
    }
  }
  function applyFinal(tracks) {
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.loop) t.apply(t.finalPhase, true); else t.apply(1);
    }
  }
  function clearInline(root) {
    qa('[style]', root).forEach(function (el) { el.removeAttribute('style'); });
    qa('.is-focus, .is-pressed', root).forEach(function (el) { el.classList.remove('is-focus', 'is-pressed'); });
    qa('[data-value]', root).forEach(function (el) { el.textContent = el.getAttribute('data-value'); });
  }

  // ---------- Grid texture (same lattice as the site: 28px cells, a drifting blue highlight) ----------
  const gridCanvas = q('#grid');
  const grid = (function () {
    const ctx = gridCanvas.getContext('2d');
    const CELL = 28;
    let W = 1920, H = 1080, pts = [], segs = [], RADIUS = 0, R2 = 0, PUSH = 0;
    function resize(w, h) {
      W = w; H = h;
      gridCanvas.width = W; gridCanvas.height = H;
      const cols = Math.floor(W / CELL) + 2, rows = Math.floor(H / CELL) + 2;
      const ox = (W % CELL) / 2, oy = (H % CELL) / 2;
      const table = [];
      pts = []; segs = [];
      for (let r = 0; r < rows; r++) {
        table[r] = [];
        for (let c = 0; c < cols; c++) { const p = { x: ox + c * CELL, y: oy + r * CELL, b: 0, px: 0, py: 0 }; pts.push(p); table[r][c] = p; }
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) segs.push([table[r][c], table[r][c + 1]]);
        if (r + 1 < rows) segs.push([table[r][c], table[r + 1][c]]);
      }
      RADIUS = 0.28 * Math.max(W, H); R2 = RADIUS * RADIUS; PUSH = 0.05 * RADIUS;
    }
    resize(W, H);
    let pointer = null;
    function focusAt(ms) {
      if (pointer) return { x: pointer.x, y: pointer.y, s: 1 };
      const t = ms / 1000;
      return { x: W * (0.28 + 0.16 * Math.sin(0.21 * t)), y: H * (0.42 + 0.18 * Math.sin(0.13 * t + 1.2)), s: 0.5 };
    }
    function draw(ms) {
      const f = focusAt(ms);
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], dx = p.x - f.x, dy = p.y - f.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
        p.b = d2 < R2 ? Math.exp(-d2 / (0.45 * R2)) * f.s : 0;
        const l = d < RADIUS ? Math.sin(d / RADIUS * Math.PI) * f.s : 0;
        if (d > 0.5 && l > 0) { const k = PUSH * l; p.px = p.x + dx / d * k; p.py = p.y + dy / d * k; } else { p.px = p.x; p.py = p.y; }
      }
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      const lit = [];
      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i];
        if (sg[0].b + sg[1].b > 0.01) { lit.push(sg); continue; }
        ctx.moveTo(sg[0].px, sg[0].py); ctx.lineTo(sg[1].px, sg[1].py);
      }
      ctx.stroke();
      for (let i = 0; i < lit.length; i++) {
        const a = lit[i][0], b = lit[i][1], m = (a.b + b.b) / 2;
        ctx.strokeStyle = 'rgba(5,123,229,' + (0.05 + 0.5 * m).toFixed(3) + ')';
        ctx.lineWidth = 0.6 + 0.7 * m;
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], o = 0.1 + 0.8 * p.b, sz = 1 + 2.2 * p.b;
        ctx.fillStyle = 'rgba(' + Math.round(255 + (5 - 255) * p.b) + ',' + Math.round(255 + (123 - 255) * p.b) + ',' + Math.round(255 + (229 - 255) * p.b) + ',' + o.toFixed(2) + ')';
        ctx.fillRect(p.px - sz / 2, p.py - sz / 2, sz, sz);
      }
    }
    stage.addEventListener('pointermove', function (e) {
      const r = stage.getBoundingClientRect();
      pointer = { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
      if (!playing) draw(elapsed);
    });
    stage.addEventListener('pointerleave', function () { pointer = null; if (!playing) draw(elapsed); });
    stage.addEventListener('pointerup', function (e) { if (e.pointerType === 'touch') pointer = null; });
    stage.addEventListener('pointercancel', function () { pointer = null; });
    return { draw: draw, resize: resize };
  })();

  // ---------- Player state ----------
  let elapsed = 0, playing = false, raf = 0, last = 0, current = -1, ended = false, scrollMode = false;
  let captionShown = '';

  function setOrientation(next) {
    if (next === orient) return;
    orient = next;
    STAGE_W = next === 'portrait' ? 1080 : 1920;
    STAGE_H = next === 'portrait' ? 1920 : 1080;
    stage.setAttribute('data-orient', next);
    grid.resize(STAGE_W, STAGE_H);
    if (current >= 0) {
      // Rebuild the active scene so every travel path is measured against the new layout.
      const i = current;
      current = -1;
      if (reduced) showFinal(i); else render();
    }
  }
  function fit() {
    if (scrollMode) { scale = 1; return; }
    const r = stageWrap.getBoundingClientRect();
    setOrientation(r.height > r.width ? 'portrait' : 'landscape');
    scale = Math.min(r.width / STAGE_W, r.height / STAGE_H) || 1;
    stage.style.setProperty('--scale', scale.toFixed(5));
  }

  function enter(i) {
    sceneEls.forEach(function (root, k) {
      if (k !== i && root.classList.contains('is-active')) {
        root.classList.remove('is-active');
        clearInline(root);
      }
    });
    current = i;
    const sc = SCENES[i], root = sceneEls[i];
    root.classList.add('is-active');
    stage.setAttribute('data-theme', sc.theme);
    clearInline(root);
    sc.tracks = sc.build(root);
    applyInitial(sc.tracks);
    segs.forEach(function (s, k) { if (k === i) s.setAttribute('aria-current', 'true'); else s.removeAttribute('aria-current'); });
    captionShown = '';
  }

  function setCaption(text) {
    if (text === captionShown) return;
    captionShown = text;
    captionEl.textContent = text;
  }

  function render() {
    const i = sceneIndexAt(elapsed);
    if (i !== current) enter(i);
    const sc = SCENES[i], local = elapsed - STARTS[i];
    applyAt(sc.tracks, local);
    grid.draw(elapsed);
    let cap = sc.captions[0].text;
    for (let k = 0; k < sc.captions.length; k++) if (sc.captions[k].at <= local) cap = sc.captions[k].text;
    setCaption(cap);
    segs.forEach(function (s, k) {
      s.style.setProperty('--fill', clamp((elapsed - STARTS[k]) / SCENES[k].durationMs, 0, 1).toFixed(4));
    });
  }
  function sceneIndexAt(t) {
    for (let i = 0; i < SCENES.length; i++) if (t < STARTS[i] + SCENES[i].durationMs) return i;
    return SCENES.length - 1;
  }

  function tick(now) {
    if (!playing) return;
    const dt = clamp(now - last, 0, 100);   // rAF timestamps can trail performance.now(), never run the clock backwards
    last = now;
    elapsed += dt;
    if (elapsed >= TOTAL) { elapsed = TOTAL - 1; render(); finish(); return; }
    render();
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (reduced || scrollMode) return;
    if (ended) { elapsed = 0; current = -1; ended = false; replayInline.hidden = true; }
    playing = true;
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    updatePlayButton();
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    updatePlayButton();
  }
  function finish() {
    playing = false; ended = true;
    cancelAnimationFrame(raf);
    replayInline.hidden = false;
    updatePlayButton();
  }
  function updatePlayButton() {
    const label = ended ? 'Replay' : (playing ? 'Pause' : 'Play');
    btn.playText.textContent = label;
    btn.play.setAttribute('aria-label', label + ' (Space)');
    q('use', btn.play).setAttribute('href', ended ? '#i-replay' : (playing ? '#i-pause' : '#i-play'));
  }
  function goto(i, opts) {
    i = clamp(i, 0, SCENES.length - 1);
    ended = false; replayInline.hidden = true;
    elapsed = STARTS[i];
    current = -1;
    if (reduced) { showFinal(i); return; }
    render();
    if (!(opts && opts.stayPaused)) play(); else updatePlayButton();
  }
  function showFinal(i) {
    enter(i);
    applyFinal(SCENES[i].tracks);
    grid.draw(STARTS[i]);
    setCaption(SCENES[i].captions[SCENES[i].captions.length - 1].text);
    segs.forEach(function (s, k) { s.style.setProperty('--fill', k <= i ? '1' : '0'); });
  }
  function replay() {
    if (scrollMode) return;
    ended = false; replayInline.hidden = true;
    elapsed = 0; current = -1;
    if (reduced) { showFinal(0); return; }
    play();
  }
  function toggle() {
    if (reduced || scrollMode) return;
    if (playing) pause(); else play();
  }
  function step(d) {
    if (scrollMode) return;
    goto((current < 0 ? 0 : current) + d);
  }

  // ---------- Captions ----------
  let captionsOn = true;
  function setCaptions(on) {
    captionsOn = on;
    document.body.classList.toggle('captions-off', !on);
    btn.captions.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.captions.setAttribute('aria-label', 'Captions ' + (on ? 'on' : 'off') + ' (C)');
  }

  // ---------- Scroll view ----------
  let resumeAfterScroll = false;
  function setScroll(on) {
    if (on === scrollMode) return;
    scrollMode = on;
    btn.scroll.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      resumeAfterScroll = playing;
      pause();
      if (current >= 0) { sceneEls[current].classList.remove('is-active'); clearInline(sceneEls[current]); }
      current = -1;
      document.body.classList.remove('mode-player');
      document.body.classList.add('mode-scroll');
      stage.setAttribute('data-theme', 'light');
      scale = 1;
      sceneEls.forEach(function (root, i) {
        root.classList.add('is-active');
        clearInline(root);
        const tracks = SCENES[i].build(root);
        applyFinal(tracks);
        qa('.beat-a', root).forEach(function (el) { el.removeAttribute('style'); });
      });
      [btn.prev, btn.play, btn.next, btn.replay, btn.captions].forEach(function (b) { b.disabled = true; });
      window.scrollTo(0, 0);
    } else {
      sceneEls.forEach(function (root) { root.classList.remove('is-active'); clearInline(root); });
      document.body.classList.remove('mode-scroll');
      document.body.classList.add('mode-player');
      [btn.prev, btn.play, btn.next, btn.replay, btn.captions].forEach(function (b) { b.disabled = false; });
      window.scrollTo(0, 0);
      fit();
      const i = sceneIndexAt(elapsed);
      elapsed = STARTS[i]; current = -1;
      if (reduced) { showFinal(i); return; }
      render();
      if (resumeAfterScroll && !ended) play(); else updatePlayButton();
    }
  }

  // ---------- Wiring ----------
  btn.play.addEventListener('click', function () { if (ended) replay(); else toggle(); });
  btn.prev.addEventListener('click', function () { step(-1); });
  btn.next.addEventListener('click', function () { step(1); });
  btn.replay.addEventListener('click', replay);
  replayInline.addEventListener('click', replay);
  btn.captions.addEventListener('click', function () { setCaptions(!captionsOn); });
  btn.scroll.addEventListener('click', function () { setScroll(!scrollMode); });
  segs.forEach(function (s) { s.addEventListener('click', function () { if (!scrollMode) goto(Number(s.getAttribute('data-index'))); }); });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    switch (e.key) {
      case ' ': e.preventDefault(); if (ended) replay(); else toggle(); break;
      case 'ArrowLeft': e.preventDefault(); step(-1); break;
      case 'ArrowRight': e.preventDefault(); step(1); break;
      case 'r': case 'R': replay(); break;
      case 'c': case 'C': setCaptions(!captionsOn); break;
    }
  });
  window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      // Re-measure the active scene once Inter has loaded so travel paths land exactly.
      if (current >= 0 && !scrollMode && !reduced) { current = -1; render(); }
    });
  }

  // ---------- Start ----------
  const params = new URLSearchParams(window.location.search);
  const showControls = params.has('controls') ? params.get('controls') !== '0' : CONFIG.controls;
  if (!showControls) {
    document.body.classList.add('no-controls');
    q('#controls').hidden = true;
  }
  const startCaptions = params.has('captions') ? params.get('captions') !== '0' : CONFIG.captions;
  if (!startCaptions) setCaptions(false);
  fit();
  if (reduced) {
    btn.play.hidden = true;
    btn.replay.hidden = true;
    showFinal(0);
  } else {
    elapsed = 0;
    render();
    play();
  }

  // Exposed for tests only.
  window.__goal = {
    get elapsed() { return elapsed; }, get playing() { return playing; }, get current() { return current; },
    get ended() { return ended; }, get reduced() { return reduced; }, get orient() { return orient; }, total: TOTAL,
    scenes: SCENES.map(function (s) { return { id: s.id, durationMs: s.durationMs, captions: s.captions }; }),
    seek: function (t) { pause(); elapsed = clamp(t, 0, TOTAL - 1); current = -1; render(); },
    showFinal: function (i) { pause(); showFinal(i); }
  };
})();
