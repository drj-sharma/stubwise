// Generates the onboarding animations as Lottie JSON files in assets/lottie.
// They are drawn here from simple shapes so the app ships no third-party
// artwork. Any file can be swapped for one exported from LottieFiles: keep the
// file name and the app picks it up.
//
// Run: node scripts/build-lottie.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'lottie');
const SIZE = 400;
const FPS = 60;

const hex = (h) => [1, 3, 5].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 1000) / 1000).concat(1);
const C = {
  primary: hex('#3F3D9E'),
  primaryLight: hex('#8E8CE0'),
  soft: hex('#E7E6FA'),
  white: hex('#FFFFFF'),
  line: hex('#D5D6E4'),
  ink: hex('#16171D'),
  green: hex('#1E9E5A'),
  greenDark: hex('#146C3C'),
  greenSoft: hex('#DDF3E6'),
  amber: hex('#F2A33A'),
  pink: hex('#E8618C'),
};

// ---- Properties -------------------------------------------------------------

const still = (k) => ({ a: 0, k });

/** Animated property from [frame, value] pairs, eased in and out. */
function anim(frames) {
  return {
    a: 1,
    k: frames.map(([t, value], index) => {
      const s = Array.isArray(value) ? value : [value];
      const last = index === frames.length - 1;
      return last ? { t, s } : { t, s, i: { x: [0.3], y: [1] }, o: { x: [0.5], y: [0] } };
    }),
  };
}

const prop = (value) => (value && typeof value === 'object' && !Array.isArray(value) && 'a' in value ? value : still(value));

// ---- Shapes -----------------------------------------------------------------

const rect = (x, y, w, h, r = 0) => ({ ty: 'rc', d: 1, s: still([w, h]), p: still([x, y]), r: still(r) });
const ellipse = (x, y, w, h = w) => ({ ty: 'el', d: 1, s: still([w, h]), p: still([x, y]) });
const fill = (color, opacity = 100) => ({ ty: 'fl', c: still(color), o: prop(opacity), r: 1 });
const stroke = (color, width) => ({ ty: 'st', c: still(color), o: still(100), w: still(width), lc: 2, lj: 2 });
const trim = (end, start = 0) => ({ ty: 'tm', s: prop(start), e: prop(end), o: still(0), m: 1 });

/** Open or closed path through straight points. */
function path(points, closed = false) {
  const zero = points.map(() => [0, 0]);
  return { ty: 'sh', ks: still({ i: zero, o: zero, v: points, c: closed }) };
}

/** A group; `t` animates it about the point `at`. */
function group(items, t = {}) {
  const at = t.at ?? [0, 0];
  return {
    ty: 'gr',
    it: [
      ...items,
      {
        ty: 'tr',
        p: prop(t.p ?? at),
        a: still(at),
        s: prop(t.s ?? [100, 100]),
        r: prop(t.r ?? 0),
        o: prop(t.o ?? 100),
        sk: still(0),
        sa: still(0),
      },
    ],
  };
}

let layerIndex = 0;
/** A shape layer. Coordinates inside are relative to the centre of the canvas. */
function layer(name, shapes, total, t = {}) {
  layerIndex += 1;
  return {
    ddd: 0,
    ind: layerIndex,
    ty: 4,
    nm: name,
    sr: 1,
    ks: {
      o: prop(t.o ?? 100),
      r: prop(t.r ?? 0),
      p: prop(t.p ?? [SIZE / 2, SIZE / 2, 0]),
      a: still([0, 0, 0]),
      s: prop(t.s ?? [100, 100, 100]),
    },
    ao: 0,
    shapes,
    ip: 0,
    op: total,
    st: 0,
    bm: 0,
  };
}

function write(name, total, layers) {
  layerIndex = 0;
  const file = { v: '5.9.0', fr: FPS, ip: 0, op: total, w: SIZE, h: SIZE, nm: name, ddd: 0, assets: [], layers: layers() };
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(file));
}

const centre = (y) => [SIZE / 2, SIZE / 2 + y, 0];
const bob = (total, amount = 7) => anim([[0, centre(0)], [total / 2, centre(-amount)], [total, centre(0)]]);
const breathe = (total, to = 105) => anim([[0, [100, 100, 100]], [total / 2, [to, to, 100]], [total, [100, 100, 100]]]);
/** Scale that pops in at `at`, holds, and leaves just before the loop restarts. */
const pop = (at, total) =>
  anim([[0, [0, 0]], [at, [0, 0]], [at + 16, [118, 118]], [at + 26, [100, 100]], [total - 14, [100, 100]], [total, [0, 0]]]);
/** Trim end that draws between two frames, holds, and clears before the loop restarts. */
const draw = (from, to, total) => anim([[0, 0], [from, 0], [to, 100], [total - 14, 100], [total, 0]]);

