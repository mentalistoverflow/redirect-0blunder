/**
 * Theme + language init — runs synchronously in <head> to prevent flash.
 * Must be loaded as a regular <script> (not module, not deferred).
 */
(function () {
  var t = localStorage.getItem('chess-learn-theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
  var l = localStorage.getItem('chess-learn-lang');
  if (l) document.documentElement.lang = l;
})();
