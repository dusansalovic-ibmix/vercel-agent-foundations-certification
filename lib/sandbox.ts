/**
 * The admin agent's persistent Vercel Sandbox.
 *
 * One named, persistent sandbox (`ADMIN_SANDBOX_NAME`) serves as both the
 * computation environment for the `bash` tool and the home of the admin
 * agent's long-term memory file. Vercel Sandbox snapshots the filesystem when
 * a session stops and restores it on the next call, so files written here
 * survive across conversations and deployments.
 *
 * Isolation: the sandbox is a Firecracker microVM separate from the app
 * server, created with `networkPolicy: "deny-all"` and no credentials or
 * environment variables. Agent-written code can read the JSON files the
 * back-office tools drop into `DATA_DIR`, but it cannot call the store API,
 * reach the internet, or see any secret.
 *
 * Server-only. Called from workflow steps (`lib/tools.ts`) and the memory
 * route — never from the browser.
 */
import { Sandbox } from "@vercel/sandbox";
import { redactSecrets } from "./secrets";

/**
 * One sandbox per environment (development / preview / production), so local
 * testing never writes into the production agent's memory.
 */
export const ADMIN_SANDBOX_NAME =
  process.env.ADMIN_SANDBOX_NAME ??
  `ship-it-shop-admin-agent-${process.env.VERCEL_ENV ?? "development"}`;

export const SANDBOX_ROOT = "/vercel/sandbox";
export const MEMORY_DIR = `${SANDBOX_ROOT}/memory`;
export const MEMORY_FILE = `${MEMORY_DIR}/MEMORY.md`;
export const DATA_DIR = `${SANDBOX_ROOT}/data`;

/** Idle time before the session stops (its filesystem is snapshotted). */
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
/** Hard limit for a single agent command. */
const COMMAND_TIMEOUT_MS = 60 * 1000;
/** Keep tool results small enough for the model's context window. */
const MAX_OUTPUT_CHARS = 12_000;

const README = `# Ship It Shop admin sandbox

This sandbox belongs to the store admin agent.

- \`data/\`   JSON snapshots written by the back-office tools (refreshed on every call)
- \`memory/MEMORY.md\`   long-term notes the agent loads at the start of every conversation

Network access is disabled. Node.js, Python 3 and jq are available.
`;

/**
 * Optional access-token auth for environments without a Vercel OIDC token.
 * On Vercel (and locally after `vercel env pull`) OIDC is used automatically.
 */
function credentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  if (VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID) {
    return {
      token: VERCEL_TOKEN,
      teamId: VERCEL_TEAM_ID,
      projectId: VERCEL_PROJECT_ID,
    };
  }
  return {};
}

export async function getAdminSandbox(): Promise<Sandbox> {
  return Sandbox.getOrCreate({
    ...credentials(),
    name: ADMIN_SANDBOX_NAME,
    persistent: true,
    networkPolicy: "deny-all",
    timeout: SESSION_TIMEOUT_MS,
    resources: { vcpus: 2 },
    tags: { app: "ship-it-shop", role: "admin-agent" },
    onCreate: async (sandbox) => {
      await sandbox.runCommand("mkdir", ["-p", MEMORY_DIR, DATA_DIR]);
      await sandbox.writeFiles([
        { path: `${SANDBOX_ROOT}/README.md`, content: README },
      ]);
    },
  });
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
  const head = text.slice(0, MAX_OUTPUT_CHARS);
  return {
    text: `${head}\n… [output truncated: ${text.length - MAX_OUTPUT_CHARS} more characters]`,
    truncated: true,
  };
}

export interface CommandOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

/** Run a shell command in the admin sandbox (bash -lc, cwd = SANDBOX_ROOT). */
export async function runSandboxCommand(command: string): Promise<CommandOutcome> {
  const sandbox = await getAdminSandbox();
  const startedAt = Date.now();
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", command],
    cwd: SANDBOX_ROOT,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  const out = truncate(redactSecrets(stdout));
  const err = truncate(redactSecrets(stderr));
  return {
    exitCode: result.exitCode,
    stdout: out.text,
    stderr: err.text,
    truncated: out.truncated || err.truncated,
    durationMs: Date.now() - startedAt,
  };
}

/** Write a JSON snapshot into DATA_DIR and return its absolute path. */
export async function writeDataFile(
  fileName: string,
  data: unknown,
): Promise<string> {
  const sandbox = await getAdminSandbox();
  const path = `${DATA_DIR}/${fileName}`;
  await sandbox.runCommand("mkdir", ["-p", DATA_DIR]);
  await sandbox.writeFiles([
    { path, content: JSON.stringify(data, null, 2) },
  ]);
  return path;
}

/** Read the memory file. Returns "" when no memory has been saved yet. */
export async function readMemoryFile(): Promise<string> {
  const sandbox = await getAdminSandbox();
  const buffer = await sandbox.readFileToBuffer({ path: MEMORY_FILE });
  return buffer ? buffer.toString("utf8") : "";
}

/**
 * Append one line to the memory file. The line is passed as an argv value
 * (not interpolated into a shell string), so its content can't inject
 * commands.
 */
export async function appendMemoryLine(line: string): Promise<void> {
  const sandbox = await getAdminSandbox();
  const result = await sandbox.runCommand("bash", [
    "-c",
    'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"',
    "append-memory",
    line,
    MEMORY_FILE,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not write memory file (exit ${result.exitCode}): ${await result.stderr()}`,
    );
  }
}
