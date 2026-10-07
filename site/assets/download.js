/* One-click download: the Download buttons point at the newest installer itself, for
   this PC's processor, instead of the release page. If GitHub can't be reached they
   keep their normal link to the release page. Linux RPMs: once the latest release has
   them, the "next release" labels go and Linux visitors get the RPM for their processor. */
(function () {
  var links = document.querySelectorAll('a[href*="github.com/RedtRocks/glance/releases"]');
  if (!links.length || !window.fetch) return;
  var arm = function () {
    var uad = navigator.userAgentData;
    if (!uad || !uad.getHighEntropyValues) return Promise.resolve(/arm|aarch64/i.test(navigator.userAgent));
    return uad.getHighEntropyValues(['architecture']).then(function (v) { return v.architecture === 'arm'; }, function () { return false; });
  };
  var windows = /Windows/i.test(navigator.userAgent);
  var linux = !windows && /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
  var soon = document.querySelectorAll('[data-linux-soon]');
  // Phones and Macs keep the release page, which also explains the web app.
  if (!windows && !linux && !soon.length) return;
  var ours = function (a) { return a && /^https:\/\/github\.com\/RedtRocks\/glance\/releases\/download\//.test(a.browser_download_url); };
  var point = function (a, asset) {
    a.setAttribute('href', asset.browser_download_url);
    a.setAttribute('title', asset.name);
  };
  Promise.all([fetch('https://api.github.com/repos/RedtRocks/glance/releases/latest').then(function (r) { return r.ok ? r.json() : Promise.reject(); }), arm()])
    .then(function (res) {
      var assets = res[0].assets || [], wantArm = res[1];
      var pick = function (re) { return assets.filter(function (a) { return re.test(a.name); })[0]; };
      var rpm = (wantArm ? pick(/aarch64\.rpm$/i) : pick(/x86_64\.rpm$/i)) || pick(/\.rpm$/i);
      if (rpm) soon.forEach(function (el) { el.remove(); });
      if (linux) {
        if (ours(rpm)) document.querySelectorAll('a[data-linux-download]').forEach(function (a) { point(a, rpm); });
        return;
      }
      if (!windows) return;
      var asset = (wantArm ? pick(/arm64.*setup\.exe$/i) : pick(/x64.*setup\.exe$/i)) || pick(/setup\.exe$/i);
      if (!ours(asset)) return;
      links.forEach(function (a) {
        if (a.hasAttribute('data-linux-download') || !/releases\/latest$/.test(a.getAttribute('href'))) return;
        point(a, asset);
      });
    })
    .catch(function () {});
})();
