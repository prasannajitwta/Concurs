# Concur — AI Coding Assistant

Concur is a VS Code extension and CLI agent that connects your workspace to Azure OpenAI. It gives the LLM real project context — file tree, uploaded files, traced imports — and lets it read, write, and create files directly in your workspace. Both the VS Code extension and the CLI share the same core agent brain.

---

## Architecture

```
src/
├── core/
│   ├── types.ts        — Shared interfaces: AgentOutput, AzureConfig, ContextFile, SearchResult
│   ├── context.ts      — Node.js fs-based context tools: file tree, import tracing, grep search
│   └── agent.ts        — CoreAgent: shared brain used by both VS Code and CLI
├── agent/
│   ├── orchestrator.ts — VS Code wrapper over CoreAgent (resolves workspace root via vscode API)
│   ├── planner.ts      — PlanningAgent: generates multiple solution approaches + detailed plans
│   └── tools.ts        — Tool exports: readFile, writeFile, executeCommand, listFiles, searchCode
├── cli/
│   ├── index.ts        — readline REPL entry point
│   └── cliAgent.ts     — CLI implementation of AgentOutput (writes to stdout, applies file edits)
├── config/
│   └── configManager.ts — Stores Azure OpenAI config in VS Code global state + secrets
└── resources/
    ├── webview.js      — Webview frontend: chat UI, planning UI, file context panel
    ├── webview.html    — (legacy reference)
    └── styles.css      — Webview styles
```

### Key Design Pattern

Both the VS Code extension and the CLI implement the `AgentOutput` interface but render output differently:

- **VS Code** — Messages, file edits and tool results are sent back to the webview as `postMessage` events and rendered in the chat panel.
- **CLI** — Everything goes to `stdout`/`stderr`, file edits are written directly to disk with `fs.writeFileSync`.

The `CoreAgent` in `src/core/agent.ts` has zero VS Code dependencies. It handles context assembly and the Azure OpenAI API call, making it fully reusable across environments.

---

## How the LLM Gets Context

Context is assembled in this order on every message:

1. **Project file tree** (automatic) — `getFileTree(rootPath)` produces an ASCII directory tree that is prepended to every LLM prompt. The LLM always knows the shape of the project.
2. **User-uploaded files** (manual) — Files selected via the `📁 Files` button or `/add` CLI command. Full file content (up to 5 000 chars per file) is included.
3. **Import-traced files** (manual) — Clicking `🔗 Trace` in the VS Code toolbar (or `/trace <file>` in the CLI) recursively follows relative `import`/`require` statements from the active file and adds all reachable local modules into the context store.

> **What is never sent automatically:** node_modules, binary files, previous chat turns (each message is a fresh stateless call), and files not explicitly added. The LLM only sees what you give it plus the file tree.

### Context Tools

| Tool | Trigger | Reaches LLM? |
|---|---|---|
| File tree | Automatic on every message | ✅ Yes |
| Uploaded files (`📁 Files`) | User clicks button / selects files | ✅ Yes |
| Import tracing (`🔗 Trace`) | User clicks button or `/trace` | ✅ Yes (added to file store) |
| Grep search (`🔍`) | User types query and clicks search | ❌ No — results shown in output panel only |
| List Files | `List` button | ❌ No — shown in output panel only |
| View Active File | `View` button | ❌ No — shown in output panel only |

---

## VS Code Extension

### Setup

1. Open the **Concur** panel in the Activity Bar (left sidebar).
2. Enter your Azure OpenAI configuration:
   - **Azure Endpoint** — e.g. `https://my-resource.openai.azure.com`
   - **Deployment Name** — e.g. `gpt-4o`
   - **API Version** — e.g. `2024-02-01`
   - **API Key** — stored securely in VS Code secrets
3. Click **Save**. The chat window opens automatically.

### Chat Tab

Type a message and press **Enter** or click **Send**. The LLM receives the project file tree and any uploaded context files together with your message.

