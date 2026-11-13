/*
 * Language preference and locale switching.
 *
 * Kept as a static file (rather than an inline Astro script) so the hash-based
 * Content-Security-Policy in src/integrations/headers.mjs needs no extra hash.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'stub.lang';
  var root = document.documentElement;
  // Lets CSS collapse progressive enhancements (e.g. the extra tag chips)
  // only when scripting is available; without it the full list stays visible.
  root.classList.add('js');
  var lang =
    root.getAttribute('data-lang') || ((root.lang || '').indexOf('zh') === 0 ? 'zh' : 'en');
  var query = window.location.search || '';
  var hash = window.location.hash || '';

  var stored = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    // Storage can be disabled; the switch still works without persistence.
  }

  function store(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      // Ignore storage failures.
    }
  }

  // Preserve filters (`?tag=…`), searches (`?q=…`) and anchors across locales.
  document.querySelectorAll('[data-lang-switch]').forEach(function (link) {
    var base = link.getAttribute('data-href');
    if (base) link.setAttribute('href', base + query + hash);
    link.addEventListener('click', function () {
      store(link.getAttribute('data-lang-target') || lang);
    });
  });

  var hint = document.querySelector('[data-lang-hint]');
  if (hint && lang === 'en') {
    var hintLink = hint.querySelector('[data-lang-hint-link]');
    if (hintLink) {
      var hintBase = hintLink.getAttribute('data-href');
      if (hintBase) hintLink.setAttribute('href', hintBase + query + hash);
      hintLink.addEventListener('click', function () {
        store('zh');
      });
    }

    var close = hint.querySelector('[data-lang-hint-close]');
    if (close) {
      close.addEventListener('click', function () {
        store('en');
        hint.hidden = true;
      });
    }

    var preferred =
      navigator.languages && navigator.languages.length
        ? navigator.languages[0]
        : navigator.language || '';
    var wantsChinese = /^zh(-|$)/i.test(preferred);
    if (!stored && wantsChinese) hint.hidden = false;
  }

  // Visiting the Chinese site counts as choosing Chinese, so the English hint
  // does not appear later.
  if (lang === 'zh') store('zh');
})();
