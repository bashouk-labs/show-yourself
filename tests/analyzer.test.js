/**
 * Unit tests for analyzer.js, run with: node tests/analyzer.test.js
 * No dependency needed.
 */
'use strict';
const path = require('path');
const analyzer = require(path.join(__dirname, '..', 'analyzer.js'));
const analyzeLink = analyzer.analyzeLink;
const _internal = analyzer._internal;

let passed = 0;
let failed = 0;

function check(name, condition, details) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log('  ✗ ' + name + (details ? '\n      ' + details : ''));
  }
}

function summary(r) {
  return r
    ? r.severity + ' → ' + r.host.registrableDisplay + ' | ' +
      r.findings.map((f) => f.level + ': ' + f.title).join(' ; ')
    : 'null';
}

/** Legit links: must NOT raise caution or danger. */
function expectClean(href, text) {
  const r = analyzeLink(href, text || '');
  check('clean: ' + href + (text ? ' [' + text + ']' : ''), r && r.severity === 'none', summary(r));
}

/** Traps: must reach at least the given level (and optionally contain a title). */
function expectTrap(href, level, titlePart, text) {
  const r = analyzeLink(href, text || '');
  const rank = { none: 0, caution: 2, danger: 3 };
  const okLevel = r && rank[r.severity] >= rank[level];
  const okTitle = !titlePart || (r && r.findings.some((f) => f.title.indexOf(titlePart) !== -1));
  check('trap (' + level + '): ' + href, okLevel && okTitle, summary(r));
  return r;
}

console.log('Show Yourself: analyzer tests\n');

// --- Internals -------------------------------------------------------------
check('punycode decode', _internal.punycodeDecode('80ak6aa92e') === 'аррӏе');
check('punycode münchen', _internal.punycodeDecode('mnchen-3ya') === 'münchen');
check('split co.uk', _internal.splitHost('www.amazon.co.uk').registrable === 'amazon.co.uk');
check('split github.io', _internal.splitHost('paypal-login.github.io').registrable === 'paypal-login.github.io');
check('split gouv.fr', _internal.splitHost('www.impots.gouv.fr').registrable === 'impots.gouv.fr');

// --- Legitimate sites: no false alarm ------------------------------------
[
  'https://www.paypal.com/signin',
  'https://www.paypal.com/fr/home',
  'https://accounts.google.com/signin',
  'https://mail.google.com/mail/u/0/',
  'https://www.google.com/search?q=phishing',
  'https://www.apple.com/fr/iphone/',
  'https://appleid.apple.com/',
  'https://login.microsoftonline.com/common/oauth2',
  'https://outlook.live.com/mail/',
  'https://learn.microsoft.com/fr-fr/',
  'https://docs.github.com/fr/authentication',
  'https://fr.wikipedia.org/wiki/Hameçonnage',
  'https://www.linkedin.com/in/someone',
  'https://www.amazon.co.uk/gp/cart',
  'https://www.amazon.fr/',
  'https://www.impots.gouv.fr/accueil',
  'https://www.ameli.fr/assure',
  'https://finance.yahoo.com/',
  'https://www.cloudflare.com/',
  'https://www.cornell.edu/',
  'https://www.lemonde.fr/international/',
  'https://www.youtube.com/watch?v=abc',
  'https://www.credit-agricole.fr/',
  'https://www.netflix.com/browse',
  'https://discord.com/channels/@me',
  'https://www.instagram.com/',
  'https://www.leboncoin.fr/',
  'https://www.orange.fr/portail',
  'https://web1.example.com/',
  'https://www.office365.com/',
  'https://192.168.1.1/admin',
  'http://localhost:3000/'
].forEach((u) => expectClean(u));

expectClean('https://www.paypal.com/signin', 'Se connecter à PayPal (paypal.com)');
expectClean('https://outlook.live.com/', 'Ouvrir outlook.com');
expectClean('https://docs.github.com/', 'Documentation GitHub (docs.github.com)');
expectClean('https://example.com/', 'Lire le README.md et index.html');
expectClean('https://www.lemonde.fr/', 'Vérifier mon compte, Accéder à la suite');

// Legit internationalised domains: informative only, not alarming
expectClean('https://münchen.de/');
expectClean('https://xn--h1alffa9f.xn--p1ai/'); // россия.рф

