import fs from "fs";
import path from "path";
import { SMS_SEND_B64 } from "./recording-assets/smsSendB64";

// Storage + edit layer for the standalone /recording page (a self-contained
// HTML bundle). The live copy lives on the DATA_DIR volume so edits made in
// the admin editor survive deploys; the repo's public/recording.html is the
// pristine seed (and the "reset" source).
//
// The bundle keeps its page markup as ONE JSON string inside
// <script type="__bundler/template">…</script> (the loader JSON.parse's it).
// Inside that template source, the transcript lines are JS object literals
// like  {k:'r',sp:'JUAN',tc:'00:52',t:'Really?\" he scoffs. \"How?'}  — i.e.
// single-quoted JS strings with their own escape layer. So text passes
// through two encodings: the JS-string layer, then the JSON layer. Editing
// works at the template-source level: JSON.parse once, edit, JSON.stringify
// back.

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function livePath(): string {
  return path.join(dataDir(), "recording.html");
}

function seedPath(): string {
  return path.join(process.cwd(), "public", "recording.html");
}

// Returns the path of the copy /recording should serve, seeding the live
// copy from the bundled one on first use. Also upgrades the live copy's
// player code in place when a newer patch exists (see patchPlayerFade) —
// the live copy may carry old player code from before a feature was added,
// and re-seeding would throw away the user's edits.
export function recordingFilePath(): string {
  const live = livePath();
  if (!fs.existsSync(live)) {
    try {
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.copyFileSync(seedPath(), live);
    } catch {
      return seedPath(); // read-only fallback: serve the bundled copy
    }
  }
  try {
    let html = fs.readFileSync(live, "utf-8");
    const before = html;
    html = patchSmsSendSound(html);
    const parts = splitTemplate(html);
    const patched = applyTemplateUpgrades(parts.template);
    if (patched !== parts.template) html = joinTemplate({ ...parts, template: patched });
    if (html !== before) fs.writeFileSync(live, html);
  } catch { /* serve as-is if the upgrade can't apply */ }
  return live;
}

// Teaches the bundle's audio player per-clip fades: fi (fade-in seconds) and
// fo (fade-out seconds) on a beat, ramped through a Web Audio gain node (an
// <audio> volume ramp is ignored on iOS). Pure text transform on the template
// source, applied idempotently — the marker comment guards re-application.
// The fade engine body, versioned. v1 wrote gain.value directly on a 40ms
// interval — audibly stair-stepped ("zipper noise") on phones, where timers
// throttle. v2 writes targets via setTargetAtTime so Web Audio ramps natively
// between ticks, which is smooth regardless of timer cadence.
const FADE_V1 =
  "/* fade-patch */\n" +
  "    this._fi = (fi != null ? +fi : 0) || 0;\n" +
  "    this._fo = (fo != null ? +fo : 0) || 0;\n" +
  "    this._t0 = start || 0;\n" +
  "    if(!this._gainCtx && (this._fi > 0 || this._fo > 0) && (window.AudioContext || window.webkitAudioContext)){\n" +
  "      try {\n" +
  "        this._gainCtx = new (window.AudioContext || window.webkitAudioContext)();\n" +
  "        this._gainNode = this._gainCtx.createGain();\n" +
  "        this._gainCtx.createMediaElementSource(audio).connect(this._gainNode);\n" +
  "        this._gainNode.connect(this._gainCtx.destination);\n" +
  "      } catch(e){ this._gainCtx = null; this._gainNode = null; }\n" +
  "    }\n" +
  "    if(this._gainCtx && this._gainCtx.state === 'suspended'){ try{ this._gainCtx.resume(); }catch(e){} }\n" +
  "    if(this._fadeTimer){ clearInterval(this._fadeTimer); this._fadeTimer = null; }\n" +
  "    const setVol = (v) => { if(this._gainNode) this._gainNode.gain.value = v; else { try{ audio.volume = v; }catch(e){} } };\n" +
  "    if(this._fi > 0 || this._fo > 0){\n" +
  "      setVol(this._fi > 0 ? 0 : 1);\n" +
  "      this._fadeTimer = setInterval(() => {\n" +
  "        const ct = audio.currentTime; let v = 1;\n" +
  "        if(this._fi > 0 && ct < this._t0 + this._fi) v = Math.min(v, Math.max(0, (ct - this._t0) / this._fi));\n" +
  "        if(this._fo > 0 && this._endTime != null && ct > this._endTime - this._fo) v = Math.min(v, Math.max(0, (this._endTime - ct) / this._fo));\n" +
  "        setVol(Math.max(0, Math.min(1, v)));\n" +
  "        if(audio.paused){ clearInterval(this._fadeTimer); this._fadeTimer = null; setVol(1); }\n" +
  "      }, 40);\n" +
  "    } else { setVol(1); }";

