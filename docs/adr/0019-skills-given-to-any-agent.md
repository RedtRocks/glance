# Glance gives design and writing skills to whichever agent is running

The maintainer wants Claude Code, Codex, Gemini and the other agents to make better files through Glance than on their own, the way design skills improve Claude's output. Writing that know-how into each company's own skill system would mean one copy per company, and agents without skills would get none.

So Glance keeps its own skills: a folder with a `SKILL.md` (the same shape as Claude's Agent Skills, so they can move both ways) plus examples and templates, for one kind of work such as slide design, letters or resumes. Glance picks the skills for the file and the request and passes them to the agent through the MCP server's instructions, prompts and resources, so every agent gets the same guidance. Skills ship with the app, and people can add their own; installing shared skills from the web is not offered, because Glance fetches nothing (see PRIVACY.md).

## Consequences
- The design rules live in Glance, so improving a skill improves every agent at once; a fixed set of test briefs scores each change.
- Settings > AI apps can also install the skills as a Claude Code skill and an AGENTS.md note, so they are there before the first tool call.
- Skills are guidance, not enforcement: the layouts and the design check keep a deck sound even when an agent ignores them.
