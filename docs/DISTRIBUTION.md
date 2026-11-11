# Getting the isokit skill in front of people

How the skill reaches agents, channel by channel, and exactly what to do for each. Checked on 2026-10-05; directories change, so re-check a channel's own docs before acting on it.

## 1. skills.sh (the `npx skills` leaderboard)

**How it works.** There is no submission form. A skill appears on [skills.sh](https://skills.sh) automatically once people install it with `npx skills add owner/repo`; the CLI sends anonymous install telemetry for public GitHub repos, and the leaderboard ranks by installs (all time, trending over 24 hours, and hot). The CLI finds our skill at `skills/isokit/SKILL.md` and needs only `name` and `description`. Users can opt out of telemetry with `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`. ([FAQ](https://skills.sh/docs/faq), [CLI](https://github.com/vercel-labs/skills))

**What to do.**
1. Install it yourself with telemetry on: `npx skills add aadilghani1/isokit`.
2. Put that command everywhere people meet the project: README, demo page, launch posts. (Done in the README and on the demo.)
3. When <https://skills.sh/aadilghani1/isokit> resolves, add the badge: `[![skills.sh](https://skills.sh/b/aadilghani1/isokit)](https://skills.sh/aadilghani1/isokit)`.
4. Optional: a `skills.sh.json` at the repo root customizes the page ([docs](https://www.skills.sh/docs/customize)).

There is no documented minimum install count or crawl schedule; expect days, not minutes.

## 2. Claude Code plugin marketplace (this repo is one)

**How it works.** The repo ships `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`, so it is installable today:

```
/plugin marketplace add aadilghani1/isokit
/plugin install isokit@isokit
```

From a shell: `claude plugin marketplace add aadilghani1/isokit` then `claude plugin install isokit@isokit`. Both manifests pass `claude plugin validate --strict .`; keep `version` in `plugin.json` in step with releases. ([marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference))

## 3. Anthropic's plugin directory (claude.ai/directory)

**How it works.** Third-party plugins are submitted through the developer portal at [claude.ai/directory/manage](https://claude.ai/directory/manage). It needs a paid Claude plan, a connected GitHub account with push access, and a public repo; every version goes through validation, a security scan and a reviewer before it is listed. Listed plugins install in Claude Code as `isokit@synced`. ([submit](https://claude.com/docs/plugins/submit), [checklist](https://claude.com/docs/plugins/pre-submission-checklist))

**What to do.**
1. Work through the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).
2. Consider adding the optional listing fields to `plugin.json`: `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl`.
3. Submit at claude.ai/directory/manage.

## 4. Directories that crawl on their own

- **[claudemarketplaces.com](https://claudemarketplaces.com/about)** crawls GitHub daily for valid `.claude-plugin/marketplace.json` files and also pulls from skills.sh. Nothing to submit; a minimum star count is reported by third parties.
- **[SkillsMP](https://skillsmp.com)** indexes public `SKILL.md` files automatically; a small star minimum is reported by third parties.

## 5. Awesome lists (submit by hand, after some traction)

| List | How | Rule that matters |
| --- | --- | --- |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md) | Issue form only, no PRs | Repo at least 14 days old with ongoing commits, or 100+ stars. Eligible from about 2026-10-18. |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills/blob/main/CONTRIBUTING.md) | Pull request | Solves a real problem, shows examples, follows the list's format exactly. |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills/blob/main/CONTRIBUTING.md) | Pull request | Author prefix in the entry, description of ten words or fewer; brand-new skills are not accepted. |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills/blob/main/CONTRIBUTING.md) | Pull request | Needs social proof (stars). |

## 6. Other agents

- **OpenAI Codex** follows the [Agent Skills](https://agentskills.io/specification) standard and reads `.agents/skills`; `npx skills add` installs there for Codex users. ([docs](https://learn.chatgpt.com/docs/build-skills))
- **Cursor** reads `.agents/skills` and `.cursor/skills`; there is no catalog, so `npx skills add` is the way in. ([docs](https://cursor.com/docs/skills))

## The Agent Skills spec, and one deliberate exception

`name` (lowercase, matches the folder) and `description` (under 1,024 characters) are compliant, and `license: MIT` is set. The strict validator (`skills-ref validate skills/isokit`) rejects one field: `argument-hint`. It is a Claude Code extension that shows `[object or idea]` after `/isokit`, and the `skills` CLI accepts it, so it stays. Remove it if a directory ever insists on strict validation.

## This week, in order

1. Install the skill yourself with telemetry on; share the one-line install.
2. Submit to claude.ai/directory/manage after the pre-submission checklist.
3. Add the skills.sh badge once the page resolves.
4. From about 2026-10-18, file the awesome-claude-code issue; send the other lists a PR once there are stars and a few real figures to show.
