import { memoryDashboardCatalog } from './memory-dashboard-i18n.mjs';

const STYLE = `
/* Layer 1: the previous stylesheet, kept as the base.
   The new system below only covers the components it redesigned. Everything else the page still
   renders -- the section switcher, the sticky topbar, buttons, dialogs, forms, the provider grid
   and the whole semantic-retrieval checklist -- has no rule in it. Dropping this layer left every
   section visible at once, because .section{display:none} lives here and nowhere else.
   Rules whose class names were renamed (card, metric, status, help, value) are dead weight now;
   they match nothing and are cheap to leave until the markup migration is finished. */
:root{
  color-scheme:light dark;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans","Noto Sans Arabic","Noto Sans Devanagari","Noto Sans Thai",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --bg:#f6f6f8;--surface:#fff;--surface-2:#efeff3;--line:rgba(20,20,30,.11);--line-strong:rgba(20,20,30,.22);
  --text:#17171d;--muted:#616171;--faint:#8c8c9c;--accent:#2563a9;--accent-soft:rgba(37,99,169,.10);
  --ok:#18743a;--warn:#a35d08;--bad:#b32929;--ok-soft:rgba(24,116,58,.11);--warn-soft:rgba(163,93,8,.11);--bad-soft:rgba(179,41,41,.11);
}
@media(prefers-color-scheme:dark){:root{--bg:#0d0d11;--surface:#15151a;--surface-2:#1c1c22;--line:rgba(255,255,255,.09);--line-strong:rgba(255,255,255,.20);--text:#ededf2;--muted:#aaaab8;--faint:#777786;--accent:#73a6de;--accent-soft:rgba(115,166,222,.14);--ok:#55c878;--warn:#e1a43c;--bad:#f07b7b;--ok-soft:rgba(85,200,120,.12);--warn-soft:rgba(225,164,60,.12);--bad-soft:rgba(240,123,123,.12)}}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}body{background:var(--bg);color:var(--text);font:14px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
button,input,select{font:inherit}button{white-space:nowrap}code,.num{font-family:var(--mono);font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}code{font-size:.92em;background:var(--surface-2);border-radius:5px;padding:1px 5px}
.shell{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100dvh}.rail{position:sticky;top:0;height:100dvh;padding:20px 14px 16px;background:var(--surface);border-inline-end:1px solid var(--line);display:flex;flex-direction:column}
.brand{padding:0 9px 18px;border-bottom:1px solid var(--line);margin-bottom:12px}.brand b{font-size:13px}.brand small{display:block;color:var(--faint);font-size:11px;margin-top:3px}.nav{display:grid;gap:3px}.nav button{border:0;background:transparent;color:var(--muted);text-align:start;padding:8px 10px;border-radius:8px;cursor:pointer}.nav button:hover,.nav button[aria-current=true]{background:var(--accent-soft);color:var(--text)}.nav button[aria-current=true]{font-weight:650}.nav button:focus-visible,.btn:focus-visible,.ghost:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rail-foot{margin-top:auto;padding:12px 9px 0;border-top:1px solid var(--line);font-size:11px;color:var(--faint)}main{min-width:0;padding:0 28px 56px}.stickytop{position:sticky;top:0;z-index:20;background:var(--bg);margin-bottom:20px}.topbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:18px 0 14px;background:var(--bg);border-bottom:1px solid var(--line)}h1{font-size:19px;margin:0}.sub{font-size:11px;color:var(--faint)}.spacer{flex:1}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.toolbar label{font-size:11px;color:var(--faint)}
.seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}.seg button{border:0;border-inline-end:1px solid var(--line);background:transparent;color:var(--muted);padding:5px 10px;cursor:pointer}.seg button:last-child{border-inline-end:0}.seg button[aria-pressed=true]{background:var(--accent-soft);color:var(--text);font-weight:650}.ghost,.btn{border:1px solid var(--line);border-radius:8px;padding:6px 11px;background:var(--surface);color:var(--text);cursor:pointer}.btn{border-color:var(--accent);background:var(--accent);color:#fff;font-weight:650}.btn.quiet{border-color:var(--line);background:var(--surface-2);color:var(--text);font-weight:500}.btn.danger{border-color:transparent;background:var(--bad-soft);color:var(--bad)}.btn[disabled]{opacity:.45;cursor:not-allowed}.btn{--spin:#fff}.btn.quiet,.ghost{--spin:var(--text)}.btn.danger{--spin:var(--bad)}.btn[data-pending],.ghost[data-pending]{position:relative;color:transparent;cursor:progress}.btn[data-pending]::after,.ghost[data-pending]::after{content:'';position:absolute;inset:0;margin:auto;width:13px;height:13px;border:2px solid var(--spin);border-top-color:transparent;border-radius:50%;animation:ownmem-spin .6s linear infinite}@keyframes ownmem-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.btn[data-pending]::after,.ghost[data-pending]::after{animation-duration:2s}}.btn:active:not([data-pending]),.ghost:active:not([data-pending]){transform:translateY(1px)}select,input{border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);padding:7px 9px;min-width:0}
.section{display:none}.section[data-active=true]{display:block}.intro{max-width:76ch;color:var(--muted);font-size:12px;margin:-5px 0 16px}.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px}.card{grid-column:span 12;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;min-width:0}.c4{grid-column:span 4}.c5{grid-column:span 5}.c6{grid-column:span 6}.c7{grid-column:span 7}.card-head{display:flex;align-items:baseline;gap:8px;margin-bottom:14px}.card-title{font-weight:650}.card-note{margin-inline-start:auto;color:var(--faint);font-size:11px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:18px}.metric{min-width:0}.metric label{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}.metric .value{font:650 25px/1.15 var(--mono);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.metric .value.na{font:500 14px/1.3 var(--sans);color:var(--faint)}.metric .foot{font-size:11px;color:var(--faint);margin-top:6px}.hero-value{font:650 50px/1 var(--mono);letter-spacing:-.04em}.help{font-size:11px;color:var(--faint);max-width:78ch;margin-top:10px}.status{display:inline-block;border-radius:99px;padding:2px 8px;font-size:10px;font-family:var(--mono);border:1px solid var(--line);color:var(--muted)}.status.ok{border-color:transparent;background:var(--ok-soft);color:var(--ok)}.status.warn{border-color:transparent;background:var(--warn-soft);color:var(--warn)}.status.bad{border-color:transparent;background:var(--bad-soft);color:var(--bad)}
/* A table's column widths come from its content, so a narrow viewport cannot shrink it: at 390px
   the recommendations table alone measured 656px and pushed the whole page into horizontal
   scroll. The page must never scroll sideways; wide content scrolls inside its own box. */
.tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:start;color:var(--faint);font-weight:500;padding:0 10px 8px 0;white-space:nowrap}td{border-top:1px solid var(--line);padding:9px 10px 9px 0;vertical-align:top;overflow-wrap:anywhere}tbody tr:hover{background:var(--surface-2)}.empty{padding:15px;border:1px solid var(--line);border-radius:9px;color:var(--muted);font-size:12px}.empty b{display:block;color:var(--text);margin-bottom:4px}.list{display:grid;gap:8px}.gap-row{padding:9px 0;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)}.gap-row:last-child{border-bottom:0}
.provider-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}.provider-card{border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);padding:14px;text-align:start;cursor:pointer}.provider-card[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft)}.provider-card b{display:block}.provider-card small{display:block;color:var(--faint);margin-top:5px}.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:13px;margin-top:14px}/* Label line-height must be pinned: Latin glyphs (API Key) and CJK glyphs (model, timeout) give
   different line-box heights at the same font size, and without pinning it the inputs on one row
   settle at different heights and simply look misaligned. */
.field{display:grid;gap:5px;align-content:start}.field label{font-size:11px;line-height:16px;min-height:16px;color:var(--muted)}.field small{font-size:10px;line-height:15px;color:var(--faint)}.field input{line-height:20px}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}.progress{height:7px;background:var(--surface-2);border-radius:99px;overflow:hidden;margin:12px 0}.progress i{display:block;height:100%;background:var(--accent)}
.banner{padding:11px 13px;border-inline-start:3px solid var(--warn);background:var(--warn-soft);border-radius:7px;margin-bottom:14px;font-size:12px}.notice{padding:12px;border-inline-start:3px solid var(--accent);background:var(--accent-soft);border-radius:7px;color:var(--muted);font-size:12px;margin:12px 0}.notice.bad{border-color:var(--bad);background:var(--bad-soft);color:var(--text)}
#modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(8,8,12,.58);z-index:50}#modal[data-open=true]{display:flex}.dialog{width:min(520px,100%);background:var(--surface);border:1px solid var(--line-strong);border-radius:12px;padding:20px}.dialog h2{font-size:16px;margin:0 0 8px}.dialog p{color:var(--muted);font-size:12px}.skeleton{height:10px;width:180px;background:var(--surface-2);border-radius:99px}#flash{position:fixed;inset:auto 50% 20px auto;transform:translateX(50%);background:var(--surface);border:1px solid var(--line-strong);border-radius:8px;padding:8px 13px;box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:12px;opacity:0;visibility:hidden;z-index:60}#flash[data-open=true]{opacity:1;visibility:visible}
.nav button{display:flex;align-items:center;gap:9px}.nav svg{width:17px;height:17px;flex:none;opacity:.7}.nav button[aria-current=true] svg{opacity:1;color:var(--accent)}.brand{display:flex;align-items:flex-start;gap:9px}.brand svg{width:19px;height:19px;flex:none;color:var(--accent);margin-top:1px}.brand .brand-text{min-width:0}.card{box-shadow:0 1px 2px rgba(16,16,24,.04)}@media(prefers-color-scheme:dark){.card{box-shadow:none}}
.chprog{align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:9px}.setup-intro{font-size:11.5px;line-height:1.6;color:var(--muted);margin:0 0 20px;max-width:78ch}
.checklist{display:grid}.crow{display:grid;grid-template-columns:28px minmax(0,1fr);gap:13px;padding:16px 0;border-top:1px solid var(--line)}.crow:first-child{border-top:0;padding-top:2px}
.cmark{width:26px;height:26px;border-radius:99px;display:flex;align-items:center;justify-content:center;font:650 11px/1 var(--mono);border:1px solid var(--line-strong);color:var(--faint);background:var(--surface)}
.crow[data-state=done] .cmark{border-color:transparent;background:var(--ok-soft);color:var(--ok)}.crow[data-state=current] .cmark{border-color:transparent;background:var(--accent);color:#fff}
.crow[data-state=todo]{opacity:.6}.crow[data-state=current]{background:linear-gradient(90deg,var(--accent-soft),transparent 62%);border-radius:10px;padding-inline:11px;margin-inline:-11px}
.chead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:0}.csum{color:var(--faint);font-size:11px;font-family:var(--mono);margin-inline-start:auto;direction:ltr;unicode-bidi:isolate}
.cdetail{margin-top:11px}.crow[data-state=todo] .cdetail{display:none}.cdetail .actions{margin-top:12px;padding-top:0;border-top:0}.cdetail .grid{gap:11px}
/* The two mode cards must stay level: let the explanatory text absorb the extra height rather than leaving the card without a button shorter or hollow */
.mode{display:flex;flex-direction:column}.mode .plain{flex:1}.mode .btn{align-self:flex-start}
.endpoint{margin-top:17px;min-width:0}.endpoint label{display:block;color:var(--muted);font-size:11px;margin-bottom:6px}.endpoint code{display:block;padding:8px 10px;line-height:1.55;overflow-wrap:anywhere}
.help.lock{color:var(--warn);margin-top:8px}.help.caution{color:var(--warn)}.help.revisit{margin-top:16px;padding-top:13px;border-top:1px solid var(--line)}
.mode{border-radius:10px}.mode.live{border-color:var(--ok);background:var(--ok-soft)}.mode .chead{margin-bottom:9px}.mode .plain{margin:0 0 7px;font-size:12.5px;color:var(--text)}.mode .help{margin-top:0;margin-bottom:13px}
#setup-banner:empty{display:none}#alert:empty{display:none}#alert{padding-bottom:12px}#alert .alert{margin-bottom:0;box-shadow:0 8px 24px rgba(0,0,0,.22)}.alert{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;margin-bottom:14px;border-inline-start:3px solid var(--bad);background:var(--bad-soft);border-radius:7px;color:var(--text);font-size:12.5px}.alert span{flex:1;min-width:0}#setup-banner .banner{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
@media(max-width:980px){.c4,.c5,.c6,.c7{grid-column:span 12}}@media(max-width:760px){/* minmax(0,1fr), not 1fr: a bare 1fr means minmax(auto,1fr), whose floor is the column's
   min-content width. One wide table then stretched <main> to 656px inside a 390px viewport
   and the whole page scrolled sideways. The desktop rule above already got this right. */.shell{grid-template-columns:minmax(0,1fr)}.rail{position:static;height:auto;border-inline-end:0;border-bottom:1px solid var(--line)}.nav{display:flex;overflow:auto}.nav button{flex:none}.rail-foot{display:none}main{padding:0 14px 40px}.stickytop{position:static}.metric .value{font-size:22px}.hero-value{font-size:42px}.toolbar{width:100%}.toolbar .locale{margin-inline-start:auto}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}

/* Layer 2: the new visual system. It comes second so it wins on equal specificity. */
/* ==========================================================================
   OwnMem local dashboard - visual system
   Single stylesheet, system fonts only, no network requests.
   Written to be pasted verbatim into the STYLE template literal of
   scripts/lib/memory-dashboard-page-v2.mjs, so it must never contain a
   backtick or a dollar-brace sequence.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Tokens
   Light is the base definition. Dark redefines values only, never structure.
   Every colour has one job; the job is named in the comment, not the hex.
   -------------------------------------------------------------------------- */
:root{
  color-scheme:light dark;

  /* Type families. The language list is load bearing: the panel ships in 16
     locales and the Noto faces cover the scripts macOS does not. */
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans","Noto Sans Arabic","Noto Sans Devanagari","Noto Sans Thai",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;

  /* Surfaces, from furthest back to nearest front. */
  --bg:#f5f5f8;            /* page canvas */
  --surface:#ffffff;       /* panel, rail, popover */
  --surface-2:#f4f4f7;     /* inset inside a panel: code, input, bar track */
  --surface-3:#eaeaf0;     /* pressed control, table hover, filled track */

  /* Hairlines. Three weights only. */
  --line:rgba(18,19,32,.085);    /* structural: panel edge, row divider */
  --line-2:rgba(18,19,32,.145);  /* control edge, thead rule */
  --line-3:rgba(18,19,32,.26);   /* dialog edge, empty tick */

  /* Ink. Each step is a role, not a shade: primary reading, supporting
     reading, metadata, and disabled. All clear 4.5:1 on --surface. */
  --text:#15161d;
  --text-2:#54566a;
  --text-3:#6f7183;
  --text-4:#a2a4b2;

  /* One accent. It means interactive or current, never decoration. */
  --accent:#2f56b8;
  --accent-hover:#26489e;
  --accent-soft:rgba(47,86,184,.10);
  --accent-ink:#ffffff;          /* text that sits on solid accent */

  /* Semantics. Used for system state only, never for ranking or emphasis. */
  --ok:#1a7444;    --ok-soft:rgba(26,116,68,.11);
  --warn:#96590a;  --warn-soft:rgba(150,89,10,.12);
  --bad:#b02a2f;   --bad-soft:rgba(176,42,47,.10);
  --info:#4a5163;  --info-soft:rgba(74,81,99,.08);

  /* Elevation. Tinted with the canvas hue, never neutral black. */
  --shadow-1:0 1px 1px rgba(18,19,32,.03),0 1px 3px rgba(18,19,32,.045);
  --shadow-2:0 1px 2px rgba(18,19,32,.05),0 14px 30px -16px rgba(18,19,32,.20);
  /* A no-op shadow, never the keyword none: one none inside a comma
     separated box-shadow list invalidates the entire declaration, which
     silently removes every other layer in it. */
  --panel-hi:0 0 rgba(0,0,0,0);  /* top highlight, dark mode only */

  /* Space. One 4px based scale; no other gaps are allowed. */
  --sp-1:4px;  --sp-2:8px;  --sp-3:12px; --sp-4:16px; --sp-5:20px;
  --sp-6:24px; --sp-7:32px; --sp-8:40px; --sp-9:56px;

  /* Radius grows with the size of the box it wraps. */
  --r-1:6px;   /* chip, code, tick */
  --r-2:9px;   /* button, input, inset block */
  --r-3:14px;  /* panel */
  --r-4:18px;  /* masthead, dialog */
  --r-pill:999px;

  /* Motion. One curve for everything, short enough to feel mechanical. */
  --ease:cubic-bezier(.2,.65,.25,1);
  --dur:140ms;

  /* Tracking on the uppercase eyebrow. Overridden for RTL, where added
     letter spacing breaks Arabic cursive joining. */
  --eyebrow-track:.07em;
}

@media(prefers-color-scheme:dark){
  :root{
    --bg:#0e0e13;
    --surface:#16161d;
    --surface-2:#1d1d25;
    --surface-3:#25252f;
    --line:rgba(255,255,255,.075);
    --line-2:rgba(255,255,255,.13);
    --line-3:rgba(255,255,255,.24);
    --text:#eceef4;
    --text-2:#a9abbb;
    --text-3:#8a8c9e;
    --text-4:#5e6072;
    --accent:#86a8f5;
    --accent-hover:#a0bcff;
    --accent-soft:rgba(134,168,245,.14);
    --accent-ink:#0c1022;
    --ok:#4fc47c;    --ok-soft:rgba(79,196,124,.13);
    --warn:#e0a340;  --warn-soft:rgba(224,163,64,.13);
    --bad:#f2807e;   --bad-soft:rgba(242,128,126,.13);
    --info:#9fa2b6;  --info-soft:rgba(159,162,182,.10);
    /* Shadows do not read on a dark canvas. A one pixel top highlight does
       the same job: it tells the eye the panel is in front. */
    --shadow-1:0 0 rgba(0,0,0,0);
    --shadow-2:0 18px 40px -24px rgba(0,0,0,.75);
    --panel-hi:inset 0 1px 0 rgba(255,255,255,.045);
  }
}

[dir=rtl]{--eyebrow-track:normal}

/* --------------------------------------------------------------------------
   2. Base
   -------------------------------------------------------------------------- */
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{
  background:var(--bg);
  color:var(--text);
  font:400 13px/1.55 var(--sans);
  letter-spacing:-.002em;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
/* Every figure in the panel is compared against the one beside it, so
   proportional digits are never acceptable here. */
body{font-variant-numeric:tabular-nums}
button,input,select,textarea{font:inherit;letter-spacing:inherit;color:inherit}
button{white-space:nowrap}
h1,h2,h3{margin:0;font-weight:650}
p{margin:0}
a{color:var(--accent);text-underline-offset:2px}

/* Mono is reserved for things a human would copy and paste: identifiers,
   paths, keys, endpoints, channel names. Measurements are set in the sans
   with tabular figures, because mono at display size reads as log output. */
code,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}
code{font-size:.9em;background:var(--surface-2);border-radius:var(--r-1);padding:1.5px 5px;color:var(--text-2)}

:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--r-1)}

.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

/* --------------------------------------------------------------------------
   3. Type roles
   Eight steps. Anything not on this list is a mistake.
   -------------------------------------------------------------------------- */
.t-display{font:650 52px/1 var(--sans);letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.t-xl     {font:620 30px/1.1 var(--sans);letter-spacing:-.022em;font-variant-numeric:tabular-nums}
.t-lg     {font:600 21px/1.25 var(--sans);letter-spacing:-.014em;font-variant-numeric:tabular-nums}
.t-md     {font:650 15px/1.35 var(--sans);letter-spacing:-.011em}
.t-base   {font:400 13px/1.55 var(--sans)}
.t-sm     {font:400 12px/1.5 var(--sans);color:var(--text-2)}
.t-xs     {font:500 11px/1.45 var(--sans);letter-spacing:.012em;color:var(--text-3)}
.eyebrow  {font:650 10px/1.4 var(--sans);letter-spacing:var(--eyebrow-track);text-transform:uppercase;color:var(--text-3)}

/* Explanatory prose is a distinct role. It is never the same weight or
   colour as a measurement, and it never runs wider than a comfortable
   measure even when the panel is 900px wide. */
.prose{font:400 12px/1.65 var(--sans);color:var(--text-2);max-width:68ch;text-wrap:pretty}
.prose--quiet{color:var(--text-3)}
.footnote{font:400 11.5px/1.6 var(--sans);color:var(--text-3);max-width:72ch;text-wrap:pretty}

/* --------------------------------------------------------------------------
   4. Shell: rail, topbar, canvas
   -------------------------------------------------------------------------- */
.shell{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:100dvh}

.rail{
  position:sticky;top:0;height:100dvh;
  display:flex;flex-direction:column;
  padding:var(--sp-5) var(--sp-3) var(--sp-4);
  background:var(--surface);
  border-inline-end:1px solid var(--line);
}
.brand{display:flex;align-items:flex-start;gap:10px;padding:0 var(--sp-2) var(--sp-5)}
.brand svg{width:20px;height:20px;flex:none;color:var(--accent);margin-top:1px}
.brand b{display:block;font:650 13.5px/1.3 var(--sans);letter-spacing:-.01em}
.brand small{display:block;font-size:11px;line-height:1.45;color:var(--text-3);margin-top:2px}

.nav{display:grid;gap:1px}
.nav button{
  display:flex;align-items:center;gap:10px;position:relative;
  border:0;background:transparent;color:var(--text-2);
  text-align:start;padding:7px 10px;border-radius:var(--r-2);cursor:pointer;
  font-size:13px;
  transition:background var(--dur) var(--ease),color var(--dur) var(--ease);
}
.nav svg{width:16px;height:16px;flex:none;opacity:.62;transition:opacity var(--dur) var(--ease),color var(--dur) var(--ease)}
.nav button:hover{background:var(--surface-2);color:var(--text)}
.nav button:hover svg{opacity:.85}
/* The current item is marked by an accent rule on the inline edge plus an
   accent icon. A filled blue pill is louder than the page it labels. */
.nav button[aria-current=true]{background:var(--surface-2);color:var(--text);font-weight:600}
.nav button[aria-current=true] svg{opacity:1;color:var(--accent)}
.nav button[aria-current=true]::before{
  content:'';position:absolute;inset-inline-start:0;inset-block:7px;
  inline-size:2px;border-radius:var(--r-pill);background:var(--accent);
}

.rail-foot{margin-top:auto;padding:var(--sp-3) var(--sp-2) 0;border-top:1px solid var(--line)}
.rail-foot .k{font:500 10.5px/1.4 var(--sans);letter-spacing:.02em;color:var(--text-3);text-transform:uppercase}
.rail-foot .v{font:600 12.5px/1.5 var(--sans);color:var(--text-2);font-variant-numeric:tabular-nums;margin-top:2px}

main{min-width:0;padding:0 var(--sp-7) var(--sp-9)}

.topbar{
  position:sticky;top:0;z-index:20;background:var(--bg);
  display:flex;align-items:center;gap:var(--sp-4);flex-wrap:wrap;
  padding:var(--sp-5) 0 var(--sp-3);
  border-bottom:1px solid var(--line);
  margin-bottom:var(--sp-6);
}
/* The rail already carries the product name. The topbar carries the answer
   to "where am I", which is the only thing that changes as you navigate. */
.topbar h1{font:650 15px/1.35 var(--sans);letter-spacing:-.011em}
.topbar .meta{font-size:11.5px;color:var(--text-3);font-variant-numeric:tabular-nums}
.topbar .spacer{flex:1;min-width:var(--sp-4)}
.toolbar{display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap}

/* --------------------------------------------------------------------------
   5. Controls
   One height, one radius, one border weight for every control on the bar.
   -------------------------------------------------------------------------- */
.ctl{
  --ctl-h:30px;
  height:var(--ctl-h);display:inline-flex;align-items:center;gap:6px;
  padding:0 11px;border-radius:var(--r-2);
  border:1px solid var(--line-2);background:var(--surface);color:var(--text);
  font-size:12.5px;cursor:pointer;
  box-shadow:var(--shadow-1);
  transition:background var(--dur) var(--ease),border-color var(--dur) var(--ease),color var(--dur) var(--ease);
}
.ctl:hover{background:var(--surface-2);border-color:var(--line-3)}
.ctl:active{background:var(--surface-3)}
.ctl[disabled]{opacity:.45;cursor:not-allowed;box-shadow:none}

/* Modifiers are additive on .ctl, so every control keeps one height. */
.btn--primary{border-color:transparent;background:var(--accent);color:var(--accent-ink);font-weight:600;box-shadow:var(--shadow-1)}
.btn--primary:hover{background:var(--accent-hover);border-color:transparent}
.btn--primary:active{background:var(--accent-hover)}
.btn--quiet{background:var(--surface-2);border-color:transparent;box-shadow:none}
.btn--quiet:hover{background:var(--surface-3);border-color:transparent}
.btn--danger{background:var(--bad-soft);border-color:transparent;color:var(--bad);font-weight:600;box-shadow:none}
.btn--danger:hover{background:var(--bad-soft);border-color:var(--bad)}
.ctl:active:not([disabled]):not([data-pending]){transform:translateY(.5px)}

/* Segment. Same height and radius as its neighbours; the selected cell is a
   raised surface rather than a colour wash. */
.seg{
  --ctl-h:30px;
  height:var(--ctl-h);display:inline-flex;padding:2px;gap:2px;
  border:1px solid var(--line-2);border-radius:var(--r-2);
  background:var(--surface-2);box-shadow:var(--shadow-1);
}
.seg button{
  border:0;background:transparent;color:var(--text-3);cursor:pointer;
  padding:0 10px;border-radius:7px;font-size:12px;font-variant-numeric:tabular-nums;
  transition:background var(--dur) var(--ease),color var(--dur) var(--ease);
}
.seg button:hover{color:var(--text)}
.seg button[aria-pressed=true]{background:var(--surface);color:var(--text);font-weight:600;box-shadow:var(--shadow-1)}

/* Native select, restyled. The chevron is drawn in CSS, not fetched, so the
   strict content policy has nothing to block. */
.selectwrap{position:relative;display:inline-flex}
.selectwrap select{
  -webkit-appearance:none;appearance:none;
  height:30px;padding:0 30px 0 11px;border-radius:var(--r-2);
  border:1px solid var(--line-2);background:var(--surface);color:var(--text);
  font-size:12.5px;cursor:pointer;box-shadow:var(--shadow-1);
  transition:background var(--dur) var(--ease),border-color var(--dur) var(--ease);
}
[dir=rtl] .selectwrap select{padding:0 11px 0 30px}
.selectwrap select:hover{background:var(--surface-2);border-color:var(--line-3)}
.selectwrap::after{
  content:'';position:absolute;inset-inline-end:12px;top:50%;
  width:6px;height:6px;margin-top:-4.5px;
  border-inline-end:1.5px solid var(--text-3);border-bottom:1.5px solid var(--text-3);
  transform:rotate(45deg);pointer-events:none;border-radius:1px;
}

.field{display:grid;gap:5px;align-content:start}
/* Latin and CJK label glyphs give different line boxes at the same size, so
   the height is pinned; otherwise inputs on one row settle at different tops. */
.field label{font-size:11px;line-height:16px;min-height:16px;color:var(--text-2)}
.field input{
  height:32px;padding:0 10px;border-radius:var(--r-2);
  border:1px solid var(--line-2);background:var(--surface);color:var(--text);
  font-size:13px;min-width:0;
  transition:border-color var(--dur) var(--ease),background var(--dur) var(--ease);
}
.field input:hover{border-color:var(--line-3)}
.field small{font-size:10.5px;line-height:15px;color:var(--text-3)}

/* --------------------------------------------------------------------------
   6. Panels
   Three levels of surface weight, so importance is visible before reading.
   -------------------------------------------------------------------------- */
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:var(--sp-4)}
.grid > *{grid-column:span 12}
.grid > .c3{grid-column:span 3}.grid > .c4{grid-column:span 4}
.grid > .c5{grid-column:span 5}.grid > .c6{grid-column:span 6}
.grid > .c7{grid-column:span 7}.grid > .c8{grid-column:span 8}
.grid > .c9{grid-column:span 9}

/* Level 1: the masthead. It has no card around it at all. The single most
   important number on a page sits directly on the canvas, separated by a
   rule instead of a box, so it cannot be mistaken for a peer of the tiles. */
.masthead{
  display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);
  gap:var(--sp-8);align-items:start;
  padding:var(--sp-2) 0 var(--sp-7);
  border-bottom:1px solid var(--line);
  margin-bottom:var(--sp-2);
}
.masthead__figure{display:flex;align-items:baseline;gap:3px;margin:var(--sp-3) 0 var(--sp-4)}
.masthead__figure .t-display{color:var(--text)}
.masthead__unit{font:600 22px/1 var(--sans);color:var(--text-3);letter-spacing:-.02em}

/* Level 2: the standard panel. */
.panel{
  min-width:0;
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:var(--r-3);
  padding:var(--sp-5);
  box-shadow:var(--shadow-1),var(--panel-hi);
}
.panel__head{display:flex;align-items:baseline;gap:var(--sp-2);margin-bottom:var(--sp-4)}
.panel__title{font:650 13px/1.4 var(--sans);letter-spacing:-.008em}
.panel__note{margin-inline-start:auto;font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums}
/* A panel only takes a semantic colour when the system is in that state.
   The rule sits on the inline edge so it never competes with the title. */
.panel--ok{box-shadow:var(--shadow-1),var(--panel-hi),inset 2px 0 0 var(--ok)}
.panel--warn{box-shadow:var(--shadow-1),var(--panel-hi),inset 2px 0 0 var(--warn)}
.panel--bad{box-shadow:var(--shadow-1),var(--panel-hi),inset 2px 0 0 var(--bad)}

/* Level 3: an inset block inside a panel. Tighter radius, no border, one
   step darker. Used for tables, code, empty states and comparisons. */
.inset{background:var(--surface-2);border-radius:var(--r-2);padding:var(--sp-4)}

/* Two related readings inside one panel, told apart by a rule rather than by
   a second card. Nesting a card inside a card is how a dashboard stops
   having a hierarchy at all. */
.panel__split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--sp-6)}
.panel__split > * + *{border-inline-start:1px solid var(--line);padding-inline-start:var(--sp-6)}
.panel__rule{border:0;border-top:1px solid var(--line);margin:var(--sp-5) 0}
@media(max-width:1180px){
  .panel__split{grid-template-columns:minmax(0,1fr);gap:var(--sp-5)}
  .panel__split > * + *{border-inline-start:0;padding-inline-start:0;border-top:1px solid var(--line);padding-top:var(--sp-5)}
}

/* --------------------------------------------------------------------------
   7. Stats
   Four weights of measurement. A page uses hero once, lead sparingly.
   Label sits above the value in every size, so a column of tiles can be
   scanned by label; the value box has a floor so a missing value never
   pulls the row out of alignment.
   -------------------------------------------------------------------------- */
/* Label, value and footnote each get their own track on the parent grid, and
   every tile borrows those tracks through subgrid. That is what keeps a row
   of figures on one baseline when one label wraps to two lines and its
   neighbour does not -- which is not a hypothetical: German labels run about
   a third longer than English, and the old layout dropped that tile's value
   20px below the rest of the row. */
.stats{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));
  grid-template-rows:auto auto auto;
  /* Row gap is zero because the parent's rows are the tile's own three
     tracks; the space between bands of tiles comes from the tile's bottom
     padding instead, cancelled once at the end. */
  row-gap:0;column-gap:var(--sp-6);margin-bottom:calc(var(--sp-5) * -1);
}
/* Capped variant: four tiles inside a 900px panel should not each be 220px
   wide with a 21px number floating in the middle of them. */
.stats--packed{grid-template-columns:repeat(auto-fit,minmax(140px,190px));justify-content:start}
.stat{min-width:0;display:grid;grid-row:span 3;grid-template-rows:subgrid;padding-bottom:var(--sp-5)}
@supports not (grid-template-rows:subgrid){
  /* Older engines fall back to a two line floor under the label. It covers
     the common case rather than every case, so it is the fallback, not the
     design. */
  .stats{row-gap:var(--sp-5);margin-bottom:0}
  .stat{display:block;padding-bottom:0}
  .stat__label{display:flex;align-items:flex-end;min-height:31px}
}
.stat__label{
  font:500 11px/1.4 var(--sans);letter-spacing:.012em;
  color:var(--text-2);margin-bottom:6px;text-wrap:pretty;
}
.stat__value{
  min-height:27px;display:flex;align-items:flex-end;
  font:600 21px/1.25 var(--sans);letter-spacing:-.014em;
  font-variant-numeric:tabular-nums;overflow-wrap:anywhere;
}
.stat__foot{font:400 11px/1.5 var(--sans);color:var(--text-3);margin-top:6px;text-wrap:pretty}
.stat--lead .stat__value{min-height:38px;font-size:30px;letter-spacing:-.022em;font-weight:620}
.stat--sm .stat__value{min-height:22px;font-size:15px;letter-spacing:-.008em}
/* Values that are words rather than numbers drop to reading size; a
   fourteen letter status word set at 21px shouts louder than the figure
   next to it and is harder to read, not easier. */
.stat__value--text{font:600 15px/1.7 var(--sans);letter-spacing:-.006em}

/* --------------------------------------------------------------------------
   8. Not measured
   The panel is required to say so when a number does not exist. That makes
   absence a first class state, not a defect, and it has to look deliberate.
   Two kinds, and the difference matters to the reader:
     .na            nothing was recorded in this window yet
     .na--nometric  the production path cannot observe this at all
   Both hold the exact height of a real value so rows stay aligned.
   -------------------------------------------------------------------------- */
/* The rule is placed on the value's own baseline by bottom margin, not
   centred in the box: a mark floating above the baseline reads as something
   that failed to load rather than as a value that does not exist. */
.na{display:block;color:var(--text-4);inline-size:24px;block-size:2px;border-radius:2px;background:currentColor;margin-block-end:8px}
.na--nometric{background:none;block-size:0;border-top:2px dashed currentColor}
.stat--lead .na{inline-size:32px;margin-block-end:11px}
.stat--sm .na{inline-size:20px;margin-block-end:5px}
/* The label of a structurally unmeasurable metric carries a dotted rule, so
   the reason is attached to the name and survives translation. */
.stat--nometric .stat__label{
  text-decoration:underline dotted var(--line-3);text-underline-offset:3px;
  text-decoration-thickness:1px;
}
.na-note{color:var(--text-3)}

/* --------------------------------------------------------------------------
   9. Chips
   -------------------------------------------------------------------------- */
.chip{
  display:inline-flex;align-items:center;gap:5px;
  height:20px;padding:0 8px;border-radius:var(--r-1);
  font:600 11px/1 var(--sans);letter-spacing:.005em;white-space:nowrap;
  background:var(--surface-2);color:var(--text-2);
}
.chip--ok{background:var(--ok-soft);color:var(--ok)}
.chip--warn{background:var(--warn-soft);color:var(--warn)}
.chip--bad{background:var(--bad-soft);color:var(--bad)}
.chip--info{background:var(--info-soft);color:var(--info)}
.chip--accent{background:var(--accent-soft);color:var(--accent)}
.chip--mono{font-family:var(--mono);font-weight:500;font-size:10.5px}
/* A dot carries the state for readers who cannot separate the fills. */
.chip__dot{inline-size:5px;block-size:5px;border-radius:var(--r-pill);background:currentColor;flex:none}

/* Rank, encoded. Three ticks say how many, the word says of what. The ticks
   are graphite by default: high impact is not a warning, and colouring rank
   would spend the semantic palette on something that has no state. */
.sev{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.sev__ticks{display:inline-flex;gap:2px;align-items:center}
.sev__ticks i{inline-size:3px;block-size:11px;border-radius:1.5px;background:var(--line-3);opacity:.55}
.sev--3 .sev__ticks i:nth-child(-n+3),
.sev--2 .sev__ticks i:nth-child(-n+2),
.sev--1 .sev__ticks i:nth-child(-n+1){background:var(--text-2);opacity:1}
.sev--alert.sev--3 .sev__ticks i:nth-child(-n+3),
.sev--alert.sev--2 .sev__ticks i:nth-child(-n+2){background:var(--warn)}
.sev__text{font-size:12px;color:var(--text-2)}

/* --------------------------------------------------------------------------
   10. Bars, funnel, sparkline
   -------------------------------------------------------------------------- */
.bar{block-size:5px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.bar i{display:block;block-size:100%;border-radius:inherit;background:var(--text-2)}
.bar--accent i{background:var(--accent)}
.bar--ok i{background:var(--ok)}
.bar--warn i{background:var(--warn)}
.bar--muted i{background:var(--line-3)}

/* Parts of a whole. The ramp is fixed and neutral, so a stack never invents
   a meaning the data does not have; semantic fills are opt in. */
.barstack{display:flex;gap:2px;block-size:8px;border-radius:var(--r-pill);overflow:hidden;background:var(--surface-3)}
.barstack i{display:block;block-size:100%;min-inline-size:2px}
.barstack i:nth-child(1){background:var(--accent)}
.barstack i:nth-child(2){background:var(--text-4)}
.barstack i:nth-child(3){background:var(--line-3)}
.legend{display:flex;flex-wrap:wrap;gap:6px var(--sp-6);margin-top:10px}
.legend span{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text-2)}
.legend b{inline-size:7px;block-size:7px;border-radius:2px;flex:none}
.legend .sw-1{background:var(--accent)}
.legend .sw-2{background:var(--text-4)}
.legend .sw-3{background:var(--line-3)}
.legend em{font-style:normal;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums}

/* A labelled bar row: name, bar, figure. Used wherever a table column holds
   values whose shape matters more than their digits. */
.barrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;align-items:center}
.barrow__name{font-size:12px;color:var(--text-2);min-width:0}
.barrow__val{font:600 12px/1 var(--sans);font-variant-numeric:tabular-nums;text-align:end}
.barrow .bar{grid-column:1/-1}

/* The funnel replaces the sentence that used to explain that three rates
   belong to one sequence. Bar length is the share of the original set; the
   figure above it is that stage's own rate. */
.funnel{display:grid;gap:var(--sp-3)}
.funnel__row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;align-items:baseline}
.funnel__name{font-size:11.5px;color:var(--text-2);display:flex;align-items:center;gap:7px}
.funnel__step{
  inline-size:16px;block-size:16px;border-radius:var(--r-1);flex:none;
  display:grid;place-items:center;background:var(--surface-2);
  font:600 9.5px/1 var(--sans);color:var(--text-3);
}
.funnel__val{font:600 13px/1 var(--sans);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.funnel__bar{grid-column:1/-1;block-size:6px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.funnel__bar i{display:block;block-size:100%;background:var(--accent);border-radius:inherit}
.funnel__row--dim .funnel__bar i{background:var(--line-3)}
.funnel__row--dim .funnel__val{color:var(--text-2)}

.spark{display:block;inline-size:100%;block-size:34px;overflow:visible}
.spark path{fill:none;stroke:var(--accent);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.spark .spark__area{fill:var(--accent-soft);stroke:none}
.spark .spark__base{stroke:var(--line);stroke-width:1;stroke-dasharray:2 3}

.progress{block-size:6px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden;margin:var(--sp-3) 0}
.progress i{display:block;block-size:100%;background:var(--accent);border-radius:inherit}

/* --------------------------------------------------------------------------
   11. Tables
   A table's columns are sized by content, so a narrow viewport cannot shrink
   one. Wide content scrolls inside its own box; the page never scrolls
   sideways.
   -------------------------------------------------------------------------- */
.tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 calc(var(--sp-5) * -1);padding:0 var(--sp-5)}
table{width:100%;border-collapse:collapse}
thead th{
  font:600 10px/1.4 var(--sans);letter-spacing:var(--eyebrow-track);text-transform:uppercase;
  color:var(--text-3);text-align:start;white-space:nowrap;
  padding:0 var(--sp-4) 9px 0;border-bottom:1px solid var(--line-2);
}
thead th:last-child{padding-inline-end:0}
tbody td{
  font-size:12.5px;color:var(--text-2);vertical-align:middle;
  padding:11px var(--sp-4) 11px 0;border-bottom:1px solid var(--line);
  overflow-wrap:anywhere;
}
tbody td:last-child{padding-inline-end:0}
tbody tr:last-child td{border-bottom:0}
/* The first column names the row, so it reads at full ink; the rest support
   it. Without this every cell competes and the table has no entry point. */
tbody td:first-child{color:var(--text);font-weight:500}
tbody tr{transition:background var(--dur) var(--ease)}
tbody tr:hover td{background:var(--surface-2)}
.num{font-variant-numeric:tabular-nums;text-align:end;white-space:nowrap}
th.num{text-align:end}
.cell-sub{display:block;font:400 11px/1.5 var(--sans);color:var(--text-3);margin-top:3px}

/* --------------------------------------------------------------------------
   12. Empty, banners, notices
   -------------------------------------------------------------------------- */
.empty{
  display:flex;align-items:flex-start;gap:11px;
  padding:var(--sp-4);border-radius:var(--r-2);
  background:var(--surface-2);
}
.empty svg{width:16px;height:16px;flex:none;color:var(--text-4);margin-top:1px}
.empty b{display:block;font:600 12.5px/1.5 var(--sans);color:var(--text);margin-bottom:2px}
.empty span{font-size:12px;line-height:1.6;color:var(--text-3)}

.banner{
  display:flex;align-items:flex-start;gap:10px;
  padding:11px var(--sp-4);border-radius:var(--r-2);
  font-size:12.5px;line-height:1.6;color:var(--text);
  background:var(--info-soft);box-shadow:inset 2px 0 0 var(--info);
}
.banner--warn{background:var(--warn-soft);box-shadow:inset 2px 0 0 var(--warn)}
.banner--bad{background:var(--bad-soft);box-shadow:inset 2px 0 0 var(--bad)}
.banner--accent{background:var(--accent-soft);box-shadow:inset 2px 0 0 var(--accent)}
.banner b{font-weight:650}
.banner .spacer{flex:1}

/* --------------------------------------------------------------------------
   13. Responsive
   -------------------------------------------------------------------------- */
@media(max-width:1180px){
  .masthead{grid-template-columns:minmax(0,1fr);gap:var(--sp-6)}
}
@media(max-width:980px){
  /* Each helper is listed rather than collapsed to .grid > * : the helpers
     carry two class selectors, so a single-class rule here would lose on
     specificity no matter where it sits in the sheet. */
  .grid > .c3,.grid > .c4,.grid > .c5,
  .grid > .c6,.grid > .c7,.grid > .c8,.grid > .c9{grid-column:span 12}
}
@media(max-width:760px){
  /* minmax(0,1fr) rather than 1fr: a bare 1fr floors at the column's
     min-content width, and one wide table then stretches main past the
     viewport and scrolls the whole page sideways. */
  .shell{grid-template-columns:minmax(0,1fr)}
  .rail{position:static;height:auto;border-inline-end:0;border-bottom:1px solid var(--line);padding:var(--sp-4) var(--sp-3)}
  .nav{display:flex;overflow:auto;gap:var(--sp-1)}
  .nav button{flex:none}
  .nav button[aria-current=true]::before{inset:auto 8px 0 8px;inline-size:auto;block-size:2px}
  .rail-foot{display:none}
  main{padding:0 var(--sp-4) var(--sp-8)}
  .topbar{position:static}
  .t-display{font-size:40px}
  .stat--lead .stat__value{font-size:25px}
  .tablewrap{margin:0 calc(var(--sp-5) * -1);padding:0 var(--sp-5)}
}
@media(prefers-reduced-motion:reduce){
  *{transition:none !important;scroll-behavior:auto !important}
}
/* Layer 3: bridge tokens.
   Layer 1 rules ask for names the new palette does not define. Mapping them here keeps those rules
   on the new colours instead of the old ones -- --faint in particular measured about 3.5:1 and was
   a real contrast defect, so it must not survive just because an old rule still references it. */
:root{--muted:var(--text-2);--faint:var(--text-3);--line-strong:var(--line-2)}

`;

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

