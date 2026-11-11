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

## 项目文档维护

- `Course.md` 用于记录当前项目状态及后续开发所需的关键信息，不记录琐碎改动或开发流水账。
- 每轮开发结束时，自行判断本轮变更是否影响项目整体行为、技术结构、运行方式或后续开发。只有存在实质性影响时，才需要同步更新项目根目录下的 `Course.md`。
- 不以修改类型、文件数量或改动大小作为更新依据，以是否影响后续理解和接手项目为准。
- 更新时只维护必要的项目状态、关键变更、重要文件、运行入口及注意事项，未变化的内容不重复修改。
- 及时修正或删除过时、重复及无用的信息，保持文档简短、准确。
- 满足条件时自动更新，无需用户额外提醒；不满足时直接跳过。
