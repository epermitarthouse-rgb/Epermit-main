# Epermit portable Agent Skills

This directory provides 12 project-level skills in the portable Agent Skills `SKILL.md` format for Cursor and compatible OpenAI agents. Cursor recognizes `.agents/skills/` when the repository is open. ChatGPT/Composio should read the matching file from the GitHub repository on demand; automatic project skill discovery in every ChatGPT interface is not guaranteed.

Canonical code repository: `epermitarthouse-rgb/Epermit-main`. Exclude `D71404/Epermit`.

Context entry point: `docs/context-handoff/12-MASTER-CONTEXT-INDEX.md` (from PR #16). Skill requirements: `docs/context-handoff/10-AGENT-SKILL-REQUIREMENTS.md`. Context handoff is based on `fc74c35`; refresh before changing code.

## Usage
Select the matching skill by its frontmatter description, open its full `SKILL.md` and only the linked chapters/source paths needed for the task. Multiple skills can be combined, e.g., architecture + code analyzer + debug + review, and deployment only if explicitly requested.

**Owner-confirmed overrides (2026-10-19):** production as default context, not blanket write permission; individual Supabase migrations only (never bulk db push); direct Railway service-specific deployment separate from GitHub push; GitHub-connected Vercel; Analyzer V2 still in progress; old ingestion-worker image not grounds to redeploy; caller-auth security audit of Edge Functions.

Do not infer that GitHub merging installs the skills inside a remote ChatGPT session; OpenAI environments may need a mounted repository, explicit skill upload, or a GitHub read to access these files.

## Stage A status
Draft procedural skills, not yet acceptance-tested with real engineering tasks. Do not deploy or execute migrations merely to test skills.
