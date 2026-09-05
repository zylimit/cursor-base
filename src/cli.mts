// CLI dispatch: argument parsing, the command table, and usage text.

import { debtCommand, fastCommand, profileCommand } from "./assurance.mjs";
import { releaseCommand } from "./release.mjs";
import { authorshipCommand, reviewCommand, reviewPackCommand } from "./review.mjs";
import { catalogLint } from "./catalog.mjs";
import { contextPack } from "./context.mjs";
import { VERSION, parseArgs } from "./core.mjs";
import { affected, archCheck, catalogDiscover, repoMap } from "./graph.mjs";
import { hook } from "./hooks.mjs";
import { doctor, installLike, manifest, testHarness, uninstall, validate } from "./install.mjs";
import { archiveCommand, feedbackCommand, invariantsCommand, recapCommand, syncCheckCommand } from "./memory.mjs";
import { gateAudit, retention, riskCommand } from "./ops.mjs";
import { gate, quality, receipt, verifyPlan, waiver } from "./quality.mjs";
import {
  adapters,
  adrCheck,
  agentsLintCommand,
  fitness,
  instructionsCommand,
  rulesAuditCommand,
  skillsLintCommand,
} from "./scan.mjs";
import { serviceCommand } from "./services.mjs";
import { taskCommand } from "./task.mjs";

/**
 * Every command the dispatcher accepts. The rules audit resolves backticked tokens against this
 * list, so a constitution that names `node scripts/harness.mjs foo` for a command that does not
 * exist is reported as a phantom rather than read as enforced.
 */
export const COMMANDS = [
  "hook", "doctor", "validate", "test", "manifest", "install", "upgrade", "uninstall", "repo-map",
  "affected", "verify-plan", "gate", "profile", "fast", "debt", "quality", "arch-check", "catalog",
  "context-pack", "task", "gate-audit", "fitness", "adapters", "instructions", "skills-lint",
  "agents-lint", "rules-audit", "adr-check", "receipt", "waiver", "service", "risk", "retention",
  "review", "review-pack", "authorship", "recap", "invariants", "sync-check", "archive", "feedback",
  "release", "help",
];