const halo = (total, color = C.soft) => layer('halo', [group([ellipse(0, 0, 300), fill(color)])], total, { s: breathe(total) });

mkdirSync(OUT, { recursive: true });

// ---- 1. Welcome: a pay stub fills itself in ---------------------------------

write('welcome', 200, () => {
  const T = 200;
  const row = (y, width, from) => group([path([[-58, y], [-58 + width, y]]), trim(draw(from, from + 22, T)), stroke(C.line, 9)]);
  return [
    layer(
      'stub',
      [
        group([ellipse(0, 0, 62), fill(C.green), ], { at: [70, 96], s: pop(104, T) }),
        group([path([[57, 96], [66, 105], [84, 87]]), trim(draw(118, 136, T)), stroke(C.white, 7)]),
        group([path([[14, 58], [58, 58]]), trim(draw(84, 102, T)), stroke(C.primary, 11)]),
        row(22, 52, 66),
        row(-6, 116, 50),
        row(-34, 88, 34),
        group([rect(-30, -84, 56, 22, 7), fill(C.primary)], { at: [-58, -84], s: pop(8, T) }),
        group([rect(0, 0, 176, 232, 20), fill(C.white), stroke(C.line, 3)]),
      ],
      T,
      { p: bob(T) },
    ),
    halo(T),
  ];
});

// ---- 2. Privacy: a green shield locks ---------------------------------------

write('secure', 200, () => {
  const T = 200;
  const shield = [[0, -112], [88, -78], [88, 2], [62, 66], [0, 112], [-62, 66], [-88, 2], [-88, -78]];
  const ring = (delay) =>
    layer('ring', [group([ellipse(0, 0, 250), stroke(C.green, 4)])], T, {
      s: anim([[0, [70, 70, 100]], [delay, [70, 70, 100]], [delay + 90, [128, 128, 100]], [T, [128, 128, 100]]]),
      o: anim([[0, 0], [delay, 0], [delay + 12, 55], [delay + 90, 0], [T, 0]]),
    });
  return [
    layer(
      'shield',
      [
        // Keyhole
        group([ellipse(0, 22, 20), fill(C.green)]),
        group([path([[0, 24], [0, 46]]), stroke(C.green, 9)]),
        // Lock body
        group([rect(0, 32, 92, 74, 16), fill(C.white)], { at: [0, 32], s: pop(20, T) }),
        // Shackle drops into the body
        group([path([[-26, 4], [-26, -22], [-14, -40], [14, -40], [26, -22], [26, 4]]), stroke(C.white, 12)], {
          at: [0, 0],
          p: anim([[0, [0, -26]], [48, [0, -26]], [66, [0, 3]], [74, [0, 0]], [T - 14, [0, 0]], [T, [0, -26]]]),
          o: anim([[0, 0], [22, 0], [36, 100], [T - 14, 100], [T, 0]]),
        }),
        group([path(shield, true), fill(C.green), stroke(C.greenDark, 4)]),
      ],
      T,
      { p: bob(T, 5) },
    ),
    ring(70),
    ring(110),
    halo(T, C.greenSoft),
  ];
});

// ---- 3. Business: a small shopfront -----------------------------------------

write('business', 200, () => {
  const T = 200;
  const stripe = (x, color) => group([rect(x, -52, 44, 46, 10), fill(color)]);
  const spark = (x, y, at) =>
    group([path([[x, y - 14], [x, y + 14]]), path([[x - 14, y], [x + 14, y]]), stroke(C.amber, 6)], { at: [x, y], s: pop(at, T), r: anim([[0, 0], [T, 90]]) });
  return [
    layer(
      'shop',
      [
        spark(118, -112, 60),
        spark(-126, -70, 96),
        group([rect(0, -108, 120, 34, 10), fill(C.primary)], { at: [0, -91], s: pop(20, T) }),
        stripe(-88, C.primary),
        stripe(-44, C.primaryLight),
        stripe(0, C.primary),
        stripe(44, C.primaryLight),
        stripe(88, C.primary),
        group([rect(46, 50, 50, 84, 8), fill(C.primary)]),
        group([rect(-44, 34, 70, 52, 8), fill(C.soft), stroke(C.line, 3)]),
        group([rect(0, 30, 200, 124, 14), fill(C.white), stroke(C.line, 3)]),
      ],
      T,
      { p: bob(T, 5) },
    ),
    halo(T),
  ];
});

// ---- 4. Pay schedule: pay days light up on a calendar -----------------------

