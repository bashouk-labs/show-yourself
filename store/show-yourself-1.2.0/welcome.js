'use strict';
ShowYourselfI18n.translatePage(document);
document.title = 'Show Yourself · ' + ShowYourselfI18n.t('w.s1');

// Demo links never navigate (trap links are already stopped by the blocker).
document.querySelectorAll('.demo a').forEach((a) => {
  a.addEventListener('click', (event) => event.preventDefault());
});
