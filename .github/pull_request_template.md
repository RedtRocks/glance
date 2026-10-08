## What changes for users

Before:

After:

<!-- For internal changes with nothing visible, say what changes for contributors instead. -->

## How

<!-- A few sentences on the approach, and anything a reviewer should look at closely. -->

## Testing

- [ ] `npm run typecheck` and `npm test` pass
- [ ] `cargo test` in `src-tauri` passes (if Rust changed)
- [ ] Tried in the app (say how):
- [ ] Screenshots in light and dark mode (if the UI changed)

## Checklist

- [ ] UI text goes through `t()` (see [CONTRIBUTING.md](https://github.com/RedtRocks/glance/blob/main/CONTRIBUTING.md#all-ui-text-goes-through-t))
- [ ] Still works, or is hidden, on Linux and in the browser version
- [ ] A line under the top `## New in` section of `CHANGELOG.md`, if users will notice
- [ ] README, `docs/FORMATS.md` or `docs/AI-APPS.md` updated, if they describe what changed
- [ ] No new network calls, telemetry or GPL/AGPL dependencies