write('schedule', 220, () => {
  const T = 220;
  const days = [];
  for (let r = 0; r < 3; r += 1) {
    for (let col = 0; col < 5; col += 1) days.push([-72 + col * 36, 2 + r * 36]);
  }
  const payDays = [4, 9, 14];
  return [
    layer(
      'calendar',
      [
        ...payDays.map((index, n) => group([ellipse(days[index][0], days[index][1], 28), fill(C.green)], { at: days[index], s: pop(30 + n * 34, T) })),
        ...days.map(([x, y]) => group([ellipse(x, y, 14), fill(C.line)])),
        group([rect(-44, -98, 12, 30, 6), fill(C.ink)]),
        group([rect(44, -98, 12, 30, 6), fill(C.ink)]),
        group([rect(0, -62, 216, 50, 0), fill(C.primary)]),
        group([rect(0, 6, 216, 190, 22), fill(C.white), stroke(C.line, 3)]),
      ],
      T,
      { p: bob(T, 5) },
    ),
    halo(T),
  ];
});

// ---- 5. Templates: stub layouts fan out -------------------------------------

write('templates', 220, () => {
  const T = 220;
  const card = (name, accent, rotation, shift) =>
    layer(
      name,
      [
        group([path([[-44, 34], [44, 34]]), stroke(C.line, 8)]),
        group([path([[-44, 8], [20, 8]]), stroke(C.line, 8)]),
        group([path([[-44, -18], [44, -18]]), stroke(C.line, 8)]),
        group([rect(-22, -58, 44, 20, 6), fill(accent)]),
        group([rect(0, 0, 136, 180, 16), fill(C.white), stroke(C.line, 3)]),
      ],
      T,
      {
        r: anim([[0, 0], [20, 0], [70, rotation], [T - 60, rotation], [T - 10, 0], [T, 0]]),
        p: anim([[0, centre(0)], [20, centre(0)], [70, [SIZE / 2 + shift, SIZE / 2, 0]], [T - 60, [SIZE / 2 + shift, SIZE / 2, 0]], [T - 10, centre(0)], [T, centre(0)]]),
      },
    );
  return [card('front', C.primary, 0, 0), card('right', C.green, 13, 62), card('left', C.amber, -13, -62), halo(T)];
});

// ---- 6. Worker: a person with an add badge ----------------------------------

write('worker', 200, () => {
  const T = 200;
  return [
    layer(
      'badge',
      [
        group([path([[86, 62], [86, 94]]), path([[70, 78], [102, 78]]), stroke(C.white, 8)], { at: [86, 78], s: pop(52, T) }),
        group([ellipse(86, 78, 64), fill(C.green)], { at: [86, 78], s: pop(40, T) }),
      ],
      T,
      { p: bob(T) },
    ),
    layer(
      'person',
      [
        group([ellipse(0, -44, 84), fill(C.primary)]),
        group([rect(0, 78, 176, 124, 62), fill(C.primary)]),
      ],
      T,
      { p: bob(T) },
    ),
    halo(T),
  ];
});

// ---- 7. Done: a check with confetti (plays once) ----------------------------

write('done', 150, () => {
  const T = 150;
  const colors = [C.primary, C.amber, C.pink, C.green, C.primaryLight];
  const confetti = Array.from({ length: 14 }, (_, index) => {
    const angle = (index / 14) * Math.PI * 2 + 0.2;
    const far = 150 + (index % 3) * 22;
    const from = [Math.cos(angle) * 40, Math.sin(angle) * 40];
    const to = [Math.cos(angle) * far, Math.sin(angle) * far];
    const shape = index % 2 === 0 ? ellipse(0, 0, 16) : rect(0, 0, 18, 10, 3);
    return group([shape, fill(colors[index % colors.length])], {
      at: [0, 0],
      p: anim([[0, from], [28, from], [80, to], [T, [to[0], to[1] + 26]]]),
      o: anim([[0, 0], [28, 0], [34, 100], [100, 100], [T, 0]]),
      r: anim([[0, 0], [T, index % 2 === 0 ? 0 : 220]]),
    });
  });
  return [
    layer('check', [group([path([[-40, 4], [-12, 32], [44, -28]]), trim(anim([[0, 0], [30, 0], [58, 100], [T, 100]])), stroke(C.white, 16)])], T),
    layer('disc', [group([ellipse(0, 0, 170), fill(C.green)])], T, {
      s: anim([[0, [0, 0, 100]], [22, [112, 112, 100]], [34, [100, 100, 100]], [T, [100, 100, 100]]]),
    }),
    layer('confetti', confetti, T),
    layer('halo', [group([ellipse(0, 0, 300), fill(C.greenSoft)])], T, {
      s: anim([[0, [60, 60, 100]], [30, [100, 100, 100]], [T, [100, 100, 100]]]),
      o: anim([[0, 0], [20, 100], [T, 100]]),
    }),
  ];
});

console.log(`Wrote animations to ${OUT}`);