const FADE_V2 =
  "/* fade-patch v2 */\n" +
  "    this._fi = (fi != null ? +fi : 0) || 0;\n" +
  "    this._fo = (fo != null ? +fo : 0) || 0;\n" +
  "    this._t0 = start || 0;\n" +
  "    if(!this._gainCtx && (this._fi > 0 || this._fo > 0) && (window.AudioContext || window.webkitAudioContext)){\n" +
  "      try {\n" +
  "        this._gainCtx = new (window.AudioContext || window.webkitAudioContext)();\n" +
  "        this._gainNode = this._gainCtx.createGain();\n" +
  "        this._gainCtx.createMediaElementSource(audio).connect(this._gainNode);\n" +
  "        this._gainNode.connect(this._gainCtx.destination);\n" +
  "      } catch(e){ this._gainCtx = null; this._gainNode = null; }\n" +
  "    }\n" +
  "    if(this._gainCtx && this._gainCtx.state === 'suspended'){ try{ this._gainCtx.resume(); }catch(e){} }\n" +
  "    if(this._fadeTimer){ clearInterval(this._fadeTimer); this._fadeTimer = null; }\n" +
  "    const g = this._gainNode, gctx = this._gainCtx;\n" +
  "    const setVol = (v, snap) => {\n" +
  "      if(g && gctx){\n" +
  "        try {\n" +
  "          if(snap){ g.gain.cancelScheduledValues(gctx.currentTime); g.gain.setValueAtTime(v, gctx.currentTime); }\n" +
  "          // Exponential approach toward the target: Web Audio interpolates\n" +
  "          // natively between ticks, so throttled mobile timers can't step it.\n" +
  "          else g.gain.setTargetAtTime(v, gctx.currentTime, 0.05);\n" +
  "        } catch(e){ g.gain.value = v; }\n" +
  "      } else { try{ audio.volume = v; }catch(e){} }\n" +
  "    };\n" +
  "    if(this._fi > 0 || this._fo > 0){\n" +
  "      setVol(this._fi > 0 ? 0.0001 : 1, true);\n" +
  "      this._fadeTimer = setInterval(() => {\n" +
  "        const ct = audio.currentTime; let v = 1;\n" +
  "        if(this._fi > 0 && ct < this._t0 + this._fi) v = Math.min(v, Math.max(0.0001, (ct - this._t0) / this._fi));\n" +
  "        if(this._fo > 0 && this._endTime != null && ct > this._endTime - this._fo) v = Math.min(v, Math.max(0.0001, (this._endTime - ct) / this._fo));\n" +
  "        setVol(Math.max(0.0001, Math.min(1, v)));\n" +
  "        if(audio.paused){ clearInterval(this._fadeTimer); this._fadeTimer = null; setVol(1, true); }\n" +
  "      }, 60);\n" +
  "    } else { setVol(1, true); }";

