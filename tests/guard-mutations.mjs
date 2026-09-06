// Guard mutation tripwire — OPT-IN, not part of the default `node --test` run.
//
// This is a meta-test: it checks that the command-safety guards are load-bearing by disabling
// one at a time and asserting the verdict changes. It proves something about the detector, not
// directly about product correctness, so it stays off the release chain and runs only when the
// guards themselves change:
//
//   npm run test:mutation
//
// The filename deliberately does not match `*.test.mjs`, so bare `node --test` skips it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnessScript = resolve(repositoryRoot, "scripts/harness.mjs");

function tempRepository(t) {
  const root = mkdtempSync(join(tmpdir(), "cursor-mutation-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}

function install(root) {
  const result = spawnSync(process.execPath, [harnessScript, "install", "--target", root], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(result.status, 0, `install failed:\n${result.stderr}`);
}

test("a quietly broken guard changes the verdict its mutation test pins", (t) => {
  // Install so the temp root carries the harness markers, then mutate the installed runtime in
  // place and restore it after each probe. Spawning the runtime directly exercises exactly what
  // an installed repository runs.
  const root = tempRepository(t);
  install(root);
  const policyFile = resolve(root, ".cursor", "runtime", "shell-policy.mjs");
  const original = readFileSync(policyFile, "utf8");

  const decisionFor = (command) => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, ".cursor", "runtime", "harness.mjs"), "hook", "beforeShellExecution", "--target", root],
      { input: JSON.stringify({ workspace_roots: [root], command }), encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).permission;
  };

  // Each mutant disables exactly one load-bearing guard with an anchored edit. If an anchor no
  // longer matches, the test fails loudly so it is updated with the refactor rather than rotting
  // into a passing no-op.
  const mutants = [
    {
      // Behind a `timeout` wrapper the start-anchored regex net does not fire, so only the
      // semantic machine-command guard denies this. That isolates the guard under test.
      name: "machine-command deny",
      from: "if (isMachineCommand(segment.name)) {",
      to: "if (false && isMachineCommand(segment.name)) {",
      command: "timeout 5 shutdown -h now",
    },
    {
      name: "substitution recursion",
      from: "verdict = strictest(verdict, classifyParsed(parseShellCommand(inner), raw, root, depth + 1, inner));",
      to: "verdict = verdict;",
      command: "echo $(shutdown -h now)",
    },
  ];

  // The unmutated runtime denies every probe: the control works.
  for (const mutant of mutants) {
    assert.equal(decisionFor(mutant.command), "deny", `baseline must block: ${mutant.name}`);
  }

  // Breaking the guard must change the verdict; a mutation that leaves it `deny` means the guard
  // was not load-bearing or the anchor is stale.
  for (const mutant of mutants) {
    assert.ok(original.includes(mutant.from), `mutation anchor is stale for ${mutant.name}; update the test with the code`);
    writeFileSync(policyFile, original.replace(mutant.from, mutant.to), "utf8");
    let permission;
    try {
      permission = decisionFor(mutant.command);
    } finally {
      writeFileSync(policyFile, original, "utf8");
    }
    assert.notEqual(permission, "deny", `guard is not load-bearing: mutating ${mutant.name} did not change the verdict for \`${mutant.command}\``);
  }
});