const SCRIPT = `
const I18N = __I18N__;
const M = I18N.messages;
const TOKEN = (location.hash.match(/t=([a-f0-9]+)/) || [])[1] || '';
const WINDOWS = ['7d','30d','90d'];
const VIEWS = ['overview','performance','quality','governance','semantic'];
// Intl.NumberFormat.prototype.format takes a single argument: options must be passed to the
// constructor or they are silently ignored, which renders a percentage as 22.531%.
const nf = new Intl.NumberFormat(I18N.locale);
const nf1 = new Intl.NumberFormat(I18N.locale,{maximumFractionDigits:1,minimumFractionDigits:1});
const nfInt = new Intl.NumberFormat(I18N.locale,{maximumFractionDigits:0});
const nfLoose1 = new Intl.NumberFormat(I18N.locale,{maximumFractionDigits:1});
const nfLoose2 = new Intl.NumberFormat(I18N.locale,{maximumFractionDigits:2});
const df = new Intl.DateTimeFormat(I18N.locale,{dateStyle:'medium',timeStyle:'short'});
const state = {since:'7d',view:'overview',data:{},loading:{},wizard:{open:false,step:1,provider:null,form:{},test:null,testing:false,job:null,poll:null,repick:false,error:null},modal:null};
function t(key){return M[key] || key}
function esc(value){return String(value === null || value === undefined ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function num(value){return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : nf.format(Number(value))}
function pct(value){return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : nf1.format(Number(value)*100)+'%'}
function ms(value){return value === null || value === undefined ? null : (Number(value)>=100?nfInt:nfLoose1).format(Number(value))+' ms'}
function bytes(value){if(value===null||value===undefined)return t('unavailable');if(value<1024)return nf.format(value)+' B';if(value<1048576)return nfLoose1.format(value/1024)+' KB';return nfLoose2.format(value/1048576)+' MB'}
function when(value){if(!value)return t('unavailable');const date=new Date(value);return Number.isNaN(date.valueOf())?String(value):df.format(date)}
function valueOrUnavailable(value){return value===null||value===undefined?'<div class="stat__value"><span class="na" role="img" aria-label="'+esc(t('unavailable'))+'"></span></div>':'<div class="stat__value">'+esc(value)+'</div>'}
// The blended rate averages two different things. cli is a deliberate question; claude-hook fires
// on every file read whether or not memory is relevant. Measured here they sit an order of
// magnitude apart, so the blend alone reads as a broken retriever. Surface ids are stable English
// identifiers, so the split needs no new translated string.
// NOTE: this whole function lives inside a template literal -- no backticks in these comments.
function abstainBySurface(report){
  const entries=Object.entries(report.performance.retrieval_by_surface||{});
  if(entries.length<2) return '';
  return ' — '+entries.map(([surface,e])=>surface+' '+pct(e.abstain_rate)).join(' · ');
}
// The single most important number leaves the card system entirely: it sits on the canvas with a
// rule under it so it cannot be read as a peer of the tiles below. The unit is split off the
// figure because a percent sign set at display size outweighs the digits it qualifies.
function heroFigure(value){
  if(!value) return '<div class="masthead__figure"><span class="na" role="img" aria-label="'+esc(t('unavailable'))+'"></span></div>';
  const parts=String(value).match(/^(.*?)(%?)$/);
  return '<div class="masthead__figure"><span class="t-display">'+esc(parts[1])+'</span>'+(parts[2]?'<span class="masthead__unit">'+parts[2]+'</span>':'')+'</div>';
}
// Bar length is the cumulative share of eligible recalls that reached the stage; the figure beside
// it is that stage own rate against the stage above. Drawing both settles the question the three
// side-by-side tiles used to raise and never answer: which denominator is this one against.
function funnel(steps){
  return '<div class="funnel">'+steps.map(function(step,index){
    return '<div class="funnel__row'+(step.dim?' funnel__row--dim':'')+'">'
      +'<span class="funnel__name"><span class="funnel__step">'+(index+1)+'</span>'+esc(step.name)+'</span>'
      +'<span class="funnel__val">'+esc(step.value||t('unavailable'))+'</span>'
      +'<span class="funnel__bar"><i style="inline-size:'+step.width+'%"></i></span></div>';
  }).join('')+'</div>';
}
function metric(label,value,foot){return '<div class="stat"><span class="stat__label">'+esc(label)+'</span>'+valueOrUnavailable(value)+(foot?'<div class="stat__foot">'+esc(foot)+'</div>':'')+'</div>'}
function empty(title,body){return '<div class="empty">'+(title?'<b>'+esc(title)+'</b>':'')+(body?'<span>'+esc(body)+'</span>':'')+'</div>'}
function card(title,body,note,classes){return '<div class="panel '+(classes||'')+'"><div class="panel__head"><span class="panel__title">'+esc(title)+'</span>'+(note?'<span class="panel__note">'+esc(note)+'</span>':'')+'</div>'+body+'</div>'}
function status(text,tone){return '<span class="chip'+(tone?' chip--'+tone:'')+'">'+(tone?'<i class="chip__dot"></i>':'')+esc(text)+'</span>'}
// These two tables used to print the raw channel and query-class identifiers, which made them the
// least readable thing on the page. Show the plain-language name and keep the identifier beside it
// so logs and docs stay connectable; an unknown key falls back to the identifier on its own.
function termLabel(prefix,name){const label=M[prefix+name];return (label?esc(label)+' ':'')+'<code>'+esc(name)+'</code>'}
function api(path){return fetch(path,{headers:{'X-Memory-Token':TOKEN},cache:'no-store'}).then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(body.message||('HTTP '+response.status));error.code=body.error;error.payload=body;throw error}return body})}
function send(method,path,body){return fetch(path,{method,headers:{'X-Memory-Token':TOKEN,'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify(body||{})}).then(async response=>{const payload=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(payload.message||('HTTP '+response.status));error.code=payload.error;error.payload=payload;throw error}return payload})}
function flash(message){const node=document.getElementById('flash');node.textContent=message;node.setAttribute('data-open','true');clearTimeout(flash.timer);flash.timer=setTimeout(()=>node.removeAttribute('data-open'),2800)}
// A failure must not go into a bottom toast that vanishes in 2.8 seconds: it sits far from the
// controls, cannot be copied, and there is no time to read it. Everything goes to the red bar at
// the top and stays until dismissed. HTTP codes get translated into plain language too, 401 above
// all: restarting the panel rotates the token, so every write from an older page is refused.
// Do not use a regex escape such as \b here: the whole SCRIPT is a template literal, so \b is
// consumed as a backspace before the pattern is built and it can never match. Compare plain strings.
function failureText(error){const code=error&&error.code;const message=String(error&&error.message||'');if(code==='unauthorized'||message.indexOf('401')>=0)return t('token_stale');if(code==='ab_report_missing')return t('need_ab_first');if(code==='not_configured')return t('not_configured');return t('operation_failed')+': '+message}
function alertTop(error){const node=document.getElementById('alert');if(!node)return;node.innerHTML='<div class="alert"><span>'+esc(typeof error==='string'?error:failureText(error))+'</span><button class="btn quiet" data-action="dismiss-alert">'+esc(t('dismiss'))+'</button></div>';node.scrollIntoView&&node.scrollIntoView({block:'nearest'})}
function clearAlert(){const node=document.getElementById('alert');if(node)node.innerHTML=''}
// A slow request with no feedback reads as a dead button, and the click gets repeated. That is not
// merely noise: widen-timeout multiplies the recall budget by three per click, so four impatient
// taps turn an 800ms budget into 64s. Every action that returns a promise therefore owns a spinner
// for its whole flight. aria-disabled rather than disabled keeps focus on the button the user just
// pressed, since disabling an element mid-click hands focus back to the body. A repaint replaces
// the node, so the released attributes are skipped once it is no longer connected.
function markPending(node,result){
  if(!node||!result||typeof result.finally!=='function')return result;
  node.setAttribute('data-pending','true');node.setAttribute('aria-busy','true');node.setAttribute('aria-disabled','true');
  return result.finally(()=>{if(!node.isConnected)return;node.removeAttribute('data-pending');node.removeAttribute('aria-busy');node.removeAttribute('aria-disabled')})
}
function renderOverview(){const data=state.data.overview;if(!data)return skeleton();const report=data.report;const health=data.health;const delivery=report.delivery;const rate=pct(delivery.fulltext_open_rate);const share=function(value){return Math.max(0,Math.min(100,(Number(value)||0)*100))};
const chain=function(){var out=1;for(var i=0;i<arguments.length;i++){var v=arguments[i];if(v===null||v===undefined)return null;out*=Number(v)}return out};
const deliveryRate=delivery.delivery_rate;const openRate=delivery.fulltext_open_rate;const topShare=delivery.top1_open_share;
let hero='<section class="masthead"><div><h2 class="t-md">'+esc(t('north_star'))+'</h2>'+heroFigure(rate)+'<p class="prose">'+esc(rate?t('north_star_help'):t('no_consumption'))+'</p></div>'
+'<div><div class="eyebrow" style="margin-bottom:var(--sp-4)">'+esc(t('recall_funnel'))+'</div>'
+funnel([{name:t('delivery_rate'),value:pct(deliveryRate),width:share(deliveryRate)},
{name:t('north_star'),value:pct(chain(deliveryRate,openRate)),width:share(chain(deliveryRate,openRate))},
{name:t('top1_open'),value:pct(chain(deliveryRate,openRate,topShare)),width:share(chain(deliveryRate,openRate,topShare))}])
+'<p class="footnote">'+esc(t('funnel_help'))+'</p></div></section>';
  // This tile counts only recalls whose component_version matches the current recall stack, while the
  // abstain rate beside it spans the whole window. Labelled "recalls in this window" it read as the
  // total and was off by an order of magnitude (165 shown against 1814 actual), so it now names its
  // scope and carries the older-version count it excludes.
  const historicalRecalls=report.performance.historical_runtime_samples;
  const activity='<div class="stats">'+metric(t('current_recalls'),num(report.performance.current_runtime.samples),historicalRecalls>0?t('historical_recalls').replace('{n}',num(historicalRecalls)):'')+metric(t('abstain_rate'),pct(report.performance.retrieval_abstain_rate),t('abstain_hint')+abstainBySurface(report))+'</div>'
// Three rates sitting side by side with three different denominators cannot be read against one
// another; name the funnel once instead of repeating a denominator under every tile.
;
  let corpus=health?'<div class="stats">'+metric(t('active_memories'),num(health.corpus.active_topics))+metric(t('corpus_size'),bytes(health.corpus.active_bytes))+metric(t('schema_errors'),num(health.corpus.schema_errors))+metric(t('evaluation_coverage'),health.evaluation.available?pct(health.evaluation.topic_coverage):null,health.evaluation.available?'':t('evaluation_unavailable'))+'</div>':empty(null,data.health_error||t('unavailable'));
  const gaps=report.data_quality.gaps.length;const recs=report.recommendations.length;const quality=report.gates.current.quality_lock;const qualityState=quality.lock_exists?(quality.lock_valid?t('valid'):t('invalid')):null;// The card was titled after evidence gaps while actually holding recommendations and the quality
// lock, which demoted its own subject to a footnote. Title it after what it holds and give the
// gap count a real slot.
const evidence='<div class="stats">'+metric(t('data_gaps'),num(gaps))+metric(t('recommendations'),num(recs))+metric(t('quality_lock'),qualityState)+'</div>';
  // The panel used to show only the count, so "3 recommended actions" could not be acted on without
  // dropping to the CLI, even though the report carries action/evidence/impact/cost for each one.
  // The action text is localized by code; evidence stays as produced because it is a measured figure.
  // An unknown code falls back to the English action rather than rendering a raw key.
  const recRows=report.recommendations.map(item=>'<tr><td>'+esc(M['rec_'+item.code]||item.action)+'</td><td>'+esc(item.evidence)+'</td><td class="num">'+esc(M['level_'+item.impact]||item.impact)+'</td><td class="num">'+esc(M['level_'+item.cost]||item.cost)+'</td></tr>').join('');
  const recTable=recRows?'<div class="tablewrap"><table><thead><tr><th>'+esc(t('column_action'))+'</th><th>'+esc(t('column_evidence'))+'</th><th class="num">'+esc(t('column_impact'))+'</th><th class="num">'+esc(t('column_cost'))+'</th></tr></thead><tbody>'+recRows+'</tbody></table></div>':'';
  return hero+'<div class="panel" style="margin-bottom:var(--sp-5)">'+activity+'</div>'+'<div class="grid">'+card(t('corpus_title'),corpus,'','c7')+card(t('evidence_gates'),evidence,'','c5')+(recTable?card(t('recommendations'),recTable,'',''):'')+'</div>'}
function renderPerformance(){const data=state.data.overview;if(!data)return skeleton();const report=data.report;const perf=report.performance;const current=perf.current_runtime;const context=report.context;const latency='<div class="stats">'+metric(t('p50'),ms(current.total_ms.p50))+metric(t('p95'),ms(current.total_ms.p95))+metric(t('p99'),ms(current.total_ms.p99))+metric(t('cold_share'),current.total_ms.samples?pct(current.cold_ms.samples/current.total_ms.samples):null)+metric(t('cache_hit'),perf.cache_hit_observed?pct(perf.cache_hit_rate):null)+metric(t('snapshot_degradation'),pct(perf.snapshot_degradation.rate))+'</div>'
// "Unavailable" alone cannot distinguish "no data yet" from "structurally unmeasurable", and two
// of these six are the latter. The CLI report already says why; the panel used to drop that.
+'<div class="prose">'+esc(t('performance_help'))+'</div>';
  const channelRows=Object.entries(perf.channels||{}).sort((a,b)=>b[1].candidates-a[1].candidates).map(([name,item])=>'<tr><td>'+termLabel('channel_',name)+'</td><td class="num">'+(item.candidates?esc(num(item.candidates)):status(t('empty_slot'),'warn'))+'</td><td class="num">'+esc(num(item.queries_with_candidates))+'</td></tr>').join('');
  const channels='<div class="tablewrap"><table><thead><tr><th>'+esc(t('column_channel'))+'</th><th class="num">'+esc(t('column_candidates'))+'</th><th class="num">'+esc(t('column_queries'))+'</th></tr></thead><tbody>'+channelRows+'</tbody></table></div><div class="prose">'+esc(t('channels_help'))+'</div>';
  const queryRows=Object.entries(perf.query_classes||{}).sort((a,b)=>b[1]-a[1]).map(([name,count])=>'<tr><td>'+termLabel('class_',name)+'</td><td class="num">'+esc(num(count))+'</td></tr>').join('');
  // The empty state used to borrow "no candidates in this window", which belongs to a channel row
  // and says the wrong thing here: an empty table means no queries were classified at all.
  const queryTypes=queryRows?'<div class="tablewrap"><table><tbody>'+queryRows+'</tbody></table></div><div class="prose">'+esc(t('query_types_help'))+'</div>':empty(null,t('no_queries'));
  const cost='<div class="stats">'+metric(t('token_p50'),num(context.estimated_tokens.p50))+metric(t('token_p95'),num(context.estimated_tokens.p95))+metric(t('truncation'),pct(context.truncation_rate))+'</div>'
  // These three come from currentContextRecalls, whose "current" means the current budgeting policy,
  // not the current recall stack: it filters the whole window. Neighbouring tiles on this page are
  // version-scoped, so the difference has to be stated rather than inferred from a variable name.
  +'<div class="prose">'+esc(t('context_cost_help'))+'</div>';
  return '<div class="grid">'+card(t('performance_title'),latency,'','')+card(t('channels'),channels,'','c7')+card(t('query_types'),queryTypes,'','c5')+card(t('context_cost'),cost,'','')+'</div>'}
function renderQuality(){const overview=state.data.overview;const benchmark=state.data.benchmark;if(!overview)return skeleton();const health=overview.health;const queue=overview.feedback_queue;let evalBody=health&&health.evaluation.available?'<div class="stats">'+metric(t('evaluation_coverage'),pct(health.evaluation.topic_coverage))+metric(t('golden'),num(health.evaluation.golden_cases))+metric(t('negative'),num(health.evaluation.negative_cases))+'</div>':empty(null,t('evaluation_unavailable'));
  let feedbackBody=queue&&queue.pending.length?'<div class="tablewrap"><table><thead><tr><th>'+esc(t('column_type'))+'</th><th>'+esc(t('column_query'))+'</th><th class="num">'+esc(t('column_expected'))+'</th><th class="num">'+esc(t('column_time'))+'</th></tr></thead><tbody>'+queue.pending.map(item=>'<tr><td>'+status(item.verdict==='retrieval_miss'?t('miss'):t('wrong'),item.verdict==='retrieval_miss'?'warn':'bad')+'</td><td>'+esc(item.query)+'</td><td class="num">'+esc(item.expected||t('unavailable'))+'</td><td class="num">'+esc(when(item.recorded_at))+'</td></tr>').join('')+'</tbody></table></div>':empty(null,t('feedback_empty'));
  // Same verdict as step 4 reads, from the same field. This card used to score the run on
// recommended_weight_safe alone and stamped a tie green, which is the exact reading that let a
// channel with no measured benefit look certified.
let abBody=empty(null,t('ab_empty'));if(benchmark&&benchmark.latest){const latest=benchmark.latest;const proven=latest.guard&&latest.guard.verdict==='improves';const measured=latest.guard&&latest.guard.verdict==='regresses';const tone=!latest.component_current?'warn':proven?'ok':measured?'bad':'warn';const label=!latest.component_current?t('stale_report'):proven?t('guard_passed'):measured?t('guard_failed'):t('ab_no_gain');const golden=latest.metrics&&latest.metrics.golden;const negative=latest.metrics&&latest.metrics.negative;
// holdoutNotWorse feeds the guard that decides whether weighted mode may be unlocked, so hiding
// the row hid one of the reasons behind the verdict. Absent holdout cases stay "unavailable"
// rather than being rendered as a zero.
const holdout=latest.metrics&&latest.metrics.holdout;// The two rows carry different metrics (top-1 hit rate against abstain rate) under one pair of
// column heads, so four bare percentages sat there with nothing saying what any of them measured.
// Name the metric on each row, and use the mode names as the column heads so this table stops
// inventing a second vocabulary for the two modes.
abBody=status(label,tone)+'<div class="tablewrap"><table style="margin-top:14px"><thead><tr><th></th><th class="num">'+esc(t('observe_mode'))+'</th><th class="num">'+esc(t('weighted_mode'))+'</th></tr></thead><tbody><tr><td>'+esc(t('golden'))+' <span class="sub">'+esc(t('recall_at_1'))+'</span></td><td class="num">'+esc(golden?pct(golden.a.recall_at_1):t('unavailable'))+'</td><td class="num">'+esc(golden?pct(golden.b.recall_at_1):t('unavailable'))+'</td></tr><tr><td>'+esc(t('negative'))+' <span class="sub">'+esc(t('abstain_rate'))+'</span></td><td class="num">'+esc(negative?pct(negative.a.abstain_rate):t('unavailable'))+'</td><td class="num">'+esc(negative?pct(negative.b.abstain_rate):t('unavailable'))+'</td></tr><tr><td>'+esc(t('holdout'))+' <span class="sub">'+esc(t('recall_at_1'))+'</span></td><td class="num">'+esc(holdout&&holdout.a?pct(holdout.a.recall_at_1):t('unavailable'))+'</td><td class="num">'+esc(holdout&&holdout.b?pct(holdout.b.recall_at_1):t('unavailable'))+'</td></tr></tbody></table></div><div class="prose">'+esc(t('ab_table_help'))+'</div>'}
  // quality_lock means the lock file's validity on the overview; reusing it as this card's title
  // made one label stand for two different things across pages.
  return '<div class="grid">'+card(t('evaluation_title'),evalBody,'','c5')+card(t('feedback'),feedbackBody,queue&&queue.pending.length?num(queue.pending.length)+' '+t('unit_items'):'','c7')+card(t('ab_evidence'),abBody,'','')+'</div>'}
function renderGovernance(){const overview=state.data.overview;const locks=state.data.locks;if(!overview||!locks)return skeleton();const health=overview.health;let quotaBody=locks.quota.valid&&health?'<div class="stats">'+// The foot is the quota ceiling; unlabelled it reads as the current value shown twice, because a fully ratcheted lock makes the two identical.
metric(t('active_memories'),num(health.corpus.active_topics),t('quota_limit')+' '+num(locks.quota.value.max_active_l3)+' '+t('unit_items'))+metric(t('corpus_size'),bytes(health.corpus.active_bytes),t('quota_limit')+' '+bytes(locks.quota.value.max_active_bytes))+'</div><div class="prose">'+esc(t('zero_net_growth'))+'</div>':empty(null,t('quota_missing'));
  const maintenance=overview.report.maintenance;const maintenanceBody='<div class="stats">'+metric(t('proposals'),num(maintenance.proposals))+metric(t('orphans'),num(maintenance.orphans))+metric(t('drift'),num(maintenance.drift))+metric(t('builds'),num(maintenance.builds))+'</div>'
// The first three are a snapshot of the last maintenance scan while builds is a running total for
// the window. Four tiles in one card read as one shared denominator unless that is spelled out.
+'<div class="prose">'+esc(t('maintenance_help'))+'</div>';
  let reviews=locks.review.upcoming||[];let reviewBody=reviews.length?'<div class="tablewrap"><table><thead><tr><th class="num">'+esc(t('column_memory'))+'</th><th class="num">'+esc(t('column_due'))+'</th><th class="num">'+esc(t('column_remaining'))+'</th><th>'+esc(t('column_status'))+'</th></tr></thead><tbody>'+reviews.map(item=>'<tr><td class="num">'+esc(item.name)+'</td><td class="num">'+esc(item.review_by)+'</td><td class="num">'+esc(item.overdue?t('overdue'):num(item.days_left)+' '+t('unit_days'))+'</td><td>'+status(item.overdue?t('overdue'):t('scheduled'),item.overdue?'bad':'')+'</td></tr>').join('')+'</tbody></table></div>':empty(null,t('review_empty'));
  const queue=locks.candidates||{available:false,waiting:0,rejected:0,items:[]};
  // Read-only on purpose: declining a lead is a judgement that has to carry a reason, and this
  // console's write surface is embedding configuration. So it shows the queue and hands over the
  // command instead of putting a one-click Decline next to a lead nobody has read.
  const queueBody=!queue.available?empty(null,String(queue.error||'')):(queue.waiting===0&&queue.rejected===0?empty(null,t('review_queue_empty')):'<div class="stats">'+metric(t('queue_waiting'),num(queue.waiting))+metric(t('queue_rejected'),num(queue.rejected))+'</div>'+(queue.items.length?'<div class="tablewrap"><table><thead><tr><th>'+esc(t('column_memory'))+'</th></tr></thead><tbody>'+queue.items.map(item=>'<tr><td><code>'+esc(item.kind)+'</code> '+esc(item.label)+'</td></tr>').join('')+'</tbody></table></div>':'')+'<div class="prose">'+esc(t('review_queue_help'))+'</div>');
  // Promotion governance. Read only, same rule as the review queue above: approving a change,
// retiring a memory or clearing a quarantine each carry a reason, and this console writes
// embedding configuration and nothing else.
//
// Two of the four surfaces have no collector in this build. They render as unavailable rather than
// as a zero, because a zero here would say nothing has been quarantined when the truth is that
// nothing has been looked at yet. NOTE: inside a template literal, so no backticks below.
  const gov=locks.governance||null;
  // Three ways to have no numbers, and each one sends the reader somewhere different: wire a
  // collector in, repair the file it reads, or fix the producer that handed back a shape this page
  // refuses. One shared phrase would point at the wrong fix two times out of three.
  const ABSENCE={'collector-not-wired':'gov_not_wired','source-unreadable':'gov_source_unreadable','collector-malformed':'gov_collector_refused'};
  function govCounts(block,entryKey){return '<div class="stats">'+metric(t(entryKey),num(block.entries))+metric(t('gov_sample'),num(block.sample))+metric(t('gov_denominator'),num(block.denominator))+'</div>'}
  function govDisposition(value){return t(value==='needs-approval'?'gov_needs_approval':value==='needs-a-person-to-merge'?'gov_needs_merge':'gov_release_process')}
  function govBlock(block,emptyKey,entryKey,body){
    if(!block)return empty(null,t('gov_not_wired'));
    if(!block.connected)return empty(null,t(ABSENCE[block.reason_code]||'gov_not_wired'));
    if(block.sample===0)return empty(null,t(emptyKey));
    return govCounts(block,entryKey||'gov_entries')+(body?body(block):'');
  }
  const materialBody=govBlock(gov&&gov.review_material,'gov_review_material_empty','gov_entries',function(block){
    return '<div class="tablewrap"><table><thead><tr><th>'+esc(t('column_memory'))+'</th><th>'+esc(t('column_risk'))+'</th><th>'+esc(t('column_disposition'))+'</th></tr></thead><tbody>'
      +block.items.map(function(item){return '<tr><td>'+esc(item.memory_id||'')+'</td><td><code>'+esc(item.risk)+'</code></td><td>'+esc(govDisposition(item.disposition))+'</td></tr>'}).join('')
      +'</tbody></table></div><div class="prose">'+esc(t('gov_review_material_help'))+'</div>';
  });
  // Both row shapes now come from the tripwire collector, so only fields it really produces are
  // drawn here. An observation window that is still open is the one a reader has to act on, so the
  // exposure count is shown against the count that would close it rather than on its own.
  const windowBody=govBlock(gov&&gov.observation_window,'gov_observation_empty','gov_watching',function(block){
    return '<div class="tablewrap"><table><thead><tr><th>'+esc(t('column_memory'))+'</th><th>'+esc(t('column_status'))+'</th><th class="num">'+esc(t('gov_observations'))+'</th></tr></thead><tbody>'
      +block.items.map(function(item){return '<tr><td>'+esc(item.memory_id||'')+'</td><td>'+status(t(item.open?'gov_window_open':'gov_window_closed'),item.open?'warn':'ok')+'</td><td class="num">'+esc(num(item.observations))+' / '+esc(num(item.observations_required))+'</td></tr>'}).join('')
      +'</tbody></table></div>';
  });
  const quarantineBody=govBlock(gov&&gov.quarantine,'gov_quarantine_empty','gov_entries',function(block){
    return '<div class="tablewrap"><table><thead><tr><th>'+esc(t('column_memory'))+'</th><th>'+esc(t('column_signal'))+'</th><th class="num">'+esc(t('column_recorded'))+'</th></tr></thead><tbody>'
      +block.items.map(function(item){return '<tr><td>'+esc(item.memory_id||'')+'</td><td><code>'+esc(item.signal||'')+'</code></td><td class="num">'+esc(when(item.recorded_at))+'</td></tr>'}).join('')
      +'</tbody></table></div>';
  });
  const settlementBody=govBlock(gov&&gov.quota_settlement,'gov_quota_settlement_empty','gov_entries',function(block){
    return '<div class="tablewrap"><table><thead><tr><th>'+esc(t('column_memory'))+'</th><th>'+esc(t('column_status'))+'</th></tr></thead><tbody>'
      +block.items.map(function(item){return '<tr><td>'+esc(item.memory_id||'')+'</td><td><code>'+esc(item.verdict)+'</code></td></tr>'}).join('')
      +'</tbody></table></div>';
  });
  return '<div class="grid">'+card(t('quota'),quotaBody,'','c6')+card(t('maintenance'),maintenanceBody,'','c6')+card(t('review_due'),reviewBody,'','c6')+card(t('review_queue'),queueBody,'','c6')
    +card(t('gov_review_material'),materialBody,'','c6')+card(t('gov_quota_settlement'),settlementBody,'','c6')
    +card(t('gov_observation_window'),windowBody,'','c6')+card(t('gov_quarantine'),quarantineBody,'','c6')+'</div>'}
const STEP_KEYS=['select_provider','credentials','build_index','run_ab','enable'];
function presets(){return state.data.presets&&state.data.presets.presets||[]}
function selectedPreset(){return presets().find(item=>item.id===state.wizard.provider)||null}
function stepProgress(){const statusData=(state.data.embedding&&state.data.embedding.status)||{};const config=statusData.configured?statusData.config:null;const rec=statusData.reconciliation||null;const latest=state.data.benchmark&&state.data.benchmark.latest||null;// The server's findEmbeddingAbReport also requires the report's provider and model to match the current config;
// checking component_current alone hands anyone who switched providers a button that is certain to 409.
const providerMatches=!latest||!config||(latest.provider===config.provider&&latest.model===config.model);
const reportMatches=Boolean(latest&&latest.component_current&&config&&providerMatches);
const done=[Boolean(config||state.wizard.provider),Boolean(config),Boolean(config&&rec&&rec.stale===0&&statusData.artifact),reportMatches,Boolean(config&&config.enabled)];const pending=done.findIndex(item=>!item);return {done,config,rec,latest,statusData,reportMatches,providerMatches,current:pending<0?done.length:pending+1,completed:done.filter(Boolean).length,total:done.length}}
function stepTone(index,progressState){if(progressState.done[index])return {cls:'done',label:t('step_complete'),tone:'ok'};if(index+1===progressState.current)return {cls:'current',label:t('step_current'),tone:'warn'};return {cls:'todo',label:t('step_todo'),tone:''}}
// A finished row reads well enough from the ✓ alone and the text badge is pure noise; but state
// must never be carried by shape and colour only, so the label moves onto the ✓ aria-label where a
// screen reader still reaches it.
function stepRow(index,progressState,summary,detail){const tone=stepTone(index,progressState);const done=tone.cls==='done';const mark=done?'<div class="cmark" role="img" aria-label="'+esc(tone.label)+'">&#10003;</div>':'<div class="cmark" aria-hidden="true">'+(index+1)+'</div>';return '<div class="crow" data-state="'+tone.cls+'">'+mark+'<div class="cbody"><div class="chead"><b>'+esc(t(STEP_KEYS[index]))+'</b>'+(done?'':status(tone.label,tone.tone))+(summary?'<span class="csum">'+summary+'</span>':'')+'</div>'+(detail?'<div class="cdetail">'+detail+'</div>':'')+'</div></div>'}
function jobFor(kind){const job=state.wizard.job;return job&&job.kind===kind?job:null}
function jobError(kind){const error=state.wizard.error;if(!error||error.kind!==kind)return '';return '<div class="notice bad"><b>'+esc(t('task_failed'))+'</b><br>'+esc(error.message||'')+'</div>'}
function progress(job){if(!job)return '';const total=Number(job.total);const completed=Number(job.completed);const known=Number.isFinite(total)&&total>0&&Number.isFinite(completed);if(!known)return job.state==='running'?'<div class="progress"><i style="width:0%"></i></div>'+(job.message_code?'<div class="prose">'+esc(t('job_'+job.message_code))+'</div>':''):'';const ratio=Math.min(1,completed/total);return '<div class="progress"><i style="width:'+ratio*100+'%"></i></div><div class="footnote num">'+esc(num(completed))+' / '+esc(num(total))+'</div>'}
function primaryClass(progressState,step){return progressState.current===step?'btn':'btn quiet'}
function lockedHint(locked){return locked?'<div class="footnote">'+esc(t('locked_hint'))+'</div>':''}
function inputField(id,label,type,value,help){return '<div class="field"><label for="field-'+id+'">'+esc(label)+'</label><input id="field-'+id+'" data-field="'+id+'" type="'+(type||'text')+'" value="'+esc(value||'')+'" autocomplete="off">'+(help?'<small>'+esc(help)+'</small>':'')+'</div>'}
function stepDetailProvider(progressState){const picking=!progressState.config||state.wizard.repick;if(!picking)return '<div class="actions"><button class="btn quiet" data-action="repick">'+esc(t('choose_another'))+'</button></div>';const cards=presets().map(item=>'<button class="provider-card" type="button" data-action="pick" data-provider="'+esc(item.id)+'" aria-pressed="'+(state.wizard.provider===item.id)+'"><b>'+esc(item.id)+'</b><small>'+esc(item.default_model||item.base_url||'')+'</small>'+(item.trains_on_input?'<span class="chip chip--bad" style="margin-top:8px">'+esc(t('privacy_title'))+'</span>':'')+'</button>').join('');return '<div class="provider-grid">'+cards+'</div>'}
// The finished state no longer repeats the provider/model/key from the summary on the right:
// metric is a 25px tabular slot meant for numbers, so those three strings both look wrong in it
// and say what the summary already said.
function stepDetailCredentials(progressState){const config=progressState.config;const preset=selectedPreset();if(config&&!state.wizard.repick)return '<div class="prose">'+esc(t('mask_help'))+'</div>';if(!preset)return '<div class="footnote">'+esc(t('locked_hint'))+'</div>';const form=state.wizard.form;let fields=inputField('api_key',t('api_key'),'password',form.api_key,t('mask_help'))+inputField('model',t('model'),'text',form.model||preset.default_model);if(!preset.base_url)fields+=inputField('base_url',t('endpoint'),'url',form.base_url);(preset.extra_fields||[]).forEach(item=>{fields+=inputField(item.id,item.label||item.id,'text',form[item.id])});
// The timeout must stay editable: latency differs widely between providers and on a first connection, so the user needs a recovery path when the budget is too tight.
fields+=inputField('timeout_ms',t('timeout'),'text',form.timeout_ms||(config?config.timeout_ms:800));let result='';if(state.wizard.testing)result='<div class="notice">'+esc(t('testing'))+'</div>';else if(state.wizard.test)result=state.wizard.test.ok?'<div class="notice"><b>'+esc(t('connection_ok'))+'</b></div>':'<div class="notice bad"><b>'+esc(t('connection_failed'))+'</b><br>'+esc(state.wizard.test.category?t('hint_'+state.wizard.test.category):(state.wizard.test.message||''))+'</div>';return '<div class="form">'+fields+'</div>'+result+'<div class="actions"><button class="'+primaryClass(progressState,2)+'" data-action="test"'+(state.wizard.testing?' data-pending="true" aria-busy="true" aria-disabled="true"':'')+'>'+esc(t('test_connection'))+'</button></div>'}
function stepDetailBuild(progressState){const rec=progressState.rec;const job=jobFor('build');const locked=!progressState.config;const fresh=Boolean(rec&&rec.stale===0&&progressState.statusData.artifact);// The synced count is already in the summary on the right; only a real backlog earns its own slot.
const metrics=rec&&rec.stale>0?'<div class="stats">'+metric(t('stale'),num(rec.stale))+'</div>':'';const action=job&&job.state==='running'?'<button class="btn quiet" data-action="cancel">'+esc(t('cancel'))+'</button>':'<button class="'+primaryClass(progressState,3)+'" data-action="build"'+(locked?' disabled':'')+'>'+esc(t(fresh?'rebuild':rec&&rec.fresh?'continue_build':'start_build'))+'</button>';return '<div class="prose">'+esc(t('build_help'))+'</div>'+metrics+progress(job)+jobError('build')+'<div class="actions">'+action+'</div>'+lockedHint(locked)}
// The verdict is READ from the report, never recomputed here. This function used to derive its own
// "no gain" flag from a recall@1 delta while the server decided on recommended_weight_safe alone --
// two judgements of the same thing, and the page's was the stricter one, so the screen could warn
// about a run the button then enabled without asking. guard.verdict is now the single source and
// saturated distinguishes the two silences: a corpus that could not show a gain versus one that
// could and did not.
function abVerdict(latest,matches){if(!latest)return null;if(matches===false)return {current:false,safe:false,noGain:false,saturated:false,proven:false,label:t('report_other_provider'),tone:'warn'};const current=Boolean(latest.component_current);const verdict=latest.guard&&latest.guard.verdict;const proven=current&&verdict==='improves';const noGain=current&&(verdict==='no_change'||verdict==='uninformative'||verdict==='insufficient_evidence');const saturated=current&&verdict==='uninformative';return {current,safe:Boolean(latest.guard&&latest.guard.recommended_weight_safe),proven,noGain,saturated,label:!current?t('stale_report'):noGain?t('ab_no_gain'):proven?t('guard_passed'):t('guard_failed'),tone:!current||noGain?'warn':proven?'ok':'bad'}}
function stepDetailAb(progressState){const job=jobFor('ab');const verdict=abVerdict(progressState.latest,progressState.providerMatches);const locked=!(progressState.config&&progressState.rec&&progressState.rec.stale===0&&progressState.statusData.artifact);// The verdict phrase is already in the summary on the right, so only the explanation stays here;
// and "passed but no gain" is a heads-up rather than a failure, which .notice.bad used to render
// as a red error and overstate.
const notice=verdict&&verdict.saturated?'<div class="notice">'+esc(t('ab_no_gain_help'))+'</div>'
  :verdict&&verdict.noGain?'<div class="notice"><b>'+esc(verdict.label)+'</b></div>'
  :verdict&&verdict.tone!=='ok'?'<div class="notice bad"><b>'+esc(verdict.label)+'</b></div>':'';const action=job&&job.state==='running'?'<button class="btn quiet" data-action="cancel">'+esc(t('cancel'))+'</button>':'<button class="'+primaryClass(progressState,4)+'" data-action="ab"'+(locked?' disabled':'')+'>'+esc(t(progressState.latest?'rerun_ab':'run_ab'))+'</button>';return '<div class="prose">'+esc(t('ab_help'))+'</div>'+progress(job)+jobError('ab')+notice+'<div class="actions">'+action+'</div>'+lockedHint(locked)}
function modeCard(kind,progressState){const config=progressState.config;const enabled=Boolean(config&&config.enabled);const weighted=kind==='weighted';const live=enabled&&(weighted?config.rrf_weight>0:config.rrf_weight===0);
// The verdict must read exactly as step 4 reads it: dropping providerMatches lets a report
// from a provider the user already replaced count as valid evidence on these cards.
const verdict=abVerdict(progressState.latest,progressState.providerMatches);
// Both modes need ready vectors plus an A/B report matching the current recall stack: the server
// runs assertVectorsReady + findEmbeddingAbReport for observe too, and either one missing is a 409.
// Without locking, pressing the button only lands on an error nobody can read.
const locked=!(progressState.done[2]&&progressState.done[3]);
// Weak evidence means two different things. With nothing enabled it is advice to start with
// observation; with weighted already live it is a correction and belongs on the weighted card.
// Leaving "recommended" on the observe card tells people they chose wrong without saying why.
const unsupported=!verdict||verdict.noGain||!verdict.safe;
const advise=!weighted&&!enabled&&unsupported;
const caution=weighted&&live&&unsupported;
const label=weighted?t('enable_weighted'):enabled?t('switch_to_observe'):t('enable_observe');
const badge=live?status(t('state_effective'),'ok'):advise?status(t('recommended'),'ok'):'';// The live card no longer carries a greyed-out enable button: the badge already says it is in
// effect, and a button that cannot be pressed only reads as broken.
// Once a mode is live there is no next step left either: the remaining card is a switch and
// must not keep the weight of a primary button.
const action=live?'':'<button class="'+(weighted||enabled?'btn quiet':primaryClass(progressState,5))+'" data-action="enable" data-mode="'+kind+'"'+(locked?' disabled':'')+'>'+esc(label)+'</button>'+lockedHint(locked);
// One line for what it does, one for what it costs. Describing only the side effect leaves no
// basis for choosing, and observation is the mode most often misread as free — it still asks
// the provider for a vector on every single recall.
return '<div class="panel c6 mode'+(live?' live':'')+'"><div class="chead"><b>'+esc(weighted?t('weighted_mode'):t('observe_mode'))+'</b>'+badge+'</div><p class="plain">'+esc(weighted?t('weighted_plain'):t('observe_plain'))+'</p><div class="prose">'+esc(weighted?t('weighted_cost'):t('observe_cost'))+'</div>'+(caution?'<div class="footnote">'+esc(t('weighted_no_evidence'))+'</div>':'')+action+'</div>'}
// Turning the channel off is a global action, but it used to sit directly under the observation
// card in the left column and read as if it belonged to that card. Keep the sentence next to the
// button on one separated row so the scope of the red button is unmistakable.
function stepDetailEnable(progressState){const config=progressState.config;const enabled=Boolean(config&&config.enabled);const stop=enabled?'<div class="actions"><button class="btn danger" data-action="enable" data-mode="off">'+esc(t('disable_semantic'))+'</button><span class="prose" style="margin:0">'+esc(t('rollback'))+'</span></div>':'<div class="prose">'+esc(t('rollback'))+'</div>';return '<div class="grid">'+modeCard('observe',progressState)+modeCard('weighted',progressState)+'</div>'+stop}
function stepSummaries(progressState){const config=progressState.config;const rec=progressState.rec;const verdict=abVerdict(progressState.latest,progressState.providerMatches);const preset=selectedPreset();return [
  config?esc(config.provider):preset?esc(preset.id):'',
  config?esc(config.api_key_masked)+' '+esc(config.model):'',
  rec?esc(t('synced'))+' '+esc(num(rec.fresh)):'',
  // This one carries tone while the others stay plain text: a green check only says the step
  // is finished, so passed / no-gain / regressed has to be legible on its own. A checkmark next
  // to grey text reading "no improvement measured" cannot say whether the gate is satisfied.
  verdict?status(verdict.label,verdict.tone):'',
  '',
]}
function renderChecklist(){const progressState=stepProgress();const summaries=stepSummaries(progressState);const details=[stepDetailProvider(progressState),stepDetailCredentials(progressState),stepDetailBuild(progressState),stepDetailAb(progressState),stepDetailEnable(progressState)];const rows=STEP_KEYS.map((key,index)=>stepRow(index,progressState,summaries[index],details[index])).join('');const label=t('wizard_progress').replace('{done}',num(progressState.completed)).replace('{total}',num(progressState.total));const effective=Boolean(progressState.config&&progressState.config.enabled);const flags=status(label,progressState.completed===progressState.total?'ok':'warn')+status(effective?t('state_effective'):t('state_off'),effective?'ok':'warn');return '<div class="panel"><div class="chead chprog"><b>'+esc(t('semantic_title'))+'</b>'+flags+'</div><p class="setup-intro">'+esc(t('setup_intro'))+'</p><div class="checklist">'+rows+'</div><div class="prose prose--quiet">'+esc(t('revisit_hint'))+'</div></div>'}
function activeEmbeddingDegradation(summary){if(!summary)return null;const observed=Number(summary.observed);const degraded=Number(summary.degraded);if(!Number.isInteger(observed)||!Number.isInteger(degraded)||observed<=0||degraded<=0||degraded>observed)return null;return {...summary,observed,degraded}}
function renderSemantic(){const embedding=state.data.embedding;const events=state.data.events;if(!embedding||!state.data.presets)return skeleton();const statusData=embedding.status||{};const degradation=activeEmbeddingDegradation(events&&events.embedding_degradation);// "1 / 1" carries no meaning, so it becomes a sentence with the numbers inside it; and when every
// failure is a timeout there must be an actionable next step. Reporting the failure alone pins the
// user in place, while a slow provider or a first connection may just need a wider request budget.
let banner='';
if(degradation){const reasons=degradation.reasons||{};const timeouts=Number(reasons.timeout)||0;const config=statusData.configured?statusData.config:null;// Stop advising once the budget already covers the provider's real latency, or the banner keeps nagging about something that is already fixed.
const allTimeout=timeouts>0&&timeouts===degradation.degraded;const advice=allTimeout&&config&&config.timeout_ms<2000?' '+esc(t('degradation_timeout_hint').replace('{timeout}',ms(config.timeout_ms)))+' <button class="btn quiet" data-action="widen-timeout">'+esc(t('widen_timeout'))+'</button>':'';
  // Name the moment of the last failure: otherwise the banner still alarms after a fix and nobody can tell "failing now" from "failed once".
  const last=degradation.last_degraded_at?' '+esc(t('degradation_last').replace('{time}',when(degradation.last_degraded_at))):'';
  banner='<div class="banner" data-kind="embedding-degradation"><b>'+esc(t('degradation'))+'</b> '+esc(t('degradation_detail').replace('{observed}',num(degradation.observed)).replace('{degraded}',num(degradation.degraded)))+last+' '+esc(t('lexical_unaffected'))+advice+'</div>'}let managed='';if(statusData.configured){const config=statusData.config;const rec=statusData.reconciliation||{};// The checklist badge says "in effect" while this note said only "weighted mode"; one state
// wearing two different labels on one screen reads as two separate facts.
const mode=!config.enabled?t('configured_disabled'):(config.rrf_weight>0?t('weighted_mode'):t('observe_mode'))+' · '+t('state_effective');// Provider, model and key already appear on checklist step 2, so this holds only the technical detail the checklist lacks and avoids repeating it on one screen.
// The endpoint is a long URL and cannot go into a metric (a 25px tabular slot for short numbers, where a long string spills onto the neighbouring column).
// Only the vector count is a real number worthy of the 25px numeric slot; timeout and endpoint are configuration values and belong in the small key-value rows.
managed='<div class="grid" style="margin-top:14px">'+card(t('current_integration'),'<div class="stats">'+metric(t('vectors'),num(rec.fresh))+'</div><div class="endpoint"><label>'+esc(t('timeout'))+'</label><code>'+esc(ms(config.timeout_ms))+'</code></div><div class="endpoint"><label>'+esc(t('endpoint'))+'</label><code>'+esc(config.base_url)+'</code></div>',mode,'')+'</div>'}return '<div class="intro">'+esc(t('semantic_intro'))+'</div>'+banner+renderChecklist()+managed}
function skeleton(){return '<div class="panel"><div class="skeleton"></div><div class="prose">'+esc(t('loading'))+'</div></div>'}
const LOADERS={overview:()=>api('/api/overview?since='+state.since).then(x=>state.data.overview=x),performance:()=>Promise.all([LOADERS.overview()]),quality:()=>Promise.all([LOADERS.overview(),api('/api/benchmark/latest').then(x=>state.data.benchmark=x)]),governance:()=>Promise.all([LOADERS.overview(),api('/api/locks').then(x=>state.data.locks=x)]),semantic:()=>Promise.all([api('/api/embedding/status').then(x=>state.data.embedding=x),api('/api/embedding/presets').then(x=>state.data.presets=x),api('/api/benchmark/latest').then(x=>state.data.benchmark=x),api('/api/events?since='+state.since).then(x=>state.data.events=x)])};
const RENDERERS={overview:renderOverview,performance:renderPerformance,quality:renderQuality,governance:renderGovernance,semantic:renderSemantic};
// An unfinished setup has to stay visible on the other pages: otherwise nothing reminds you it is not in effect once you enter the key and navigate away.
function paintSetupBanner(){const node=document.getElementById('setup-banner');if(!node)return;const statusData=state.data.embedding&&state.data.embedding.status;const config=statusData&&statusData.configured?statusData.config:null;const unfinished=Boolean(config&&!config.enabled)&&state.view!=='semantic';if(!unfinished){node.innerHTML='';return}const progressState=stepProgress();const label=t('wizard_progress').replace('{done}',num(progressState.completed)).replace('{total}',num(progressState.total));node.innerHTML='<div class="banner"><b>'+esc(t('resume_setup'))+'</b> '+esc(label)+'. '+esc(t('state_off'))+'. <button class="btn quiet" data-action="goto-setup">'+esc(t('nav_semantic'))+'</button></div>'}
function paint(){document.querySelectorAll('.section').forEach(node=>node.setAttribute('data-active',node.id==='view-'+state.view));document.querySelectorAll('.nav button').forEach(node=>node.setAttribute('aria-current',node.dataset.view===state.view));document.getElementById('view-'+state.view).innerHTML=RENDERERS[state.view]();paintSetupBanner();const meta=state.data.overview;document.getElementById('generated').textContent=meta?t('generated_at')+' '+when(meta.generated_at):t('loading');const health=meta&&meta.health;document.getElementById('rail-foot').textContent=health?t('corpus_status')+' '+num(health.corpus.active_topics)+' / '+bytes(health.corpus.active_bytes):t('loading')}
function load(view,force){if(state.loading[view]&&!force)return state.loading[view];const task=LOADERS[view]().then(paint).catch(error=>alertTop(error));state.loading[view]=task;return task}
function go(view){state.view=view;paint();load(view)}
function openModal(config){state.modal={...config,opener:document.activeElement};const node=document.getElementById('modal');node.innerHTML='<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description" tabindex="-1"><h2 id="modal-title">'+esc(config.title)+'</h2><p id="modal-description">'+esc(config.body)+'</p><div class="actions"><button class="btn quiet" data-action="modal-cancel">'+esc(config.cancel)+'</button><span class="spacer"></span><button class="btn danger" data-action="modal-confirm">'+esc(config.confirm)+'</button></div></div>';node.setAttribute('data-open','true');node.querySelector('[data-action="modal-cancel"]').focus()}
function closeModal(){const opener=state.modal&&state.modal.opener;state.modal=null;const node=document.getElementById('modal');node.removeAttribute('data-open');node.innerHTML='';if(opener&&opener.isConnected)opener.focus()}
function onModalKey(event){if(!state.modal)return;if(event.key==='Escape'){event.preventDefault();closeModal();return}if(event.key!=='Tab')return;const dialog=document.querySelector('#modal .dialog');if(!dialog)return;const focusable=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];if(!focusable.length){event.preventDefault();dialog.focus();return}const first=focusable[0];const last=focusable[focusable.length-1];if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
function refreshSemantic(){state.loading.semantic=null;return load('semantic',true)}
function pollJob(id){clearTimeout(state.wizard.poll);state.wizard.poll=setTimeout(()=>api('/api/jobs/'+id).then(job=>{state.wizard.job=job;if(job.state==='running'){paint();pollJob(id);return}
// The reason for a failure stays on its own step instead of in a toast that disappears: a toast sits too far from the controls and cannot be copied.
if(job.state==='failed')state.wizard.error={kind:job.kind,message:job.error||t('task_failed')};
refreshSemantic().then(()=>{if(job.state!=='failed')flash(job.state==='done'?t('task_done'):t('task_cancelled'))})}).catch(error=>{state.wizard.error={kind:'poll',message:failureText(error)};paint()}),1000)}
function startJob(kind){state.wizard.job=null;state.wizard.error=null;return send('POST','/api/embedding/'+kind,{}).then(job=>{state.wizard.job=job;paint();pollJob(job.job_id)}).catch(error=>{if(error.code==='job_in_progress'&&error.payload&&error.payload.job){state.wizard.job=error.payload.job;paint();pollJob(error.payload.job.job_id);return}state.wizard.error={kind,message:error.message};paint()})}
function testConnection(){const preset=selectedPreset();if(!preset)return;const form=state.wizard.form;const draft={provider:preset.id,api_key:form.api_key||''};if(form.model)draft.model=form.model;if(!preset.base_url)draft.base_url=form.base_url||'';(preset.extra_fields||[]).forEach(item=>draft[item.id]=form[item.id]||'');
// Submitting without timeout_ms makes the server reset it to 800 and silently wipe the value the user just tuned.
const timeout=Number.parseInt(form.timeout_ms,10);if(Number.isInteger(timeout))draft.timeout_ms=timeout;state.wizard.testing=true;state.wizard.test=null;paint();return send('POST','/api/embedding/test',{draft}).then(result=>{state.wizard.testing=false;state.wizard.test=result;if(!result.ok){paint();return}return send('PUT','/api/embedding/config',draft).then(()=>{state.wizard.repick=false;refreshSemantic()})}).catch(error=>{state.wizard.testing=false;state.wizard.test={ok:false,message:error.message,category:error.payload&&error.payload.category};paint()})}
// One click widens the hot-path budget enough to cover a slow response or a first connection.
// provider/model/base_url must be sent back, or the server's draftEmbeddingConfig treats the
// missing fields as a new configuration; omitting api_key makes it reuse the stored one.
function widenTimeout(){const statusData=state.data.embedding&&state.data.embedding.status;const config=statusData&&statusData.configured?statusData.config:null;if(!config)return;const next=Math.min(120000,Math.max(2000,(Number(config.timeout_ms)||800)*3));return send('PUT','/api/embedding/config',{provider:config.provider,model:config.model,base_url:config.base_url,timeout_ms:next}).then(()=>refreshSemantic()).catch(error=>alertTop(error))}
function enable(mode,forced){const body={mode};if(forced){body.force=true;body.confirm=true}clearAlert();return send('POST','/api/embedding/enable',body).then(()=>{state.wizard.open=false;return refreshSemantic()}).catch(error=>alertTop(error))}
function onAction(target){const action=target.dataset.action;if(action==='pick'){const preset=presets().find(item=>item.id===target.dataset.provider);if(!preset)return;const select=()=>{state.wizard.provider=preset.id;state.wizard.form={model:preset.default_model||''};state.wizard.test=null;paint()};if(preset.trains_on_input){openModal({title:t('privacy_title'),body:t('privacy_body'),cancel:t('choose_another'),confirm:t('accept_risk'),onConfirm:select});return}select()}else if(action==='repick'){state.wizard.repick=true;state.wizard.test=null;paint()}else if(action==='widen-timeout')return widenTimeout();else if(action==='test')return testConnection();else if(action==='build')return startJob('build');else if(action==='ab')return startJob('ab');else if(action==='cancel'&&state.wizard.job)return send('POST','/api/jobs/'+state.wizard.job.job_id+'/cancel',{}).then(job=>{state.wizard.job=job;paint()}).catch(error=>alertTop(error));else if(action==='goto-setup'){state.view='semantic';paint();load('semantic')}else if(action==='enable'){const mode=target.dataset.mode;const latest=state.data.benchmark&&state.data.benchmark.latest;const unsafe=mode==='weighted'&&latest&&latest.component_current&&latest.guard.verdict!=='improves';if(unsafe){openModal({title:t('force_title'),body:t('force_body'),cancel:t('review_regressions'),confirm:t('force_enable'),onConfirm:()=>enable('weighted',true)});return}return enable(mode,false)}else if(action==='dismiss-alert')clearAlert();else if(action==='modal-cancel')closeModal();else if(action==='modal-confirm'){const fn=state.modal&&state.modal.onConfirm;closeModal();if(fn)return fn()}}
function boot(){document.querySelectorAll('.nav button').forEach(node=>node.addEventListener('click',()=>go(node.dataset.view)));document.querySelectorAll('.seg button').forEach(node=>node.addEventListener('click',()=>{state.since=node.dataset.since;document.querySelectorAll('.seg button').forEach(other=>other.setAttribute('aria-pressed',other.dataset.since===state.since));state.data={};state.loading={};paint();load(state.view,true)}));document.getElementById('refresh').addEventListener('click',event=>{state.data={};state.loading={};paint();markPending(event.currentTarget,load(state.view,true).then(()=>flash(t('refreshed'))))});document.getElementById('locale').addEventListener('change',event=>{const url=new URL(location.href);url.searchParams.set('lang',event.target.value);location.href=url.toString()});document.addEventListener('input',event=>{const target=event.target.closest('[data-field]');if(target)state.wizard.form[target.dataset.field]=target.value});document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled||target.getAttribute('aria-disabled')==='true')return;markPending(target,onAction(target))});document.addEventListener('keydown',onModalKey);if(!TOKEN){document.getElementById('view-overview').innerHTML=empty(t('token_missing'),t('token_missing_help'));return}paint();load('overview');
// The banner must be able to appear on any page, so the setup status cannot load only on the semantic page.
api('/api/embedding/status').then(payload=>{state.data.embedding=payload;paintSetupBanner()}).catch(()=>{})}
document.addEventListener('DOMContentLoaded',boot);
`;

