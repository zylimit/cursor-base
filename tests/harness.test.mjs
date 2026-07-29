import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnessScript = resolve(repositoryRoot, "scripts/harness.mjs");
const installManifestRelative = join(".cursor", "harness-state", "install-manifest.json");

function tempRepository(t, label = "cursor-harness-") {
  const root = mkdtempSync(join(tmpdir(), label));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runHarness(args, { input, cwd = repositoryRoot, timeout = 20_000 } = {}) {
  return spawnSync(process.execPath, [harnessScript, ...args], {
    cwd,
    encoding: "utf8",
    input: typeof input === "string" ? input : input === undefined ? undefined : JSON.stringify(input),
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
}

function runHarnessScript(script, args, { cwd = repositoryRoot, timeout = 20_000 } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
}

function runProgram(program, args, cwd) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${program} ${args.join(" ")} failed:\n${result.stderr}`);
  return result;
}

function jsonResult(result, expectedStatus = 0) {
  assert.ifError(result.error);
  assert.equal(
    result.status,
    expectedStatus,
    `unexpected exit status\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.ok(result.stdout.trim(), `expected JSON output, stderr was:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizedHash(value) {
  return createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
}

function manifestDigest(files) {
  return createHash("sha256")
    .update(files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""))
    .digest("hex");
}

function refreshManifestDigest(manifest) {
  manifest.digest = manifestDigest(manifest.files);
  return manifest;
}

function hook(root, event, payload) {
  return jsonResult(
    runHarness(["hook", event, "--target", root], {
      input: { workspace_roots: [root], ...payload },
    }),
  );
}

test("security hooks allow routine work and gate shell side effects", async (t) => {
  const root = tempRepository(t);
  const cases = [
    ["git status --short", "allow"],
    ["git diff --stat", "allow"],
    ["npm test", "allow"],
    ["npm run build", "allow"],
    ["node --test", "allow"],
    ["npm install left-pad", "ask"],
    ["echo inspected && npm install left-pad", "ask"],
    ["git push origin main", "ask"],
    ["git -C . push origin main", "ask"],
    ["npm --prefix . install", "ask"],
    ["rm harmless.txt", "ask"],
    ["del harmless.txt", "ask"],
    ["Remove-Item harmless.txt", "ask"],
    ["sh -c 'echo dynamic'", "ask"],
    ["powershell -Command 'Write-Output dynamic'", "ask"],
    ["node -e \"console.log('dynamic')\"", "ask"],
    ["python -c \"print('dynamic')\"", "ask"],
    ["curl --data '{\"ok\":true}' https://example.invalid", "ask"],
    ["Invoke-RestMethod https://example.invalid -Method Post -Body '{}'", "ask"],
    ["gh issue create --title Regression", "ask"],
    ["echo safe && git reset --hard HEAD", "deny"],
    ["git clean -fd", "deny"],
    ["rm -rf .git", "deny"],
    ["Remove-Item C:\\workspace\\.git -Recurse -Force", "deny"],
    ["del C:\\workspace\\* /s /q", "deny"],
    ["diskpart /s wipe.txt", "deny"],
  ];

  for (const [command, expected] of cases) {
    await t.test(command, () => {
      const output = hook(root, "beforeShellExecution", { command });
      assert.equal(output.permission, expected);
    });
  }
});

test("sensitive reads and preToolUse deletes are fail-closed", (t) => {
  const root = tempRepository(t);

  assert.equal(
    hook(root, "beforeReadFile", { file_path: "/work/project/src/index.js" }).permission,
    "allow",
  );
  assert.equal(
    hook(root, "beforeReadFile", { file_path: "/work/project/.env.local" }).permission,
    "deny",
  );
  assert.equal(
    hook(root, "beforeReadFile", { file_path: "/work/project/.env.example" }).permission,
    "allow",
  );
  assert.equal(
    hook(root, "beforeReadFile", { file_path: "/work/project/.aws/config" }).permission,
    "deny",
  );
  assert.equal(
    hook(root, "preToolUse", {
      tool_name: "read",
      tool_input: { path: "/work/project/id_ed25519" },
    }).permission,
    "deny",
  );
  assert.equal(
    hook(root, "preToolUse", {
      tool_name: "write",
      tool_input: { file_path: "/work/project/secrets.json" },
    }).permission,
    "deny",
  );
  assert.equal(
    hook(root, "preToolUse", {
      tool_name: "delete",
      tool_input: { path: "src/generated.txt" },
    }).permission,
    "allow",
  );

  for (const path of ["", "../outside.txt", ".git/config", "src/*.js"]) {
    const output = hook(root, "preToolUse", {
      tool_name: "delete",
      tool_input: path ? { path } : {},
    });
    assert.equal(output.permission, "deny", `delete path ${path || "<missing>"}`);
  }
});

test("MCP hooks distinguish reads, writes, destructive calls, and production mutations", (t) => {
  const root = tempRepository(t);
  const cases = [
    [{ tool_name: "search_documents", tool_input: { query: "status" } }, "allow"],
    [{ tool_name: "create_issue", tool_input: { title: "Regression" } }, "ask"],
    [
      {
        tool_name: "records",
        tool_input: { operation: "update", record: { id: 1 } },
      },
      "ask",
    ],
    [{ tool_name: "delete_database", tool_input: { id: "sandbox" } }, "deny"],
    [
      {
        tool_name: "database_query",
        tool_input: { environment: "production", operation: "update", id: 1 },
      },
      "deny",
    ],
  ];

  for (const [payload, expected] of cases) {
    const output = hook(root, "beforeMCPExecution", payload);
    assert.equal(output.permission, expected, payload.tool_name);
  }
});

test("security hook configuration and malformed JSON enforce fail-closed process behavior", (t) => {
  const root = tempRepository(t);
  const config = JSON.parse(readFileSync(resolve(repositoryRoot, ".cursor/hooks.json"), "utf8"));
  const securityEvents = [
    "beforeShellExecution",
    "beforeMCPExecution",
    "beforeReadFile",
    "preToolUse",
  ];

  for (const event of securityEvents) {
    assert.equal(config.hooks[event]?.length, 1, `${event} must have exactly one hook`);
    assert.equal(config.hooks[event][0].failClosed, true, `${event} must fail closed`);

    const result = runHarness(["hook", event, "--target", root], { input: '{"broken":' });
    assert.ifError(result.error);
    assert.equal(result.status, 1, event);
    assert.equal(result.stdout, "", event);
    assert.match(result.stderr, /Hook input is not valid JSON/, event);
  }
});

test("session baseline separates pre-existing dirty paths from session edits", (t) => {
  const root = tempRepository(t);
  runProgram("git", ["init", "--quiet"], root);
  runProgram("git", ["config", "user.email", "harness-tests@example.invalid"], root);
  runProgram("git", ["config", "user.name", "Harness Tests"], root);
  writeFileSync(resolve(root, "tracked.txt"), "baseline\n", "utf8");
  runProgram("git", ["add", "tracked.txt"], root);
  runProgram("git", ["commit", "--quiet", "-m", "baseline"], root);

  writeFileSync(resolve(root, "tracked.txt"), "user change before session\n", "utf8");
  hook(root, "sessionStart", { session_id: "session-1" });

  const edited = resolve(root, "src", "agent-change.js");
  mkdirSync(dirname(edited), { recursive: true });
  writeFileSync(edited, "export const changed = true;\n", "utf8");
  hook(root, "afterFileEdit", { file_path: edited });

  const quality = JSON.parse(
    readFileSync(resolve(root, ".cursor", "harness-state", "quality.json"), "utf8"),
  );
  assert.deepEqual(quality.preexisting_changed_paths, ["tracked.txt"]);
  assert.deepEqual(quality.session_edited_files, ["src/agent-change.js"]);
  assert.match(quality.session_baseline_diff_sha256, /^[a-f0-9]{64}$/);
});

test("receipts are valid for the bound diff and stale after any diff change", (t) => {
  const root = tempRepository(t);
  runProgram("git", ["init", "--quiet"], root);
  runProgram("git", ["config", "user.email", "harness-tests@example.invalid"], root);
  runProgram("git", ["config", "user.name", "Harness Tests"], root);
  writeFileSync(resolve(root, "tracked.txt"), "baseline\n", "utf8");
  runProgram("git", ["add", "tracked.txt"], root);
  runProgram("git", ["commit", "--quiet", "-m", "baseline"], root);

  const created = jsonResult(
    runHarness([
      "receipt",
      "--target",
      root,
      "--reviewer",
      "strict-reviewer",
      "--decision",
      "approve",
      "--scope",
      "src/**",
    ]),
  );
  assert.equal(created.receipt.version, 1);
  assert.match(created.receipt.diff_sha256, /^[a-f0-9]{64}$/);
  assert.match(created.receipt.content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(created.receipt.reviewer, "strict-reviewer");

  const valid = jsonResult(runHarness(["receipt", "check", created.path, "--target", root]));
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.expected, {
    base_commit: created.receipt.base_commit,
    diff_sha256: created.receipt.diff_sha256,
  });

  writeJson(created.path, { ...created.receipt, reviewer: "tampered-reviewer" });
  const tampered = jsonResult(
    runHarness(["receipt", "check", created.path, "--target", root]),
    1,
  );
  assert.equal(tampered.valid, false);
  assert.ok(tampered.errors.includes("Receipt content integrity hash is invalid."));
  const missingScope = { ...created.receipt };
  delete missingScope.scope;
  writeJson(created.path, missingScope);
  const incomplete = jsonResult(
    runHarness(["receipt", "check", created.path, "--target", root]),
    1,
  );
  assert.ok(incomplete.errors.includes("Missing receipt field: scope."));
  writeJson(created.path, created.receipt);

  mkdirSync(resolve(root, "src"), { recursive: true });
  writeFileSync(resolve(root, "src", "changed.js"), "export const changed = true;\n", "utf8");
  const stale = jsonResult(
    runHarness(["receipt", "check", created.path, "--target", root]),
    1,
  );
  assert.equal(stale.valid, false);
  assert.notEqual(stale.expected.diff_sha256, created.receipt.diff_sha256);
});

test("unborn repositories bind staged, unstaged, and untracked changes and reject invalid bases", (t) => {
  const root = tempRepository(t);
  runProgram("git", ["init", "--quiet"], root);
  writeFileSync(resolve(root, "staged.txt"), "staged-v1\n", "utf8");
  runProgram("git", ["add", "staged.txt"], root);
  writeFileSync(resolve(root, "staged.txt"), "staged-v2\n", "utf8");
  writeFileSync(resolve(root, "untracked.txt"), "untracked-v1\n", "utf8");

  const created = jsonResult(
    runHarness(["receipt", "--target", root, "--reviewer", "reviewer", "--decision", "approve"]),
  );
  assert.equal(created.receipt.base_commit, "NO_COMMIT");
  assert.equal(
    jsonResult(runHarness(["receipt", "check", created.path, "--target", root])).valid,
    true,
  );

  writeFileSync(resolve(root, "staged.txt"), "staged-v3\n", "utf8");
  assert.equal(
    jsonResult(runHarness(["receipt", "check", created.path, "--target", root]), 1).valid,
    false,
  );

  const invalidBase = runHarness(["receipt", "--target", root, "--base", "does-not-exist"]);
  assert.equal(invalidBase.status, 1);
  assert.match(invalidBase.stderr, /Invalid Git base/);
});

test("waivers require all fields, reject expiry, and cannot bypass safety", (t) => {
  const root = tempRepository(t);
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const expired = new Date(Date.now() - 86_400_000).toISOString();

  const valid = jsonResult(
    runHarness([
      "waiver",
      "create",
      "--target",
      root,
      "--owner",
      "quality-owner",
      "--reason",
      "Flaky optional formatter",
      "--scope",
      "format-check",
      "--expiry",
      future,
      "--compensation",
      "Manual formatting review",
    ]),
  );
  assert.equal(valid.waiver.owner, "quality-owner");
  assert.equal(jsonResult(runHarness(["waiver", "check", valid.path, "--target", root])).valid, true);
  writeJson(valid.path, { ...valid.waiver, version: 2 });
  assert.equal(
    jsonResult(runHarness(["waiver", "check", valid.path, "--target", root]), 1).valid,
    false,
  );
  writeJson(valid.path, { ...valid.waiver, created_at: "not-a-date" });
  const invalidCreated = jsonResult(
    runHarness(["waiver", "check", valid.path, "--target", root]),
    1,
  );
  assert.ok(invalidCreated.errors.includes("Waiver created_at must be an ISO timestamp."));
  writeJson(valid.path, { ...valid.waiver, expiry: expired });
  const expiredCheck = jsonResult(
    runHarness(["waiver", "check", valid.path, "--target", root]),
    1,
  );
  assert.equal(expiredCheck.valid, false);
  assert.ok(expiredCheck.errors.includes("Waiver is expired."));

  const missing = runHarness([
    "waiver",
    "create",
    "--target",
    root,
    "--owner",
    "quality-owner",
  ]);
  assert.equal(missing.status, 1);
  for (const field of ["reason", "scope", "expiry", "compensation"]) {
    assert.match(missing.stderr, new RegExp(`Missing waiver field: ${field}`));
  }

  const expiredResult = runHarness([
    "waiver",
    "create",
    "--target",
    root,
    "--owner",
    "quality-owner",
    "--reason",
    "Temporary exception",
    "--scope",
    "format-check",
    "--expiry",
    expired,
    "--compensation",
    "Manual review",
  ]);
  assert.equal(expiredResult.status, 1);
  assert.match(expiredResult.stderr, /Waiver is expired/);

  const safety = runHarness([
    "waiver",
    "create",
    "--target",
    root,
    "--owner",
    "quality-owner",
    "--reason",
    "Need to bypass safety control",
    "--scope",
    "production deploy",
    "--expiry",
    future,
    "--compensation",
    "Observe deployment",
  ]);
  assert.equal(safety.status, 1);
  assert.match(safety.stderr, /Safety and external-side-effect controls cannot be waived/);
});

test("module catalog resolves direct impact, reverse dependencies, and verification plan", (t) => {
  const root = tempRepository(t);
  writeJson(resolve(root, "harness", "module-catalog.json"), {
    version: 1,
    modules: [
      {
        id: "core",
        paths: ["packages/core/**"],
        dependsOn: [],
        verification: ["unit"],
      },
      {
        id: "api",
        paths: ["packages/api/**"],
        dependsOn: ["core"],
        verification: ["unit", "integration"],
      },
      {
        id: "app",
        paths: ["apps/web/**"],
        dependsOn: ["api"],
        verification: ["e2e"],
      },
      {
        id: "docs",
        paths: ["docs/**"],
        dependsOn: [],
        verification: ["docs"],
      },
    ],
  });
  writeJson(resolve(root, "harness", "verification-matrix.json"), {
    version: 1,
    checks: {
      unit: { class: "test", command: "node --test unit", required: true },
      integration: { class: "integration", command: "node --test integration", required: true },
      e2e: { class: "test", command: "node --test e2e", required: true },
      docs: { class: "static", command: "node docs-check.mjs", required: false },
    },
  });

  const affected = jsonResult(
    runHarness(["affected", "packages/core/src/index.js", "--target", root]),
  );
  assert.deepEqual(affected.paths, ["packages/core/src/index.js"]);
  assert.deepEqual(affected.direct, ["core"]);
  assert.deepEqual(affected.affected, ["core", "api", "app"]);

  const plan = jsonResult(
    runHarness(["verify-plan", "packages/core/src/index.js", "--target", root]),
  );
  assert.deepEqual(plan.modules, ["core", "api", "app"]);
  assert.deepEqual(
    plan.checks.map((check) => check.id),
    ["unit", "integration", "e2e"],
  );
  assert.ok(plan.checks.every((check) => typeof check.command === "string" && check.command));
  assert.equal(plan.checks.filter((check) => check.id === "unit").length, 1);

  const conservative = jsonResult(
    runHarness(["verify-plan", "unknown/generated.asset", "--target", root]),
  );
  assert.deepEqual(conservative.unmatched_paths, ["unknown/generated.asset"]);
  assert.equal(conservative.modules.length, 0);
  assert.ok(conservative.checks.length >= 1);
  assert.equal(conservative.checks[0].conservative, true);
});

test("install preserves a non-empty target and writes conflicts to sidecars", (t) => {
  const root = tempRepository(t);
  const userAgents = "user-owned AGENTS\n";
  writeFileSync(resolve(root, "AGENTS.md"), userAgents, "utf8");
  writeFileSync(resolve(root, "private-notes.txt"), "do not touch\n", "utf8");

  const installed = jsonResult(runHarness(["install", "--target", root]));
  const agentsOperation = installed.operations.find((entry) => entry.path === "AGENTS.md");
  assert.deepEqual(agentsOperation, {
    path: "AGENTS.md",
    action: "preserve",
    sidecar: "AGENTS.md.cursor-harness-new",
  });
  assert.equal(readFileSync(resolve(root, "AGENTS.md"), "utf8"), userAgents);
  assert.equal(
    readFileSync(resolve(root, "AGENTS.md.cursor-harness-new"), "utf8"),
    readFileSync(resolve(repositoryRoot, "AGENTS.md"), "utf8").replace(/\r\n?/g, "\n"),
  );
  assert.equal(readFileSync(resolve(root, "private-notes.txt"), "utf8"), "do not touch\n");
  assert.ok(existsSync(resolve(root, installManifestRelative)));
  for (const path of ["README.md", "package.json", "src", "tests", "setup.ps1", "SECURITY.md"]) {
    assert.equal(existsSync(resolve(root, path)), false, `${path} must not be installed`);
  }
  assert.ok(existsSync(resolve(root, "harness", "module-catalog.json")));
  assert.ok(existsSync(resolve(root, "harness", "verification-matrix.json")));
});

test("install dry-run reports operations without modifying the target", (t) => {
  const root = tempRepository(t);
  writeFileSync(resolve(root, "sentinel.txt"), "unchanged\n", "utf8");
  writeFileSync(resolve(root, "AGENTS.md"), "user AGENTS\n", "utf8");

  const result = jsonResult(runHarness(["install", "--target", root, "--dry-run"]));
  assert.equal(result.dry_run, true);
  assert.ok(result.operations.some((entry) => entry.action === "create"));
  assert.equal(
    result.operations.find((entry) => entry.path === "AGENTS.md").action,
    "preserve",
  );
  assert.equal(readFileSync(resolve(root, "sentinel.txt"), "utf8"), "unchanged\n");
  assert.equal(readFileSync(resolve(root, "AGENTS.md"), "utf8"), "user AGENTS\n");
  assert.equal(existsSync(resolve(root, "AGENTS.md.cursor-harness-new")), false);
  assert.equal(existsSync(resolve(root, installManifestRelative)), false);
});

test("upgrade and uninstall dry-runs leave managed files and metadata untouched", (t) => {
  const root = tempRepository(t);
  jsonResult(runHarness(["install", "--target", root]));

  const oldAgents = "AGENTS from harness version 0\n";
  writeFileSync(resolve(root, "AGENTS.md"), oldAgents, "utf8");
  const manifestPath = resolve(root, installManifestRelative);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.files.find((entry) => entry.path === "AGENTS.md").sha256 = normalizedHash(oldAgents);
  writeJson(manifestPath, refreshManifestDigest(manifest));
  const manifestBefore = readFileSync(manifestPath, "utf8");

  const upgrade = jsonResult(runHarness(["upgrade", "--target", root, "--dry-run"]));
  assert.equal(upgrade.dry_run, true);
  assert.equal(upgrade.operations.find((entry) => entry.path === "AGENTS.md").action, "update");
  assert.equal(readFileSync(resolve(root, "AGENTS.md"), "utf8"), oldAgents);
  assert.equal(readFileSync(manifestPath, "utf8"), manifestBefore);

  const uninstall = jsonResult(runHarness(["uninstall", "--target", root, "--dry-run"]));
  assert.equal(uninstall.dry_run, true);
  assert.ok(uninstall.operations.some((entry) => entry.action === "remove"));
  assert.equal(readFileSync(resolve(root, "AGENTS.md"), "utf8").length > 0, true);
  assert.equal(readFileSync(resolve(root, "AGENTS.md"), "utf8"), oldAgents);
  assert.equal(readFileSync(manifestPath, "utf8"), manifestBefore);
});

test("upgrade replaces old unmodified files and preserves user-modified files", (t) => {
  const root = tempRepository(t);
  jsonResult(runHarness(["install", "--target", root]));

  const oldAgents = "AGENTS from harness version 0\n";
  const oldIndexingIgnore = "old indexing ignore\n";
  const userIndexingIgnore = "user-modified indexing ignore\n";
  writeFileSync(resolve(root, "AGENTS.md"), oldAgents, "utf8");
  writeFileSync(resolve(root, ".cursorindexingignore"), userIndexingIgnore, "utf8");

  const manifestPath = resolve(root, installManifestRelative);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.files.find((entry) => entry.path === "AGENTS.md").sha256 = normalizedHash(oldAgents);
  manifest.files.find((entry) => entry.path === ".cursorindexingignore").sha256 =
    normalizedHash(oldIndexingIgnore);
  writeJson(manifestPath, refreshManifestDigest(manifest));

  const upgraded = jsonResult(runHarness(["upgrade", "--target", root]));
  assert.equal(
    upgraded.operations.find((entry) => entry.path === "AGENTS.md").action,
    "update",
  );
  assert.equal(
    readFileSync(resolve(root, "AGENTS.md"), "utf8"),
    readFileSync(resolve(repositoryRoot, "AGENTS.md"), "utf8").replace(/\r\n?/g, "\n"),
  );
  assert.equal(
    upgraded.operations.find((entry) => entry.path === ".cursorindexingignore").action,
    "preserve",
  );
  assert.equal(readFileSync(resolve(root, ".cursorindexingignore"), "utf8"), userIndexingIgnore);
  assert.equal(
    readFileSync(resolve(root, ".cursorindexingignore.cursor-harness-new"), "utf8"),
    readFileSync(resolve(repositoryRoot, ".cursorindexingignore"), "utf8").replace(/\r\n?/g, "\n"),
  );
});

test("uninstall removes only unchanged managed files and retains user content", (t) => {
  const root = tempRepository(t);
  jsonResult(runHarness(["install", "--target", root]));
  writeFileSync(resolve(root, "AGENTS.md"), "user changed after install\n", "utf8");
  writeFileSync(resolve(root, "private-notes.txt"), "keep me\n", "utf8");

  const result = jsonResult(runHarness(["uninstall", "--target", root]));
  assert.equal(
    result.operations.find((entry) => entry.path === "AGENTS.md").action,
    "preserve-modified",
  );
  assert.equal(readFileSync(resolve(root, "AGENTS.md"), "utf8"), "user changed after install\n");
  assert.equal(readFileSync(resolve(root, "private-notes.txt"), "utf8"), "keep me\n");
  assert.equal(existsSync(resolve(root, "AGENTS.md")), true);
  assert.equal(existsSync(resolve(root, ".cursorindexingignore")), false);
  assert.equal(existsSync(resolve(root, installManifestRelative)), false);
});

test("validate and doctor pass a source-free installed harness and require its runtime", (t) => {
  const root = tempRepository(t);
  jsonResult(runHarness(["install", "--target", root]));

  const validation = jsonResult(runHarness(["validate", "--target", root]));
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);

  const diagnosis = jsonResult(runHarness(["doctor", "--target", root]));
  assert.equal(diagnosis.ok, true);
  assert.equal(
    diagnosis.checks.find((check) => check.name === "runtime-sync").ok,
    true,
  );

  const runtimePath = resolve(root, ".cursor", "runtime", "harness.mjs");
  assert.equal(existsSync(resolve(root, "src", "harness.ts")), false);
  assert.ok(diagnosis.warnings.some((warning) => /bootstrap defaults/.test(warning)));
  rmSync(runtimePath);

  const missingRuntime = jsonResult(
    runHarness(["validate", "--sync-only", "--target", root]),
    1,
  );
  assert.equal(missingRuntime.ok, false);
  assert.ok(missingRuntime.errors.some((error) => /Missing checked-in runtime/.test(error)));
});

test("install and upgrade reject the harness source as their target", () => {
  for (const command of ["install", "upgrade"]) {
    const result = runHarness([command, "--target", repositoryRoot, "--dry-run"]);
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /harness source as the target/);
  }
});

test("managed manifest paths cannot delete outside the target", (t) => {
  const root = tempRepository(t);
  jsonResult(runHarness(["install", "--target", root]));
  const victimName = `victim-${basename(root)}.txt`;
  const victim = resolve(root, "..", victimName);
  t.after(() => rmSync(victim, { force: true }));
  writeFileSync(victim, "must survive\n", "utf8");

  const manifestPath = resolve(root, installManifestRelative);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.files.push({
    path: `../${victimName}`,
    sha256: normalizedHash("must survive\n"),
    bytes: "must survive\n".length,
  });
  writeJson(manifestPath, refreshManifestDigest(manifest));

  for (const command of ["upgrade", "uninstall"]) {
    const result = runHarness([command, "--target", root]);
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /Unsafe managed path/);
    assert.equal(readFileSync(victim, "utf8"), "must survive\n");
  }
});

test("managed paths reject absolute destinations and external junctions", (t) => {
  const absoluteRoot = tempRepository(t);
  jsonResult(runHarness(["install", "--target", absoluteRoot]));
  const absoluteManifestPath = resolve(absoluteRoot, installManifestRelative);
  const absoluteManifest = JSON.parse(readFileSync(absoluteManifestPath, "utf8"));
  absoluteManifest.files.push({
    path: resolve(absoluteRoot, "..", "absolute-victim.txt"),
    sha256: normalizedHash("victim\n"),
    bytes: 7,
  });
  writeJson(absoluteManifestPath, refreshManifestDigest(absoluteManifest));
  const absoluteResult = runHarness(["uninstall", "--target", absoluteRoot]);
  assert.equal(absoluteResult.status, 1);
  assert.match(absoluteResult.stderr, /Unsafe managed path/);

  const junctionRoot = tempRepository(t);
  const outside = tempRepository(t);
  try {
    symlinkSync(outside, resolve(junctionRoot, ".cursor"), "junction");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip("junction creation is not permitted on this host");
      return;
    }
    throw error;
  }
  const junctionResult = runHarness(["install", "--target", junctionRoot]);
  assert.equal(junctionResult.status, 1);
  assert.match(junctionResult.stderr, /resolves outside target/);
});

test("conflict sidecars never overwrite different existing content", (t) => {
  const root = tempRepository(t);
  writeFileSync(resolve(root, "AGENTS.md"), "user-owned\n", "utf8");
  const protectedSidecar = resolve(root, "AGENTS.md.cursor-harness-new");
  writeFileSync(protectedSidecar, "older sidecar\n", "utf8");

  const installed = jsonResult(runHarness(["install", "--target", root]));
  const operation = installed.operations.find((entry) => entry.path === "AGENTS.md");
  assert.equal(operation.action, "preserve");
  assert.notEqual(operation.sidecar, "AGENTS.md.cursor-harness-new");
  assert.match(operation.sidecar, /AGENTS\.md\.cursor-harness-new-[a-f0-9]{12}-/);
  assert.equal(readFileSync(protectedSidecar, "utf8"), "older sidecar\n");
  assert.equal(
    readFileSync(resolve(root, operation.sidecar), "utf8"),
    readFileSync(resolve(repositoryRoot, "AGENTS.md"), "utf8").replace(/\r\n?/g, "\n"),
  );
});

test("sync-only validation never records a validated diff", (t) => {
  const root = tempRepository(t);
  jsonResult(runHarness(["install", "--target", root]));
  const qualityPath = resolve(root, ".cursor", "harness-state", "quality.json");
  assert.equal(existsSync(qualityPath), false);

  const syncOnly = jsonResult(runHarness(["validate", "--sync-only", "--target", root]));
  assert.equal(syncOnly.check_type, "sync-only");
  assert.equal(existsSync(qualityPath), false);

  const full = jsonResult(runHarness(["validate", "--target", root]));
  assert.equal(full.check_type, "full");
  const quality = JSON.parse(readFileSync(qualityPath, "utf8"));
  assert.match(quality.validated_diff_sha256, /^[a-f0-9]{64}$/);
  assert.equal(quality.validated_check, "full");
});

test("validate ignores unrelated malformed JSON in a large installed repository", (t) => {
  const root = tempRepository(t, "cursor-harness-json-");
  jsonResult(runHarness(["install", "--target", root]));
  const generated = resolve(root, "vendor", "generated");
  mkdirSync(generated, { recursive: true });
  for (let index = 0; index < 500; index += 1) {
    writeFileSync(resolve(generated, `${index}.js`), `export default ${index};\n`, "utf8");
  }
  writeFileSync(resolve(generated, "unrelated.json"), '{"broken":', "utf8");

  const validation = jsonResult(
    runHarness(["validate", "--dry-run", "--target", root], { timeout: 10_000 }),
  );
  assert.equal(validation.ok, true);
});

test("manifest checks compare every field and recompute the saved digest", (t) => {
  const root = tempRepository(t);
  const runtime = resolve(root, ".cursor", "runtime", "harness.mjs");
  const source = resolve(root, "src", "harness.ts");
  const script = resolve(root, "scripts", "harness.mjs");
  for (const path of [runtime, source]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, readFileSync(resolve(repositoryRoot, ".cursor", "runtime", "harness.mjs")));
  }
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(
    script,
    '#!/usr/bin/env node\nimport { main } from "../.cursor/runtime/harness.mjs";\nmain();\n',
    "utf8",
  );
  for (const name of ["default-module-catalog.json", "default-verification-matrix.json"]) {
    const destination = resolve(root, "harness", name);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(resolve(repositoryRoot, "harness", name)));
  }

  jsonResult(runHarnessScript(runtime, ["manifest", "--write", "--target", root], { cwd: root }));
  const manifestPath = resolve(root, "FRAMEWORK-MANIFEST.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.harness_version = "tampered";
  manifest.files[0].sha256 = "0".repeat(64);
  writeJson(manifestPath, manifest);

  const checked = jsonResult(
    runHarnessScript(runtime, ["manifest", "--check", "--target", root], { cwd: root }),
    1,
  );
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.includes("Saved source manifest digest does not match its files."));
  assert.ok(checked.errors.includes("Source manifest harness_version is stale."));
  assert.ok(checked.errors.includes("Source manifest files is stale."));
});

test("source manifest contains only installable assets", () => {
  const value = jsonResult(runHarness(["manifest"]));
  for (const entry of value.files) {
    assert.equal(
      entry.path === "AGENTS.md" ||
        entry.path === ".cursorignore" ||
        entry.path === ".cursorindexingignore" ||
        entry.path === "scripts/harness.mjs" ||
        entry.path.startsWith("harness/") ||
        (entry.path.startsWith(".cursor/") &&
          (!entry.path.startsWith(".cursor/harness-state/") ||
            entry.path === ".cursor/harness-state/.gitignore")),
      true,
      `unexpected install asset: ${entry.path}`,
    );
  }
  for (const forbidden of ["README.md", "package.json", "src/harness.ts", "setup.ps1"]) {
    assert.equal(value.files.some((entry) => entry.path === forbidden), false);
  }
});

test("affected scales by declared paths and graph in a generated 200k-line modular repository", (t) => {
  const root = tempRepository(t, "cursor-harness-large-");
  const moduleCount = 24;
  const linesPerModule = 9_000;
  const modules = [];
  const source = "// synthetic source line; unrelated content must not affect impact\n".repeat(
    linesPerModule,
  );

  for (let index = 0; index < moduleCount; index += 1) {
    const id = `module-${String(index).padStart(2, "0")}`;
    const moduleRoot = resolve(root, "modules", id, "src");
    mkdirSync(moduleRoot, { recursive: true });
    writeFileSync(resolve(moduleRoot, "generated.js"), source, "utf8");
    modules.push({
      id,
      paths: [`modules/${id}/**`],
      dependsOn: index === 0 ? [] : [`module-${String(index - 1).padStart(2, "0")}`],
      verification: [],
    });
  }
  const generatedLines = moduleCount * linesPerModule;
  assert.ok(generatedLines >= 200_000);
  writeJson(resolve(root, "harness", "module-catalog.json"), { version: 1, modules });

  const changedIndex = 7;
  const changedId = `module-${String(changedIndex).padStart(2, "0")}`;
  const changedPath = `modules/${changedId}/src/generated.js`;
  const started = process.hrtime.bigint();
  const result = jsonResult(
    runHarness(["affected", changedPath, "--target", root], { timeout: 10_000 }),
  );
  const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;

  assert.deepEqual(result.direct, [changedId]);
  assert.deepEqual(
    result.affected,
    modules.slice(changedIndex).map((module) => module.id),
  );
  assert.equal(result.affected.includes("module-06"), false);
  assert.ok(
    elapsedMilliseconds < 5_000,
    `affected took ${elapsedMilliseconds.toFixed(1)}ms for ${generatedLines} generated lines`,
  );
});
