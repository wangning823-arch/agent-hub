# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Hub is a generic CLI Agent Web UI that allows multiple AI coding assistants (agents) to work simultaneously, each in its own project window. It is a full-stack JavaScript application with a Node.js/Express backend and a React/Vite frontend.

## Commands

```bash
# Install dependencies
cd backend && npm install && cd ../frontend && npm install

# Run backend (Express + WebSocket, port 3001)
cd backend && npm start       # or: npm run dev (with --watch)

# Run frontend (Vite dev server, port 5173)
cd frontend && npm run dev

# Build frontend for production
cd frontend && npm run build   # outputs to frontend/dist/

# One-shot startup (installs deps if needed, starts both)
./start.sh
```

There are no lint or test scripts configured.

## Architecture

### Backend (`backend/server.js`)

Single entry point. Express HTTP server + WebSocket server on port 3001. All REST API routes and WebSocket handling are defined here.

Key backend modules:
- `sessions.js` — SessionManager: creates/manages sessions, spawns agent adapters
- `projects.js` — ProjectManager: CRUD for project registry
- `permissions.js` — PermissionManager: command/file permission policies with regex pattern matching for dangerous commands
- `token-tracker.js` — Tracks API token usage and costs per session
- `claude-service.js` — One-shot Claude API calls (summary, review, title generation)
- `claude-client.js` — Singleton Anthropic SDK client (reads API key from `~/.claude/settings.json`)
- `agents/` — Agent adapters (see below)

### Agent Adapters (`backend/agents/`)

All extend `Agent` base class (Node.js `EventEmitter`). Two patterns:
- **CLI subprocess**: `ClaudeCodeAgent`, `OpenCodeAgent`, `CodexAgent` — spawn CLI, parse stdout JSON line-by-line
- **SDK direct**: `ClaudeApiAgent` — calls Anthropic SDK directly with streaming

Each adapter emits events: `message`, `error`, `stopped`, `token_usage`, `tool_use`, `conversation_id`, `title_update`.

### Frontend (`frontend/src/`)

React 18 + Vite + Tailwind CSS. Main entry: `main.jsx` → `App.jsx`.

- `App.jsx` — Global state management (session list, active session, modals)
- `ChatPanel.jsx` — WebSocket connection per active session, sends `{type: 'user_input', content: ...}`
- `components/` — UI components
- `hooks/` — Custom React hooks

Vite proxies `/api` and `/ws` to backend (see `frontend/vite.config.js`).

### Data Persistence

All data stored as JSON files in `data/`:
- `sessions.json` — Session metadata + last 200 messages per session
- `projects.json` — Project registry + recent projects list
- `token-stats.json` — Per-session token usage statistics

### WebSocket Protocol

Connect: `ws://localhost:3001?session=SESSION_ID&token=TOKEN`

Send: `{type: 'user_input', content: '...'}`

Receive: `{type: text|status|error|token_usage|tool_use|conversation_id|title_update, content: '...'}`

## Adding a New Agent

Implement the Agent interface (extend `EventEmitter`):
- `constructor(name, workdir)` — Initialize with session name and working directory
- `start()` — Launch the agent process
- `send(message)` — Send a user message
- `stop()` — Terminate the agent process
- Emit events: `message`, `error`, `stopped`

Then register it in `sessions.js` and add the agent type string to the agents list returned by the `/api/agents` endpoint in `server.js`.

## Security

- Optional token-based auth via `.token` file at project root, passed as `x-access-token` header
- `validatePath()` restricts file operations to `ALLOWED_ROOT`
- Git commands whitelisted: `pull`, `push`, `status`, `log`, `diff`, `stash`, `fetch`, `branch`
- Permission manager blocks dangerous commands via regex patterns