export function patchPlayerFade(template: string): string {
  if (template.includes("/* fade-patch v2 */")) return template;
  // Migrate a live copy that already carries the v1 engine.
  if (template.includes("/* fade-patch */")) {
    return template.includes(FADE_V1) ? template.replace(FADE_V1, FADE_V2) : template;
  }
  let t = template;
  const swaps: [string, string][] = [
    // effClip carries the beat's fades through to the play call (audio
    // overrides keep their own start/end; fades always come from the beat).
    [
      "return { clip: b.clip || '', start:defStart, end:defEnd };",
      "return { clip: b.clip || '', start:defStart, end:defEnd, fi:(b.fi!=null?+b.fi:0), fo:(b.fo!=null?+b.fo:0) };",
    ],
    [
      "end: (ov.end != null ? +ov.end : defEnd)",
      "end: (ov.end != null ? +ov.end : defEnd), fi:(b.fi!=null?+b.fi:0), fo:(b.fo!=null?+b.fo:0)",
    ],
    [
      "if(eff.clip){ this.playClip(s.step, eff.clip, eff.start, eff.end); }",
      "if(eff.clip){ this.playClip(s.step, eff.clip, eff.start, eff.end, eff.fi, eff.fo); }",
    ],
    [
      "if(this._curKey !== key){ this.playClip(step, eff.clip, eff.start, eff.end); }",
      "if(this._curKey !== key){ this.playClip(step, eff.clip, eff.start, eff.end, eff.fi, eff.fo); }",
    ],
    [
      "this.playClip(i, eff.clip, eff.start, eff.end);",
      "this.playClip(i, eff.clip, eff.start, eff.end, eff.fi, eff.fo);",
    ],
    ["playClip(i, src, start, end){", "playClip(i, src, start, end, fi, fo){"],
    [
      "this._endTime = (end != null ? +end : null);",
      `this._endTime = (end != null ? +end : null);\n    ${FADE_V2}`,
    ],
  ];
  for (const [from, to] of swaps) {
    if (!t.includes(from)) return template; // player code changed — skip whole patch rather than half-apply
    t = t.replace(from, to);
  }
  return t;
}

// Cosmetic upgrade for the title and end screens: staggered cinematic reveal
// (kicker tracks in behind a pulsing REC dot, the date rises out of a blur,
// the hairline draws itself) and a matching blur-rise + tracking settle on
// the closing title/byline. Same idempotent all-or-nothing contract as the
// fade patch.
export function patchIntroEndStyle(template: string): string {
  if (template.includes("@keyframes trackin")) return template;
  let t = template;
  const swaps: [string, string][] = [
    [
      "@keyframes bandGlow{0%,100%{box-shadow:0 0 0 rgba(143,32,32,0)}50%{box-shadow:0 8px 30px rgba(143,32,32,.35)}}",
      "@keyframes bandGlow{0%,100%{box-shadow:0 0 0 rgba(143,32,32,0)}50%{box-shadow:0 8px 30px rgba(143,32,32,.35)}}\n" +
      "    @keyframes trackin{from{opacity:0;letter-spacing:.7em;filter:blur(3px)}to{opacity:1;letter-spacing:.34em;filter:blur(0)}}\n" +
      "    @keyframes dateIn{from{opacity:0;transform:translateY(30px) scale(.965);filter:blur(10px)}to{opacity:1;transform:none;filter:blur(0)}}\n" +
      "    @keyframes lineDraw{from{width:0;opacity:0}to{width:50px;opacity:1}}\n" +
      "    @keyframes endTitle{from{opacity:0;transform:translateY(34px) scale(.97);filter:blur(12px)}to{opacity:1;transform:none;filter:blur(0)}}\n" +
      "    @keyframes subTrack{from{opacity:0;letter-spacing:.6em}to{opacity:1;letter-spacing:.32em}}",
    ],
    // Title screen: pulsing REC dot + kicker tracking in together.
    [
      "<div style=\"font:600 11px/1 'IBM Plex Mono';letter-spacing:.34em;color:#b2492f;margin-bottom:30px\">RECONSTRUCTED</div>",
      "<div style=\"display:flex;align-items:center;justify-content:center;gap:11px;margin-bottom:30px;animation:trackin 1.1s .15s cubic-bezier(.2,.7,.2,1) both\">" +
      "<span style=\"width:7px;height:7px;border-radius:50%;background:#c23b2e;box-shadow:0 0 12px rgba(194,59,46,.8);animation:recpulse 1.6s 1.3s infinite\"></span>" +
      "<span style=\"font:600 11px/1 'IBM Plex Mono';color:#b2492f\">RECONSTRUCTED</span></div>",
    ],
    // The date rises out of a blur with a faint glow.
    [
      "<h1 style=\"margin:0;font-weight:300;font-size:clamp(46px,8.5vw,116px);line-height:.98;letter-spacing:-.01em\">August 8, 2018</h1>",
      "<h1 style=\"margin:0;font-weight:300;font-size:clamp(46px,8.5vw,116px);line-height:.98;letter-spacing:-.01em;text-shadow:0 2px 60px rgba(233,225,210,.14);animation:dateIn 1.3s .5s cubic-bezier(.2,.7,.2,1) both\">August 8, 2018</h1>",
    ],
    // The hairline draws itself, now with soft gradient ends.
    [
      "<div style=\"width:50px;height:1px;background:rgba(233,225,210,.28);margin:38px auto 0\"></div>",
      "<div style=\"width:50px;height:1px;background:linear-gradient(90deg,transparent,rgba(233,225,210,.6),transparent);margin:38px auto 0;animation:lineDraw .8s 1.5s ease both\"></div>",
    ],
    // The prompt holds back until the sequence settles, then breathes.
    [
      "<div style=\"margin-top:44px;font:600 11px/1 'IBM Plex Mono';letter-spacing:.24em;color:rgba(233,225,210,.6);animation:blink 2s infinite\">CLICK OR PRESS → TO BEGIN</div>",
      "<div style=\"margin-top:44px;font:600 11px/1 'IBM Plex Mono';letter-spacing:.24em;color:rgba(233,225,210,.6);animation:softin .9s 2.1s both, blink 2s 3s infinite\">CLICK OR PRESS → TO BEGIN</div>",
    ],
    // End screen: title gets the same blur-rise + glow; byline tracks in.
    [
      "animation:endRise 1.1s .15s cubic-bezier(.2,.7,.2,1) both\">",
      "text-shadow:0 2px 70px rgba(233,225,210,.16);animation:endTitle 1.4s .15s cubic-bezier(.2,.7,.2,1) both\">",
    ],
    [
      "animation:endFade 1.2s 1.05s both\">",
      "animation:subTrack 1.4s 1.2s cubic-bezier(.2,.7,.2,1) both\">",
    ],
  ];
  for (const [from, to] of swaps) {
    if (!t.includes(from)) return template; // markup changed — skip whole patch rather than half-apply
    t = t.replace(from, to);
  }
  return t;
}

