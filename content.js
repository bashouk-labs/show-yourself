/**
 * Show Yourself: content script.
 *
 * Hover (or Tab-focus) a link, an e-mail sender or an attachment: a magnifier
 * bubble shows the REAL destination, letter by letter. The letter under the
 * cursor swells (Dock-style wave) and the inspector names it (ASCII or not,
 * what it imitates). Shift or a click expands the details.
 *
 *  - Detection logic lives in analyzer.js / files.js; this file is UI only.
 *  - Closed Shadow DOM, no innerHTML: the page can neither read nor style it.
 *  - Delegated listeners on document: works with links added later by SPAs.
 *  - Settings changes apply live (chrome.storage.onChanged), and a re-injected
 *    copy shuts the previous one down cleanly.
 */
(() => {
  'use strict';

  // After an extension reload/update, the newly injected copy takes over and
  // shuts the orphaned one down.
  if (typeof window.__showYourselfTeardown === 'function') {
    try { window.__showYourselfTeardown(); } catch (e) { /* orphaned context */ }
  }
  let alive = true;

  const Analyzer = typeof ShowYourselfAnalyzer !== 'undefined' ? ShowYourselfAnalyzer : null;
  const I18n = typeof ShowYourselfI18n !== 'undefined' ? ShowYourselfI18n : null;
  const Features = typeof ShowYourselfFeatures !== 'undefined' ? ShowYourselfFeatures : null;
  if (!Analyzer || !I18n) return;
  const t = I18n.t;

  // Every DOM listener is registered with this signal, so teardown removes them all.
  const lifetime = new AbortController();
  const on = (target, type, handler, options) =>
    target.addEventListener(type, handler, Object.assign({ signal: lifetime.signal }, options));

  window.__showYourselfTeardown = () => {
    alive = false;
    lifetime.abort();
    try {
      hide();
      closeBlocker();
      clearOutlines();
      scanObserver.disconnect();
    } catch (e) { /* best effort */ }
    if (hostElement) hostElement.remove();
  };

  // Demo pages (welcome page, test page): "Go anyway" never navigates.
  const IS_DEMO = !!document.querySelector('meta[name="show-yourself-test-page"], meta[name="show-yourself-demo"]');

  // The local test page (file://) loads a fallback copy unless told the
  // extension is there. Limited to file:// so websites cannot detect us.
  if (location.protocol === 'file:' && document.querySelector('meta[name="show-yourself-test-page"]')) {
    document.documentElement.setAttribute('data-show-yourself-extension', 'active');
  }

  // --- CONFIGURATION ---
  const SPEED_MS = { fast: 150, normal: 400, slow: 650 }; // hover time before the bubble opens
  const HIDE_DELAY_MS = 260;     // time to travel from the link to the bubble
  const VIEWPORT_MARGIN = 8;
  const GAP = 8;
  const WAVE_MAX_BOOST = 0.95;   // letter under the cursor = 1.95× bigger
  const WAVE_SPREAD = 1.9;       // how many neighbours follow the wave
  const WAVE_LIFT_PX = 4;        // the focused letter also rises a bit
  const DOMAIN_FONT_PX = 18;     // base size of the domain in the bubble
  const DOMAIN_MIN_FONT_PX = 12; // long domains shrink down to this size
  const FONT_FAMILY = 'ShowYourselfMono';
  const MONO_STACK = `"${FONT_FAMILY}", "Atkinson Hyperlegible Mono", "JetBrains Mono", "Cascadia Mono", Consolas, Menlo, monospace`;

  // --- STATE ---
  let hoverTimer = null;
  let hideTimer = null;
  let activeAnchor = null;
  let activeResult = null;
  let expanded = false;
  let hostElement = null;
  // A bubble opened on request (QR code) is pinned: hovering other links does
  // not replace it. Closed with Escape or a click elsewhere.
  let pinned = false;
  let tooltip = null;
  let ui = null;             // inspector parts of the current bubble
  let waveChars = [];        // [{ span, ch, mark }]
  let waveFrame = null;
  let pendingPointer = null; // { x, y }
  let lastPointer = null;
  let fontRequested = false;
  let blocker = null;        // full-screen warning when a trap link is clicked
  let bypassAnchor = null;   // the user chose "Go anyway" for this link

  // --- SETTINGS, TRUSTED SITES, DAILY COUNTER (chrome.storage.local) --------
  const storage = (() => {
    try { return chrome.storage && chrome.storage.local ? chrome.storage.local : null; } catch (e) { return null; }
  })();
  /** bubble: 'all' | 'risky' | 'off'; speed: 'fast' | 'normal' | 'slow' */
  const DEFAULT_SETTINGS = { enabled: true, blockClicks: true, bubble: 'all', speed: 'normal' };
  // Escape hides the bubble on this page until it is reloaded (red links still show).
  let pausedForPage = false;
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  const isOn = () => alive && settings.enabled !== false;
  let trusted = new Set();
  const countedThisPage = new Set();

  if (storage) {
    storage.get(['settings', 'trusted'], (data) => {
      if (data.settings) settings = Object.assign(settings, data.settings);
      trusted = new Set(data.trusted || []);
      refreshPage();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !alive) return;
      if (!changes.settings && !changes.trusted) return;
      if (changes.settings) settings = Object.assign({}, DEFAULT_SETTINGS, changes.settings.newValue);
      if (changes.trusted) trusted = new Set(changes.trusted.newValue || []);
      refreshPage();
    });
  }

  /** A site the user said they know: only softens non-danger verdicts. */
  function isTrusted(result) {
    if (!result.host) return false;
    return result.severity !== 'danger' && !result.host.isIP && trusted.has(result.host.registrableAscii);
  }

  function setTrusted(domain, value) {
    if (!storage) return;
    if (value) trusted.add(domain); else trusted.delete(domain);
    storage.set({ trusted: Array.from(trusted).sort() });
  }

  /** Daily buckets { 'YYYY-MM-DD': [spotted, blocked] }, kept 30 days. */
  function recordStat(index) {
    if (!storage) return;
    const day = new Date().toISOString().slice(0, 10);
    storage.get('stats', (data) => {
      const stats = data.stats || {};
      stats[day] = stats[day] || [0, 0];
      stats[day][index]++;
      const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      Object.keys(stats).forEach((d) => { if (d < cutoff) delete stats[d]; });
      storage.set({ stats });
    });
  }

  // --- FONT: Atkinson Hyperlegible Mono (Braille Institute, SIL OFL) ---
  // Designed so that 1/l/I, 0/O… are impossible to confuse. Monospace, so
  // "rn" takes two cells where "m" takes one. Loaded lazily, as raw bytes, so
  // the page CSP can't block it.
  function loadFontOnce() {
    if (fontRequested) return;
    fontRequested = true;
    let url = null;
    try {
      url = chrome.runtime.getURL('fonts/AtkinsonHyperlegibleMono.ttf');
    } catch (e) {
      return; // test-page fallback mode: system monospace fonts are used
    }
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buffer) => {
        const face = new FontFace(FONT_FAMILY, buffer, { weight: '200 800' });
        document.fonts.add(face);
        return face.load();
      })
      .then(() => { if (activeAnchor) position(activeAnchor); })
      .catch(() => { /* fallback fonts still work */ });
  }

  // --- STYLES ---
  // CSS px on purpose: the bubble follows the page zoom, like the text it
  // inspects. Every dimension is capped by the viewport.
  const STYLES = `
    :host {
      all: initial;
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
    }
    * { box-sizing: border-box; }

    .sy-bubble {
      --tint: 148, 163, 184;
      position: fixed;
      top: 0;
      left: 0;
      max-width: calc(100vw - 16px);
      padding: 7px 12px 7px 10px;
      border-radius: 18px;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      text-align: left;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.03) 50%, rgba(var(--tint),0.12)),
        rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.35),
        0 0 0 1px rgba(var(--tint), 0.45),
        0 0 18px rgba(var(--tint), 0.30),
        0 12px 30px -10px rgba(0, 0, 0, 0.55);
      opacity: 0;
      transform: translateY(4px) scale(0.96);
      transform-origin: 50% 100%;
      transition: opacity 0.16s ease, transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.3), border-radius 0.2s;
      pointer-events: none;
      user-select: none;
      cursor: pointer;
    }
    .sy-bubble.sy-visible { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
    .sy-bubble.sy-below { transform-origin: 50% 0%; }
    .sy-bubble.sy-expanded { border-radius: 16px; padding: 10px 14px 10px; cursor: default; }
    .sy-bubble.sy-official { --tint: 34, 197, 94; }
    .sy-bubble.sy-caution  { --tint: 245, 158, 11; }
    .sy-bubble.sy-danger   { --tint: 239, 68, 68; }

    /* --- Compact row: dot + domain + verdict --- */
    .sy-row { display: flex; align-items: center; gap: 9px; }
    .sy-orb {
      flex: none;
      width: 9px; height: 9px; border-radius: 50%;
      background: rgb(var(--tint));
      box-shadow: 0 0 8px rgba(var(--tint), 0.9);
    }
    .sy-official .sy-orb, .sy-danger .sy-orb { animation: sy-pulse 1.6s ease-in-out infinite; }
    @keyframes sy-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(var(--tint), 0.7), 0 0 8px rgba(var(--tint), 0.9); }
      50% { box-shadow: 0 0 0 5px rgba(var(--tint), 0), 0 0 12px rgba(var(--tint), 1); }
    }
    .sy-domain {
      display: flex;
      flex-wrap: nowrap;
      align-items: flex-end;
      min-height: 1.9em;
      font-family: ${MONO_STACK};
      font-variant-numeric: slashed-zero;
      font-feature-settings: "zero" 1;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.1;
    }
    .sy-ch {
      display: inline-block;
      --s: 1;
      --lift: 0px;
      font-size: calc(1em * var(--s));
      margin: 0 0.09em;             /* = letter-spacing 0.18em */
      transform: translateY(calc(-1 * var(--lift)));
      transition: font-size 0.09s ease-out, transform 0.09s ease-out;
      border-radius: 3px;
      text-shadow: 0 1px 6px rgba(0,0,0,0.35);
    }
    .sy-ch.sy-focus { box-shadow: 0 0 0 1px rgba(255,255,255,0.55); background-color: rgba(255,255,255,0.12); }
    .sy-ch.sy-sep { color: rgba(203,213,225,0.65); }
    .sy-verdict {
      flex: none;
      max-width: 170px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      background: rgba(var(--tint), 0.2);
      color: rgb(var(--tint));
      border: 1px solid rgba(var(--tint), 0.5);
    }
    .sy-bubble:not(.sy-official):not(.sy-caution):not(.sy-danger) .sy-verdict { color: #cbd5e1; }
    .sy-danger .sy-verdict { background: #ef4444; color: #fff; border-color: #fca5a5; }

    /* --- Letter inspector (one small line) --- */
    .sy-inspector {
      display: flex; align-items: center; gap: 7px;
      margin-top: 4px;
      font-size: 11px;
      color: rgba(226,232,240,0.85);
      white-space: nowrap;
      overflow: hidden;
    }
    .sy-glyph {
      flex: none;
      min-width: 20px; height: 20px; padding: 0 4px;
      display: inline-flex; align-items: center; justify-content: center;
      font-family: ${MONO_STACK};
      font-variant-numeric: slashed-zero;
      font-size: 14px; font-weight: 800;
      border-radius: 6px;
      background: rgba(2,6,23,0.65);
      color: #fff;
    }
    .sy-tag {
      flex: none;
      font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em;
      padding: 1px 5px; border-radius: 4px;
      background: rgba(148,163,184,0.2); color: #cbd5e1;
    }
    .sy-tag-nonascii { background: #dc2626; color: #fff; }
    .sy-desc { overflow: hidden; text-overflow: ellipsis; }
    .sy-code { flex: none; color: rgba(148,163,184,0.85); font-family: ${MONO_STACK}; font-size: 10px; }
    .sy-hint { margin-left: auto; padding-left: 8px; flex: none; color: rgba(148,163,184,0.75); font-size: 10px; }

    /* --- Details (expanded) --- */
    .sy-details { display: none; margin-top: 8px; max-width: 480px; white-space: normal; }
    .sy-expanded .sy-details { display: block; }
    .sy-expanded .sy-hint { display: none; }
    .sy-qr-note {
      position: fixed; z-index: 2147483647; width: 300px; padding: 10px 14px; border-radius: 14px;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e2e8f0;
      background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(255,255,255,0.15);
      box-shadow: 0 12px 32px rgba(0,0,0,0.35); word-break: break-word; pointer-events: none;
    }
    .sy-via { color: rgba(203,213,225,0.8); font-size: 11px; margin-bottom: 6px; }
    .sy-url-box {
      font-family: ${MONO_STACK};
      font-variant-numeric: slashed-zero;
      font-feature-settings: "zero" 1;
      font-size: 11.5px;
      background: rgba(2, 6, 23, 0.55);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 6px 9px;
      word-break: break-all;
      line-height: 1.55;
    }
    .sy-protocol-https { color: #64748b; }
    .sy-protocol-http { color: #fdba74; background: rgba(239,68,68,0.22); border: 1px solid rgba(249,115,22,0.55); border-radius: 4px; padding: 0 4px; font-weight: 700; }
    .sy-userinfo { color: #fca5a5; text-decoration: line-through; text-decoration-thickness: 2px; }
    .sy-sub { color: #64748b; letter-spacing: 0.08em; }
    .sy-reg { color: #f8fafc; font-weight: 800; letter-spacing: 0.18em; border-bottom: 2px solid rgb(var(--tint)); }
    .sy-port { color: #f59e0b; font-weight: 700; }
    .sy-path { color: #94a3b8; }
    .sy-findings { display: flex; flex-direction: column; gap: 5px; margin-top: 7px; }
    .sy-finding { padding: 6px 9px; border-radius: 9px; border-left: 3px solid; }
    .sy-finding-title { font-weight: 700; font-size: 12px; }
    .sy-finding-detail { font-size: 11.5px; margin-top: 2px; opacity: 0.92; }
    .sy-finding-danger { background: rgba(239,68,68,0.16); border-color: #ef4444; color: #fecaca; }
    .sy-finding-caution { background: rgba(245,158,11,0.14); border-color: #f59e0b; color: #fde68a; }
    .sy-finding-info { background: rgba(56,189,248,0.09); border-color: #38bdf8; color: #bae6fd; }
    .sy-footer { margin-top: 7px; color: rgba(203,213,225,0.65); font-size: 10.5px; }

    /* Highlighted characters */
    .sy-mark-caution { background-color: rgba(245,158,11,0.35); color: #fde047; outline: 1px solid rgba(251,191,36,0.85); border-radius: 3px; }
    .sy-mark-danger { background-color: #dc2626; color: #ffffff; outline: 1px solid #fca5a5; border-radius: 3px; }
    .sy-level-danger { color: #fca5a5; font-weight: 700; }
    .sy-level-caution { color: #fde68a; }

    .sy-trust {
      all: unset;
      display: inline-block;
      margin-top: 7px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      color: #bbf7d0;
      background: rgba(34,197,94,0.14);
      border: 1px solid rgba(34,197,94,0.45);
    }
    .sy-trust:hover, .sy-trust:focus-visible { background: rgba(34,197,94,0.28); }

    /* --- Click blocker (full-screen warning) --- */
    .sy-block {
      position: fixed; inset: 0;
      width: 100vw; height: 100vh;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      background: rgba(2, 6, 23, 0.72);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      color: #f8fafc;
      animation: sy-fade 0.18s ease;
    }
    @keyframes sy-fade { from { opacity: 0; } to { opacity: 1; } }
    .sy-block-card {
      width: min(460px, 100%);
      max-height: calc(100vh - 32px);
      overflow: auto;
      padding: 22px 24px 20px;
      border-radius: 20px;
      background: linear-gradient(160deg, rgba(127,29,29,0.55), rgba(15,23,42,0.97) 45%);
      border: 1px solid rgba(248,113,113,0.6);
      box-shadow: 0 0 0 1px rgba(239,68,68,0.35), 0 0 40px rgba(239,68,68,0.35), 0 24px 60px -20px rgba(0,0,0,0.8);
      text-align: center;
    }
    .sy-block-icon { width: 56px; height: 56px; margin: 0 auto 8px; display: block; }
    .sy-block-title { font-size: 19px; font-weight: 800; margin: 0 0 12px; }
    .sy-block-lead { font-size: 13px; color: #cbd5e1; margin: 0 0 6px; }
    .sy-block-domain {
      font-family: ${MONO_STACK};
      font-variant-numeric: slashed-zero;
      font-size: 24px; font-weight: 800; letter-spacing: 0.18em;
      padding: 10px 12px; margin: 0 0 14px;
      border-radius: 12px;
      background: rgba(2,6,23,0.7);
      border: 1px solid rgba(255,255,255,0.12);
      word-break: break-all;
    }
    .sy-block-why { text-align: left; margin: 0 0 16px; display: flex; flex-direction: column; gap: 6px; }
    .sy-block-actions { display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap; }
    .sy-btn {
      all: unset;
      cursor: pointer;
      padding: 10px 18px;
      border-radius: 12px;
      font-size: 14px; font-weight: 800;
    }
    .sy-btn-safe { background: #22c55e; color: #052e16; box-shadow: 0 6px 18px -6px rgba(34,197,94,0.8); }
    .sy-btn-safe:hover, .sy-btn-safe:focus-visible { background: #4ade80; }
    .sy-btn-risk { color: #fca5a5; font-weight: 600; font-size: 12.5px; text-decoration: underline; padding: 10px 8px; }
    .sy-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .sy-block-demo { margin-top: 12px; font-size: 13px; color: #86efac; font-weight: 700; }

    @media (prefers-reduced-motion: reduce) {
      .sy-bubble, .sy-ch { transition: none; }
      .sy-orb { animation: none !important; }
    }
  `;

  const FINDING_ICONS = { danger: '🚨 ', caution: '⚠️ ', info: 'ℹ️ ' };

  // --- DOM HELPERS ---

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Lazily creates the host element and its closed Shadow DOM. */
  function ensureShadowDOM() {
    if (tooltip && hostElement && hostElement.isConnected) return;
    hostElement = document.createElement('show-yourself-inspector');
    const shadow = hostElement.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    tooltip = el('div', 'sy-bubble');
    tooltip.setAttribute('role', 'tooltip');
    shadow.appendChild(style);
    shadow.appendChild(tooltip);
    document.documentElement.appendChild(hostElement);

    tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    tooltip.addEventListener('mouseleave', () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HIDE_DELAY_MS);
    });
    tooltip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(!expanded);
    });
  }

  /** Renders labels with grouped highlight spans (used in the full address). */
  function renderLabels(labels, container) {
    labels.forEach((label, i) => {
      if (i > 0) container.appendChild(document.createTextNode('.'));
      let buffer = '';
      let level = null;
      const flush = () => {
        if (!buffer) return;
        container.appendChild(level ? el('span', 'sy-mark-' + level, buffer) : document.createTextNode(buffer));
        buffer = '';
      };
      label.chars.forEach((ch, idx) => {
        const m = label.marks[idx];
        if (m !== level) { flush(); level = m; }
        buffer += ch;
      });
      flush();
    });
  }

  /** Renders the registrable domain one span per character, for the wave. */
  function renderWave(labels, container, prefix) {
    waveChars = [];
    // E-mail sender: the part before "@" too, every letter inspectable.
    for (const ch of prefix || '') {
      const info = Analyzer.describeChar(ch);
      const mark = ch === '@' ? 'sep' : info.level;
      const span = el('span', 'sy-ch' + (mark === 'sep' ? ' sy-sep' : mark ? ' sy-mark-' + mark : ''), ch);
      container.appendChild(span);
      waveChars.push({ span, ch, mark: mark === 'sep' ? null : mark });
    }
    labels.forEach((label, i) => {
      if (i > 0) {
        const dot = el('span', 'sy-ch sy-sep', '.');
        container.appendChild(dot);
        waveChars.push({ span: dot, ch: '.', mark: null });
      }
      label.chars.forEach((ch, idx) => {
        const mark = label.marks[idx];
        const span = el('span', 'sy-ch' + (mark ? ' sy-mark-' + mark : ''), ch);
        container.appendChild(span);
        waveChars.push({ span, ch, mark });
      });
    });
  }

  const BIDI_CONTROLS = new Set(['RLO', 'LRO', 'RLE', 'LRE', 'RLI', 'LRI', 'FSI', 'PDF', 'PDI', 'RLM', 'LRM', 'ALM']);

  /** Renders a file name one span per character, hidden characters made visible. */
  function renderFileWave(file, container) {
    waveChars = [];
    const ext = file.exec && file.ext ? '.' + file.ext : '';
    const last = file.tokens.map((tk) => typeof tk.ch === 'string').lastIndexOf(true);
    const push = (ch, mark, desc, code) => {
      const span = el('span', 'sy-ch' + (mark ? ' sy-mark-' + mark : ''), ch);
      container.appendChild(span);
      waveChars.push({ span, ch, mark, desc, code });
    };
    file.tokens.forEach((tk, i) => {
      if (tk.hidden) return push(BIDI_CONTROLS.has(tk.hidden) ? '⇄' : '‧', 'danger', t('c.hidden', { name: tk.hidden }), tk.hidden);
      if (tk.fakeDot) return push(tk.fakeDot, 'danger');
      const text = tk.ch;
      const cut = i === last && ext && text.toLowerCase().endsWith(ext) ? text.length - ext.length : text.length;
      Array.from(text).forEach((ch, j) => {
        if (j >= cut) push(ch, 'danger', t('c.realExt'), ext);
        else push(ch === ' ' ? '·' : ch, ch === ' ' && /\s{3,}/.test(text) ? 'caution' : null);
      });
    });
  }

  /** Short verdict for the compact bubble. */
  function verdictText(result) {
    if (result.official) return t('ui.official');
    if (isTrusted(result)) return t('ui.trusted');
    if (result.severity === 'danger') {
      const first = result.findings.find((f) => f.level === 'danger' && f.kind === 'imitate') ||
        result.findings.find((f) => f.level === 'danger');
      return '🚨 ' + (first ? first.title : t('ui.trapDefault'));
    }
    if (result.severity === 'caution') return t('ui.caution');
    return t('ui.none');
  }

  // --- RENDERING ---

  function render(result) {
    ensureShadowDOM();
    tooltip.replaceChildren();
    const status = result.official || isTrusted(result) ? 'official' : result.severity;
    tooltip.className = 'sy-bubble' + (status !== 'none' ? ' sy-' + status : '') + (expanded ? ' sy-expanded' : '');

    const regLabels = result.host ? result.host.labels.filter((l) => l.part === 'reg') : [];
    const subLabels = result.host ? result.host.labels.filter((l) => l.part === 'sub') : [];

    // Compact row: dot + domain + verdict
    const row = el('div', 'sy-row');
    row.appendChild(el('span', 'sy-orb'));
    const domain = el('div', 'sy-domain');
    if (result.file) renderFileWave(result.file, domain);
    else if (result.sender) renderWave(result.host.labels, domain, result.sender.email.split('@')[0] + '@');
    else renderWave(regLabels, domain);
    const len = Math.max(1, waveChars.length);
    domain.style.fontSize = Math.max(DOMAIN_MIN_FONT_PX, Math.min(DOMAIN_FONT_PX, DOMAIN_FONT_PX * 18 / len)) + 'px';
    row.appendChild(domain);
    const verdict = el('span', 'sy-verdict', verdictText(result));
    verdict.title = result.official ? t('ui.officialTitle', { name: result.official.name }) : '';
    row.appendChild(verdict);
    tooltip.appendChild(row);

    // Letter inspector
    const insp = el('div', 'sy-inspector');
    const glyph = el('span', 'sy-glyph', '🔍');
    const tag = el('span', 'sy-tag', '');
    tag.style.display = 'none';
    const desc = el('span', 'sy-desc', t('ui.idle'));
    const code = el('span', 'sy-code', '');
    const hint = el('span', 'sy-hint', t('ui.hint'));
    insp.append(glyph, tag, desc, code, hint);
    tooltip.appendChild(insp);

    // Details, shown when expanded
    const details = el('div', 'sy-details');
    if (result.via.length) {
      details.appendChild(el('div', 'sy-via',
        t('ui.via', { chain: result.via.map((v) => v.service + ' (' + v.host + ')').join(' → ') })));
    }
    const box = el('div', 'sy-url-box');
    if (result.qr) details.appendChild(el('div', 'sy-via', t('qr.from')));
    if (result.file) {
      details.appendChild(el('div', 'sy-via', t('ui.file')));
      box.appendChild(el('span', 'sy-path', result.file.tokens.map((tk) => tk.ch || tk.fakeDot || '[' + tk.hidden + ']').join('')));
    } else if (result.sender) {
      details.appendChild(el('div', 'sy-via', t('ui.sender') + (result.sender.name ? ' : ' + result.sender.name : '')));
      box.appendChild(el('span', 'sy-path', result.sender.email.split('@')[0] + '@'));
    } else box.appendChild(el('span', result.protocol === 'http:' ? 'sy-protocol-http' : 'sy-protocol-https', result.protocol + '//'));
    if (result.userinfo) box.appendChild(el('span', 'sy-userinfo', result.userinfo + '@'));
    if (subLabels.length) {
      const sub = el('span', 'sy-sub');
      renderLabels(subLabels, sub);
      sub.appendChild(document.createTextNode('.'));
      box.appendChild(sub);
    }
    const reg = el('span', 'sy-reg');
    renderLabels(regLabels, reg);
    box.appendChild(reg);
    if (result.port && !result.sender) box.appendChild(el('span', 'sy-port', ':' + result.port));
    if (result.path && !result.sender) box.appendChild(el('span', 'sy-path', result.path));
    details.appendChild(box);

    const findings = result.findings.filter((f) => f.kind !== 'unwrap');
    if (findings.length) {
      const list = el('div', 'sy-findings');
      findings.forEach((f) => {
        const item = el('div', 'sy-finding sy-finding-' + f.level);
        item.appendChild(el('div', 'sy-finding-title', FINDING_ICONS[f.level] + f.title));
        item.appendChild(el('div', 'sy-finding-detail', f.detail));
        list.appendChild(item);
      });
      details.appendChild(list);
    }
    details.appendChild(el('div', 'sy-footer',
      result.severity === 'danger' ? t('ui.footerDanger')
        : result.official ? t('ui.footerOfficial', { name: result.official.name })
          : isTrusted(result) ? t('ui.footerTrusted')
            : t('ui.footerNone')));

    // "I know this site": never offered for traps, IPs, official sites or senders
    if (storage && result.severity !== 'danger' && !result.official && result.host && !result.host.isIP && !result.sender) {
      const domainName = result.host.registrableAscii;
      const isIn = trusted.has(domainName);
      const btn = el('button', 'sy-trust', t(isIn ? 'ui.trustRemove' : 'ui.trustAdd'));
      btn.type = 'button';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setTrusted(domainName, !isIn);
        render(result);
        tooltip.classList.add('sy-visible');
        if (activeAnchor) position(activeAnchor);
      });
      details.appendChild(btn);
    }
    tooltip.appendChild(details);

    ui = { glyph, tag, desc, code };

    // Freeze the width, plus room for the ~4 letters the wave enlarges, so the
    // bubble does not wobble while the cursor moves.
    tooltip.style.width = '';
    const natural = tooltip.offsetWidth;
    const fontPx = parseFloat(domain.style.fontSize) || DOMAIN_FONT_PX;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    tooltip.style.width = Math.min(natural + Math.round(fontPx * 4), vw - 2 * VIEWPORT_MARGIN) + 'px';
  }

  function setExpanded(value) {
    if (!activeResult || expanded === value) return;
    expanded = value;
    render(activeResult);
    tooltip.classList.add('sy-visible');
    if (activeAnchor) position(activeAnchor);
    if (lastPointer) onPointerMove({ clientX: lastPointer.x, clientY: lastPointer.y });
  }

  // --- DOCK-LIKE WAVE + LETTER INSPECTOR ---

  /** Applies the wave around a fractional focus index. */
  function applyWave(focus) {
    let closest = -1;
    let closestDist = Infinity;
    waveChars.forEach((c, i) => {
      const d = i - focus;
      const g = Math.exp(-(d * d) / (2 * WAVE_SPREAD * WAVE_SPREAD));
      c.span.style.setProperty('--s', (1 + WAVE_MAX_BOOST * g).toFixed(3));
      c.span.style.setProperty('--lift', (WAVE_LIFT_PX * g).toFixed(1) + 'px');
      if (Math.abs(d) < closestDist) { closestDist = Math.abs(d); closest = i; }
    });
    waveChars.forEach((c, i) => c.span.classList.toggle('sy-focus', i === closest));
    if (closest >= 0) inspect(waveChars[closest]);
  }

  /** Tells exactly which character is under the magnifier. */
  function inspect(c) {
    if (!ui) return;
    const base = Analyzer.describeChar(c.ch);
    const info = c.desc ? { text: c.desc, ascii: base.ascii && !c.code, code: c.code || base.code, level: c.mark } : base;
    const level = c.mark === 'danger' || info.level === 'danger' ? 'danger' : (c.mark || info.level);
    ui.glyph.textContent = c.ch;
    ui.glyph.className = 'sy-glyph' + (level ? ' sy-mark-' + level : '');
    ui.tag.style.display = '';
    ui.tag.textContent = info.ascii ? 'ASCII' : 'NON-ASCII';
    ui.tag.className = 'sy-tag' + (info.ascii ? '' : ' sy-tag-nonascii');
    ui.desc.textContent = info.text;
    ui.desc.className = 'sy-desc' + (level ? ' sy-level-' + level : '');
    ui.code.textContent = info.code;
  }

  /**
   * Maps the pointer to a letter: over the bubble's domain → the letter under
   * the cursor; over the link → same relative position along the link.
   */
  function onPointerMove(event) {
    if (!activeAnchor || !waveChars.length) return;
    pendingPointer = { x: event.clientX, y: event.clientY };
    if (waveFrame) return;
    waveFrame = requestAnimationFrame(() => {
      waveFrame = null;
      if (!activeAnchor || !pendingPointer) return;
      const p = pendingPointer;
      const tr = tooltip.getBoundingClientRect();
      const overBubble = p.x >= tr.left && p.x <= tr.right && p.y >= tr.top && p.y <= tr.bottom;
      let ratio;
      if (overBubble) {
        // Use the letters' resting positions so the wave doesn't chase itself
        const first = waveChars[0].span.getBoundingClientRect();
        const last = waveChars[waveChars.length - 1].span.getBoundingClientRect();
        if (last.right <= first.left) return;
        ratio = (p.x - first.left) / (last.right - first.left);
      } else {
        const r = activeAnchor.getBoundingClientRect();
        if (r.width <= 0) return;
        ratio = (p.x - r.left) / r.width;
      }
      ratio = Math.min(1, Math.max(0, ratio));
      applyWave(ratio * (waveChars.length - 1));
    });
  }

  // --- POSITIONING ---

  /**
   * Places the bubble just above the link (or below if there is no room),
   * centred on the pointer when known, always fully inside the viewport.
   * getBoundingClientRect and position:fixed share the same coordinate space,
   * so this stays aligned at any Chrome zoom level.
   */
  function position(anchor) {
    if (!tooltip || !anchor) return;
    const rects = anchor.getClientRects();
    // Multi-line links: use the line under the pointer
    let a = anchor.getBoundingClientRect();
    if (rects.length > 1 && lastPointer) {
      for (const r of rects) {
        if (lastPointer.y >= r.top - 2 && lastPointer.y <= r.bottom + 2) { a = r; break; }
      }
    }
    // offsetWidth/Height ignore the pop-in scale animation (getBoundingClientRect does not)
    const t = { width: tooltip.offsetWidth, height: tooltip.offsetHeight };
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const room = 24; // the wave can make the domain line grow

    const fitsAbove = a.top >= t.height + room + GAP + VIEWPORT_MARGIN;
    const fitsBelow = vh - a.bottom >= t.height + room + GAP + VIEWPORT_MARGIN;
    const above = fitsAbove || (!fitsBelow && a.top > vh - a.bottom);
    let top = above ? a.top - t.height - GAP : a.bottom + GAP;
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - t.height - VIEWPORT_MARGIN));
    tooltip.classList.toggle('sy-below', !above);

    const centerX = a.left + a.width / 2;
    let left = centerX - t.width / 2;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - t.width - VIEWPORT_MARGIN));

    tooltip.style.top = Math.round(top) + 'px';
    tooltip.style.left = Math.round(left) + 'px';
  }

  // --- LIVE REFRESH (settings or trusted list changed) -----------------------
  function refreshPage() {
    if (!isOn()) { hide(); closeBlocker(); clearOutlines(); return; }
    if (activeAnchor) {
      const anchor = activeAnchor;
      hide();
      show(anchor);
    }
    clearOutlines();
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanSenders, 0);
  }

  // --- SHOW / HIDE ---

  /** Applies the "show the magnifier" preference: always, if suspicious, never. */
  function wantsBubble(result) {
    if (settings.bubble === 'off') return false;
    // A trusted destination stays silent in every mode (danger is never trusted).
    if (isTrusted(result)) return false;
    if (pausedForPage && result.severity !== 'danger') return false;
    // Links that stay on the same site are silent unless something is wrong.
    if (Analyzer.isSameSite && Analyzer.isSameSite(result, location.hostname)) return false;
    if (settings.bubble === 'risky') return result.severity !== 'none' && !result.official;
    return true;
  }

  function show(anchor, preset) {
    if (!isOn()) return;
    let result = preset || null;
    if (!result) {
      try {
        result = analyzeAnchor(anchor);
      } catch (e) {
        return; // never break the host page
      }
    }
    if (!result) return;
    countDanger(result);
    if (!preset && !wantsBubble(result)) return; // an explicit request (QR) always shows

    loadFontOnce();
    pinned = Boolean(preset);
    activeAnchor = anchor;
    activeResult = result;
    expanded = false;
    render(result);
    position(anchor);
    if (lastPointer) onPointerMove({ clientX: lastPointer.x, clientY: lastPointer.y });
    requestAnimationFrame(() => {
      if (tooltip && activeAnchor === anchor) tooltip.classList.add('sy-visible');
    });
  }

  function hide() {
    pinned = false;
    clearTimeout(hoverTimer);
    hoverTimer = null;
    activeAnchor = null;
    activeResult = null;
    pendingPointer = null;
    expanded = false;
    if (tooltip) tooltip.classList.remove('sy-visible');
  }

  // --- E-MAIL SENDERS AND ATTACHMENTS ---------------------------------------
  // Gmail: [email] attribute; any webmail: mailto: links; Outlook: titled spans.
  const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
  const SENDER_SEL = '[email], a[href^="mailto:" i], span[title*="@"]';

  /** {email, name} when the element shows an e-mail address, else null. */
  function senderInfo(node) {
    if (!(node instanceof Element)) return null;
    let email = null;
    let name = '';
    if (node.hasAttribute('email')) {
      email = node.getAttribute('email');
      name = node.getAttribute('name') || node.innerText || '';
    } else if (node.matches('a[href^="mailto:" i]')) {
      const raw = node.getAttribute('href').slice(7).split('?')[0];
      try { email = decodeURIComponent(raw); } catch (e) { email = raw; }
      name = node.innerText || '';
    } else if (node.matches('span[title*="@"]')) {
      email = node.getAttribute('title');
      name = node.innerText || '';
    }
    email = email && email.trim();
    if (!email || !EMAIL_RE.test(email)) return null;
    if (name.trim().toLowerCase() === email.toLowerCase()) name = '';
    return { email, name: name.trim().slice(0, 200) };
  }

  const FILE_SEL = '[download_url], a[download]';

  /** File name shown by an attachment element, else null. */
  function fileInfo(node) {
    if (!(node instanceof Element) || !node.matches(FILE_SEL)) return null;
    let name = '';
    if (node.hasAttribute('download_url')) name = (node.getAttribute('download_url') || '').split(':')[1] || '';
    else {
      name = node.getAttribute('download') || '';
      if (!name) { try { name = decodeURIComponent(new URL(node.href).pathname.split('/').pop()); } catch (e) { name = ''; } }
    }
    return name ? name.slice(0, 260) : null;
  }

  /** Analyses an <a> (HTML, or SVG whose href is an SVGAnimatedString). */
  function analyzeLinkElement(anchor) {
    const href = typeof anchor.href === 'string' ? anchor.href : (anchor.href && anchor.href.baseVal);
    if (!href) return null;
    const text = (anchor.innerText || anchor.textContent || '') + ' ' + (anchor.getAttribute('title') || '');
    return Analyzer.analyzeLink(href, text, document.baseURI);
  }

  /** Analyses an attachment, a sender or a link. */
  function analyzeAnchor(anchor) {
    const fileName = fileInfo(anchor);
    if (fileName) return Analyzer.analyzeFile(fileName);
    const sender = senderInfo(anchor);
    if (sender) return Analyzer.analyzeSender(sender.email, sender.name);
    return analyzeLinkElement(anchor);
  }

  function countDanger(result) {
    const key = result.file ? 'file:' + result.file.name : result.sender ? 'mail:' + result.sender.email : result.href;
    if (result.severity === 'danger' && !countedThisPage.has(key)) {
      countedThisPage.add(key);
      recordStat(0);
    }
  }

  function crossOriginLink(node) {
    if (!node.matches('a[href]')) return false;
    try { return new URL(node.getAttribute('href'), location.href).origin !== location.origin; } catch (e) { return false; }
  }

  function anchorFrom(target) {
    if (!(target instanceof Element)) return null;
    const f = target.closest(FILE_SEL);
    // Browsers ignore `download` on cross-origin links: those navigate, so judge the destination.
    if (f && fileInfo(f) && !crossOriginLink(f)) return f;
    const s = target.closest(SENDER_SEL);
    if (s && senderInfo(s)) return s;
    return target.closest('a[href]');
  }

  // Senders and attachments are scanned without hovering: suspicious ones get
  // an orange or red outline.
  let scannedSenders = new WeakSet();
  const outlined = new Set();
  let scanTimer = null;
  function clearOutlines() {
    outlined.forEach((node) => {
      ['outline', 'outline-offset', 'border-radius'].forEach((p) => node.style.removeProperty(p));
    });
    outlined.clear();
    scannedSenders = new WeakSet();
  }
  function scanSenders() {
    scanTimer = null;
    if (!document.body || !isOn()) return;
    document.querySelectorAll(FILE_SEL + ', ' + SENDER_SEL).forEach((node) => {
      if (scannedSenders.has(node)) return;
      scannedSenders.add(node);
      let r = null;
      try { r = analyzeAnchor(node); } catch (e) { return; }
      if (!r || r.severity === 'none' || isTrusted(r)) return;
      countDanger(r);
      const color = r.severity === 'danger' ? '#ef4444' : '#f59e0b';
      node.style.setProperty('outline', '2px solid ' + color, 'important');
      node.style.setProperty('outline-offset', '2px', 'important');
      node.style.setProperty('border-radius', '4px', 'important');
      outlined.add(node);
    });
  }
  const scanObserver = new MutationObserver(() => {
    if (isOn() && !scanTimer) scanTimer = setTimeout(scanSenders, 500);
  });
  scanObserver.observe(document.documentElement, { childList: true, subtree: true });
  scanTimer = setTimeout(scanSenders, 300);

  // --- QR CODES ---------------------------------------------------------------
  // Right-click an image → the background decodes it (jsQR) → the decoded link
  // is shown in a pinned bubble.
  let lastContextTarget = null;
  on(document, 'contextmenu', (event) => {
    lastContextTarget = event.target instanceof Element ? event.target : null;
  }, { capture: true, passive: true });

  let qrNote = null;
  function showQrNote(anchor, text) {
    ensureShadowDOM();
    if (qrNote) qrNote.remove();
    qrNote = el('div', 'sy-qr-note', text);
    tooltip.parentNode.appendChild(qrNote);
    const r = anchor ? anchor.getBoundingClientRect() : { left: 20, top: 20, width: 0 };
    qrNote.style.left = Math.max(8, Math.round(r.left + r.width / 2 - 150)) + 'px';
    qrNote.style.top = Math.max(8, Math.round(r.top + 8)) + 'px';
    setTimeout(() => { if (qrNote) { qrNote.remove(); qrNote = null; } }, 6000);
  }

  function onQrResult(msg) {
    if (!isOn() || !Features || !Features.isOn('qrCode')) return;
    const anchor = (lastContextTarget && lastContextTarget.isConnected) ? lastContextTarget : document.body;
    if (!msg.text) return showQrNote(anchor, t(msg.error ? 'qr.error' : 'qr.none'));
    let result = null;
    if (/^https?:\/\//i.test(msg.text.trim())) {
      try { result = Analyzer.analyzeLink(msg.text.trim(), '', document.baseURI); } catch (e) { result = null; }
    }
    if (!result) return showQrNote(anchor, t('qr.text', { text: msg.text.slice(0, 120) }));
    result.qr = true;
    clearTimeout(hideTimer);
    show(anchor, result);
  }

  /** Draws the right-clicked image (img, inline SVG or canvas) into a PNG data URL. */
  function grabImage(node) {
    return new Promise((resolve) => {
      const toPng = (source, w, h) => {
        try {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(source, 0, 0, w, h);
          resolve(c.toDataURL('image/png'));
        } catch (e) { resolve(null); } // canvas tainted by a cross-origin image
      };
      if (!node) return resolve(null);
      const canvas = node.closest('canvas');
      if (canvas) { try { return resolve(canvas.toDataURL('image/png')); } catch (e) { return resolve(null); } }
      const svg = node.closest('svg');
      const img = node.closest('img');
      if (img) {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        return w && h ? toPng(img, w, h) : resolve(null);
      }
      if (svg) {
        const r = svg.getBoundingClientRect();
        const scale = Math.max(1, 600 / Math.max(r.width, r.height, 1)); // upscale small SVGs for the decoder
        const xml = new XMLSerializer().serializeToString(svg);
        const pic = new Image();
        pic.onload = () => toPng(pic, Math.round(r.width * scale), Math.round(r.height * scale));
        pic.onerror = () => resolve(null);
        pic.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        return undefined;
      }
      return resolve(null);
    });
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!alive || !msg) return undefined;
      if (msg.type === 'sy-qr') onQrResult(msg);
      if (msg.type === 'sy-qr-grab') {
        grabImage(lastContextTarget).then((png) => sendResponse({ png }));
        return true; // async response
      }
      return undefined;
    });
  } catch (e) { /* test page: no extension APIs */ }

  // --- CLICK BLOCKER ---------------------------------------------------------

  function closeBlocker() {
    if (!blocker) return;
    blocker.remove();
    blocker = null;
  }

  /** Full-screen warning shown instead of opening a trap link. */
  function openBlocker(anchor, result, newTab) {
    ensureShadowDOM();
    closeBlocker();
    hide();
    loadFontOnce();
    recordStat(1);

    blocker = el('div', 'sy-block');
    blocker.setAttribute('role', 'alertdialog');
    blocker.setAttribute('aria-modal', 'true');
    const card = el('div', 'sy-block-card');
    try {
      const img = el('img', 'sy-block-icon');
      img.src = chrome.runtime.getURL('icons/icon-128.png');
      img.alt = '';
      card.appendChild(img);
    } catch (e) { /* test-page fallback: no icon */ }
    card.appendChild(el('div', 'sy-block-title', t('block.title')));
    card.appendChild(el('div', 'sy-block-lead', t('block.lead')));
    const dom = el('div', 'sy-block-domain');
    renderLabels(result.host.labels.filter((l) => l.part === 'reg'), dom);
    card.appendChild(dom);

    const why = el('div', 'sy-block-why');
    result.findings.filter((f) => f.level === 'danger').slice(0, 3).forEach((f) => {
      const item = el('div', 'sy-finding sy-finding-danger');
      item.appendChild(el('div', 'sy-finding-title', FINDING_ICONS.danger + f.title));
      item.appendChild(el('div', 'sy-finding-detail', f.detail));
      why.appendChild(item);
    });
    card.appendChild(why);

    const actions = el('div', 'sy-block-actions');
    const back = el('button', 'sy-btn sy-btn-safe', t('block.back'));
    back.type = 'button';
    back.addEventListener('click', closeBlocker);
    const go = el('button', 'sy-btn sy-btn-risk', t('block.go'));
    go.type = 'button';
    go.addEventListener('click', () => {
      if (IS_DEMO) {
        actions.replaceChildren(back);
        card.appendChild(el('div', 'sy-block-demo', t('block.demo')));
        back.focus();
        return;
      }
      closeBlocker();
      const dest = typeof anchor.href === 'string' ? anchor.href : new URL(anchor.getAttribute('href') || anchor.getAttribute('xlink:href'), location.href).href;
      if (newTab) {
        window.open(dest, '_blank', 'noopener');
      } else if (typeof anchor.click !== 'function') {
        location.assign(dest);
      } else {
        bypassAnchor = anchor;
        anchor.click();
        bypassAnchor = null;
      }
    });
    actions.append(back, go);
    card.appendChild(actions);
    blocker.appendChild(card);
    blocker.addEventListener('click', (event) => { if (event.target === blocker) closeBlocker(); });
    blocker.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeBlocker(); }
    });
    tooltip.parentNode.appendChild(blocker);
    back.focus();
  }

  /** Intercepts clicks (left, middle, keyboard Enter) on trap links. */
  function onLinkActivate(event) {
    if (!isOn() || !settings.blockClicks) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    if (event.type === 'click' && event.button !== 0) return;
    const anchor = event.composedPath().find((n) => n instanceof Element && n.matches('a[href]'));
    if (!anchor || anchor === bypassAnchor) return;
    let result = null;
    try {
      result = analyzeLinkElement(anchor);
    } catch (e) {
      return;
    }
    if (!result || result.severity !== 'danger') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const newTab = event.type === 'auxclick' || event.ctrlKey || event.metaKey || event.shiftKey;
    openBlocker(anchor, result, newTab);
  }
  on(window, 'click', onLinkActivate, { capture: true });
  on(window, 'auxclick', onLinkActivate, { capture: true });

  // --- DELEGATED POINTER / KEYBOARD LISTENERS ---------------------------------

  on(document, 'mouseover', (event) => {
    if (!isOn()) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (pinned) return;
    const anchor = anchorFrom(event.target);
    if (!anchor) return;
    clearTimeout(hideTimer);
    if (anchor === activeAnchor) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => show(anchor), SPEED_MS[settings.speed] || SPEED_MS.normal);
  }, { passive: true, capture: true });

  on(document, 'mousemove', (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (activeAnchor) onPointerMove(event);
  }, { passive: true, capture: true });

  on(document, 'mouseout', (event) => {
    if (pinned) return;
    const anchor = anchorFrom(event.target);
    if (!anchor) return;
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    clearTimeout(hoverTimer);
    hoverTimer = null;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }, { passive: true, capture: true });

  // A pinned bubble closes on any click outside it
  on(document, 'mousedown', (event) => {
    if (pinned && event.target !== hostElement) hide();
  }, { passive: true, capture: true });

  on(document, 'focusin', (event) => {
    if (!isOn() || pinned) return;
    const anchor = anchorFrom(event.target);
    if (!anchor) return;
    clearTimeout(hideTimer);
    clearTimeout(hoverTimer);
    show(anchor);
  }, { passive: true });

  on(document, 'focusout', (event) => {
    if (anchorFrom(event.target) === activeAnchor) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HIDE_DELAY_MS);
    }
  }, { passive: true });

  const reposition = () => { if (activeAnchor) position(activeAnchor); };
  on(window, 'scroll', reposition, { passive: true, capture: true });
  on(window, 'resize', () => {
    if (!activeResult) return;
    render(activeResult);
    tooltip.classList.add('sy-visible');
    reposition();
  }, { passive: true });

  // Shift toggles the details, Escape closes
  on(document, 'keydown', (event) => {
    if (blocker) { if (event.key === 'Escape') closeBlocker(); return; }
    if (!activeAnchor) return;
    if (event.key === 'Escape') {
      if (!pinned) pausedForPage = true; // a QR bubble just closes
      hide();
    }
    else if (event.key === 'Shift' && !event.repeat) setExpanded(!expanded);
  }, { passive: true });
})();
