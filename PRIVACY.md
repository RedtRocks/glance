# Privacy policy

Glance doesn't collect, store or send any personal information. There is no telemetry, no account and no advertising.

- Your files stay on your PC. Glance opens and saves them where you choose; version history and saved signatures are kept in your Windows user profile (signatures encrypted with Windows DPAPI).
- Text recognition, background removal and every other feature except Ask AI run on your PC.
- Unless you use Ask AI (below), the only network request is an optional daily check for a newer release on GitHub (api.github.com), which you can turn off in Settings. It sends nothing about you or your files beyond what any web request carries (such as your IP address, under [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)). The Microsoft Store version doesn't make it; the Store handles updates.
- Sharing a file through the Windows share sheet sends it only to the app you pick.
- Ask AI (the sidebar) is off until you open it. When you chat, Glance sends your messages and what you share (the page, a selected area, the file's text and name) to the AI company you pick (Anthropic, OpenAI, Google, GitHub, Alibaba, Moonshot, Mistral, OpenCode or an address you enter), signed in with your own account or API key, under that company's terms. API keys are kept in Windows Credential Manager, and past chats stay on your PC. Picking a company may download its free helper app once, and its website opens in the sidebar only when you ask for it.
- The mic in Ask AI uses Windows speech recognition, which sends your voice to Microsoft under Windows' Online speech recognition setting.
- AI apps you connect (Settings → AI apps) can use Glance's tools on your files. Glance itself sends nothing; the AI app sends what it reads through Glance (page images, text, file names) to its AI provider, under that provider's terms. Turn AI access off in Settings → AI apps at any time.

Questions: [open an issue](https://github.com/RedtRocks/glance/issues).