// Fades are gone from the editor — they sounded bad over phone speakers no
// matter how the ramp was scheduled. Strip any fi/fo params previously saved
// onto clips so nothing on the page fades. (The patched player's fade engine
// stays in place but is inert with no fi/fo on any beat.)
export function stripClipFades(template: string): string {
  return template.replace(CLIP_RE, (whole, src: string, params: string) => {
    if (!/,f[io]:/.test(params)) return whole;
    const kept = parseClipParams(params);
    const cs = kept.start !== null && kept.start > 0 ? `,cs:${kept.start}` : "";
    const ce = kept.end !== null ? `,ce:${kept.end}` : "";
    return `clip:'${src}'${cs}${ce}`;
  });
}

// Removes the faint mono timecode ("00:52") shown beside each speaker name in
// the reading view. The tc values stay on the beats — the player derives its
// audio scheduling from them — this only drops the visual.
export function patchHideTimecodes(template: string): string {
  return template.replace(
    "<span style=\"font:500 11px/1 'IBM Plex Mono';letter-spacing:.12em;color:rgba(233,225,210,.3)\">{{ b.tc }}</span>",
    "",
  );
}

// The page ships its own in-page audio editor that persists per-browser
// overrides to localStorage — and the player PREFERS those over the beat's
// baked-in cs/ce. Once /admin/recording became the source of truth, stale
// local overrides silently masked centrally saved timing edits on any device
// that had ever touched the in-page editor. Stop loading them and clear the
// stale key so every visitor hears the saved timings.
export function patchDisableLocalOverrides(template: string): string {
  return template.replace(
    "try { ov = JSON.parse(localStorage.getItem(this.OVKEY) || '{}') || {}; } catch(e){ ov = {}; }",
    "try { localStorage.removeItem(this.OVKEY); } catch(e){} /* central timings win */",
  );
}

// Load glitch (root cause): the title card is position:fixed inset:0 with an
// OPAQUE background, but it fades in via `softin .6s` from opacity 0 — so for
// the first ~0.6s the whole card is translucent and everything behind it
// shows through: the numbered evidence/dossier column on the left, the nav
// bar, etc. Drop the fade on the OUTER card so its opaque background paints on
// frame 1 and masks everything; the inner kicker/date/hairline keep their own
// staggered entrance animations, so the reveal still looks cinematic.
export function patchKillTitleFlash(template: string): string {
  return template.replace(
    "background:radial-gradient(125% 95% at 50% 42%, #18130e, #0b0908);animation:softin .6s ease both\">",
    "background:radial-gradient(125% 95% at 50% 42%, #18130e, #0b0908)\">",
  );
}