export function usage() {
  process.stdout.write(`Cursor repository harness ${VERSION}
Usage: node scripts/harness.mjs <command> [arguments] [--target PATH] [--dry-run]
Commands:
  hook <event>       Evaluate a Cursor hook event from JSON stdin
  doctor             Diagnose prerequisites and harness integrity
  validate           Validate configuration, catalogs, and runtime parity
  test               Run the deterministic Node test suite
  manifest           Print the LF-normalized SHA-256 source manifest
  install            Install safely into a repository
  upgrade            Upgrade managed files without overwriting user changes
  uninstall          Remove only unchanged managed files
  repo-map           Print declared module and dependency boundaries
  affected [paths]   Resolve affected modules from paths and declared dependencies
  verify-plan        Build a verification plan for affected modules
  gate [checks]      Execute the verification plan and record diff-bound receipts
  profile <sub>      show, explain, list, or set the assurance profile (explore|rapid|balanced|strict|adaptive)
  fast <sub>         on --minutes N --reason TEXT, off, or status: a dated, repayable loan against evidence
  debt list          Evidence still owed from fast loans; only a later PASS repays it
  quality <sub>      status, attributes, or verify for ledger and evidence integrity
  fitness            Run built-in quality-attribute rules over changed paths or --all
  adapters <sub>     list external quality tools, or add one to the verification matrix
  adr-check          Require every live decision record to name the check that enforces it
  instructions       Scan instruction files (AGENTS.md, rules, skills, agents) as untrusted input
  skills-lint        Frontmatter the skill loader can read; a malformed skill is dropped silently
  agents-lint        Modules with blocking attributes carry a nested AGENTS.md contract
  rules-audit        Which rules name a real enforcement point, which admit they do not, and which only pretend
  arch-check         Compare real import edges against declared module dependencies
  catalog lint       Prove every tracked path is mapped, global, or ignored with a reason
  catalog discover   Propose a module catalog and matrix from the tree and real imports (--write to save)
  context-pack       Build a budgeted context pack on disk and print only its manifest
  task <sub>         start, status, complete, or cancel the owning task
  gate-audit         Report which hooks have actually intervened and which never have
  receipt            Create or check a diff-bound review receipt
  review <sub>       start, blue, lens <name>, verdict, status, team, backlog: structured review as a gate
  review-pack        Evidence pack for reviewers with deletions and renames in their own sections
  authorship <sub>   record or show who edited the current diff (best effort, per conversation)
  waiver             Create, check, or list diff-bound non-safety quality waivers
  service <sub>      start, stop, status, list, or logs for supervised dev services
  risk               Scan harness state for stale tasks, broken chains, and dead services
  retention          Destroy aged evidence and context packs; protects referenced receipts
  release readiness  Report every release condition under the strict floor; performs no release action
  feedback <sub>     list or lint recorded lessons; recurring ones graduate into rules
  recap              Budgeted digest of project memory plus live state; never from a summary
  invariants         The non-negotiable rules plus live state, small enough to re-inject
  sync-check         Governed code changed without progress.md, or a spec without its changelog
  archive [--apply]  Move the oldest Done/Notes entries into the archive; nothing is deleted
`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const { options, positional } = parseArgs(rest);
  switch (command) {
    case "hook":
      await hook(positional[0], options);
      break;
    case "doctor":
      doctor(options);
      break;
    case "validate":
      validate(options);
      break;
    case "test":
      testHarness(options);
      break;
    case "manifest":
      manifest(options);
      break;
    case "install":
      installLike("install", options);
      break;
    case "upgrade":
      installLike("upgrade", options);
      break;
    case "uninstall":
      uninstall(options);
      break;
    case "repo-map":
      repoMap(options);
      break;
    case "affected":
      affected(positional, options);
      break;
    case "verify-plan":
      verifyPlan(positional, options);
      break;
    case "gate":
      gate(positional, options);
      break;
    case "profile":
      profileCommand(positional, options);
      break;
    case "fast":
      fastCommand(positional, options);
      break;
    case "debt":
      debtCommand(positional, options);
      break;
    case "quality":
      quality(positional, options);
      break;
    case "arch-check":
      archCheck(options);
      break;
    case "catalog":
      if (positional[0] === "discover") catalogDiscover(options);
      else if (!positional[0] || positional[0] === "lint") catalogLint(options);
      else throw new Error("catalog supports the lint or discover subcommand.");
      break;
    case "context-pack":
      contextPack(positional, options);
      break;
    case "task":
      taskCommand(positional, options);
      break;
    case "gate-audit":
      gateAudit(options);
      break;
    case "fitness":
      fitness(options);
      break;
    case "adapters":
      adapters(positional, options);
      break;
    case "instructions":
      instructionsCommand(options);
      break;
    case "skills-lint":
      skillsLintCommand(options);
      break;
    case "agents-lint":
      agentsLintCommand(options);
      break;
    case "rules-audit":
      rulesAuditCommand(options, COMMANDS);
      break;
    case "adr-check":
      adrCheck(options);
      break;
    case "receipt":
      receipt(positional, options);
      break;
    case "waiver":
      waiver(positional, options);
      break;
    case "service":
      await serviceCommand(positional, options);
      break;
    case "risk":
      riskCommand(options);
      break;
    case "retention":
      retention(options);
      break;
    case "review":
      await reviewCommand(positional, options);
      break;
    case "review-pack":
      reviewPackCommand(options);
      break;
    case "authorship":
      await authorshipCommand(positional, options);
      break;
    case "release":
      releaseCommand(positional, options);
      break;
    case "recap":
      recapCommand(options);
      break;
    case "invariants":
      invariantsCommand(options);
      break;
    case "sync-check":
      syncCheckCommand(options);
      break;
    case "archive":
      archiveCommand(options);
      break;
    case "feedback":
      feedbackCommand(positional, options);
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
