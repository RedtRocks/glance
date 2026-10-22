# When Glance can't make something, it hands the job to the AI company's own agent

Glance makes decks, documents, spreadsheets and PDFs with its own tools. People also ask for things those tools can't make, such as animated charts, a video or an e-book. The maintainer wanted Glance to get those made without the person copying, pasting or switching apps.

Two routes were weighed (the mockups are in the pull request): driving the company's website in the sidebar (claude.ai, chatgpt.com) with an injected script, or giving the job to the company's own agent, which the Ask AI sidebar already starts over the Agent Client Protocol (Claude through claude-agent-acp, ChatGPT through codex-acp, and so on).

We chose the agent. Glance starts a separate session of the same company's agent, gives it the request, the file's path and an empty folder under Glance's app data, and opens the file the agent writes there in a new tab with a "Made by <company>" bar (Keep moves it next to the original file, or into Downloads). It happens when the in-app AI ends its answer with a hand-off line because the rest is beyond Glance's tools, when the request asks for a kind of file Glance can't make, or when the person taps **Do more with <company>…**.

The website is not scripted. Scraping and typing into another company's page breaks whenever the page changes, and the consumer terms of both companies forbid automated access outside their APIs, which would put the person's account at risk. Instead the website view only:

- catches files the person downloads there (Tauri's `on_download` on the child web view), saves them in Downloads and opens them in Glance with an "Opened from <site>" bar (Settings → AI apps → Open files made on AI websites in Glance, on by default);
- offers **Do more on <site>…**, which opens the site's new-chat address with the request filled in (`claude.ai/new?q=`, `chatgpt.com/?q=`) for the person to send.

## Consequences
- Files reach the AI company only when the person hands off. Files Glance just made go with the request; a file the person opened is sent only after they say yes, once per file. PRIVACY.md says so.
- The feature is desktop only: the browser version has no agents and no web views, so it is hidden there.
- The agent writes files itself, so the hand-off session gets no Glance tools and works in its own folder; Glance only opens what it finds there.
- Download catching depends on the web view: WebView2 on Windows reports the saved path; WebKitGTK on Linux does too, but its download handler is shared by the web context.