// The bottom nav bar (BACK / advance hint / RESTART) is fixed at z-45 and
// always rendered; it has no business on the title screen. Gate it behind
// `started` (already exposed to the view) so it only appears once reading.
export function patchGateNavBar(template: string): string {
  if (template.includes('value="{{ started }}"')) return template; // already gated
  const head = '<div style="position:fixed;bottom:16px;left:0;right:0;z-index:45;display:flex;align-items:center;justify-content:center;pointer-events:none">';
  const tail = 'RESTART</button>\n      </div>\n    </div>';
  if (!template.includes(head) || !template.includes(tail)) return template;
  return template
    .replace(head, `<sc-if value="{{ started }}">${head}`)
    .replace(tail, `${tail}</sc-if>`);
}

// Editorial disclaimer under the date on the title card, above the begin
// prompt. Anchored on the date text, which survives the style patch.
const DISCLAIMER = "Warning: This report contains references to sexual assault.";
// Earlier wordings that a live copy may already carry — migrated in place to
// the current text so re-running the upgrade never leaves two warnings.
const DISCLAIMER_PRIOR = ["Warning: This report contains details of sexual assault."];
export function patchTitleDisclaimer(template: string): string {
  if (template.includes(DISCLAIMER)) return template;
  for (const old of DISCLAIMER_PRIOR) {
    if (template.includes(old)) return template.split(old).join(DISCLAIMER);
  }
  const anchor = "August 8, 2018</h1>";
  if (!template.includes(anchor)) return template;
  const el =
    "<div style=\"margin-top:30px;max-width:46ch;font:500 12px/1.7 'IBM Plex Mono';" +
    "letter-spacing:.05em;color:rgba(233,225,210,.42);animation:softin 1s 1.7s both\">" +
    `${DISCLAIMER}</div>`;
  return template.replace(anchor, `${anchor}${el}`);
}

// Copy fixes to captions/text, applied on read since the in-page editor is
// gone. Each entry is [old, new]; a missing `old` is simply skipped (already
// applied or superseded).
const COPY_FIXES: [string, string][] = [
  [
    "Susana and I revisited the bus stop in Miami, Florida, on June 22, 2026.",
    "Susana revisited the bus stop in Miami, Florida, on June 22, 2026.",
  ],
];
export function patchCopyFixes(template: string): string {
  let t = template;
  for (const [from, to] of COPY_FIXES) if (t.includes(from)) t = t.split(from).join(to);
  return t;
}

// End card: the red/cream/blue band reads as the French tricolor. Swap it for
// a row of three crimson stars (fitting "The Most American Woman") that pop in
// on the same stagger. Adds the starIn keyframe next to bandGlow.
const END_BAND =
  '<div style="display:flex;justify-content:center;gap:0;margin:42px auto 0;width:min(340px,72vw);height:7px;border-radius:1px;overflow:hidden;animation:bandGlow 4s 1.4s ease-in-out infinite">\n' +
  '                    <span style="flex:1;background:#8f2020;transform-origin:left;animation:bandIn .55s .55s cubic-bezier(.2,.7,.2,1) both"></span>\n' +
  '                    <span style="flex:1;background:#e9e1d2;transform-origin:left;animation:bandIn .55s .72s cubic-bezier(.2,.7,.2,1) both"></span>\n' +
  '                    <span style="flex:1;background:#2f4a72;transform-origin:left;animation:bandIn .55s .89s cubic-bezier(.2,.7,.2,1) both"></span>\n' +
  '                  </div>';
// Red, white, and blue (the end band's own flag palette), one color per star.
const END_STARS =
  '<div style="display:flex;justify-content:center;gap:20px;margin:40px auto 0;font-size:15px;line-height:1">' +
  '<span style="display:inline-block;color:#8f2020;animation:starIn .5s .55s cubic-bezier(.2,.7,.2,1) both">★</span>' +
  '<span style="display:inline-block;color:#e9e1d2;text-shadow:0 0 1px rgba(0,0,0,.35);animation:starIn .5s .72s cubic-bezier(.2,.7,.2,1) both">★</span>' +
  '<span style="display:inline-block;color:#2f4a72;animation:starIn .5s .89s cubic-bezier(.2,.7,.2,1) both">★</span>' +
  '</div>';
