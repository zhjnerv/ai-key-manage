# Repository Guidelines

## Project Structure & Module Organization

- `app/` contains the Next.js App Router UI. The page, shared layout, and styles live here.
- `lib/` holds reusable TypeScript logic for endpoint testing, API contracts, and CC Switch SQL parsing.
- `tests/` contains Node test-runner suites named `*.test.ts`.
- `public/` stores static assets; `scripts/` contains local build and preview helpers.
- `.next/` and `out/` are generated artifacts. Do not edit them as source.

## Build, Test, and Development Commands

- `npm install` installs locked dependencies.
- `npm run dev` starts Next.js locally at `http://localhost:3000`.
- `npm run lint` runs the Next.js and TypeScript ESLint rules.
- `npm test` runs every `tests/*.test.ts` suite with Node’s built-in test runner.
- `npm run build` creates the static export in `out/`; `npm run start` previews it locally.
- `npm run docker:deploy` builds and starts Docker Compose. Use `npm run docker:logs` and `npm run docker:down`.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, double quotes, and semicolons. Use `PascalCase` for React components and exported types, `camelCase` for functions and variables, and uppercase snake case for module constants. Prefer small reusable functions in `lib/`, explicit public contract types, and the `@/*` import alias. Add concise Chinese comments only for non-obvious decisions or complex logic.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Cover protocol fallbacks, URL normalization, parsers, and regression-prone error paths. Use concise Chinese names describing observable behavior. Mock external `fetch` calls; automated tests must not contact paid or credentialed APIs. No coverage threshold is configured, so prioritize meaningful branch coverage.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, often with Conventional Commit prefixes such as `feat:` and `chore:`. Follow that pattern, for example `fix: handle Claude model fallback`. Pull requests should describe user-visible behavior, list validation commands, link related issues, and include screenshots for UI changes. Highlight changes affecting API-key handling, browser storage, CORS, Docker, or deployment.

## Security & Configuration

Never commit API keys, exported configurations, local environment files, deployment credentials, or private deployment notes. Static builds send keys directly to providers. Keep paid operations explicitly user-triggered and treat HTTP upstreams as plaintext transport.
