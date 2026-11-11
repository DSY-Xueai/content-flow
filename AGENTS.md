# Repository Guidelines

## Project Structure & Module Organization

- `aihot-frontend/` contains the React/TypeScript AI news and article workflow workbench. UI components live in `src/components/`, API clients in `src/api/`, and shared utilities in `src/lib/`.
- `aihot-frontend/server/agentPipeline/` implements job orchestration, persistence, model calls, and script adapters; Vite mounts local API middleware.
- `task_skills/` contains content formatting, illustration, rendering, and WeChat publishing workflows, with executable TypeScript under each skill's `scripts/` directory. `message_skills/` contains information-gathering instructions.
- Tests sit beside implementation files. Static assets belong in `aihot-frontend/public/`.

## Build, Test, and Development Commands

Run these commands from `aihot-frontend/`:

```sh
npm ci                # Install dependencies from package-lock.json
npm run dev           # Start the local workbench at http://127.0.0.1:5177
npm run build         # Run TypeScript checks and produce dist/
npm test              # Run the Vitest suite once
npm run test:watch     # Watch tests during development
npm test -- src/api/agent.test.ts  # Run a focused test file
```

Content workflow scripts also require Bun. Inspect the relevant `SKILL.md` and script package dependencies before running them.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, and semicolons. Match surrounding quote and formatting conventions: frontend files generally use single quotes. Use PascalCase for React components and types, camelCase for functions and variables, and descriptive module names. No dedicated lint or formatter command is configured. Keep changes focused; avoid unrelated refactoring or speculative abstractions.

## Testing Guidelines

Frontend and pipeline tests use Vitest; UI tests use Testing Library with jsdom and `src/test/setup.ts`. Name adjacent tests `*.test.ts` or `*.test.tsx`. Skill scripts also contain `node:test` suites; preserve their existing harness. Cover changed behavior and failure paths, mocking external services and publishing operations. No numeric coverage threshold is configured. Run relevant tests and the frontend build before submitting code changes.

## Commit & Pull Request Guidelines

Recent commits use short, action-oriented Chinese subjects, such as `添加全局侧栏折叠交互`. Follow that style and keep each commit focused. PRs should explain the problem, resulting behavior, and validation commands; link relevant issues or design documents. Include screenshots for visible UI changes.

## Security & Agent Instructions

Use `aihot-frontend/.env.example` as the configuration reference. Keep credentials in ignored `.env` files. Exclude generated `dist/`, `data/`, `test-results/`, and `pipeline-output/` artifacts. Agents should communicate primarily in Chinese, state implementation assumptions, and preserve unrelated user changes.
