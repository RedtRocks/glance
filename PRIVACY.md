# Privacy policy

Glance doesn't collect, store or send any personal information. There is no account and no advertising, and no telemetry beyond one anonymous daily count of installs, which you can turn off.

- Your files stay on your PC. Glance opens and saves them where you choose; version history and saved signatures are kept in your Windows user profile (signatures encrypted with Windows DPAPI).
- Text recognition, background removal and every other feature run on your PC.
- Apart from the install count below, the only network request is an optional daily check for a newer release on GitHub (api.github.com), which you can turn off in Settings. It sends nothing about you or your files beyond what any web request carries (such as your IP address, under [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)). The Microsoft Store version doesn't make it; the Store handles updates. Opening **Help → About Glance** makes one more request to the same address to read the download count; it sends nothing either.
- Once a day, unless you turn off **Settings → Count this install**, Glance tells [Umami](https://umami.is) that a copy is in use. It sends the version number, whether the copy came from the Microsoft Store or GitHub, and what any web request carries (the app's language, and the country worked out from your IP address, which isn't stored). It has no install ID, nothing about you, and never a file name or anything you open, so it only adds up to a number of copies in use. The Microsoft Store version does this too.
- Sharing a file through the Windows share sheet sends it only to the app you pick.
- AI apps you connect (Settings → AI apps) can use Glance's tools on your files. Glance itself sends nothing; the AI app sends what it reads through Glance (page images, text, file names) to its AI provider, under that provider's terms. Turn AI access off in Settings → AI apps at any time.

## The website

The website (redtrocks.github.io/glance, including the browser version of Glance) counts visits with [Umami](https://umami.is), which sets no cookies and stores nothing on your device. It records the page, the referring site, your browser, operating system, device type and country (worked out from your IP address, which isn't stored), and clicks on the download and Microsoft Store links. In the browser version it also counts the type of file you open, edit or save (for example "pdf" or "heic"), never its name or contents: your files stay on your device. Glance on Windows has no such counting.

Questions: [open an issue](https://github.com/RedtRocks/glance/issues).
