// Cursor hook events: dispatch, fail-closed security handling, session baseline, compaction
// notes, delegation contracts, and the completion gate on stop.
import { existsSync, renameSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { effectiveSelection, loadPolicy, openDebts, readLoan, resolveAssurance } from "./assurance.mjs";
import { invariants, syncCheck } from "./memory.mjs";
import { recordAuthorship } from "./review.mjs";
import { EVENTS, SECURITY_EVENTS, STATE_REL, binding, boundedHead, boundedText, changedPaths, errorMessage, posix, printJson, readJson, redactSecrets, sensitivePath, stdinJson, targetFrom, withStateLock, writeJson, } from "./core.mjs";
import { appendLedger, riskScan } from "./ops.mjs";
import { QUALITY_LEDGER_REL, assessQuality, buildVerifyPlan } from "./quality.mjs";
import { READ_ONLY_TOOLS, decision, mcpDecision, shellDecision, toolPaths } from "./shell-policy.mjs";
import { TASKS_REL, activeTask } from "./state.mjs";
import { preflightTaskWrite, recordTaskWrite } from "./task.mjs";
export async function hook(event, options) {
    if (!EVENTS.includes(event))
        throw new Error(`Unsupported hook event: ${event}`);
    const payload = await stdinJson();
    const root = payload.workspace_roots?.[0] ? resolve(payload.workspace_roots[0]) : targetFrom(options);
    let output = {};
    try {
        output = await handleHookEvent(event, payload, root);
    }
    catch (error) {
        // Security events stay fail-closed. The failure is recorded first, because a crashing
        // security hook previously left no trace at all and read as `unexercised` in an audit.
        if (SECURITY_EVENTS.includes(event)) {
            try {
                appendLedger(root, event, payload, `error:${errorMessage(error)}`);
            }
            catch {
                // A ledger that cannot be written must not convert a fail-closed hook into a pass.
            }
            throw error;
        }
        // Observational events degrade, but the degraded output must not be byte-identical to
        // "everything is verified". A silent `{}` here turned a broken gate into a silent pass.
        appendLedger(root, event, payload, `error:${errorMessage(error)}`);
        const quarantined = quarantineCorruptState(root);
        printJson({
            additional_context: `The harness could not evaluate the ${event} event: ${boundedText(errorMessage(error), 400)} ` +
                (quarantined.length > 0
                    ? `Unreadable state was moved aside (${quarantined.join(", ")}) and will be rebuilt. `
                    : "") +
                "Treat verification state as unknown until `node scripts/harness.mjs gate` has been run again.",
        });
        return;
    }
    // The decision reaches the host before the audit record is written. An unwritable state
    // directory must not discard the hook's output, which carries the permission verdict.
    printJson(output);
    try {
        appendLedger(root, event, payload, output.permission || (output.followup_message ? "followup" : "observe"), output.user_message || output.followup_message);
    }
    catch (error) {
        process.stderr.write(`harness: could not record the hook ledger: ${errorMessage(error)}\n`);
    }
}
/** Moves unparseable state files aside so the next run rebuilds them instead of failing forever. */
export function quarantineCorruptState(root) {
    const moved = [];
    const candidates = [
        QUALITY_LEDGER_REL,
        TASKS_REL,
        `${STATE_REL}/quality.json`,
        `${STATE_REL}/baseline.json`,
    ];
    for (const relativePath of candidates) {
        const absolute = resolve(root, relativePath);
        if (!existsSync(absolute))
            continue;
        try {
            readJson(absolute);
        }
        catch {
            const parked = `${absolute}.corrupt-${Date.now()}`;
            try {
                renameSync(absolute, parked);
                moved.push(posix(relative(root, parked)));
            }
            catch {
                continue;
            }
        }
    }
    return moved;
}
export async function handleHookEvent(event, payload, root) {
    let output = {};
    if (event === "beforeShellExecution") {
        output = shellDecision(payload.command, root);
    }
    else if (event === "beforeMCPExecution") {
        output = mcpDecision(payload);
    }
    else if (event === "beforeReadFile") {
        output = sensitivePath(payload.file_path || "")
            ? {
                permission: "deny",
                user_message: "Blocked reading a likely credential or secret file.",
            }
            : { permission: "allow" };
    }
    else if (event === "preToolUse") {
        const tool = String(payload.tool_name || "").toLowerCase();
        const input = (payload.tool_input || {});
        const paths = toolPaths(input);
        const exposed = paths.find((candidate) => sensitivePath(candidate));
        // Any tool that names a credential file is exposure, whether it reads or writes, and
        // whichever of the host's tool names it happens to use.
        if (exposed) {
            output = decision("deny", "Blocked access to a likely credential or secret file.", exposed);
        }
        else if (tool === "delete" &&
            (paths.length === 0 ||
                paths.some((candidate) => /(^|[\\/])\.git([\\/]|$)|\.\.[\\/]|[*?]/.test(candidate)))) {
            output = decision("deny", "Blocked a broad or sensitive delete operation.", paths[0] || "<unspecified>");
        }
        else {
            // Anything not on the read-only list is treated as a write. Enumerating writer tool names
            // meant an unrecognized one skipped the concurrency guard entirely.
            const conflict = READ_ONLY_TOOLS.has(tool)
                ? null
                : paths
                    .map((candidate) => preflightTaskWrite(root, posix(relative(root, resolve(root, candidate)))))
                    .find(Boolean) ?? null;
            output = conflict ?? { permission: "allow" };
        }
    }
    else if (event === "sessionStart") {
        const current = binding(root);
        const dirty = changedPaths(root, current.base_commit);
        writeJson(resolve(root, STATE_REL, "baseline.json"), {
            ...current,
            changed_paths: dirty,
            session_id: payload.session_id || payload.conversation_id || null,
            created_at: new Date().toISOString(),
        });
        const lines = [
            "Safety controls are non-waivable. Record exact verification evidence and bind reviews to the current base commit and diff hash.",
        ];
        const task = activeTask(root);
        if (task) {
            lines.push(`Task ${task.id} is still active: ${task.goal}. Writable scope: ${task.owned_paths.join(", ")}.`);
        }
        // A dirty tree at session start usually means a previous session was interrupted or
        // compacted, so the recorded state may not describe reality any more.
        if (dirty.length > 0) {
            lines.push(`${dirty.length} path(s) already differ from ${current.base_commit}. Reconcile what is already in progress before adding new work, and preserve changes you did not make.`);
        }
        const notePath = resolve(root, STATE_REL, "compaction-note.json");
        if (existsSync(notePath)) {
            lines.push(`A pre-compaction state note is available at ${posix(relative(root, notePath))}.`);
        }
        // The profile in force is the one fact that changes what every other rule means, so it is
        // announced where the session begins rather than discovered when a gate refuses.
        try {
            lines.push(assuranceBanner(root, task?.id ?? null));
        }
        catch (error) {
            lines.push(`The assurance policy could not be read (${boundedHead(errorMessage(error), 120)}); the built-in balanced profile applies until it is repaired.`);
        }
        // Risk decays silently between sessions; the start of one is the moment the agent can
        // still act on it cheaply. Only the worst findings are surfaced, and a failing scan must
        // not block the session it is trying to help.
        try {
            const findings = riskScan(root).filter((finding) => finding.severity !== "info");
            for (const finding of findings.slice(0, 3)) {
                lines.push(`[risk:${finding.severity}] ${finding.message}`);
            }
            if (findings.length > 3) {
                lines.push(`${findings.length - 3} further risk finding(s): run \`node scripts/harness.mjs risk\`.`);
            }
        }
        catch (error) {
            lines.push(`The risk scan failed (${boundedHead(errorMessage(error), 120)}); treat harness state as unknown rather than healthy.`);
        }
        output = { env: { CURSOR_HARNESS_ROOT: root }, additional_context: lines.join(" ") };
    }
    else if (event === "afterFileEdit") {
        const current = binding(root);
        const editedFile = payload.file_path ? posix(relative(root, payload.file_path)) : null;
        withStateLock(root, "quality", () => {
            const qualityPath = resolve(root, STATE_REL, "quality.json");
            const qualityState = existsSync(qualityPath) ? readJson(qualityPath) : {};
            const baselinePath = resolve(root, STATE_REL, "baseline.json");
            const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
            writeJson(qualityPath, {
                ...qualityState,
                pending_diff_sha256: current.diff_sha256,
                edited_at: new Date().toISOString(),
                session_baseline_diff_sha256: baseline?.diff_sha256 || null,
                preexisting_changed_paths: baseline?.changed_paths || [],
                session_edited_files: [
                    ...new Set([...(qualityState.session_edited_files || []), editedFile].filter(Boolean)),
                ],
            });
        });
        if (editedFile) {
            recordTaskWrite(root, editedFile);
            // Who edited what, per conversation. The review verdict uses it to refuse a self-review;
            // it is a claim about the editing conversation, not an authenticated identity.
            const author = payload.subagent_id ?? payload.conversation_id ?? null;
            if (author)
                recordAuthorship(root, String(author), [editedFile]);
        }
    }
    else if (event === "afterShellExecution") {
        // Recording what actually ran turns "Verified" from an agent's claim into a fact the
        // harness can check independently.
        const command = String(payload.command || "");
        const exitCode = payload.exit_code;
        // The binding is computed before taking the lock. Holding a lock across a repository-wide
        // git diff can outlast the stale-takeover window and lose another writer's update.
        const entry = {
            command: boundedHead(redactSecrets(command), 500),
            exit_code: typeof exitCode === "number" ? exitCode : null,
            diff_sha256: binding(root).diff_sha256,
            at: new Date().toISOString(),
        };
        withStateLock(root, "shell-log", () => {
            const path = resolve(root, STATE_REL, "shell-log.json");
            const existing = existsSync(path) ? readJson(path) : { version: 1, entries: [] };
            const entries = [...(Array.isArray(existing.entries) ? existing.entries : []), entry].slice(-300);
            writeJson(path, { version: 1, entries });
        });
    }
    else if (event === "subagentStart") {
        const task = activeTask(root);
        const lines = [
            "Return the completion receipt: Status / Changed / Verified / Not verified / Needs review by / Evidence.",
            "`Verified` may list only checks that actually executed in this delegation.",
        ];
        if (task) {
            lines.push(`An owning task is active (${task.id}, risk ${task.risk}). Writable scope is limited to: ${task.owned_paths.join(", ")}.`, "Writes outside that scope, and writes to files changed outside this task, are blocked.");
        }
        // The delegate consumes the resolved profile; it never re-derives thresholds of its own.
        try {
            lines.push(assuranceBanner(root, task?.id ?? null));
        }
        catch {
            // A policy problem is reported at session start; a delegation must not fail on it.
        }
        output = { additional_context: lines.join(" ") };
    }
    else if (event === "preCompact") {
        // Compaction is the last moment the current reasoning still exists. Anything not written
        // down here is gone, which is how long tasks drift in large repositories. Cursor's
        // preCompact hook is observational, so the note is saved to disk and the next tool call
        // re-injects the invariants from it.
        const current = binding(root);
        const plan = buildVerifyPlan(root, [], { base: current.base_commit });
        const assessment = assessQuality(root, plan);
        const task = activeTask(root);
        const notePath = resolve(root, STATE_REL, "compaction-note.json");
        writeJson(notePath, {
            version: 1,
            created_at: new Date().toISOString(),
            ...current,
            active_task: task,
            assurance: assessment.assurance,
            affected_modules: plan.modules,
            outstanding_checks: assessment.checks.filter((check) => !check.acceptable),
            blockers: assessment.blockers,
            changed_paths: changedPaths(root, current.base_commit).slice(0, 200),
        });
        writeJson(resolve(root, STATE_REL, REINJECT_REL_NAME), {
            version: 1,
            requested_at: new Date().toISOString(),
            trigger: payload.trigger ?? null,
        });
        output = {
            user_message: `Harness state was saved to ${posix(relative(root, notePath))} before compaction: base commit ${current.base_commit}, ` +
                `${plan.modules.length} affected modules, ${assessment.blockers.length} blocker(s). The invariants will be re-injected after the next tool call.`,
        };
    }
    else if (event === "postToolUse") {
        // Compaction does not correct drift; the summary carries it forward. The first tool result
        // after a compaction therefore carries the invariants re-derived from files, not from the
        // summary. Nothing else happens on this event, so a routine tool call costs one stat.
        const marker = resolve(root, STATE_REL, REINJECT_REL_NAME);
        if (existsSync(marker)) {
            try {
                const derived = invariants(root);
                const note = resolve(root, STATE_REL, "compaction-note.json");
                output = {
                    additional_context: "A context compaction just happened. Compaction removes governance constraints rather than diluting them, so the following was re-derived from files, not from the summary. Calibrate against it, not against the compacted impression." +
                        (existsSync(note) ? ` The pre-compaction state note is at ${posix(relative(root, note))}.` : "") +
                        `\n\n${derived.text}`,
                };
            }
            finally {
                rmSync(marker, { force: true });
            }
        }
    }
    else if (event === "subagentStop") {
        if (payload.status === "completed" &&
            Array.isArray(payload.modified_files) &&
            payload.modified_files.length > 0 &&
            Number(payload.loop_count || 0) < 1) {
            output = {
                followup_message: "Inspect the complete scoped diff and run the affected verification plan. Report exact outcomes; do not widen scope.",
            };
        }
    }
    else if (event === "stop") {
        const current = binding(root);
        const baselinePath = resolve(root, STATE_REL, "baseline.json");
        const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
        // Relying on afterFileEdit would miss every write made through a shell command, so the
        // trigger is the working tree moving away from the session baseline instead.
        const changedThisSession = baseline
            ? baseline.diff_sha256 !== current.diff_sha256
            : changedPaths(root, current.base_commit).length > 0;
        if (payload.status === "completed" &&
            Number(payload.loop_count || 0) < 2 &&
            changedThisSession) {
            const plan = buildVerifyPlan(root, [], { base: current.base_commit });
            const assessment = assessQuality(root, plan);
            const parts = [];
            if (!assessment.complete) {
                const outstanding = assessment.checks
                    .filter((check) => !check.acceptable)
                    .map((check) => `${check.id} (${check.status})`);
                const gapsBlock = assessment.assurance.controls.attributeGaps === "blocking";
                const gaps = assessment.attributes
                    .filter((entry) => entry.enforcement === "block" && !entry.covered && !entry.deferred)
                    .map((entry) => `${entry.module}/${entry.attribute} (${entry.tier})`);
                if (outstanding.length > 0) {
                    parts.push(`no passing verification receipt for: ${outstanding.join(", ")}`);
                }
                if (gapsBlock && gaps.length > 0) {
                    parts.push(`no evidence for required quality attributes: ${gaps.join(", ")}`);
                }
            }
            // Memory that falls behind the code is the state a cleared session cannot recover from.
            // Whether that stops the turn is the profile's call: strict blocks, balanced reports
            // through recap and risk, explore ignores it.
            if (assessment.assurance.controls.memorySync === "block") {
                try {
                    const sync = syncCheck(root, changedPaths(root, current.base_commit));
                    const behind = sync.findings.find((finding) => finding.code === "MEMORY_BEHIND_CODE");
                    if (behind)
                        parts.push(`governed code changed but ${sync.ledger} did not (${behind.sample?.slice(0, 3).join(", ")})`);
                }
                catch {
                    // A memory check that cannot run must not convert a completed turn into a loop.
                }
            }
            // A blast radius over budget is a reason to split the change or escalate on purpose; under
            // `budget: block` the turn does not end on it silently.
            if (assessment.budget.mode === "block" && assessment.budget.exceeded.length > 0) {
                parts.push(`a blast radius over budget (${assessment.budget.exceeded.join("; ")})`);
            }
            if (parts.length > 0) {
                output = {
                    followup_message: `Under the ${assessment.assurance.effective} assurance profile the current diff has ${parts.join("; and ")}. ` +
                        "Run `node scripts/harness.mjs gate` (and record the decision in project memory) and report the outcome. Do not claim verification that did not execute.",
                };
            }
        }
    }
    return output;
}
const REINJECT_REL_NAME = "reinject-invariants.json";
/** One line describing the assurance profile in force, for session and delegation context. */
function assuranceBanner(root, taskId) {
    const compiled = loadPolicy(root);
    const selection = effectiveSelection(root, taskId);
    const resolved = resolveAssurance(compiled, { selection, risk: activeTask(root)?.risk ?? null });
    const loan = readLoan(root);
    const debts = openDebts(root).length;
    const parts = [
        `Assurance profile: ${resolved.effective} (selection ${selection}${resolved.requested !== resolved.effective ? `, raised by ${resolved.floors.map((floor) => floor.source).join(", ")}` : ""}); floors from impact, protected attributes, and governance paths are applied per change by the gate.`,
    ];
    if (loan.active) {
        parts.push(`FAST LOAN OPEN until ${loan.loan?.expires_at} (${loan.loan?.reason}): allowFastSkip checks are deferred and recorded as debt.`);
    }
    if (debts > 0)
        parts.push(`${debts} evidence debt(s) are unpaid; a loaned gate cannot close a task or a release.`);
    return parts.join(" ");
}
