'use strict';
ShowYourselfI18n.translatePage(document);
document.title = 'Show Yourself · ' + ShowYourselfI18n.t('w.s1');

// Demo links never navigate (trap links are already stopped by the blocker).
document.querySelectorAll('.demo a').forEach((a) => {
  a.addEventListener('click', (event) => event.preventDefault());
});

// The live popup is shown full height, so it never scrolls inside the page.
const popupDemo = document.getElementById('popupDemo');
if (popupDemo) {
  popupDemo.addEventListener('load', () => {
    try {
      const doc = popupDemo.contentDocument;
      const fit = () => { popupDemo.style.height = doc.documentElement.scrollHeight + 'px'; };
      fit();
      new ResizeObserver(fit).observe(doc.body);
    } catch (e) { /* keep the default height */ }
  });
}
