/*
 * "Open a file" on the website's pages: the file is picked (or dropped) here, handed
 * to the Glance web app through the same Cache Storage the Share target uses
 * (web/sw.js, src/platform/webApp.ts), and the app opens it. Nothing is uploaded:
 * the cache lives in this browser. Without JavaScript the buttons are plain links.
 */
(function () {
  // The app sits beside this script's folder: /assets/open.js -> /app/.
  var app = new URL('../app/', document.currentScript.src).href;
  var input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  document.body.appendChild(input);

  function open(files) {
    if (!files || !files.length) return;
    if (!('caches' in window)) { location.href = app; return; }
    caches.open('glance-shared').then(function (cache) {
      // One at a time, so the tabs open in the order the files were picked.
      return Array.prototype.reduce.call(files, function (done, f, i) {
        return done.then(function () {
          return cache.put(new Request(app + 'shared/' + Date.now() + '-' + i), new Response(f, {
            headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name) }
          }));
        });
      }, Promise.resolve());
    }).then(function () { location.href = app + '?shared=1'; }, function () { location.href = app; });
  }

  document.querySelectorAll('[data-open-file]').forEach(function (b) {
    b.addEventListener('click', function (e) { e.preventDefault(); input.click(); });
  });
  input.addEventListener('change', function () { open(input.files); });

  // Dropping files anywhere on the page opens them too.
  var zone = document.querySelector('[data-drop]');
  var depth = 0;
  window.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
    depth++;
    if (zone) zone.classList.add('dragging');
  });
  window.addEventListener('dragleave', function () { if (--depth <= 0 && zone) { depth = 0; zone.classList.remove('dragging'); } });
  window.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    depth = 0;
    if (zone) zone.classList.remove('dragging');
    open(e.dataTransfer.files);
  });
})();
