/*
 * Show Yourself: file name analyzer (pure, no browser API; testable with Node).
 * Shows what a downloaded file really is when its name is disguised:
 *   facture.pdf.exe, photo<RLO>gpj.exe, "invoice.pdf          .exe", zero-width chars…
 * Philosophy: a plain "setup.exe" is NOT flagged. Only deception is.
 */
(function (root) {
  'use strict';

  // Extensions that run code when opened (or mount something that does).
  const EXEC = new Set(('exe scr com pif bat cmd vbs vbe js jse wsf wsh hta msi msp lnk url ps1 psm1 ' +
    'jar reg cpl inf scf apk app dmg pkg sh command iso img vhd vhdx appx msix xll').split(' '));
  // Extensions people trust (documents, media, archives).
  const DOC = new Set(('pdf doc docx xls xlsx ppt pptx odt ods txt rtf csv jpg jpeg png gif bmp webp ' +
    'heic mp3 mp4 mov avi wav zip rar 7z html htm eml').split(' '));

  const BIDI = /[‪-‮⁦-⁩‎‏؜]/;
  const INVISIBLE = /[​-‍⁠﻿­᠎]/;
  const FAKE_DOT = /[․﹒．。‧·܁܂]/; // look like "."
  const PADDING = /(\s{3,}|_{5,}|\.{4,})/;

  const NAMES = {
    '‪': 'LRE', '‫': 'RLE', '‬': 'PDF', '‭': 'LRO', '‮': 'RLO',
    '⁦': 'LRI', '⁧': 'RLI', '⁨': 'FSI', '⁩': 'PDI', '‎': 'LRM', '‏': 'RLM',
    '؜': 'ALM', '​': 'ZWSP', '‌': 'ZWNJ', '‍': 'ZWJ', '⁠': 'WJ', '﻿': 'BOM',
    '­': 'SHY', '᠎': 'MVS',
  };

  const basename = (p) => String(p || '').split(/[\\/]/).pop();

  /** Split a name into display tokens: {ch} for normal text, {hidden:'RLO'} for control/invisible chars. */
  function tokens(name) {
    const out = [];
    for (const ch of name) {
      if (NAMES[ch]) out.push({ hidden: NAMES[ch] });
      else if (FAKE_DOT.test(ch)) out.push({ fakeDot: ch });
      else if (out.length && typeof out[out.length - 1].ch === 'string') out[out.length - 1].ch += ch;
      else out.push({ ch });
    }
    return out;
  }

  function analyze(path) {
    const name = basename(path);
    const clean = name.replace(new RegExp(BIDI.source + '|' + INVISIBLE.source, 'g'), '');
    const parts = clean.split('.');
    const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase().trim() : '';
    const prevExt = parts.length > 2 ? parts[parts.length - 2].toLowerCase().trim() : '';
    const exec = EXEC.has(ext);
    const findings = [];

    if (exec && DOC.has(prevExt)) findings.push({ code: 'double', fake: prevExt, real: ext });
    if (BIDI.test(name)) findings.push({ code: 'bidi' });
    if (INVISIBLE.test(name)) findings.push({ code: 'invisible' });
    if (exec && PADDING.test(clean)) findings.push({ code: 'padding' });
    if (FAKE_DOT.test(name)) {
      const m = clean.match(new RegExp('(' + FAKE_DOT.source + ')([a-z0-9]{2,5})', 'i'));
      if (m && DOC.has(m[2].toLowerCase())) findings.push({ code: 'fakeDot', fake: m[2].toLowerCase() });
    }
    // A name that *looks* like it ends in a doc extension after bidi reversal (photo<RLO>gpj.exe → photoexe.jpg)
    if (BIDI.test(name) && exec) {
      const after = name.split(BIDI).pop().replace(/\.[^.]*$/, '');
      const rev = after.split('').reverse().join('').toLowerCase();
      if (DOC.has(rev)) findings.push({ code: 'reversed', fake: rev, real: ext });
    }

    // Warn only on deception: bidi tricks always; other tricks only when the real file runs code.
    const danger = findings.some((f) => f.code === 'bidi') || (exec && findings.length > 0);
    return { name, ext, exec, findings, danger, tokens: tokens(name) };
  }

  const api = { analyze, tokens, EXEC, DOC };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShowYourselfFiles = api;
})(typeof self !== 'undefined' ? self : this);
