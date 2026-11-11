@AGENTS.md

## Claude Code

- **Figures go through the skill.** Run `/isokit <object>` or read `skills/isokit/SKILL.md`, and `references/levels.md` before choosing how complicated a figure is. Inside this repo, start from `npm run new:figure` rather than an empty file.
- **Look before you hand over.** Screenshot with `playwright-core` and the system Chrome (`chromium.launch({ channel: "chrome" })`); the bundled headless shell is often missing. Read every image: light and dark, 1280 and 390 px, at rest and after each press.
- **Parallel builders.** Give each subagent one industry folder and the figure contract from AGENTS.md. Two agents never edit the same file. Nobody runs `git stash`, `reset` or `checkout` on the shared tree while others work in it. Builders do not commit; the lead session does.
- **Commits and pull requests carry no AI trailers.** This repo's rule overrides the default attribution: no `Co-Authored-By` line for Claude, and no "Generated with Claude Code" footer.
- **Ask before merging.** A merge to `main` opens the version PR, merging that publishes to npm, and the studio redeploys to GitHub Pages.
- **Keep the docs in step.** When the public API changes, update `skills/isokit/references/api.md`, the studio's component docs and `llms.txt` in the same change.
