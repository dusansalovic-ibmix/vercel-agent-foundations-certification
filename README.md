# Ship It Shop — Store Agents (Vercel Agent Foundations Certification)

The Ship It Shop storefront (Next.js 16, backed by the live Vercel Swag Store API) extended with two separate AI agents:

| | Shopping agent | Store admin agent |
| --- | --- | --- |
| Audience | Customers | Employees |
| UI | Storefront chat panel (robot icon in the header) | `/admin` (password-gated) |
| Endpoint | `POST /api/chat`, `GET /api/chat/:id/stream` | `POST /api/admin/chat`, `GET /api/admin/chat/:id/stream` |
| Workflow | `shoppingChatFlow` | `adminChatFlow` |
| Tools | `searchProducts`, `getAllCategories`, `getProductDetails`, `returnOrder` | `searchProducts`, `getAllCategories`, `getSupportTickets`, `getReturnsHistory`, `getInventoryStock`, `getSalesAnalytics`, `bash`, `saveMemory` |
| Default model (via AI Gateway) | `openai/gpt-4.1-mini` | `openai/gpt-4.1` |

Built with the **AI SDK 7** (`WorkflowAgent` from `@ai-sdk/workflow`), **AI Elements**, **Vercel AI Gateway**, **Vercel Workflows** and **Vercel Sandbox**.

## Setup