When the LLM response contains file-edit blocks (see [Automatic File Editing](#automatic-file-editing)), the changes are applied to disk immediately and the modified files open in the editor.

### Toolbar Buttons

| Button | Action |
|---|---|
| `📁 Files` | Open a file/folder picker; selected files are read and added to the LLM context |
| `🔗 Trace` | Trace import graph of the currently open file; all reachable local files are added to context |
| `🗑️ Clear` | Remove all files from context |
| `List` | List workspace files in the output panel |
| `View` | Show the active editor file in the output panel |
| `🔍` (+ search box) | Grep-search the workspace; results shown in output panel |

Uploaded files are shown in the **Context Files** panel below the toolbar. Click ✕ on any file to remove it from context (both the UI and the backend store are updated).

### Planning Tab

The Planning Agent generates multiple engineering approaches for a development task:

1. Switch to the **🚀 Planning** tab.
2. Describe your task in the text area.
3. Click **Generate Plans** — the agent returns 4–5 approach cards with pros, cons, estimated time, and complexity rating.
4. Click **Select This Approach →** on the approach you want.
5. A detailed step-by-step implementation plan is shown with file-edit blocks.
6. Click **✓ Execute** to apply all file changes at once.

### Automatic File Editing

The LLM can create or edit files by formatting its response with special markers:

```
===FILE: src/path/to/file.ts|EDIT===
// complete updated file content here
===FILE: src/new/feature.ts|CREATE===
// new file content here
```

- `EDIT` — replaces the entire content of an existing file
- `CREATE` — creates a new file (parent directories are created automatically)

The system parses these blocks from the LLM response automatically and applies them. Each modified file is opened in the editor for review.

---

## CLI Agent

The CLI agent uses the same `CoreAgent` brain as the VS Code extension but runs entirely in the terminal.

### Requirements

Compile the extension first:

```bash
cd concur
npm run compile
```

### Configuration

Set these environment variables before starting:

```bash
export AZURE_OPENAI_ENDPOINT="https://my-resource.openai.azure.com"
export AZURE_OPENAI_DEPLOYMENT="gpt-4o"
export AZURE_OPENAI_API_KEY="your-api-key"
export AZURE_OPENAI_API_VERSION="2024-02-01"   # optional, defaults to 2024-02-01
```

### Starting the REPL

```bash
# Pass your project root as the first argument (defaults to current directory)
node out/cli/index.js /path/to/your/project

# Or via npm script (uses cwd as project root)
npm run cli
```

### CLI Commands

| Command | Description |
|---|---|
| `/tree` | Print the project file tree |
| `/search <query>` | Grep search across the workspace (plain text, case-insensitive) |
| `/add <path>` | Read a file and add it to LLM context |
| `/trace <path>` | Recursively trace imports from a file and add all local modules to context |
| `/files` | List all files currently in context |
| `/clear` | Remove all files from context |
| `/help` | Show command reference |
| `/exit` | Quit |
| `<anything else>` | Send as a chat message to the LLM |

### Example Session

```
═══════════════════════════════════════
 Concur CLI Agent
 Workspace: /home/user/myproject
 Type /help for commands
═══════════════════════════════════════

You> /tree
myproject/
├── src/
│   ├── index.ts
│   └── utils/
│       └── helpers.ts
└── package.json

You> /trace src/index.ts
  ✓ Traced 3 file(s) from: /home/user/myproject/src/index.ts
    • /home/user/myproject/src/index.ts
    • /home/user/myproject/src/utils/helpers.ts

You> refactor the helpers module to use async/await instead of callbacks
```

The LLM response will include file-edit blocks which the CLI automatically applies to disk.

---

## Message Flow

### VS Code Extension

```
User types message
       │
       ▼
webview.js  ──postMessage('sendMessage')──►  extension.ts
                                                    │
                                                    ▼
                                            Agent.handleMessage()
                                                    │
                                                    ▼
                                            CoreAgent.handleMessage()
                                          ┌─────────────────────────┐
                                          │ 1. getFileTree(root)    │
                                          │ 2. fileStore contents   │
                                          │ 3. user message         │
                                          └─────────────────────────┘
                                                    │
                                                    ▼
                                          Azure OpenAI API call
                                                    │
                                                    ▼
                                          Parse ===FILE:=== blocks
                                          Apply edits to disk
                                          Open files in editor
                                                    │
                                                    ▼
                                    postMessage('messageResponse') ──► webview.js
                                                                              │
                                                                              ▼
                                                                    Render markdown in chat
```

### CLI Agent

```
User types in REPL
       │
       ├── /command  ──►  Handled locally (tree, search, add, trace, files, clear)
       │
       └── message   ──►  CliAgent.handleMessage()
                                    │
                                    ▼
                            CoreAgent.handleMessage()
                          (same brain as VS Code)
                                    │
                                    ▼
                          Azure OpenAI API call
                                    │
                                    ▼
                          Print response to stdout
                          Apply ===FILE:=== edits to disk
```

---

## Development

### Build

```bash
cd concur
npm install
npm run compile        # one-time build
npm run watch          # watch mode during development
```

### Run the Extension (VS Code)

Press **F5** in VS Code to open a new Extension Development Host window with Concur loaded.

### Lint

```bash
npm run lint
```

### Run Tests

```bash
npm test
```

---

## Context Limits

| Parameter | Value |
|---|---|
| Per-file content limit (chat) | 5 000 characters |
| Per-file content limit (planning) | 3 000 characters |
| Max completion tokens (chat) | 4 000 |
| Max completion tokens (planning) | 20 000 |
| Max files in listFiles tool | 2 000 |
| Max grep results per search | 50 (VS Code) / 100 default (CLI) |
| Max import trace depth | 2 levels |
| Max file tree depth | 4 levels |

---

## Roadmap

- [ ] Conversation history (multi-turn chat)
- [ ] Semantic search via `@xenova/transformers` or `sentence-transformers` (beyond grep)
- [ ] `.concurignore` support for excluding files from context
- [ ] Streaming responses
- [ ] Token count display in UI
