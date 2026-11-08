/*
 * Show Yourself: feature flags, shared by every context (content scripts,
 * service worker, extension pages). Usage: ShowYourselfFeatures.isOn('qrCode')
 */
(function (root) {
  'use strict';

  const FLAGS = {
    qrCode: true,        // right-click an image → decode its QR code locally (lib/jsQR.js)
    fileGuard: true,     // disguised file names: attachments, file links, downloads
    clickBlocker: true,
    trustedSites: true,
    statsCounter: true,
  };

  const api = {
    flags: Object.freeze(Object.assign({}, FLAGS)),
    isOn: (name) => FLAGS[name] === true,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShowYourselfFeatures = api;
})(typeof self !== 'undefined' ? self : this);
