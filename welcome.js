'use strict';
ShowYourselfI18n.translatePage(document);
document.title = 'Show Yourself · ' + ShowYourselfI18n.t('w.s1');

// Demo links never navigate (trap links are already stopped by the blocker).
document.querySelectorAll('.demo a').forEach((a) => {
  a.addEventListener('click', (event) => event.preventDefault());
});

// The training site opens in the same language as the extension.
const trainLink = document.getElementById('trainLink');
if (trainLink && ['fr', 'en'].includes(ShowYourselfI18n.getLang())) {
  trainLink.href = 'https://showyourself.app/' + ShowYourselfI18n.getLang() + '/';
}

// The live popup is shown full height, so it never scrolls inside the page.
const popupDemo = document.getElementById('popupDemo');
if (popupDemo) {
  popupDemo.addEventListener('load', () => {
    try {
      const doc = popupDemo.contentDocument;
      // The frame's height includes its border (box-sizing: border-box): add it, or the popup scrolls.
      const border = popupDemo.offsetHeight - popupDemo.clientHeight;
      const fit = () => { popupDemo.style.height = (doc.documentElement.scrollHeight + border) + 'px'; };
      fit();
      new ResizeObserver(fit).observe(doc.body);
    } catch (e) { /* keep the default height */ }
  });
}