// The monochrome version earlier installs carry, so they can be upgraded.
const END_STARS_MONO =
  '<div style="display:flex;justify-content:center;gap:20px;margin:40px auto 0;color:#8f2020;font-size:15px;line-height:1">' +
  '<span style="display:inline-block;animation:starIn .5s .55s cubic-bezier(.2,.7,.2,1) both">★</span>' +
  '<span style="display:inline-block;animation:starIn .5s .72s cubic-bezier(.2,.7,.2,1) both">★</span>' +
  '<span style="display:inline-block;animation:starIn .5s .89s cubic-bezier(.2,.7,.2,1) both">★</span>' +
  '</div>';
export function patchEndStars(template: string): string {
  // Recolor a previously-applied monochrome row in place.
  if (template.includes(END_STARS_MONO)) return template.replace(END_STARS_MONO, END_STARS);
  if (template.includes("@keyframes starIn")) return template; // already current
  const bandKf = "@keyframes bandGlow{0%,100%{box-shadow:0 0 0 rgba(143,32,32,0)}50%{box-shadow:0 8px 30px rgba(143,32,32,.35)}}";
  if (!template.includes(END_BAND) || !template.includes(bandKf)) return template;
  return template
    .replace(END_BAND, END_STARS)
    .replace(bandKf, `${bandKf}\n    @keyframes starIn{from{opacity:0;transform:scale(.4) translateY(6px)}to{opacity:1;transform:none}}`);
}

// Every template upgrade, applied in order; recordingFilePath runs this on
// the live copy so existing installs pick new patches up without losing edits.
export function applyTemplateUpgrades(template: string): string {
  return patchEndStars(patchCopyFixes(patchTitleDisclaimer(patchGateNavBar(patchKillTitleFlash(
    patchDisableLocalOverrides(patchHideTimecodes(stripClipFades(patchIntroEndStyle(patchPlayerFade(template))))),
  )))));
}

// --- sms send sound (file-level upgrade) ---------------------------------------

const SMS_SEND_ID = "assets/sms-send.mp3";
const SMS_SEND_UUID = "5e40c0de-51a3-4b0e-9a90-6d5a2e70b001";

// Injects the iPhone "message sent" whoosh into the bundle and attaches it to
// the text-message beat, so the sms bubble lands with its sound. Unlike the
// template patches this touches the asset manifest too, so it operates on the
// whole file. Idempotent (guarded on the asset id); skips cleanly if any
// anchor is missing rather than half-applying.
export function patchSmsSendSound(html: string): string {
  if (html.includes(`"id":"${SMS_SEND_ID}"`)) return html;
  const manifestOpen = '<script type="__bundler/manifest">';
  const idAnchor = '{"id":"assets/clip-we-can-do-it-tonight.mp3","uuid":"13cfacfb-fb29-43fc-8f28-57d0b201b443"}';
  const mi = html.indexOf(manifestOpen);
  if (mi < 0 || !html.includes(idAnchor)) return html;
  // 1. Asset bytes into the manifest map (right after its opening "{").
  const brace = html.indexOf("{", mi + manifestOpen.length);
  if (brace < 0) return html;
  let out =
    html.slice(0, brace + 1) +
    `"${SMS_SEND_UUID}":{"mime":"audio/mpeg","compressed":false,"data":"${SMS_SEND_B64}"},` +
    html.slice(brace + 1);
  // 2. Register the id → uuid mapping alongside the other audio assets.
  out = out.replace(idAnchor, `${idAnchor},{"id":"${SMS_SEND_ID}","uuid":"${SMS_SEND_UUID}"}`);
  // 3. Attach the clip to the sms beat in the template.
  const parts = splitTemplate(out);
  const beat = "{k:'sms',t:";
  if (!parts.template.includes(beat)) return html;
  parts.template = parts.template.replace(beat, `{k:'sms',clip:'${SMS_SEND_ID}',t:`);
  return joinTemplate(parts);
}

export function resetRecordingToBundled(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.copyFileSync(seedPath(), livePath());
}

// --- template extraction -----------------------------------------------------

const OPEN = '<script type="__bundler/template">';

function readFileText(): string {
  return fs.readFileSync(recordingFilePath(), "utf-8");
}

