# Count installs with one anonymous daily check-in

The maintainer wants to know how many copies of Glance are in use. GitHub's download counts include people who update, and the Microsoft Store counts only its own installs, so neither says how many copies are actually used.

Once a day, while **Settings → Count this install** is on, the app sends one event ("Daily check-in") to Umami, the same service the website uses, as its own "Glance app" site so the numbers stay apart. The event carries the version number and whether the copy came from the Microsoft Store or GitHub, plus what any web request carries: the app's language, and the country Umami works out from the IP address (the address itself isn't stored). There is no install ID, so a count of check-ins per day is a count of copies in use that day; one person with two PCs counts twice, and a PC that is off doesn't count.

## Consequences
- Update checks are not the counter: they are off in the Store build and can be turned off, and they ask GitHub, which gives Glance's maintainer no numbers. The check-in is a separate setting that also runs in the Store build, and is on by default like the update check.
- Nothing is sent without a network, and failures are ignored.
- `PRIVACY.md` describes it, and the content-security policy allows `https://cloud.umami.is`.
- Until the "Glance app" Umami website ID is set in `src/state/installCount.ts`, the check-in is off.
