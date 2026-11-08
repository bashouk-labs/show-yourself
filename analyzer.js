/**
 * Show Yourself: Analyzer (pure logic, no DOM)
 *
 * Takes a link (href + visible text) and explains in plain language where it
 * really goes and which visual tricks it uses. No network access, no storage:
 * everything is computed locally.
 *
 * Design rules:
 *  - Show facts, don't certify safety. There is no "safe" verdict, only
 *    "no known trap detected".
 *  - Avoid false alarms on legitimate sites (paypal.com must NOT be flagged),
 *    otherwise users learn to ignore the warnings.
 *
 * Loaded as a content script before content.js (shared isolated world), and
 * usable from Node for the unit tests: `node tests/analyzer.test.js`.
 */
(function (root, factory) {
  'use strict';
  var URLImpl = typeof URL !== 'undefined' ? URL : require('url').URL;
  var I18n = root && root.ShowYourselfI18n ? root.ShowYourselfI18n : require('./i18n.js');
  var Files = root && root.ShowYourselfFiles ? root.ShowYourselfFiles :
    (typeof require === 'function' ? require('./files.js') : null);
  var api = factory(URLImpl, I18n, Files);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ShowYourselfAnalyzer = api;
  }
})(typeof self !== 'undefined' ? self : this, function (URLImpl, I18n, Files) {
  'use strict';
  const t = I18n.t;

  // ---------------------------------------------------------------------------
  // 1. REFERENCE DATA
  // ---------------------------------------------------------------------------

  const LEVEL_RANK = { info: 1, caution: 2, danger: 3 };

  /**
   * Two-label public suffixes (interim list, to be replaced by the full
   * Public Suffix List). "x.co.uk" belongs to "x", not to "co.uk".
   */
  const MULTI_PART_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk', 'police.uk',
    'com.fr', 'asso.fr', 'tm.fr', 'gouv.fr', 'nom.fr',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp', 'lg.jp',
    'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
    'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in', 'firm.in',
    'co.za', 'org.za', 'gov.za',
    'com.mx', 'org.mx', 'gob.mx',
    'com.sg', 'edu.sg', 'gov.sg',
    'com.hk', 'org.hk', 'gov.hk',
    'com.tr', 'org.tr', 'gov.tr',
    'co.nz', 'org.nz', 'govt.nz', 'ac.nz',
    'co.kr', 'or.kr', 'go.kr', 'ac.kr',
    'co.il', 'org.il', 'gov.il', 'ac.il',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'com.tw', 'org.tw', 'gov.tw', 'edu.tw',
    'com.ar', 'gob.ar', 'com.co', 'gov.co', 'com.pe', 'gob.pe', 'com.ve', 'com.ec', 'com.uy',
    'com.ng', 'com.eg', 'co.ke', 'com.pk', 'com.bd', 'com.vn', 'com.my', 'com.ph',
    'co.id', 'co.th', 'in.th', 'ac.th', 'com.ua', 'com.pl', 'com.es', 'com.pt',
    'co.at', 'or.at', 'com.sa', 'com.qa', 'com.kw', 'co.ae', 'com.lb'
  ]);

  /**
   * Free hosting / tunnel platforms: anyone can create "whatever.github.io".
   * The owner of "paypal-login.github.io" is "paypal-login", not GitHub.
   */
  const HOSTING_SUFFIXES = new Set([
    'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'r2.dev',
    'web.app', 'firebaseapp.com', 'herokuapp.com', 'blogspot.com', 'wordpress.com', 'wixsite.com',
    'weebly.com', 'webflow.io', 'glitch.me', 'replit.app', 'repl.co', 'onrender.com', 'fly.dev',
    'ngrok.io', 'ngrok-free.app', 'ngrok.app', 'azurewebsites.net', 'cloudfront.net',
    's3.amazonaws.com', 'appspot.com', '000webhostapp.com', 'godaddysites.com', 'square.site',
    'carrd.co', 'framer.app', 'framer.website', 'surge.sh', 'neocities.org', 'tumblr.com',
    'myshopify.com', 'blob.core.windows.net', 'trycloudflare.com', 'loca.lt', 'duckdns.org',
    'ddns.net', 'hopto.org', 'zapto.org', 'translate.goog'
  ]);

  /** URL shorteners: the real destination is hidden. */
  const SHORTENERS = new Set([
    'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'v.gd', 'buff.ly',
    'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 't.ly', 'lnkd.in', 'tiny.cc', 's.id',
    'bl.ink', 'short.gy', 'qrco.de', 'tiny.one', 'shorturl.gg'
  ]);

  /** E-mail / newsletter click trackers (registrable domains). */
  const TRACKERS = new Set([
    'list-manage.com', 'mailchi.mp', 'sendgrid.net', 'mandrillapp.com', 'mailgun.org',
    'sparkpostmail.com', 'exacttarget.com', 'mcsv.net', 'rs6.net', 'awstrack.me', 'klclick.com',
    'klclick1.com', 'hubspotlinks.com', 'hs-sites.com', 'cmail19.com', 'cmail20.com',
    'sendibt3.com', 'sendibm1.com', 'r.mailjet.com', 'mjt.lu', 'brevo.com', 'emltrk.com'
  ]);

  /** Query parameters that commonly carry a redirect target. */
  const REDIRECT_PARAMS = new Set([
    'url', 'u', 'target', 'dest', 'destination', 'redirect', 'redirect_url', 'redirecturl', 'redirect_to',
    'return', 'returnurl', 'return_url', 'returnto', 'next', 'continue', 'goto', 'link', 'out', 'to',
    'r', 'rurl', 'forward', 'location', 'jump'
  ]);

  /**
   * TLDs common enough to recognise "something.com" written in a link text
   * without a protocol. File-like extensions (md, js, py, sh…) are excluded.
   */
  const COMMON_TLDS = new Set([
    'com', 'net', 'org', 'fr', 'de', 'uk', 'co', 'io', 'be', 'ch', 'ca', 'es', 'it', 'nl', 'eu',
    'info', 'biz', 'us', 'jp', 'au', 'br', 'in', 'ru', 'cn', 'pl', 'pt', 'se', 'no', 'dk', 'fi',
    'at', 'ie', 'gr', 'tr', 'mx', 'ar', 'me', 'tv', 'app', 'dev', 'ai', 'gov', 'edu', 'lu', 'ma',
    'tn', 'dz', 'sn', 'ci', 'cm', 'il', 'ae', 'sa', 'kr', 'tw', 'hk', 'sg', 'nz', 'za', 'ua', 'cz',
    'ro', 'hu', 're', 'xyz', 'online', 'site', 'shop', 'top', 'live', 'store', 'tech', 'cloud'
  ]);

  /** Country TLDs heavily abused (free or near-free registrations). */
  const ABUSED_CCTLDS = new Set(['tk', 'ml', 'ga', 'cf', 'gq', 'pw', 'cc', 'ws', 'su', 'co']);

  /**
   * Official domains per organisation. Contributions welcome: a missing
   * official domain = a false alarm for that brand.
   */
  const GROUPS = {
    paypal: ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal-community.com'],
    apple: ['apple.com', 'icloud.com', 'me.com', 'apple.co', 'apple.news', 'mzstatic.com', 'cdn-apple.com'],
    microsoft: ['microsoft.com', 'microsoftonline.com', 'live.com', 'outlook.com', 'office.com', 'office365.com',
      'office.net', 'sharepoint.com', 'onedrive.com', 'onedrive.live.com', 'windows.net', 'windows.com', 'azure.com',
      'bing.com', 'msn.com', 'skype.com', 'xbox.com', 'microsoft365.com', 'aka.ms', 'msft.net', 'hotmail.com'],
    google: ['google.com', 'gmail.com', 'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googleusercontent.com',
      'gstatic.com', 'googleapis.com', 'goo.gl', 'g.co', 'withgoogle.com', 'blogger.com', 'android.com',
      'googlesource.com', 'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com',
      'googleadservices.com', 'googlevideo.com', 'ggpht.com', 'forms.gle'],
    amazon: ['amazon.com', 'amazonaws.com', 'media-amazon.com', 'ssl-images-amazon.com', 'amzn.to', 'a2z.com',
      'amazon-adsystem.com', 'amazontrust.com', 'primevideo.com', 'amazon.jobs'],
    meta: ['facebook.com', 'fb.com', 'fb.me', 'facebook.net', 'fbcdn.net', 'facebookmail.com', 'meta.com',
      'messenger.com', 'instagram.com', 'cdninstagram.com', 'whatsapp.com', 'whatsapp.net', 'wa.me', 'threads.net'],
    netflix: ['netflix.com', 'netflix.net', 'nflxext.com', 'nflximg.net', 'nflxvideo.net'],
    linkedin: ['linkedin.com', 'lnkd.in', 'licdn.com'],
    dropbox: ['dropbox.com', 'dropboxusercontent.com', 'dropboxapi.com', 'dropboxstatic.com', 'db.tt'],
    docusign: ['docusign.com', 'docusign.net'],
    adobe: ['adobe.com', 'adobelogin.com', 'acrobat.com', 'adobesign.com', 'adobe.io', 'adobedtm.com'],
    dhl: ['dhl.com'],
    fedex: ['fedex.com'],
    ups: ['ups.com'],
    laposte: ['laposte.fr', 'laposte.net', 'labanquepostale.fr', 'colissimo.fr'],
    chronopost: ['chronopost.fr'],
    ameli: ['ameli.fr'],
    impots: ['impots.gouv.fr'],
    antai: ['antai.gouv.fr'],
    caf: ['caf.fr'],
    franceconnect: ['franceconnect.gouv.fr', 'franceconnect.fr'],
    orange: ['orange.fr', 'orange.com'],
    sfr: ['sfr.fr'],
    bouygues: ['bouyguestelecom.fr'],
    creditagricole: ['credit-agricole.fr', 'credit-agricole.com'],
    bnpparibas: ['bnpparibas.com', 'bnpparibas.fr', 'mabanque.bnpparibas'],
    societegenerale: ['societegenerale.fr', 'societegenerale.com'],
    lcl: ['lcl.fr'],
    boursorama: ['boursorama.com', 'boursobank.com', 'boursorama-banque.com'],
    revolut: ['revolut.com', 'revolut.me'],
    binance: ['binance.com'],
    coinbase: ['coinbase.com'],
    metamask: ['metamask.io'],
    ledger: ['ledger.com'],
    steam: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steam-chat.com'],
    roblox: ['roblox.com', 'rbxcdn.com'],
    discord: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media'],
    twitter: ['twitter.com', 'x.com', 't.co', 'twimg.com'],
    tiktok: ['tiktok.com', 'tiktokcdn.com'],
    yahoo: ['yahoo.com', 'yimg.com'],
    ebay: ['ebay.com', 'ebayimg.com'],
    spotify: ['spotify.com', 'scdn.co', 'spotify.link'],
    chase: ['chase.com'],
    wellsfargo: ['wellsfargo.com'],
    bankofamerica: ['bankofamerica.com', 'bofa.com'],
    amex: ['americanexpress.com', 'aexp.com'],
    mastercard: ['mastercard.com'],
    visa: ['visa.com'],
    github: ['github.com', 'githubusercontent.com', 'githubassets.com'],
    wetransfer: ['wetransfer.com', 'we.tl'],
    zoom: ['zoom.us', 'zoom.com'],
    telegram: ['telegram.org', 't.me', 'telegram.me'],
    airbnb: ['airbnb.com']
  };

  /**
   * Brand names watched in addresses.
   * - key: how it is written inside a domain (lowercase, no hyphen)
   * - fuzzy: false for common words (to avoid false alarms like "orage")
   * Keys of 4 characters or less only match exactly.
   */
  const BRANDS = [
    { key: 'paypal', name: 'PayPal', group: 'paypal' },
    { key: 'apple', name: 'Apple', group: 'apple' },
    { key: 'icloud', name: 'iCloud', group: 'apple' },
    { key: 'appleid', name: 'Apple ID', group: 'apple' },
    { key: 'microsoft', name: 'Microsoft', group: 'microsoft' },
    { key: 'outlook', name: 'Outlook', group: 'microsoft' },
    { key: 'office365', name: 'Office 365', group: 'microsoft' },
    { key: 'microsoft365', name: 'Microsoft 365', group: 'microsoft' },
    { key: 'onedrive', name: 'OneDrive', group: 'microsoft' },
    { key: 'sharepoint', name: 'SharePoint', group: 'microsoft' },
    { key: 'hotmail', name: 'Hotmail', group: 'microsoft' },
    { key: 'google', name: 'Google', group: 'google' },
    { key: 'gmail', name: 'Gmail', group: 'google' },
    { key: 'youtube', name: 'YouTube', group: 'google' },
    { key: 'amazon', name: 'Amazon', group: 'amazon' },
    { key: 'facebook', name: 'Facebook', group: 'meta' },
    { key: 'instagram', name: 'Instagram', group: 'meta' },
    { key: 'whatsapp', name: 'WhatsApp', group: 'meta' },
    { key: 'messenger', name: 'Messenger', group: 'meta', fuzzy: false },
    { key: 'netflix', name: 'Netflix', group: 'netflix' },
    { key: 'linkedin', name: 'LinkedIn', group: 'linkedin' },
    { key: 'dropbox', name: 'Dropbox', group: 'dropbox' },
    { key: 'docusign', name: 'DocuSign', group: 'docusign' },
    { key: 'adobe', name: 'Adobe', group: 'adobe' },
    { key: 'dhl', name: 'DHL', group: 'dhl' },
    { key: 'fedex', name: 'FedEx', group: 'fedex' },
    { key: 'ups', name: 'UPS', group: 'ups' },
    { key: 'laposte', name: 'La Poste', group: 'laposte' },
    { key: 'colissimo', name: 'Colissimo', group: 'laposte' },
    { key: 'labanquepostale', name: 'La Banque Postale', group: 'laposte' },
    { key: 'chronopost', name: 'Chronopost', group: 'chronopost' },
    { key: 'ameli', name: 'Ameli (Assurance Maladie)', group: 'ameli' },
    { key: 'impots', name: 'impots.gouv.fr', group: 'impots' },
    { key: 'antai', name: 'ANTAI (amendes)', group: 'antai' },
    { key: 'franceconnect', name: 'FranceConnect', group: 'franceconnect' },
    { key: 'orange', name: 'Orange', group: 'orange', fuzzy: false },
    { key: 'sfr', name: 'SFR', group: 'sfr' },
    { key: 'bouyguestelecom', name: 'Bouygues Telecom', group: 'bouygues' },
    { key: 'creditagricole', name: 'Crédit Agricole', group: 'creditagricole' },
    { key: 'bnpparibas', name: 'BNP Paribas', group: 'bnpparibas' },
    { key: 'societegenerale', name: 'Société Générale', group: 'societegenerale' },
    { key: 'lcl', name: 'LCL', group: 'lcl' },
    { key: 'boursorama', name: 'Boursorama', group: 'boursorama' },
    { key: 'boursobank', name: 'BoursoBank', group: 'boursorama' },
    { key: 'revolut', name: 'Revolut', group: 'revolut' },
    { key: 'binance', name: 'Binance', group: 'binance' },
    { key: 'coinbase', name: 'Coinbase', group: 'coinbase' },
    { key: 'metamask', name: 'MetaMask', group: 'metamask' },
    { key: 'ledger', name: 'Ledger', group: 'ledger', fuzzy: false },
    { key: 'steampowered', name: 'Steam', group: 'steam' },
    { key: 'steamcommunity', name: 'Steam', group: 'steam' },
    { key: 'roblox', name: 'Roblox', group: 'roblox' },
    { key: 'discord', name: 'Discord', group: 'discord' },
    { key: 'twitter', name: 'Twitter / X', group: 'twitter' },
    { key: 'tiktok', name: 'TikTok', group: 'tiktok' },
    { key: 'yahoo', name: 'Yahoo', group: 'yahoo' },
    { key: 'ebay', name: 'eBay', group: 'ebay' },
    { key: 'spotify', name: 'Spotify', group: 'spotify' },
    { key: 'chase', name: 'Chase', group: 'chase', fuzzy: false },
    { key: 'wellsfargo', name: 'Wells Fargo', group: 'wellsfargo' },
    { key: 'bankofamerica', name: 'Bank of America', group: 'bankofamerica' },
    { key: 'americanexpress', name: 'American Express', group: 'amex' },
    { key: 'mastercard', name: 'Mastercard', group: 'mastercard' },
    { key: 'github', name: 'GitHub', group: 'github' },
    { key: 'wetransfer', name: 'WeTransfer', group: 'wetransfer' },
    { key: 'zoom', name: 'Zoom', group: 'zoom' },
    { key: 'telegram', name: 'Telegram', group: 'telegram' },
    { key: 'airbnb', name: 'Airbnb', group: 'airbnb' }
  ];

  /** Every official domain → its group, for fast lookup. */
  const OFFICIAL_DOMAIN_TO_GROUP = new Map();
  Object.keys(GROUPS).forEach(function (group) {
    GROUPS[group].forEach(function (d) { OFFICIAL_DOMAIN_TO_GROUP.set(d, group); });
  });
  /** Every brand key → group (to accept "amazon.fr", "dhl.de"…). */
  const KEY_TO_GROUP = new Map();
  BRANDS.forEach(function (b) { KEY_TO_GROUP.set(b.key, b.group); });

  /**
   * Non-Latin characters that look like Latin letters (subset of Unicode
   * "confusables" focused on what is actually used in phishing).
   */
  const CONFUSABLES = {
    // Cyrillic
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j',
    'ѕ': 's', 'ӏ': 'l', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ү': 'y', 'ь': 'b', 'ѵ': 'v',
    'ӕ': 'ae', 'ɡ': 'g',
    // Greek
    'α': 'a', 'ο': 'o', 'ν': 'v', 'ρ': 'p', 'υ': 'u', 'ι': 'i', 'κ': 'k', 'χ': 'x', 'ϲ': 'c',
    // Armenian
    'օ': 'o', 'ս': 'u', 'հ': 'h', 'ո': 'n', 'ց': 'g', 'զ': 'q',
    // Latin look-alikes (not accents: real different letters)
    'ı': 'i', 'ɑ': 'a', 'ǀ': 'l', 'ɩ': 'i', 'ł': 'l', 'ȷ': 'j', 'ʟ': 'l', 'ɪ': 'i', 'ꞁ': 'l', 'ƚ': 'l',
    'ɒ': 'a', 'ß': 'b', 'ŀ': 'l', 'ɦ': 'h', 'ɱ': 'm', 'ɴ': 'n', 'ʀ': 'r', 'ʏ': 'y'
  };

  /** Pairs of characters that look alike when substituted (lowercase domains). */
  const VISUAL_PAIRS = [
    'il', 'ij', 'lj', 'i1', 'l1', 'o0', 'uv', 'vy', 'ce', 'gq', 'mn', 'hb', 'nh', 'ao'
  ].reduce(function (set, p) { set.add(p); set.add(p[1] + p[0]); return set; }, new Set());

  const DIGRAPHS = { rn: 'm', vv: 'w', cl: 'd' };

  /** Localized script name ("cyrillique" / "Cyrillic"). */
  function scriptName(s) { return t('script.' + s); }

  /** Scripts whose letters can be confused with Latin letters. */
  const LATIN_LOOKALIKE_SCRIPTS = new Set(['Cyrillic', 'Greek', 'Armenian', 'Cherokee', 'Georgian']);

  // ---------------------------------------------------------------------------
  // 2. LOW-LEVEL HELPERS
  // ---------------------------------------------------------------------------

  /** RFC 3492 Punycode decoder (xn--80ak6aa92e → аррӏе). */
  function punycodeDecode(input) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const output = [];
    let n = 128, i = 0, bias = 72;

    function adapt(delta, numPoints, firstTime) {
      let k = 0;
      delta = firstTime ? Math.floor(delta / damp) : delta >> 1;
      delta += Math.floor(delta / numPoints);
      for (; delta > ((base - tMin) * tMax) >> 1; k += base) {
        delta = Math.floor(delta / (base - tMin));
      }
      return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
    }
    function digitOf(cp) {
      if (cp >= 48 && cp <= 57) return cp - 22;
      if (cp >= 65 && cp <= 90) return cp - 65;
      if (cp >= 97 && cp <= 122) return cp - 97;
      return base;
    }

    let basic = input.lastIndexOf('-');
    if (basic < 0) basic = 0;
    for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j));

    for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
      const oldi = i;
      let w = 1;
      for (let k = base; ; k += base) {
        if (index >= input.length) throw new Error('punycode: truncated');
        const digit = digitOf(input.charCodeAt(index++));
        if (digit >= base) throw new Error('punycode: bad digit');
        i += digit * w;
        const t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
        if (digit < t) break;
        w *= base - t;
      }
      const len = output.length + 1;
      bias = adapt(i - oldi, len, oldi === 0);
      n += Math.floor(i / len);
      i %= len;
      output.splice(i++, 0, n);
    }
    return String.fromCodePoint.apply(null, output);
  }

  function decodeLabel(asciiLabel) {
    if (asciiLabel.slice(0, 4).toLowerCase() !== 'xn--') return asciiLabel;
    try {
      return punycodeDecode(asciiLabel.slice(4));
    } catch (e) {
      return asciiLabel;
    }
  }

  const SCRIPT_RANGES = [
    ['Latin', 0x00C0, 0x024F], ['Latin', 0x0250, 0x02AF], ['Latin', 0x1D00, 0x1D7F],
    ['Latin', 0x1E00, 0x1EFF], ['Latin', 0x2C60, 0x2C7F], ['Latin', 0xA720, 0xA7FF], ['Latin', 0xAB30, 0xAB6F],
    ['Inherited', 0x0300, 0x036F],
    ['Greek', 0x0370, 0x03FF], ['Greek', 0x1F00, 0x1FFF],
    ['Cyrillic', 0x0400, 0x052F], ['Cyrillic', 0x1C80, 0x1C8F], ['Cyrillic', 0x2DE0, 0x2DFF], ['Cyrillic', 0xA640, 0xA69F],
    ['Armenian', 0x0530, 0x058F], ['Hebrew', 0x0590, 0x05FF],
    ['Arabic', 0x0600, 0x06FF], ['Arabic', 0x0750, 0x077F], ['Arabic', 0x08A0, 0x08FF],
    ['Arabic', 0xFB50, 0xFDFF], ['Arabic', 0xFE70, 0xFEFF],
    ['Devanagari', 0x0900, 0x097F], ['Bengali', 0x0980, 0x09FF], ['Tamil', 0x0B80, 0x0BFF],
    ['Thai', 0x0E00, 0x0E7F], ['Georgian', 0x10A0, 0x10FF], ['Hangul', 0x1100, 0x11FF],
    ['Ethiopic', 0x1200, 0x137F], ['Cherokee', 0x13A0, 0x13FF],
    ['Hiragana', 0x3040, 0x309F], ['Katakana', 0x30A0, 0x30FF], ['Hangul', 0x3130, 0x318F],
    ['Han', 0x3400, 0x4DBF], ['Han', 0x4E00, 0x9FFF], ['Hangul', 0xAC00, 0xD7AF],
    ['Han', 0xF900, 0xFAFF], ['Han', 0x20000, 0x2FFFF]
  ];

  function scriptOf(ch) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) return /[a-z]/i.test(ch) ? 'Latin' : 'Common';
    if (cp === 0xD7 || cp === 0xF7) return 'Common';
    for (let r = 0; r < SCRIPT_RANGES.length; r++) {
      if (cp >= SCRIPT_RANGES[r][1] && cp <= SCRIPT_RANGES[r][2]) return SCRIPT_RANGES[r][0];
    }
    return 'Other';
  }

  /** Base Latin letter a character imitates ('а'→'a', 'é'→'e', 'a'→'a'). */
  function latinBase(ch) {
    if (CONFUSABLES[ch]) return CONFUSABLES[ch];
    if (ch.charCodeAt(0) < 0x80) return ch;
    const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/^[a-z]+$/.test(stripped)) return stripped;
    return ch;
  }

  function isIPv4(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  }

  function isPrivateHost(host) {
    if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]') return true;
    if (/^\[(fc|fd|fe80)/i.test(host)) return true;
    if (!isIPv4(host)) return false;
    const p = host.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || (p[0] === 192 && p[1] === 168) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 169 && p[1] === 254);
  }

  /**
   * Splits an ASCII hostname into public suffix + registrable domain.
   * "login.paypal.com.pirate.fr" → { suffix: 'fr', registrable: 'pirate.fr', subCount: 3 }
   */
  function splitHost(hostAscii) {
    const labels = hostAscii.split('.');
    let suffixLen = 1;
    if (labels.length >= 3 && HOSTING_SUFFIXES.has(labels.slice(-3).join('.'))) {
      suffixLen = 3;
    } else if (labels.length >= 2) {
      const lastTwo = labels.slice(-2).join('.');
      if (HOSTING_SUFFIXES.has(lastTwo) || MULTI_PART_SUFFIXES.has(lastTwo)) suffixLen = 2;
    }
    const regLen = Math.min(labels.length, suffixLen + 1);
    const suffix = labels.slice(-suffixLen).join('.');
    return {
      labels: labels,
      suffix: suffix,
      suffixLen: suffixLen,
      registrable: labels.slice(-regLen).join('.'),
      subCount: labels.length - regLen,
      hosting: HOSTING_SUFFIXES.has(suffix) ? suffix : null
    };
  }

  /** Is this public suffix trustworthy enough to accept "brand.<suffix>" as official? */
  function isTrustedSuffix(suffix) {
    if (suffix === 'com' || suffix === 'net' || suffix === 'org' || suffix === 'eu') return true;
    if (MULTI_PART_SUFFIXES.has(suffix)) return true;
    return /^[a-z]{2}$/.test(suffix) && !ABUSED_CCTLDS.has(suffix);
  }

  /** Groups for which a registrable domain is official ("amazon.fr" → amazon). */
  function officialGroupsOf(registrable) {
    const groups = new Set();
    if (OFFICIAL_DOMAIN_TO_GROUP.has(registrable)) groups.add(OFFICIAL_DOMAIN_TO_GROUP.get(registrable));
    const parts = splitHost(registrable);
    if (parts.labels.length > parts.suffixLen && isTrustedSuffix(parts.suffix)) {
      const sld = parts.labels[0].replace(/-/g, '');
      if (KEY_TO_GROUP.has(sld)) groups.add(KEY_TO_GROUP.get(sld));
    }
    return groups;
  }

  /**
   * Are a and b one *visual* edit apart? Returns the differing indexes in a,
   * or null. Accepted edits: look-alike substitution (l↔i, o↔0…), adjacent
   * swap (goolge), doubled letter added/removed (gooogle, gogle).
   */
  function visualDiff(a, b) {
    if (a === b) return null;
    if (a.length === b.length) {
      const diffs = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
      if (diffs.length === 1 && VISUAL_PAIRS.has(a[diffs[0]] + b[diffs[0]])) return diffs;
      if (diffs.length === 2 && diffs[1] === diffs[0] + 1 &&
        a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]]) return diffs;
      return null;
    }
    if (a.length === b.length + 1) {
      // a has an extra character: must be a doubled letter
      let k = 0;
      while (k < b.length && a[k] === b[k]) k++;
      if (a.slice(0, k) + a.slice(k + 1) === b && (a[k] === a[k - 1] || a[k] === a[k + 1])) return [k];
      return null;
    }
    if (a.length + 1 === b.length) {
      // a is missing a character: must be one of a doubled letter in b
      let k = 0;
      while (k < a.length && a[k] === b[k]) k++;
      if (b.slice(0, k) + b.slice(k + 1) === a && (b[k] === b[k - 1] || b[k] === b[k + 1])) {
        return [Math.min(k, a.length - 1)];
      }
      return null;
    }
    return null;
  }

  /**
   * Builds the ways a token can be "read" by a human:
   * 0→o, 1→l or i, rn→m, vv→w, cl→d, Cyrillic/accents → Latin.
   * Each output character remembers which source characters produced it.
   */
  function readingVariants(tokenChars) {
    const base = tokenChars.map(function (t) {
      const b = latinBase(t.ch);
      return { ch: b, src: [t.idx], changed: b !== t.ch };
    });
    function digits(oneAs) {
      return base.map(function (c) {
        if (c.ch === '0') return { ch: 'o', src: c.src, changed: true };
        if (c.ch === '1') return { ch: oneAs, src: c.src, changed: true };
        return c;
      });
    }
    function digraphs(arr) {
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const next = arr[i + 1];
        const rep = next ? DIGRAPHS[arr[i].ch + next.ch] : null;
        if (rep) {
          out.push({ ch: rep, src: arr[i].src.concat(next.src), changed: true });
          i++;
        } else {
          out.push(arr[i]);
        }
      }
      return out;
    }
    const a = digits('l');
    const b = digits('i');
    const seen = new Set();
    return [a, b, digraphs(a), digraphs(b)].filter(function (v) {
      const text = v.map(function (c) { return c.ch; }).join('');
      if (seen.has(text)) return false;
      seen.add(text);
      v.text = text;
      return true;
    });
  }

  /** Best brand match for one token (lookalike > exact > contains). */
  function matchBrand(tokenChars) {
    const variants = readingVariants(tokenChars);
    let best = null;
    const rank = { lookalike: 3, exact: 2, contains: 1 };

    variants.forEach(function (v) {
      const changedSrc = [];
      v.forEach(function (c) { if (c.changed) changedSrc.push.apply(changedSrc, c.src); });

      BRANDS.forEach(function (brand) {
        let candidate = null;
        if (v.text === brand.key) {
          candidate = changedSrc.length > 0
            ? { type: 'lookalike', brand: brand, marks: changedSrc, reading: v.text }
            : { type: 'exact', brand: brand, marks: [], reading: v.text };
        } else if (brand.key.length >= 5 && brand.fuzzy !== false) {
          const diff = visualDiff(v.text, brand.key);
          if (diff) {
            const marks = changedSrc.slice();
            diff.forEach(function (i) { if (v[i]) marks.push.apply(marks, v[i].src); });
            candidate = { type: 'lookalike', brand: brand, marks: marks, reading: v.text };
          }
        }
        if (!candidate && brand.key.length >= 6 && v.text.length > brand.key.length &&
          v.text.indexOf(brand.key) !== -1) {
          candidate = { type: 'contains', brand: brand, marks: [], reading: v.text };
        }
        if (candidate && (!best || rank[candidate.type] > rank[best.type])) best = candidate;
      });
    });
    return best;
  }

  /** Domains written in a free text ("Connexion (login.microsoft.com)"). */
  const L = 'a-z0-9\\u00c0-\\u024f\\u0370-\\u03ff\\u0400-\\u052f\\u0530-\\u058f\\u0590-\\u06ff\\u3040-\\u30ff\\u4e00-\\u9fff\\uac00-\\ud7af';
  const TEXT_DOMAIN_RE = new RegExp(
    '(https?:\\/\\/)?((?:[' + L + '](?:[' + L + '-]{0,61}[' + L + '])?\\.)+([' + L.replace('0-9', '') + ']{2,24}))(?![' + L + '-])',
    'gi'
  );

  function extractDomainsFromText(text) {
    const found = [];
    if (!text) return found;
    const sample = String(text).slice(0, 500);
    TEXT_DOMAIN_RE.lastIndex = 0;
    let m;
    while ((m = TEXT_DOMAIN_RE.exec(sample)) !== null) {
      const domain = m[2];
      const tld = m[3].toLowerCase();
      const looksLikeUrl = Boolean(m[1]) || /^www\./i.test(domain) || COMMON_TLDS.has(tld) || /[^\x00-\x7f]/.test(tld);
      if (!looksLikeUrl) continue;
      try {
        const ascii = new URLImpl('http://' + domain).hostname;
        found.push({ written: domain, ascii: ascii, registrable: splitHost(ascii).registrable });
      } catch (e) { /* not a valid hostname */ }
    }
    return found;
  }

  function safeDecode(value) {
    try { return decodeURIComponent(value); } catch (e) { return value; }
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(value || '');
  }

  /**
   * Known "link wrappers" (mail security, social networks): returns the real
   * destination hidden inside, or null.
   */
  function unwrapKnownRedirect(url) {
    const h = url.hostname;
    const p = url.pathname;
    const q = url.searchParams;
    let inner = null;
    let service = null;

    if (/^(www\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(h) && p === '/url') {
      inner = q.get('q') || q.get('url'); service = 'Google';
    } else if (/\.safelinks\.protection\.outlook\.com$/.test(h)) {
      inner = q.get('url'); service = 'Outlook SafeLinks';
    } else if ((h === 'l.facebook.com' || h === 'lm.facebook.com' || h === 'l.messenger.com') && p === '/l.php') {
      inner = q.get('u'); service = 'Facebook';
    } else if (h === 'l.instagram.com') {
      inner = q.get('u'); service = 'Instagram';
    } else if (/(^|\.)youtube\.com$/.test(h) && p === '/redirect') {
      inner = q.get('q'); service = 'YouTube';
    } else if (/(^|\.)linkedin\.com$/.test(h) && (p.indexOf('/redir/redirect') === 0 || p.indexOf('/safety/go') === 0)) {
      inner = q.get('url'); service = 'LinkedIn';
    } else if (h === 'slack-redir.net') {
      inner = q.get('url'); service = 'Slack';
    } else if (h === 'out.reddit.com') {
      inner = q.get('url'); service = 'Reddit';
    } else if (h === 'steamcommunity.com' && p.indexOf('/linkfilter') === 0) {
      inner = q.get('url') || q.get('u'); service = 'Steam';
    } else if ((h === 'vk.com' || h === 'm.vk.com') && p === '/away.php') {
      inner = q.get('to'); service = 'VK';
    } else if (h === 't.umblr.com') {
      inner = q.get('z'); service = 'Tumblr';
    } else if (h === 'urldefense.com' && p.indexOf('/v3/__') === 0) {
      const start = url.href.indexOf('/v3/__') + 6;
      const end = url.href.indexOf('__', start);
      inner = url.href.slice(start, end === -1 ? undefined : end); service = 'Proofpoint';
    } else if (h === 'urldefense.proofpoint.com' && p.indexOf('/v2/url') === 0 && q.get('u')) {
      inner = q.get('u').replace(/_/g, '/').replace(/-([0-9A-F]{2})/gi, function (_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      });
      service = 'Proofpoint';
    }

    if (inner && !isHttpUrl(inner)) inner = safeDecode(inner);
    return inner && isHttpUrl(inner) ? { href: inner, service: service } : null;
  }

  /** Generic redirect parameter (?redirect=https://…) pointing to another site. */
  function findGenericRedirect(url) {
    let result = null;
    url.searchParams.forEach(function (value, name) {
      if (result || !REDIRECT_PARAMS.has(name.toLowerCase())) return;
      const v = isHttpUrl(value) ? value : safeDecode(value);
      if (isHttpUrl(v)) result = v;
    });
    return result;
  }

  function formatPath(url) {
    const raw = (url.pathname || '/') + (url.search || '') + (url.hash || '');
    if (raw === '/') return '';
    const MAX = 68;
    return raw.length <= MAX ? raw : raw.slice(0, 42) + '…' + raw.slice(-20);
  }

  // ---------------------------------------------------------------------------
  // 3. HOST ANALYSIS
  // ---------------------------------------------------------------------------

  function analyzeHost(hostAscii, findings) {
    const split = splitHost(hostAscii);
    const isIP = isIPv4(hostAscii) || hostAscii.charAt(0) === '[';

    const labels = split.labels.map(function (ascii, i) {
      const display = isIP ? ascii : decodeLabel(ascii);
      const chars = Array.from(display);
      return {
        ascii: ascii,
        display: display,
        chars: chars,
        marks: chars.map(function () { return null; }),
        part: isIP || i >= split.subCount ? 'reg' : 'sub',
        isSuffix: !isIP && i >= split.labels.length - split.suffixLen,
        isPunycode: display !== ascii
      };
    });

    const host = {
      isIP: isIP,
      labels: labels,
      registrableAscii: isIP ? hostAscii : split.registrable,
      registrableDisplay: isIP ? hostAscii : labels.filter(function (l) { return l.part === 'reg'; })
        .map(function (l) { return l.display; }).join('.'),
      suffix: split.suffix,
      hosting: split.hosting
    };

    function mark(label, idx, level) {
      if (!label.marks[idx] || LEVEL_RANK[level] > LEVEL_RANK[label.marks[idx]]) label.marks[idx] = level;
    }

    if (isIP) {
      if (!isPrivateHost(hostAscii)) {
        findings.push({
          level: 'caution',
          title: t('f.ip.title'),
          detail: t('f.ip.detail', { host: hostAscii })
        });
      }
      return host;
    }

    const officialGroups = officialGroupsOf(host.registrableAscii);
    const brandFindings = new Map(); // group → finding (keep the strongest)
    const labelsWithBrand = new Set();
    let reportedScript = false;

    labels.forEach(function (label, li) {
      // --- A. Alphabets (homograph attacks) --------------------------------
      const scripts = new Set();
      label.chars.forEach(function (ch) {
        const s = scriptOf(ch);
        if (s !== 'Common' && s !== 'Inherited') scripts.add(s);
      });
      const encodedNote = label.isPunycode ? t('f.note', { ascii: label.ascii }) : '';

      if (scripts.size > 1) {
        const list = Array.from(scripts);
        const cjkOk = list.every(function (s) { return ['Latin', 'Han', 'Hiragana', 'Katakana'].indexOf(s) !== -1; }) ||
          list.every(function (s) { return ['Latin', 'Han', 'Hangul'].indexOf(s) !== -1; });
        if (!cjkOk) {
          const latinMix = scripts.has('Latin') && list.some(function (s) { return LATIN_LOOKALIKE_SCRIPTS.has(s); });
          const cyrGreek = scripts.has('Cyrillic') && scripts.has('Greek');
          const level = latinMix || cyrGreek ? 'danger' : 'caution';
          label.chars.forEach(function (ch, i) {
            const s = scriptOf(ch);
            if (s !== 'Common' && s !== 'Inherited' && (!scripts.has('Latin') || s !== 'Latin')) mark(label, i, level);
          });
          findings.push({
            level: level,
            title: t('f.mix.title'),
            detail: t('f.mix.detail', { label: label.display, scripts: list.map(scriptName).join(' + '), note: encodedNote })
          });
        }
      } else if (scripts.size === 1) {
        const only = Array.from(scripts)[0];
        const letters = label.chars.filter(function (ch) { return scriptOf(ch) === only; });
        if (LATIN_LOOKALIKE_SCRIPTS.has(only) && letters.length > 0 &&
          letters.every(function (ch) { return CONFUSABLES[ch]; })) {
          const reading = label.chars.map(latinBase).join('');
          label.chars.forEach(function (ch, i) { if (CONFUSABLES[ch]) mark(label, i, 'danger'); });
          findings.push({
            level: 'danger',
            title: t('f.fake.title', { script: scriptName(only) }),
            detail: t('f.fake.detail', { reading: reading, script: scriptName(only), note: encodedNote })
          });
        } else if (only !== 'Latin' && !reportedScript) {
          reportedScript = true;
          findings.push({
            level: 'info',
            title: t('f.script.title', { script: scriptName(only) }),
            detail: t('f.script.detail', { script: scriptName(only), note: encodedNote })
          });
        }
      }

      // Latin non-ASCII letters: real look-alikes (ı, ɑ…) or accents (é, ü…)
      if (scripts.has('Latin')) {
        const accents = [];
        label.chars.forEach(function (ch, i) {
          if (ch.charCodeAt(0) < 0x80 || scriptOf(ch) !== 'Latin') return;
          if (CONFUSABLES[ch]) {
            mark(label, i, 'danger');
            findings.push({
              level: 'danger',
              title: t('f.trapLetter.title', { ch: ch }),
              detail: t('f.trapLetter.detail', { ch: ch, base: CONFUSABLES[ch], note: encodedNote })
            });
          } else {
            mark(label, i, 'caution');
            if (accents.indexOf(ch) === -1) accents.push(ch);
          }
        });
        if (accents.length) {
          findings.push({
            level: 'info',
            title: t('f.accents.title', { list: accents.join(' ') }),
            detail: t('f.accents.detail', { note: encodedNote })
          });
        }
      }

      // --- B. Brand impersonation ------------------------------------------
      if (label.isSuffix) return;

      const tokens = [];
      let current = [];
      label.chars.forEach(function (ch, i) {
        if (ch === '-') {
          if (current.length) tokens.push(current);
          current = [];
        } else {
          current.push({ ch: ch, idx: i });
        }
      });
      if (current.length) tokens.push(current);
      if (tokens.length > 1) {
        // "pay-pal" → "paypal"
        tokens.push([].concat.apply([], tokens));
      }

      tokens.forEach(function (tok) {
        const match = matchBrand(tok);
        if (!match || officialGroups.has(match.brand.group)) return;
        labelsWithBrand.add(li);

        const official = GROUPS[match.brand.group][0];
        const isSld = label.part === 'reg';
        let finding;
        if (match.type === 'lookalike') {
          match.marks.forEach(function (i) { mark(label, i, 'danger'); });
          const written = tok.map(function (t) { return t.ch; }).join('');
          // Foreign letters look identical: "« аррӏе » ressemble à « apple »" would read as nonsense
          const foreignLetters = /[^\x00-\x7f]/.test(written);
          finding = {
            level: 'danger',
            kind: 'imitate',
            title: t('f.imitate.title', { name: match.brand.name }),
            detail: t(foreignLetters ? 'f.imitate.detailForeign' : 'f.imitate.detail',
              { written: written, key: match.brand.key, official: official })
          };
        } else if (match.type === 'exact' && isSld && !isTrustedSuffix(host.suffix) && !host.hosting) {
          finding = {
            level: 'caution',
            title: t('f.brandTld.title', { name: match.brand.name }),
            detail: t('f.brandTld.detail', { official: official, suffix: host.suffix })
          };
        } else if (match.type === 'exact') {
          finding = {
            level: 'danger',
            title: t('f.brandUse.title', { name: match.brand.name }),
            detail: t('f.brandUse.detail', { reg: host.registrableDisplay, name: match.brand.name, official: official })
          };
        } else {
          finding = {
            level: 'caution',
            title: t('f.brandHas.title', { name: match.brand.name }),
            detail: t('f.brandHas.detail', { name: match.brand.name, official: official })
          };
        }
        const prev = brandFindings.get(match.brand.group);
        if (!prev || LEVEL_RANK[finding.level] > LEVEL_RANK[prev.level]) brandFindings.set(match.brand.group, finding);
      });

      // --- C. Digit hidden inside a word (c0inbase, micr0soft) -------------
      if (!labelsWithBrand.has(li)) {
        label.chars.forEach(function (ch, i) {
          if ((ch === '0' || ch === '1') && /[a-z]/.test(label.chars[i - 1] || '') && /[a-z]/.test(label.chars[i + 1] || '')) {
            mark(label, i, 'caution');
            findings.push({
              level: 'caution',
              title: t('f.digit.title'),
              detail: t('f.digit.detail', { label: label.display, ch: ch, what: t(ch === '0' ? 'f.digit.zero' : 'f.digit.one') })
            });
          }
        });
      }
    });

    brandFindings.forEach(function (f) { findings.push(f); });

    // --- D. Fake address placed at the start (paypal.com.pirate.fr) --------
    // A TLD-like label *after* another label ("paypal.com.…"), not a leading
    // language prefix like "fr.wikipedia.org".
    const fakeTld = labels.some(function (l, i) {
      return i > 0 && l.part === 'sub' && ['com', 'net', 'org', 'fr', 'co', 'uk', 'de', 'io', 'gov', 'gouv'].indexOf(l.ascii) !== -1;
    });
    if (fakeTld && brandFindings.size === 0) {
      findings.push({
        level: 'caution',
        title: t('f.fakeStart.title'),
        detail: t('f.fakeStart.detail', { reg: host.registrableDisplay })
      });
    }

    // --- E. Free hosting --------------------------------------------------
    if (host.hosting && labels.length > host.hosting.split('.').length) {
      findings.push({
        level: 'info',
        title: t('f.hosting.title', { hosting: host.hosting }),
        detail: t('f.hosting.detail', { hosting: host.hosting, owner: labels[labels.length - host.hosting.split('.').length - 1].display })
      });
    }

    return host;
  }

  // ---------------------------------------------------------------------------
  // 4. PUBLIC ENTRY POINT
  // ---------------------------------------------------------------------------

  /**
   * @param {string} href      Link target (absolute or relative)
   * @param {string} linkText  Visible text of the link (to detect "text says X, goes to Y")
   * @param {string} [baseURI] Base for relative links
   * @returns {object|null}    null when the link is not an http(s) web address
   */
  function analyzeLink(href, linkText, baseURI, depth) {
    depth = depth || 0;
    let url;
    try {
      url = baseURI ? new URLImpl(href, baseURI) : new URLImpl(href);
    } catch (e) {
      return null;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;

    // Known link wrappers: analyse the real destination instead.
    if (depth < 3) {
      const wrapped = unwrapKnownRedirect(url);
      if (wrapped) {
        const inner = analyzeLink(wrapped.href, linkText, null, depth + 1);
        if (inner) {
          inner.via.unshift({ host: url.hostname, service: wrapped.service });
          if (depth === 0) {
            inner.findings.push({
              level: 'info',
              kind: 'unwrap',
              title: t('f.unwrap.title', { service: wrapped.service }),
              detail: t('f.unwrap.detail', { host: url.hostname })
            });
            finalize(inner);
          }
          return inner;
        }
      }
    }

    const findings = [];
    const host = analyzeHost(url.hostname, findings);
    const reg = host.registrableAscii;

    // "@" trick: https://paypal.com@evil.com goes to evil.com
    let userinfo = '';
    if (url.username || url.password) {
      userinfo = safeDecode(url.username) + (url.password ? ':' + safeDecode(url.password) : '');
      findings.push({
        level: 'danger',
        title: t('f.at.title'),
        detail: t('f.at.detail', { userinfo: userinfo, reg: host.registrableDisplay })
      });
    }

    if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
      findings.push({
        level: 'caution',
        title: t('f.http.title'),
        detail: t('f.http.detail')
      });
    }

    const isShortener = SHORTENERS.has(reg) || SHORTENERS.has(url.hostname);
    const isTracker = TRACKERS.has(reg) || TRACKERS.has(url.hostname);
    if (isShortener) {
      findings.push({
        level: 'caution',
        title: t('f.short.title', { host: url.hostname }),
        detail: t('f.short.detail')
      });
    } else if (isTracker) {
      findings.push({
        level: 'info',
        title: t('f.tracker.title'),
        detail: t('f.tracker.detail')
      });
    }

    // Generic redirect parameter (?redirect=https://other-site)
    const redirectTarget = findGenericRedirect(url);
    if (redirectTarget && depth < 3) {
      const target = analyzeLink(redirectTarget, '', null, depth + 1);
      if (target && target.host.registrableAscii !== reg) {
        const isDanger = target.severity === 'danger';
        findings.push({
          level: isDanger ? 'danger' : 'caution',
          title: t('f.redirect.title'),
          detail: t('f.redirect.detail', { reg: target.host.registrableDisplay }) +
            (isDanger ? t('f.redirect.trap', { title: target.findings[0].title }) : '')
        });
      }
    }

    // Visible text announces another site than the real destination
    const destGroups = officialGroupsOf(reg);
    const reported = new Set();
    extractDomainsFromText(linkText).forEach(function (d) {
      if (d.registrable === reg || reported.has(d.registrable)) return;
      const textGroups = officialGroupsOf(d.registrable);
      const sameOrg = Array.from(textGroups).some(function (g) { return destGroups.has(g); });
      if (sameOrg) return;
      reported.add(d.registrable);
      findings.push({
        level: isShortener || isTracker ? 'caution' : 'danger',
        title: t('f.textLies.title'),
        detail: t('f.textLies.detail', { written: d.written, reg: host.registrableDisplay }) +
          (isShortener || isTracker ? t('f.textLies.masked') : '')
      });
    });

    // A domain hidden in the path (evil.com/www.paypal.com/login)
    extractDomainsFromText(safeDecode(url.pathname)).forEach(function (d) {
      if (d.registrable === reg || reported.has(d.registrable)) return;
      if (officialGroupsOf(d.registrable).size === 0) return;
      reported.add(d.registrable);
      findings.push({
        level: 'caution',
        title: t('f.path.title'),
        detail: t('f.path.detail', { written: d.written, reg: host.registrableDisplay })
      });
    });

    // A link straight to a disguised file (.../facture.pdf.exe)
    const fileName = safeDecode(url.pathname.split('/').pop() || '');
    const fileCheck = Files && fileName ? Files.analyze(fileName) : null;
    if (fileCheck && fileCheck.danger) findings.push(fileFinding(fileCheck));

    const result = {
      href: url.href,
      protocol: url.protocol,
      userinfo: userinfo,
      host: host,
      port: url.port,
      path: formatPath(url),
      via: [],
      findings: findings,
      severity: 'none',
      official: null
    };
    finalize(result);
    result.official = computeOfficial(result, url);
    return result;
  }

  /**
   * Hosts of official domains where ANYONE can publish content (forms, sites,
   * shared files): never shown as "official", phishers use them a lot.
   */
  const USER_CONTENT_HOSTS = [
    'sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.gle', 'script.google.com',
    'storage.googleapis.com', 'firebasestorage.googleapis.com', 'googleusercontent.com',
    'sharepoint.com', 'onedrive.live.com', '1drv.ms', 'forms.office.com', 'forms.microsoft.com',
    'dropboxusercontent.com', 'dropbox.com', 'blogger.com', 'amazonaws.com', 'githubusercontent.com',
    'gist.github.com', 'windows.net', 'web.core.windows.net', 'translate.goog', 'wetransfer.com', 'we.tl',
    'docusign.net', 'adobe.com', 'acrobat.com', 't.co', 'goo.gl', 'lnkd.in', 'linkedin.com', 'facebook.com',
    'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'discord.com', 'discord.gg',
    't.me', 'telegram.me', 'github.com', 'steamcommunity.com', 'roblox.com'
  ];

  const GROUP_NAMES = {};
  BRANDS.forEach(function (b) { if (!GROUP_NAMES[b.group]) GROUP_NAMES[b.group] = b.name; });

  function isUserContentHost(hostname) {
    return USER_CONTENT_HOSTS.some(function (h) { return hostname === h || hostname.slice(-(h.length + 1)) === '.' + h; });
  }

  /**
   * "Official site" verdict (green): only when NOTHING is suspicious, the
   * connection is https, and the domain is in our explicit official list.
   * Social networks & file-sharing sites are excluded on purpose: the domain
   * is real, but the page content can be written by anyone.
   */
  function computeOfficial(result, url) {
    if (result.severity !== 'none' || result.userinfo || url.protocol !== 'https:' || result.host.isIP) return null;
    const group = OFFICIAL_DOMAIN_TO_GROUP.get(result.host.registrableAscii);
    if (!group || isUserContentHost(url.hostname)) return null;
    return { name: GROUP_NAMES[group] || result.host.registrableDisplay, domain: result.host.registrableAscii };
  }

  function finalize(result) {
    result.findings.sort(function (a, b) { return LEVEL_RANK[b.level] - LEVEL_RANK[a.level]; });
    let max = 0;
    result.findings.forEach(function (f) { max = Math.max(max, LEVEL_RANK[f.level]); });
    result.severity = max >= 3 ? 'danger' : max === 2 ? 'caution' : 'none';
    return result;
  }

  /**
   * Neutral hints for the ASCII characters people confuse (keys 'c.l', 'c.0'…
   * in i18n.js). Informative only, never an alert: "l" in "paypal" is normal.
   * Note: domain names are case-insensitive (DNS) and browsers always show them
   * lowercase, so upper/lower case never changes the destination.
   */
  const ASCII_HINT_KEYS = 'lio01mwd58';

  function codePoint(ch) {
    // Decimal value (what people learn as "the ASCII code"); Unicode U+ form
    // kept alongside for non-ASCII characters, since that is how they are looked up.
    const cp = ch.codePointAt(0);
    if (cp < 0x80) return 'ASCII ' + cp;
    return cp + ' · U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Plain-language identity of a single character, for the magnifier.
   * @returns {{ text: string, ascii: boolean, code: string, level: (null|'caution'|'danger') }}
   */
  function describeChar(ch) {
    const code = codePoint(ch);
    const lower = ch.toLowerCase();
    if (ch.charCodeAt(0) < 0x80) {
      let text;
      if (ASCII_HINT_KEYS.indexOf(lower) !== -1) text = t('c.' + lower);
      else if (/^[0-9]$/.test(ch)) text = t('c.digit', { name: t('c.digits').split(',')[+ch] });
      else if (/^[a-z]$/i.test(ch)) text = t('c.letter', { up: ch.toUpperCase() });
      else if (ch === '-') text = t('c.dash');
      else if (ch === '.') text = t('c.dot');
      else text = t('c.symbol', { ch: ch });
      return { text: text, ascii: true, code: code, level: null };
    }
    const script = scriptOf(ch);
    const alphabet = script === 'Latin' ? t('script.LatinExt') : scriptName(script);
    if (CONFUSABLES[ch]) {
      return { text: t('c.fake', { base: CONFUSABLES[ch], alphabet: alphabet }), ascii: false, code: code, level: 'danger' };
    }
    const base = latinBase(ch);
    if (script === 'Latin' && base !== ch) {
      return { text: t('c.accent', { up: base.toUpperCase(), base: base }), ascii: false, code: code, level: 'caution' };
    }
    return { text: t('c.other', { alphabet: alphabet }), ascii: false, code: code, level: 'caution' };
  }

  /** Finding for a disguised file name (from files.js). */
  function fileFinding(fr) {
    const f = fr.findings.find(function (x) { return x.code === 'double' || x.code === 'reversed' || x.code === 'fakeDot'; });
    let detail;
    if (f && f.fake && fr.exec) detail = t('f.file.fake', { fake: f.fake, real: fr.ext });
    else if (fr.exec) detail = t('f.file.exec', { real: fr.ext });
    else detail = t('f.file.hidden');
    if (fr.findings.some(function (x) { return x.code === 'bidi'; })) detail += ' ' + t('f.file.bidi');
    else if (fr.findings.some(function (x) { return x.code === 'padding'; })) detail += ' ' + t('f.file.padding');
    else if (fr.findings.some(function (x) { return x.code === 'invisible'; })) detail += ' ' + t('f.file.invisible');
    return { level: 'danger', kind: 'file', title: t('f.file.title'), detail: detail };
  }

  /**
   * Inspects a file NAME on its own (mail attachment, download).
   * @returns {{file:object, findings:Array, severity:string, official:null, via:Array}|null}
   */
  function analyzeFile(name) {
    if (!Files || !name) return null;
    const fr = Files.analyze(String(name));
    const result = { file: fr, findings: fr.danger ? [fileFinding(fr)] : [], severity: 'none', official: null, via: [] };
    return finalize(result);
  }

  /** Free webmail providers: anyone can create "paypal.support@gmail.com". */
  const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr',
    'live.com', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
    'protonmail.com', 'gmx.com', 'gmx.fr', 'mail.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'laposte.net',
    'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'zoho.com']);

  /**
   * Inspects an e-mail SENDER: same letter-by-letter checks as a link on the
   * address's domain, plus the display-name tricks ("PayPal" <x@gmail.com>,
   * "service@paypal.com" <x@evil.ru>).
   * @returns {object|null} same shape as analyzeLink, plus `sender: {email, name}`
   */
  function analyzeSender(email, displayName) {
    const m = String(email || '').trim().match(/^[^@\s]+@([^@\s>]+)$/);
    if (!m) return null;
    const domain = m[1].replace(/\.$/, '');
    const result = analyzeLink('https://' + domain + '/', '');
    if (!result) return null;
    result.sender = { email: email, name: displayName || '' };
    const reg = result.host.registrableAscii;
    const regShown = result.host.registrableDisplay;
    const name = String(displayName || '');

    // Display name contains another address/domain
    const shownDomains = extractDomainsFromText(name).filter(function (d) { return d.registrable !== reg; });
    if (shownDomains.length) {
      const written = shownDomains[0].written;
      result.findings.push({ level: 'danger', title: t('f.senderAddr.title'),
        detail: t('f.senderAddr.detail', { written: written, reg: regShown }) });
    } else if (!result.findings.some(function (f) { return f.kind === 'imitate'; })) {
      // Display name names a brand the address does not belong to
      const norm = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
      const ownGroup = OFFICIAL_DOMAIN_TO_GROUP.get(reg);
      const brand = BRANDS.find(function (b) {
        return b.key.length >= 4 && norm.indexOf(b.key) !== -1 && b.group !== ownGroup;
      });
      if (brand && !OFFICIAL_DOMAIN_TO_GROUP.has(reg) || brand && FREEMAIL.has(reg)) {
        result.findings.push({ level: FREEMAIL.has(reg) ? 'danger' : 'caution', title: t('f.senderName.title', { brand: brand.name }),
          detail: t(FREEMAIL.has(reg) ? 'f.senderName.free' : 'f.senderName.detail', { brand: brand.name, reg: regShown }) });
      }
    }
    finalize(result);
    // A gmail.com address is a real Google domain, but not a message from Google.
    if (result.severity !== 'none' || FREEMAIL.has(reg)) result.official = null;
    return result;
  }

  return {
    analyzeLink: analyzeLink,
    analyzeSender: analyzeSender,
    analyzeFile: analyzeFile,
    describeChar: describeChar,
    // exposed for unit tests
    _internal: {
      punycodeDecode: punycodeDecode,
      splitHost: splitHost,
      visualDiff: visualDiff,
      extractDomainsFromText: extractDomainsFromText,
      officialGroupsOf: officialGroupsOf
    }
  };
});