Prerequisites: Node.js 22+ (LTS), [pnpm](https://pnpm.io), the [Vercel CLI](https://vercel.com/docs/cli), and a Vercel project created from this repo.

```bash
pnpm install
vercel login
vercel link                 # select the team + existing project
vercel env pull .env.local  # BYPASS_SECRET, API_BASE_URL and a VERCEL_OIDC_TOKEN
pnpm dev                    # http://localhost:3000
```

The OIDC token authenticates **both** AI Gateway and Vercel Sandbox locally. It expires after 12 hours; run `vercel env pull .env.local` again when the agents start reporting authentication errors. On Vercel, OIDC is automatic.

- Storefront chat: open any store page and click the robot icon in the header.
- Admin chat: visit `/admin` and sign in with the demo password from the assignment brief.
- Demo orders for returns: `11111`, `22222`, `33333` are returnable; `44444` (paid) and `55555` (cancelled) are not.

Inspect durable runs locally with `npx workflow web` (or `npx workflow inspect runs`).

### Deploying

Push to the Vercel-connected repo. `BYPASS_SECRET` and `API_BASE_URL` are set by the Deploy button; AI Gateway and Sandbox use the deployment's OIDC token, so no extra secrets are required. Optionally set `AI_GATEWAY_API_KEY` and the model overrides below.

## Environment variables

All variables are server-only. None use the `NEXT_PUBLIC_` prefix except the optional site URL. See `.env.example`.

| Variable | Required | Description |
| --- | --- | --- |
| `BYPASS_SECRET` | Yes | Vercel deployment-protection bypass for the store API. Sent server-side on every store request. |
| `API_BASE_URL` | No | Store API base URL. Defaults to `https://vercel-agentic-swag-store-api.vercel.app/api`. |
| `VERCEL_OIDC_TOKEN` | Locally | Written by `vercel env pull`. Authenticates AI Gateway and Vercel Sandbox. Automatic on Vercel. |
| `AI_GATEWAY_API_KEY` | No | Alternative AI Gateway auth (instead of OIDC). |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | No | Alternative Sandbox auth when no OIDC token is available. |
| `SHOPPING_AGENT_MODEL` | No | AI Gateway model ID for the shopping agent (default `openai/gpt-4.1-mini`). Any tool-capable model works. |
| `ADMIN_AGENT_MODEL` | No | AI Gateway model ID for the admin agent (default `openai/gpt-4.1`). |
| `ADMIN_SANDBOX_NAME` | No | Name of the persistent admin sandbox (default `ship-it-shop-admin-agent-<VERCEL_ENV>`, so development, preview and production each get their own memory). |
| `NEXT_PUBLIC_SITE_URL` | No | Public site URL for metadata. Defaults to `http://localhost:3000`. |

## Architecture

```
Browser (useChat + WorkflowChatTransport)          Server
─────────────────────────────────────────          ─────────────────────────────────────────────
components/agent-chat.tsx ── POST /api/chat ──────▶ start(shoppingChatFlow) ──▶ WorkflowAgent
                          ◀─ SSE + x-workflow-run-id      │  model calls = durable steps (AI Gateway)
                          ── GET /api/chat/:id/stream ─▶  │  tools       = durable steps (store API)
                             (reconnect / refresh)        └─ returnOrder ─▶ start(returnFlow)  (background)

components/admin-agent-chat.tsx ─ /api/admin/chat ─▶ start(adminChatFlow)
                                                     ├─ loadAdminMemoryStep  (reads MEMORY.md from sandbox)
                                                     └─ WorkflowAgent ─▶ back-office tools ─▶ JSON → sandbox /data
                                                                     └─▶ bash / saveMemory ─▶ Vercel Sandbox
```

### Key files

| File | Purpose |
| --- | --- |
| `lib/agent.ts` | Agent definitions (instructions, models, tool sets) and typed UI message types |
| `lib/tools.ts` | All tools. Network work runs in `"use step"` functions with retries and structured failures |
| `lib/return-steps.ts` | Durable steps of the return process |
| `lib/sandbox.ts` | Persistent admin sandbox (`Sandbox.getOrCreate`), command runner, data files, memory file |
| `lib/workflows/chat-flow.ts`, `admin-chat-flow.ts`, `return-flow.ts` | The three workflows |
| `lib/chat-route.ts` | Shared route logic: message validation, streaming, resumable stream replay |
| `lib/secrets.ts` | Redacts credentials from tool/sandbox output and blocks them from memory |
| `hooks/use-durable-chat.ts` | `useChat` + `WorkflowChatTransport` + per-chat persistence and resume |
| `components/chat/*` | Generative UI for tool results (shopping cards, admin tool cards, sandbox terminal) |
| `app/api/admin/memory/route.ts` | Read-only view of the memory file for the admin UI ("Memory" button) |

### Shopping agent

- **Tools use store data, never guesses.** `searchProducts` covers text search, category filtering and browsing the full catalog. The category filter is validated against `GET /categories`, so a wrong slug returns the valid list. `getProductDetails` adds live stock.
- **Generative UI.** Search results render as a product grid (image, name, formatted price, link to the existing product page, "Open in search"). Details render as a product card with an image gallery, stock badge, tags, **Add to cart** (the existing cart context) and a product-page link. Categories render as chips. A filed return renders a confirmation card. Every tool shows a progress state while running and a clear notice for not-found, invalid, ineligible, or unavailable results.
- **Scope.** The system prompt keeps the agent on products and returns and redirects anything else back to the store.
- **Returns.** `returnOrder` checks the order first, so a missing, cancelled, or not-yet-delivered order gets an honest answer and never a fake "filed". It then `start()`s `returnFlow` in the background and immediately confirms that the return was filed.

### Durable workflows (both agents)

- Each chat turn is a workflow run. `WorkflowAgent` runs every model call and every tool step as a durable step: transient failures are retried, and completed steps are replayed, not re-executed.
- Tool steps throw `RetryableError` with backoff on network, 429, and 5xx errors. On the final attempt they return a `SERVICE_UNAVAILABLE` result, so the model must report the outage instead of inventing data. 404 and 422 errors become `NOT_FOUND` and `INVALID_REQUEST` without retries.
- If the model still fails after retries, the workflow writes an explicit error to the stream. The UI shows it with a **Try again** button.
- **Chat recovery.** The POST response carries `x-workflow-run-id`. If the stream ends without `finish` (dropped connection, function timeout), `WorkflowChatTransport` reconnects to `GET …/:id/stream?startIndex=n`. That route replays the durable stream and skips the chunks the client already has. After a **page refresh**, `useDurableChat` restores the conversation as it was when the turn was sent and reattaches to the still-running run, so the reply continues without duplicate output and without starting the task again.
- **Return side effects.** `returnFlow` runs look up order → notify customer → pre-authorize refund → file return (with a `createWebhook()` callback URL) → wait for the decision (callback or polling) → notify the decision. If filing fails and retries, the notification and pre-authorization are not repeated, because completed steps replay from the event log. The run starts with the hook token `return:<orderId>`, so a duplicate request for the same order while one is in flight is refused (`ALREADY_IN_PROGRESS`) instead of filing twice. The callback body is never trusted on its own; the status is re-read from the store API.

### Store admin agent

- **Read-only back-office tools** with every filter from the starter's API helpers: tickets (date, status, priority, category, assignee, limit), returns (date, status, decision, limit; includes order and refund info), inventory (product IDs, low stock, in stock, pagination) and sales (date range, product). Catalog search and categories identify products first.
- **Sandbox computation.** Each back-office call writes its full, untruncated result to `/vercel/sandbox/data/*.json` in the admin sandbox and returns a preview plus the file path. The agent must compute aggregates and joins with the `bash` tool (Node, Python, jq) rather than doing arithmetic itself. Examples: return rate per product = returned units ÷ units sold for the same window, and low-stock top sellers = sales ⨝ low-stock inventory. Command activity appears in a terminal view with running, exit-code, and failure states.
- **Isolation.** The sandbox is a separate Firecracker microVM created with `networkPolicy: "deny-all"`, no environment variables and no credentials. Agent-written code can't reach the store API, the internet or any secret. The `bash` tool is only in the admin tool set.
- **Persistent memory.** One named, persistent sandbox (`Sandbox.getOrCreate({ name, persistent: true })`) holds both the data files and `/vercel/sandbox/memory/MEMORY.md`, and its filesystem is snapshotted between sessions. At the start of every admin run, application code (`loadAdminMemoryStep`) reads the file and injects it into the agent's instructions, with an explicit "no saved memory yet" path. The agent appends preferences, corrections and business context with `saveMemory`, and memory never replaces live store data. Notes that look like credentials are rejected. The **Memory** button in the admin header shows the file.
- **Answers.** The agent knows today's date, resolves relative ranges into explicit dates, formats cents as dollars, names products, and states assumptions and data limits (truncation, the ~180-day history).

### Security

- The store API value, AI Gateway auth and the admin password exist only on the server. The browser talks only to this app's routes. Tool outputs never include request URLs, sandbox output is passed through `redactSecrets`, and memory refuses credential-like notes.
- Admin API routes (`/api/admin/*`) check the admin session in the route handler and in `proxy.ts`, which returns 401. The session cookie is `httpOnly`, `sameSite=lax`, path `/`.
- Chat requests are validated (`safeValidateUIMessages`, size and length caps, only user and assistant roles), so a client can't inject system instructions. Stream-resume routes only serve runs of their own workflow, so a shopper can't read admin runs by ID.
- Agents treat tool results and memory as data, not instructions, and never reveal credentials or their prompts.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Dev server on http://localhost:3000 |
| `pnpm build` | Production build (compiles workflows; `/` stays static, `/products/[param]` SSG, `/search` dynamic) |
| `pnpm start` | Serve the production build |
| `npx workflow web` | Local workflow run inspector |

`pnpm lint` is wired to `eslint .`, but ESLint isn't installed. There is no test framework; `pnpm build` plus `tsc --noEmit` are the checks.