// Inline SVG keeps the page network-free; icons use one 18-unit grid, 1.5 strokes, and currentColor.
// The brand mark is the one exception and is drawn with fills: sharing the nav stroke weight made it
// read as a sixth nav entry rather than a logo. Its form is the wiki link the memory files are wired
// with -- a bracket boundary holding one memory, which is what "your project, its own memory" means.
const ICON_PATHS = Object.freeze({
  brand: '<g fill="currentColor" stroke="none"><path d="M6.3 3H3v12h3.3v-1.6H4.7V4.6h1.6Z"/><path d="M11.7 3H15v12h-3.3v-1.6h1.6V4.6h-1.6Z"/><circle cx="9" cy="9" r="1.9"/></g>',
  overview: '<rect x="2.6" y="2.6" width="5.6" height="5.6" rx="1.5"/><rect x="9.8" y="2.6" width="5.6" height="5.6" rx="1.5"/><rect x="2.6" y="9.8" width="5.6" height="5.6" rx="1.5"/><rect x="9.8" y="9.8" width="5.6" height="5.6" rx="1.5"/>',
  performance: '<path d="M2.2 12.4h2.6l2.1-6.6 2.7 9.2 2.3-5.6h3.9"/>',
  quality: '<path d="M9 2.3l5.5 2v4.2c0 3.5-2.2 6.3-5.5 7.2-3.3-.9-5.5-3.7-5.5-7.2V4.3z"/><path d="M6.5 9l1.9 1.9 3.3-3.6"/>',
  governance: '<path d="M9 2.9v12.2"/><path d="M3.4 5.7h11.2"/><path d="M5.7 5.7L3.1 10.4h5.2z"/><path d="M12.3 5.7L9.7 10.4h5.2z"/>',
  semantic: '<circle cx="4.5" cy="5.1" r="1.9"/><circle cx="13.5" cy="4.7" r="1.9"/><circle cx="8.9" cy="13.3" r="1.9"/><path d="M6 6.5l2 5"/><path d="M12.3 6.3l-2.1 5.2"/><path d="M6.4 4.9l5.2-.2"/>',
});

