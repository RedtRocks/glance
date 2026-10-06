/* One-click download: the Download buttons point at the newest installer itself, for
   this PC's processor, instead of the release page. If GitHub can't be reached they
   keep their normal link to the release page. */
(function () {
  var links = document.querySelectorAll('a[href*="github.com/RedtRocks/glance/releases"]');
  if (!links.length || !window.fetch) return;
  var arm = function () {
    var uad = navigator.userAgentData;
    if (!uad || !uad.getHighEntropyValues) return Promise.resolve(/arm/i.test(navigator.userAgent));
    return uad.getHighEntropyValues(['architecture']).then(function (v) { return v.architecture === 'arm'; }, function () { return false; });
  };
  var windows = /Windows/i.test(navigator.userAgent);
  if (!windows) return; // Phones and Macs keep the release page, which also explains the web app.
  Promise.all([fetch('https://api.github.com/repos/RedtRocks/glance/releases/latest').then(function (r) { return r.ok ? r.json() : Promise.reject(); }), arm()])
    .then(function (res) {
      var assets = res[0].assets || [], wantArm = res[1];
      var pick = function (re) { return assets.filter(function (a) { return re.test(a.name); })[0]; };
      var asset = (wantArm ? pick(/arm64.*setup\.exe$/i) : pick(/x64.*setup\.exe$/i)) || pick(/setup\.exe$/i);
      if (!asset || !/^https:\/\/github\.com\/RedtRocks\/glance\/releases\/download\//.test(asset.browser_download_url)) return;
      links.forEach(function (a) {
        if (!/releases\/latest$/.test(a.getAttribute('href'))) return;
        a.setAttribute('href', asset.browser_download_url);
        a.setAttribute('title', asset.name);
      });
    })
    .catch(function () {});
})();
