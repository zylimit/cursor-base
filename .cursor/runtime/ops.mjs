// Operations: hook ledger, gate-effectiveness audit, proactive risk scan, and evidence retention.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, } from "node:fs";
import { relative, resolve } from "node:path";
import { effectiveSelection, loadPolicy, openDebts, readLoan } from "./assurance.mjs";
import { catalog } from "./catalog.mjs";
import { EVENTS, STATE_REL, binding, boolOption, boundedHead, errorMessage, posix, printJson, redactSecrets, targetFrom, } from "./core.mjs";
import { feedbackLessons, memoryDrift } from "./memory.mjs";
import { FAIL_STREAK_THRESHOLD, consecutiveFailures, readQualityLedger, readWaivers, verifyLedgerChain, } from "./quality.mjs";
import { listServiceStateDirs, positiveNumber, readServiceState, synthesizeServiceStatus } from "./services.mjs";
import { activeTask } from "./state.mjs";
export const STALE_TASK_HOURS = 72;
export function riskScan(root) {
    const findings = [];
    const integrity = verifyLedgerChain(root);
    if (!integrity.ok) {
        findings.push({
            severity: "high",
            id: "ledger-chain-broken",
            message: `Quality ledger failed integrity verification: ${integrity.reason}`,
        });
    }
    const task = activeTask(root);
    if (task) {
        const ageHours = (Date.now() - Date.parse(task.created_at)) / 3_600_000;
        if (Number.isFinite(ageHours) && ageHours > STALE_TASK_HOURS) {
            findings.push({
                severity: "medium",
                id: "stale-task",
                message: `Task ${task.id} has been active for ${Math.round(ageHours)}h. Complete, cancel, or re-scope it; a stale scope blocks writes it no longer describes.`,
            });
        }
    }
    const drift = memoryDrift(root);
    if (drift) {
        findings.push({
            severity: "medium",
            id: "memory-behind-code",
            message: `${drift} Record the change in project memory (see the project-memory skill) or the next session cannot resume from it.`,
        });
    }
    // Borrowed evidence decays into forgotten evidence unless something keeps saying so.
    const loan = readLoan(root);
    const debts = openDebts(root);
    if (loan.active) {
        findings.push({
            severity: "medium",
            id: "fast-loan-open",
            message: `A fast loan is open until ${loan.loan?.expires_at} (${loan.loan?.reason}). Checks marked allowFastSkip are being deferred, not run.`,
        });
    }
    if (debts.length > 0) {
        const oldest = debts.reduce((min, entry) => (Date.parse(entry.opened_at) < Date.parse(min.opened_at) ? entry : min), debts[0]);
        findings.push({
            severity: loan.active ? "medium" : "high",
            id: "evidence-debt",
            message: `${debts.length} deferred check(s) were never re-run (oldest ${oldest.check}, opened ${oldest.opened_at}). ${loan.active ? "" : "The loan window has closed; "}run \`node scripts/harness.mjs gate\` to repay.`,
        });
    }
    try {
        const policy = loadPolicy(root);
        const selection = effectiveSelection(root, task?.id ?? null);
        if (selection !== "adaptive" && policy.ranks.get(selection) === 0) {
            findings.push({
                severity: "medium",
                id: "explore-profile-selected",
                message: `The ${selection} profile is selected for the ${task ? "task" : "project"}; it runs no verification and cannot close work. Select rapid or stronger before implementing.`,
            });
        }
    }
    catch (error) {
        findings.push({
            severity: "high",
            id: "assurance-policy-invalid",
            message: `harness/assurance-policy.json could not be compiled: ${errorMessage(error)}`,
        });
    }
    if (integrity.ok) {
        const ledger = readQualityLedger(root);
        const seen = new Set();
        for (let index = ledger.length - 1; index >= 0; index -= 1) {
            const checkId = ledger[index].check_id;
            if (seen.has(checkId))
                continue;
            seen.add(checkId);
            const streak = consecutiveFailures(ledger, checkId);
            if (streak >= FAIL_STREAK_THRESHOLD) {
                findings.push({
                    severity: "medium",
                    id: `fail-streak-${checkId}`,
                    message: `Check ${checkId} has failed ${streak} consecutive runs. Stop re-running it; diagnose the root cause first.`,
                });
            }
        }
    }
    for (const name of listServiceStateDirs(root)) {
        const synthesized = synthesizeServiceStatus(readServiceState(root, name));
        if (synthesized.status === "crashed") {
            findings.push({
                severity: "high",
                id: `service-crashed-${name}`,
                message: `Service ${name} tripped its restart breaker and gave up. The fault is not transient; read its log before restarting.`,
            });
        }
        else if (synthesized.status === "dead") {
            findings.push({
                severity: "high",
                id: `service-dead-${name}`,
                message: `Service ${name} is recorded as supervised but its supervisor process is gone. Restart it or mark it stopped.`,
            });
        }
    }
    const stateDir = resolve(root, STATE_REL);
    if (existsSync(stateDir)) {
        const quarantined = readdirSync(stateDir).filter((name) => name.includes(".corrupt-"));
        if (quarantined.length > 0) {
            findings.push({
                severity: "medium",
                id: "quarantined-state",
                message: `${quarantined.length} corrupt state file(s) were quarantined (${quarantined.slice(0, 3).join(", ")}). They are forensic evidence; the active state was rebuilt.`,
            });
        }
    }
    for (const waiver of readWaivers(root)) {
        const expiry = Date.parse(String(waiver.value.expiry || ""));
        if (Number.isFinite(expiry) && expiry <= Date.now()) {
            findings.push({
                severity: "info",
                id: `waiver-expired-${waiver.id}`,
                message: `Waiver ${waiver.id} expired; its deferred check ${String(waiver.value.check || "?")} is due.`,
            });
        }
    }
    const notePath = resolve(root, STATE_REL, "compaction-note.json");
    if (existsSync(notePath)) {
        findings.push({
            severity: "info",
            id: "compaction-note",
            message: `A pre-compaction recovery note exists at ${posix(relative(root, notePath))}.`,
        });
    }
    const candidates = feedbackLessons(root).filter((lesson) => lesson.errors.length === 0 && lesson.occurrences >= 3 && !lesson.graduated);
    if (candidates.length > 0) {
        findings.push({
            severity: "info",
            id: "feedback-graduation",
            message: `${candidates.length} recorded lesson(s) recurred 3+ times without graduating into a rule: ${candidates.map((lesson) => lesson.id).slice(0, 3).join(", ")}.`,
        });
    }
    return findings;
}
export function riskCommand(options) {
    const root = targetFrom(options);
    const findings = riskScan(root);
    const highs = findings.filter((finding) => finding.severity === "high");
    printJson({
        command: "risk",
        target: root,
        ok: highs.length === 0,
        counts: {
            high: highs.length,
            medium: findings.filter((finding) => finding.severity === "medium").length,
            info: findings.filter((finding) => finding.severity === "info").length,
        },
        findings,
    });
    if (highs.length > 0 && boolOption(options, "strict"))
        process.exitCode = 1;
}
export const RETENTION_DEFAULTS = {
    evidenceMaxAgeDays: 30,
    evidenceMaxCount: 200,
    contextMaxCount: 50,
};
export function retentionPolicy(root) {
    const declared = catalog(root).retention || {};
    return {
        evidenceMaxAgeDays: positiveNumber(declared.evidenceMaxAgeDays, RETENTION_DEFAULTS.evidenceMaxAgeDays, "retention.evidenceMaxAgeDays"),
        evidenceMaxCount: positiveNumber(declared.evidenceMaxCount, RETENTION_DEFAULTS.evidenceMaxCount, "retention.evidenceMaxCount"),
        contextMaxCount: positiveNumber(declared.contextMaxCount, RETENTION_DEFAULTS.contextMaxCount, "retention.contextMaxCount"),
    };
}
export function retention(options) {
    const root = targetFrom(options);
    const policy = retentionPolicy(root);
    const dryRun = boolOption(options, "dry-run");
    const ledger = readQualityLedger(root);
    const current = binding(root);
    const protectedPaths = new Set();
    const newestPerCheck = new Map();
    for (const receipt of ledger) {
        newestPerCheck.set(receipt.check_id, receipt);
        if (receipt.diff_sha256 === current.diff_sha256 && receipt.evidence_path) {
            protectedPaths.add(posix(receipt.evidence_path));
        }
    }
    for (const receipt of newestPerCheck.values()) {
        if (receipt.evidence_path)
            protectedPaths.add(posix(receipt.evidence_path));
    }
    const deleted = [];
    const kept = [];
    const evidenceDir = resolve(root, STATE_REL, "evidence");
    const cutoff = Date.now() - policy.evidenceMaxAgeDays * 24 * 3_600_000;
    if (existsSync(evidenceDir)) {
        const entries = readdirSync(evidenceDir)
            .map((name) => {
            const absolute = resolve(evidenceDir, name);
            const rel = posix(relative(root, absolute));
            try {
                return { rel, absolute, mtime: statSync(absolute).mtimeMs };
            }
            catch {
                return null;
            }
        })
            .filter((entry) => entry !== null)
            .sort((left, right) => right.mtime - left.mtime);
        let unprotectedKept = 0;
        for (const entry of entries) {
            if (protectedPaths.has(entry.rel)) {
                kept.push(entry.rel);
                continue;
            }
            const tooOld = entry.mtime < cutoff;
            const overCount = unprotectedKept >= policy.evidenceMaxCount;
            if (tooOld || overCount) {
                deleted.push(entry.rel);
                if (!dryRun)
                    rmSync(entry.absolute, { force: true });
            }
            else {
                unprotectedKept += 1;
            }
        }
    }
    const contextDir = resolve(root, STATE_REL, "context");
    if (existsSync(contextDir)) {
        const packs = readdirSync(contextDir)
            .map((name) => {
            const absolute = resolve(contextDir, name);
            try {
                return { rel: posix(relative(root, absolute)), absolute, mtime: statSync(absolute).mtimeMs };
            }
            catch {
                return null;
            }
        })
            .filter((entry) => entry !== null)
            .sort((left, right) => right.mtime - left.mtime);
        for (const pack of packs.slice(policy.contextMaxCount)) {
            deleted.push(pack.rel);
            if (!dryRun)
                rmSync(pack.absolute, { force: true });
        }
    }
    printJson({
        command: "retention",
        target: root,
        dry_run: dryRun,
        policy,
        deleted: deleted.length,
        deleted_paths: deleted.slice(0, 100),
        protected: kept.length,
        note: "Evidence referenced by current-diff receipts and the newest receipt per check is never deleted. " +
            "Quarantined *.corrupt-* files are forensic evidence and are left alone.",
    });
}
// A gate nobody can show a catch for is pure cost: latency, false positives, and the false
// confidence of a control that has never been exercised. This makes that measurable.
export function gateAudit(options) {
    const root = targetFrom(options);
    const ledgerPath = resolve(root, STATE_REL, "ledger.jsonl");
    const activity = new Map();
    for (const event of EVENTS) {
        activity.set(event, {
            event,
            denied: 0,
            asked: 0,
            followups: 0,
            observed: 0,
            errors: 0,
            last_intervention: null,
            examples: [],
        });
    }
    let records = 0;
    let earliest = null;
    let latest = null;
    if (existsSync(ledgerPath)) {
        for (const line of readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean)) {
            let record;
            try {
                record = JSON.parse(line);
            }
            catch {
                continue;
            }
            records += 1;
            const timestamp = String(record.timestamp || "");
            if (!earliest || timestamp < earliest)
                earliest = timestamp;
            if (!latest || timestamp > latest)
                latest = timestamp;
            const entry = activity.get(String(record.event));
            if (!entry)
                continue;
            const outcome = String(record.outcome || "");
            if (outcome === "deny")
                entry.denied += 1;
            else if (outcome === "ask")
                entry.asked += 1;
            else if (outcome === "followup")
                entry.followups += 1;
            else if (outcome.startsWith("error:"))
                entry.errors += 1;
            else
                entry.observed += 1;
            if (outcome === "deny" || outcome === "ask" || outcome === "followup") {
                entry.last_intervention = timestamp;
                if (entry.examples.length < 3 && record.reason)
                    entry.examples.push(String(record.reason));
            }
        }
    }
    const gates = [...activity.values()];
    const effective = gates.filter((gate) => gate.denied + gate.asked + gate.followups > 0);
    const inert = gates.filter((gate) => gate.denied + gate.asked + gate.followups === 0 && gate.observed + gate.errors > 0);
    const unexercised = gates.filter((gate) => gate.observed + gate.errors + gate.denied + gate.asked + gate.followups === 0);
    printJson({
        command: "gate-audit",
        target: root,
        ledger_records: records,
        window: { from: earliest, to: latest },
        effective: effective.sort((left, right) => right.denied + right.asked - (left.denied + left.asked)),
        inert: inert.map((gate) => gate.event),
        unexercised: unexercised.map((gate) => gate.event),
        guidance: "A gate listed under `inert` has run without ever intervening. Either produce evidence of what it caught, or remove it rather than paying its cost for reassurance.",
    });
}
export const LEDGER_MAX_BYTES = 4 * 1024 * 1024;
// An append-only log that nothing rotates eventually dominates both disk and the cost of every
// audit that reads it. One generation is retained so recent history survives the roll.
export function rotateLedgerIfLarge(path) {
    try {
        if (!existsSync(path) || statSync(path).size < LEDGER_MAX_BYTES)
            return;
        renameSync(path, `${path}.1`);
    }
    catch {
        // A failed rotation must not prevent the current record from being written.
    }
}
export function appendLedger(root, event, payload, outcome, reason) {
    const state = resolve(root, STATE_REL);
    mkdirSync(state, { recursive: true });
    rotateLedgerIfLarge(resolve(state, "ledger.jsonl"));
    const subject = payload.command ||
        payload.tool_name ||
        (payload.file_path ? posix(relative(root, payload.file_path)) : null);
    const record = {
        timestamp: new Date().toISOString(),
        event,
        conversation_id: payload.conversation_id || null,
        generation_id: payload.generation_id || null,
        subject: subject ? boundedHead(redactSecrets(String(subject)), 300) : null,
        outcome,
        // The reason is what makes an audit able to say what a gate actually caught.
        reason: reason ? boundedHead(redactSecrets(reason), 300) : null,
    };
    appendFileSync(resolve(state, "ledger.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}