function icon(name) {
  return `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

export function renderMemoryDashboardPage({ locale = 'en' } = {}) {
  const catalog = memoryDashboardCatalog(locale);
  const messages = catalog.messages;
  const nav = ['overview', 'performance', 'quality', 'governance', 'semantic']
    .map(id => `<button type="button" data-view="${id}" aria-current="${id === 'overview'}">${icon(id)}<span>${escapeHtml(messages[`nav_${id}`])}</span></button>`).join('');
  const sections = ['overview', 'performance', 'quality', 'governance', 'semantic']
    .map(id => `<section class="section" id="view-${id}" data-active="${id === 'overview'}"></section>`).join('');
  const locales = catalog.locales.map(item => `<option value="${item.id}"${item.id === catalog.locale ? ' selected' : ''}>${escapeHtml(item.nativeName)}</option>`).join('');
  const runtimeCatalog = { locale: catalog.locale, direction: catalog.direction, messages };
  return `<!doctype html>
<html lang="${catalog.locale}" dir="${catalog.direction}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(messages.page_title)}</title><style>${STYLE}</style></head>
<body><div class="shell"><aside class="rail"><div class="brand">${icon('brand')}<div class="brand-text"><b>${escapeHtml(messages.brand_name)}</b><small>${escapeHtml(messages.local_only)}</small></div></div><nav class="nav" aria-label="${escapeHtml(messages.page_title)}">${nav}</nav><div class="rail-foot" id="rail-foot">${escapeHtml(messages.loading)}</div></aside>
<main><div class="stickytop"><div class="topbar"><h1>${escapeHtml(messages.brand_name)}</h1><span class="sub" id="generated">${escapeHtml(messages.loading)}</span><span class="spacer"></span><div class="toolbar"><label for="locale">${escapeHtml(messages.language)}</label><select class="locale" id="locale">${locales}</select><div class="seg" role="group" aria-label="${escapeHtml(messages.data_window)}">${['7d', '30d', '90d'].map((window, index) => `<button type="button" data-since="${window}" aria-pressed="${index === 0}">${window}</button>`).join('')}</div><button class="ghost" type="button" id="refresh">${escapeHtml(messages.refresh)}</button></div></div><div id="alert" role="alert" aria-live="assertive"></div></div><div id="setup-banner"></div>${sections}</main></div><div id="modal"></div><div id="flash" role="status" aria-live="polite"></div><script>${SCRIPT.replace('__I18N__', safeJson(runtimeCatalog))}</script></body></html>`;
}