// Splits the file into [before, templateSource, after]; templateSource is the
// JSON-decoded page markup.
function splitTemplate(html: string): { before: string; template: string; after: string } {
  const i = html.indexOf(OPEN);
  if (i < 0) throw new Error("recording bundle: template script not found");
  const start = i + OPEN.length;
  const end = html.indexOf("</script>", start);
  if (end < 0) throw new Error("recording bundle: template script not closed");
  const raw = html.slice(start, end).trim();
  return {
    before: html.slice(0, start),
    template: JSON.parse(raw) as string,
    after: html.slice(end),
  };
}

function joinTemplate(parts: { before: string; template: string; after: string }): string {
  // JSON.stringify escapes ", \ and control chars — the same shape the bundle
  // shipped with. "</" sequences inside the JSON string would end the host
  // <script> early, so escape the slash (valid JSON, ignored by JSON.parse).
  const raw = JSON.stringify(parts.template).replace(/<\//g, "<\\u002F");
  return `${parts.before}\n${raw}\n  ${parts.after}`;
}

// --- the JS-string escape layer (inside the template source) -----------------

function jsDecode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, "\n")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function jsEncode(s: string): string {
  return s.replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/—/g, "\\u2014")
    .replace(/’/g, "\\u2019")
    .replace(/‘/g, "\\u2018")
    .replace(/“/g, "\\u201C")
    .replace(/”/g, "\\u201D");
}

// --- transcript lines ---------------------------------------------------------

export type RecordingLine = {
  index: number;      // stable ordinal of the t:'…' occurrence in the template
  speaker: string | null;
  timecode: string | null;
  text: string;       // decoded, human-editable
};

// Matches a single-quoted JS string value for a `t:` key. At template-source
// level, escapes are single backslashes, so (?:\\.|[^'\\])* is the standard
// "escaped or plain char" scan.
const LINE_RE = /([{,]\s*)t:'((?:\\.|[^'\\])*)'/g;

export function listRecordingLines(): RecordingLine[] {
  const { template } = splitTemplate(readFileText());
  const out: RecordingLine[] = [];
  let m: RegExpExecArray | null;
  let index = 0;
  LINE_RE.lastIndex = 0;
  while ((m = LINE_RE.exec(template))) {
    // Pull speaker/timecode from the same object literal: scan back to the
    // nearest '{' and look for sp:'…' / tc:'…' in that span.
    const objStart = template.lastIndexOf("{", m.index);
    const ctx = template.slice(objStart, m.index + 1);
    const sp = /sp:'((?:\\.|[^'\\])*)'/.exec(ctx);
    const tc = /tc:'((?:\\.|[^'\\])*)'/.exec(ctx);
    out.push({
      index: index++,
      speaker: sp ? jsDecode(sp[1]) : null,
      timecode: tc ? jsDecode(tc[1]) : null,
      text: jsDecode(m[2]),
    });
  }
  return out;
}

export function saveRecordingLine(index: number, newText: string): void {
  const html = readFileText();
  const parts = splitTemplate(html);
  let i = 0;
  let hit = false;
  parts.template = parts.template.replace(LINE_RE, (whole, prefix: string) => {
    if (i++ !== index) return whole;
    hit = true;
    return `${prefix}t:'${jsEncode(newText)}'`;
  });
  if (!hit) throw new Error(`Line ${index} not found — the page may have changed; reload the editor.`);
  fs.writeFileSync(livePath(), joinTemplate(parts));
}

// --- audio clip timings --------------------------------------------------------

export type RecordingClip = {
  index: number;       // ordinal of the clip:'…' occurrence in the template
  file: string;        // e.g. "assets/clip-we-can-do-it-tonight.mp3"
  start: number | null; // cs — seconds into the file playback begins (null = 0)
  end: number | null;   // ce — seconds where playback stops (null = play to end)
  snippet: string;      // nearby transcript text, for identifying the clip
};

// A clip's trim params sit immediately after its src in the same object
// literal: clip:'assets/x.mp3',cs:1.5,ce:2.8 — all optional. fi/fo (fades)
// are matched too so rewrites and the fade-removal cleanup can strip them.
const CLIP_RE = /clip:'((?:\\.|[^'\\])*)'((?:,(?:cs|ce|fi|fo):[0-9.]+)*)/g;