// --- Traps -------------------------------------------------------------
expectTrap('https://www.paypai.com/', 'danger', 'PayPal');
expectTrap('https://paypa1.com/login', 'danger', 'PayPal');
expectTrap('https://login.rnicr0soft.com/oauth2', 'danger', 'Microsoft');
expectTrap('https://arnazon.com/', 'danger', 'Amazon');
expectTrap('https://gooogle.com/', 'danger', 'Google');
expectTrap('https://goolge.com/', 'danger', 'Google');
expectTrap('https://c0inbase.com/', 'danger', 'Coinbase');
expectTrap('https://steamcommunlty.com/tradeoffer', 'danger', 'Steam');
expectTrap('https://faceb00k-login.com/', 'danger', 'Facebook');
expectTrap('http://paypal.com.securite-client.pirate.fr/login', 'danger', 'PayPal');
expectTrap('https://secure-paypal-verification.com/', 'danger', 'PayPal');
expectTrap('https://paypal-login.github.io/', 'danger', 'PayPal');
expectTrap('https://ameli-remboursement.fr/', 'danger', 'Ameli');
expectTrap('https://paypal.xyz/', 'caution', 'extension inhabituelle');
expectTrap('https://monpaypalsecure.net/', 'caution', 'PayPal');
expectTrap('https://xn--80ak6aa92e.com/id', 'danger', 'Fausses lettres');
expectTrap('https://pаypal.com/', 'danger', 'Mélange'); // Cyrillic а
expectTrap('https://gοogle.com/', 'danger', 'Mélange'); // Greek ο
expectTrap('https://paypal.com@evil.com/', 'danger', '@');
expectTrap('http://185.23.45.67/login', 'caution', 'IP');
expectTrap('http://example.com/', 'caution', 'http');
expectTrap('https://bit.ly/3xYz', 'caution', 'raccourci');
expectTrap('https://evil.fr/login', 'danger', 'texte', 'https://www.paypal.com/signin');
expectTrap('https://login.rnicr0soft.com/', 'danger', 'texte', 'Se connecter à Microsoft 365 (login.microsoft.com)');
expectTrap('https://evil.example/www.paypal.com/login', 'caution', 'suite de l');
expectClean('https://fr.wikipedia.org/wiki/PayPal');
expectClean('https://de.wikipedia.org/');
expectTrap('https://c0inbase-pro.example.org/', 'danger', 'Coinbase');
expectTrap('https://shop.c0mpany.org/', 'caution', 'Chiffre');

// Unwrapped redirects
let r = expectTrap('https://www.google.com/url?q=https://paypal-secure.fr/login', 'danger', 'PayPal');
check('google redirect unwrapped', r && r.host.registrableAscii === 'paypal-secure.fr' && r.via.length === 1, summary(r));
r = expectTrap('https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fpaypa1.com%2Flogin&data=x', 'danger', 'PayPal');
check('safelinks unwrapped', r && r.host.registrableAscii === 'paypa1.com', summary(r));
r = analyzeLink('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.lemonde.fr%2F&h=AT0', '');
check('facebook redirect to legit stays clean', r && r.severity === 'none' && r.host.registrableAscii === 'lemonde.fr', summary(r));
r = expectTrap('https://urldefense.proofpoint.com/v2/url?u=https-3A__evil-2Dpaypal.com_login&d=x', 'danger', 'PayPal');
check('proofpoint v2 decoded', r && r.host.registrableAscii === 'evil-paypal.com', summary(r));
expectTrap('https://legit.example.com/out?redirect=https://paypa1.com/', 'danger', 'Redirection');
expectClean('https://accounts.google.com/signin?continue=https://mail.google.com/');

// Green "official" verdict: only for real official domains, never for user content
function official(href, text) { const x = analyzeLink(href, text || ''); return x && x.official; }
check('official: paypal.com', official('https://www.paypal.com/signin') && official('https://www.paypal.com/signin').name === 'PayPal');
check('official: impots.gouv.fr', !!official('https://www.impots.gouv.fr/'));
check('official: accounts.google.com', !!official('https://accounts.google.com/'));
check('not official: http', !official('http://www.paypal.com/'));
check('not official: github.io', !official('https://paypal-login.github.io/'));
check('not official: sites.google.com', !official('https://sites.google.com/view/paypal-verif'));
check('not official: docs.google.com forms', !official('https://docs.google.com/forms/d/e/xyz/viewform'));
check('not official: sharepoint tenant', !official('https://evilcorp.sharepoint.com/file'));
check('not official: lying text', !official('https://www.paypal.com/', 'https://www.amazon.fr'));
check('not official: unknown site', !official('https://www.lemonde.fr/'));
check('not official: trap', !official('https://paypa1.com/'));

// Not web links
check('mailto ignored', analyzeLink('mailto:a@b.c', '') === null);
check('javascript ignored', analyzeLink('javascript:void(0)', '') === null);

// English messages
const I18n = require(path.join(__dirname, '..', 'i18n.js'));
I18n.setLang('en');
r = analyzeLink('https://paypa1.com/', '');
check('en: brand title', r && r.findings.some((f) => f.title === 'Imitates “PayPal”'), summary(r));
check('en: describeChar cyrillic', analyzer.describeChar('ӏ').text === 'FAKE “l”: Cyrillic letter', analyzer.describeChar('ӏ').text);
check('en: no missing key', !JSON.stringify(analyzeLink('https://xn--80ak6aa92e.com/', 'paypal.com')).match(/"(f|c|script)\.[a-zA-Z.]+"/));
I18n.setLang('fr');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