function parseClipParams(params: string): { start: number | null; end: number | null } {
  const n = (k: string) => {
    const m = new RegExp(`,${k}:([0-9.]+)`).exec(params);
    return m ? Number(m[1]) : null;
  };
  return { start: n("cs"), end: n("ce") };
}

export function listRecordingClips(): RecordingClip[] {
  const { template } = splitTemplate(readFileText());
  const out: RecordingClip[] = [];
  let m: RegExpExecArray | null;
  let index = 0;
  CLIP_RE.lastIndex = 0;
  while ((m = CLIP_RE.exec(template))) {
    // Identify the clip by the first transcript text that follows it.
    const window = template.slice(m.index, m.index + 400);
    const t = /t:'((?:\\.|[^'\\])*)'/.exec(window);
    const text = t ? jsDecode(t[1]) : "";
    out.push({
      index: index++,
      file: jsDecode(m[1]),
      ...parseClipParams(m[2]),
      snippet: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    });
  }
  return out;
}

export function saveRecordingClipTiming(index: number, start: number | null, end: number | null): void {
  if (start !== null && (!Number.isFinite(start) || start < 0)) throw new Error("Start must be a non-negative number of seconds.");
  if (end !== null && (!Number.isFinite(end) || end <= 0)) throw new Error("End must be a positive number of seconds.");
  if (start !== null && end !== null && end <= start) throw new Error("End must be after start.");
  const parts = splitTemplate(readFileText());
  parts.template = applyTemplateUpgrades(parts.template);
  let i = 0;
  let hit = false;
  parts.template = parts.template.replace(CLIP_RE, (whole, src: string) => {
    if (i++ !== index) return whole;
    hit = true;
    const cs = start !== null && start > 0 ? `,cs:${start}` : "";
    const ce = end !== null ? `,ce:${end}` : "";
    return `clip:'${src}'${cs}${ce}`;
  });
  if (!hit) throw new Error(`Clip ${index} not found — the page may have changed; reload the editor.`);
  fs.writeFileSync(livePath(), joinTemplate(parts));
}

// --- embedded asset extraction (for in-editor audio preview) -------------------

// The bundle embeds every asset as base64 in two JSON blobs: a manifest
// mapping id → uuid, and a resources map of uuid → {mime, data}. Pull one
// asset's bytes out so the admin editor can play the audio being trimmed.
export function getRecordingAsset(id: string): { mime: string; data: Buffer } | null {
  const html = readFileText();
  const idKey = `"id":${JSON.stringify(id)},"uuid":"`;
  const i = html.indexOf(idKey);
  if (i < 0) return null;
  const uuid = html.slice(i + idKey.length, html.indexOf('"', i + idKey.length));
  const resKey = `"${uuid}":{"mime":"`;
  const j = html.indexOf(resKey);
  if (j < 0) return null;
  const mime = html.slice(j + resKey.length, html.indexOf('"', j + resKey.length));
  const dataKey = '"data":"';
  const k = html.indexOf(dataKey, j);
  if (k < 0) return null;
  const b64 = html.slice(k + dataKey.length, html.indexOf('"', k + dataKey.length));
  const gz = html.slice(j, k).includes('"compressed":true');
  try {
    const raw = Buffer.from(b64, "base64");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return { mime, data: gz ? require("zlib").gunzipSync(raw) : raw };
  } catch {
    return null;
  }
}

// --- generic find & replace ---------------------------------------------------

// Replaces every occurrence of `find`, both as plain markup text and as
// JS-string-escaped text (covers transcript lines, labels, narration, and any
// on-page HTML). Returns how many occurrences were replaced.
export function findReplaceRecording(find: string, replace: string): number {
  if (!find) return 0;
  const parts = splitTemplate(readFileText());
  let count = 0;
  const sub = (hay: string, needle: string, repl: string): string => {
    if (!needle || !hay.includes(needle)) return hay;
    const n = hay.split(needle).length - 1;
    count += n;
    return hay.split(needle).join(repl);
  };
  parts.template = sub(parts.template, find, replace);
  const encFind = jsEncode(find);
  if (encFind !== find) parts.template = sub(parts.template, encFind, jsEncode(replace));
  if (count > 0) fs.writeFileSync(livePath(), joinTemplate(parts));
  return count;
}
