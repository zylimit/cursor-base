// Structured review: independent lenses, staged by cost, with a verdict the engine computes.
//
// A review loop is the one lever in this field with a large measured effect, and consensus is
// its failure mode: reviewers agreeing cheaply have not reviewed anything. So the engine counts
// what actually happened. A verdict cannot be written until every convened lens of the current
// stage has reported, every finding is locatable, and the session still binds the diff it
// opened on. One error finding is never outvoted by clean lenses. Stages order the work by cost:
// a security lens is not spent on code that has not passed correctness.
//
// Authorship is best effort on this host. The hooks record which conversation edited which
// file; a lens that names its `--agent` and matches an author of the diff cannot carry an
// ACCEPT. When no identity was recorded the verdict says so rather than pretending it checked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { REVIEW_LENSES, REVIEW_STAGES, convenedLenses } from "./assurance.mjs";
import { catalog } from "./catalog.mjs";
import { EXIT, STATE_REL, binding, boolOption, git, gitAvailable, gitBase, posix, printJson, readJson, stdinJson, targetFrom, withStateLock, writeJson, } from "./core.mjs";
import { buildVerifyPlan, writeReviewReceipt } from "./quality.mjs";
import { activeTask } from "./state.mjs";
export const REVIEW_STATE_REL = `${STATE_REL}/review/session.json`;
export const AUTHORSHIP_REL = `${STATE_REL}/authorship.json`;
export const DEFAULT_MAX_ROUNDS = 3;
const LOCATION = /^[^\s:]+:\d+/;
function sessionPath(root) {
    return resolve(root, REVIEW_STATE_REL);
}
export function readSession(root) {
    const path = sessionPath(root);
    if (!existsSync(path))
        return null;
    return readJson(path);
}
function saveSession(root, session) {
    writeJson(sessionPath(root), session);
    return session;
}
/** The session is evidence only about the tree it opened on. */
function freshness(root, session) {
    if (!session)
        return { ok: false, reason: "no review session is open; run `review start`" };
    const current = binding(root);
    if (current.diff_sha256 !== session.diff_sha256 || current.base_commit !== session.base_commit) {
        return { ok: false, stale: true, reason: "the working tree changed since this review opened; re-open it and re-run the lenses" };
    }
    return { ok: true };
}
function stageOf(lens) {
    return lens in REVIEW_LENSES ? REVIEW_LENSES[lens].stage : 1;
}
/**
 * The stage whose lenses may report now. A stage is complete when every convened lens in it
 * reported without an error finding and without declaring itself unable; until then later,
 * more expensive stages stay closed. Stages the profile convenes nobody for are skipped.
 */
export function currentStage(session) {
    for (const stage of [1, 2, 3]) {
        const lenses = session.required_lenses.filter((lens) => stageOf(lens) === stage);
        if (lenses.length === 0)
            continue;
        const complete = lenses.every((lens) => {
            const report = session.lenses[lens];
            return report && !report.unable && !report.findings.some((finding) => finding.severity === "error");
        });
        if (!complete)
            return stage;
    }
    return 3;
}
function maxRounds(root) {
    const declared = catalog(root).review?.maxRounds;
    return Number.isInteger(declared) && Number(declared) > 0 ? Number(declared) : DEFAULT_MAX_ROUNDS;
}
export function readAuthorship(root) {
    const path = resolve(root, AUTHORSHIP_REL);
    if (!existsSync(path))
        return { version: 1, entries: [] };
    const value = readJson(path);
    return { version: 1, entries: Array.isArray(value?.entries) ? value.entries : [] };
}
export function recordAuthorship(root, agent, files) {
    const cleaned = files.map((file) => posix(file)).filter((file) => file && !file.startsWith("..") && !file.includes("/../"));
    if (!agent || cleaned.length === 0)
        return;
    withStateLock(root, "authorship", () => {
        const file = readAuthorship(root);
        file.entries.push({ at: new Date().toISOString(), agent, files: cleaned, base_commit: gitAvailable(root) ? gitBase(root) : "NO_GIT" });
        file.entries = file.entries.slice(-2000);
        writeJson(resolve(root, AUTHORSHIP_REL), file);
    });
}
/** Agents recorded as having edited any path in the given set since the base commit. */
export function authorsOf(root, paths) {
    const wanted = new Set(paths.map(posix));
    const base = gitAvailable(root) ? gitBase(root) : "NO_GIT";
    const authors = new Set();
    for (const entry of readAuthorship(root).entries) {
        if (entry.base_commit !== base)
            continue;
        if (entry.files.some((file) => wanted.has(file)))
            authors.add(entry.agent);
    }
    return [...authors].sort();
}
// ---------------------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------------------
export function startReview(root, options) {
    const plan = buildVerifyPlan(root, [], options);
    if (plan.paths.length === 0)
        return { ok: false, degraded: true, reason: "no change is under review: the working tree matches the base" };
    const definition = catalog(root);
    const affected = definition.modules.filter((module) => plan.modules.includes(module.id));
    const team = convenedLenses(plan.assurance.controls, affected);
    const previous = readSession(root);
    const lineage = previous?.lineage ? [...previous.lineage] : [];
    if (previous?.verdict?.verdict === "FIX_REQUIRED") {
        lineage.push({ at: previous.verdict.at, diff_sha256: previous.diff_sha256, errors: previous.verdict.errors });
    }
    const session = {
        version: 1,
        base_commit: plan.base_commit,
        diff_sha256: plan.diff_sha256,
        started_at: new Date().toISOString(),
        scope: String(options.scope ?? "working tree"),
        modules: plan.modules,
        required_lenses: team.convened,
        excluded_lenses: team.excluded,
        lineage,
        blue: null,
        lenses: {},
        verdict: null,
        backlog: previous?.backlog ?? [],
    };
    return { ok: true, session: saveSession(root, session), plan };
}
export function recordBlue(root, payload) {
    const session = readSession(root);
    const fresh = freshness(root, session);
    if (!fresh.ok)
        return { ...fresh, ok: false };
    const claims = Array.isArray(payload?.claims) ? (payload.claims) : [];
    if (claims.length === 0)
        return { ok: false, reason: "blue must state at least one claim" };
    const bad = claims.filter((claim) => !claim || typeof claim !== "object" || !claim.claim || !claim.evidence);
    if (bad.length)
        return { ok: false, reason: `${bad.length} claim(s) carry no evidence; a claim without a command, a path, or an exit code is an opinion` };
    session.blue = { at: new Date().toISOString(), claims: claims };
    saveSession(root, session);
    return { ok: true, claims: claims.length };
}
export function recordLens(root, lens, payload, agent) {
    const session = readSession(root);
    const fresh = freshness(root, session);
    if (!fresh.ok)
        return { ...fresh, ok: false };
    if (!session.required_lenses.includes(lens)) {
        return { ok: false, reason: `lens ${lens} was not convened; this review requires ${session.required_lenses.join(", ")}` };
    }
    const body = (payload ?? {});
    const findings = Array.isArray(body.findings) ? body.findings : [];
    for (const finding of findings) {
        if (!finding || !["error", "warning", "info"].includes(finding.severity)) {
            return { ok: false, reason: "each finding needs severity error | warning | info" };
        }
        const located = (finding.location && LOCATION.test(String(finding.location))) || (finding.reproduction && String(finding.reproduction).trim());
        if (!located) {
            return { ok: false, reason: "a finding needs a file:line location or a reproduction someone else can run; an impression nobody can locate cannot be acted on" };
        }
        if (typeof finding.summary !== "string" || !finding.summary.trim())
            return { ok: false, reason: "each finding needs a summary" };
    }
    const stage = stageOf(lens);
    const open = currentStage(session);
    if (stage > open) {
        return {
            ok: false,
            stage_gated: true,
            reason: `${lens} belongs to stage ${stage} (${REVIEW_STAGES[stage]}) and the review is at stage ${open} (${REVIEW_STAGES[open]}); the earlier stage must report clean first`,
        };
    }
    session.lenses[lens] = {
        at: new Date().toISOString(),
        agent,
        unable: body.unable === true,
        unable_reason: typeof body.unableReason === "string" ? body.unableReason : null,
        findings,
    };
    saveSession(root, session);
    const after = currentStage(session);
    const remaining = session.required_lenses.filter((entry) => !session.lenses[entry]);
    return {
        ok: true,
        findings: findings.length,
        stage,
        open_stage: after,
        remaining,
        note: remaining.length === 0
            ? "every convened lens has reported; run `review verdict`"
            : after > stage
                ? `stage ${stage} is complete; stage ${after} (${REVIEW_STAGES[after]}) lenses may report now`
                : undefined,
    };
}
export function reviewVerdict(root, reviewer, notes) {
    const session = readSession(root);
    const fresh = freshness(root, session);
    if (!fresh.ok)
        return { ...fresh, ok: false };
    const current = session;
    const stage = currentStage(current);
    const reports = Object.entries(current.lenses);
    const errors = reports.flatMap(([lens, report]) => report.findings.filter((finding) => finding.severity === "error").map((finding) => ({ lens, ...finding })));
    const unable = reports.filter(([, report]) => report.unable).map(([lens]) => lens);
    const blockers = [];
    if (!current.blue)
        blockers.push("blue has not stated what it verified");
    const stageLenses = current.required_lenses.filter((lens) => stageOf(lens) === stage);
    const missing = stageLenses.filter((lens) => !current.lenses[lens]);
    if (missing.length && errors.length === 0 && unable.length === 0) {
        blockers.push(`stage ${stage} lens(es) never reported: ${missing.join(", ")}`);
    }
    // The reviewer is never the author. Enforced only where identities were actually recorded;
    // an unenforced rule reported as enforced would be worse than the prose it replaces.
    const authors = authorsOf(root, changedFiles(root, current));
    const reporting = reports.map(([, report]) => report.agent).filter((agent) => Boolean(agent));
    const selfReview = reporting.filter((agent) => authors.includes(agent));
    const authorshipEnforced = authors.length > 0 && reporting.length > 0;
    if (selfReview.length)
        blockers.push(`lens report(s) from an author of this diff: ${[...new Set(selfReview)].join(", ")}; a self-review cannot carry an ACCEPT`);
    if (blockers.length)
        return { ok: false, blockers, stage, authorship_enforced: authorshipEnforced };
    const verdict = errors.length ? "FIX_REQUIRED" : unable.length ? "NEEDS_MORE_EVIDENCE" : "ACCEPT";
    const cap = maxRounds(root);
    const round = current.lineage.length + 1;
    const escalate = verdict === "FIX_REQUIRED" && round >= cap;
    const final = verdict === "ACCEPT" && !current.required_lenses.some((lens) => stageOf(lens) > stage);
    current.verdict = {
        at: new Date().toISOString(),
        verdict,
        reviewer,
        notes,
        round,
        escalate,
        stage,
        final,
        errors: errors.length,
        authorship_enforced: authorshipEnforced,
    };
    saveSession(root, current);
    let receipt = null;
    if (verdict === "ACCEPT" && final) {
        const written = writeReviewReceipt(root, {
            scope: current.modules.length ? current.modules : ["."],
            reviewer,
            decision: "approve",
            findings: reports.flatMap(([lens, report]) => report.findings.map((finding) => ({ lens, ...finding }))),
            notReviewed: current.excluded_lenses.map((entry) => `${entry.lens}: ${entry.reason}`).join("; "),
            lenses: current.required_lenses,
        });
        receipt = posix(relative(root, written.path));
    }
    return {
        ok: true,
        verdict,
        stage,
        final,
        round,
        max_rounds: cap,
        escalate,
        errors: errors.slice(0, 20),
        unable,
        receipt,
        authorship_enforced: authorshipEnforced,
        authorship_note: authorshipEnforced
            ? undefined
            : authors.length === 0
                ? "no authorship was recorded for this diff, so reviewer independence was not machine-checked"
                : "no lens named its --agent, so reviewer independence was not machine-checked",
        advice: escalate
            ? `round ${round} of ${cap}: this change has been rejected ${round} times. Stop. Either the change is wrong or the standard is, and another round cannot tell you which. Take it to the user.`
            : verdict === "ACCEPT"
                ? final
                    ? "every stage passed, every convened lens reported, and none found an error"
                    : `stage ${stage} (${REVIEW_STAGES[stage]}) passed; report the stage ${stage + 1} lenses to advance`
                : verdict === "FIX_REQUIRED"
                    ? "fix the located errors and re-open the review; a lens that found an error is not outvoted by lenses that found nothing"
                    : "a lens could not reach a conclusion; supply exactly what it named rather than accepting around it",
    };
}
function changedFiles(root, session) {
    if (!gitAvailable(root))
        return [];
    const result = git(root, ["diff", "--name-only", session.base_commit], true);
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard"], true);
    return [...new Set([...result.stdout.split("\n"), ...untracked.stdout.split("\n")].map((line) => line.trim()).filter(Boolean))];
}
const BACKLOG_FORBIDDEN = /(security|safety|privacy|pii|secret|credential)/i;
export function backlogAdd(root, payload) {
    const session = readSession(root);
    const fresh = freshness(root, session);
    if (!fresh.ok)
        return { ...fresh, ok: false };
    const body = (payload ?? {});
    const missing = ["owner", "expiry", "summary", "lens"].filter((key) => typeof body[key] !== "string" || !String(body[key]).trim());
    if (missing.length)
        return { ok: false, reason: `a backlog entry needs ${missing.join(", ")} (owner, expiry as an ISO date, summary, lens)` };
    if (!(Date.parse(String(body.expiry)) > Date.now()))
        return { ok: false, reason: "expiry must be in the future; an undated debt is never repaid" };
    if (BACKLOG_FORBIDDEN.test(String(body.summary)) || BACKLOG_FORBIDDEN.test(String(body.lens))) {
        return { ok: false, reason: "a security, safety, or privacy finding cannot be backlogged; the backlog would become the waiver this design refuses" };
    }
    session.backlog.push({
        at: new Date().toISOString(),
        owner: String(body.owner),
        expiry: String(body.expiry),
        lens: String(body.lens),
        summary: String(body.summary),
        location: typeof body.location === "string" ? body.location : null,
    });
    saveSession(root, session);
    return { ok: true, count: session.backlog.length };
}
// ---------------------------------------------------------------------------------------
// Review pack
// ---------------------------------------------------------------------------------------
export function reviewPack(root, options) {
    if (!gitAvailable(root))
        return { ok: false, degraded: true, reason: "not a git repository; a review pack derives its facts from git" };
    const base = gitBase(root, options.base);
    const maxDiffLines = options["max-diff-lines"] === undefined ? 800 : Number(options["max-diff-lines"]);
    const commits = base === "NO_COMMIT" ? "" : git(root, ["log", "--oneline", `${base}..HEAD`], true).stdout.trim();
    const stat = git(root, ["diff", "--stat", base], true).stdout.trim();
    const nameStatus = git(root, ["diff", "--name-status", base], true).stdout.trim();
    const deletions = nameStatus.split("\n").filter((line) => /^D\s/.test(line)).map((line) => line.slice(1).trim());
    const renames = nameStatus.split("\n").filter((line) => /^R\d*\s/.test(line)).map((line) => line.replace(/^R\d*\s+/, ""));
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard"], true).stdout.split("\n").filter(Boolean);
    const full = git(root, ["diff", "--no-color", "--no-ext-diff", "--no-renames", base], true).stdout;
    const lines = full.split("\n");
    // What left matters as much as what arrived. Removed lines are rendered under a budget so a
    // reviewer skimming additions still sees the deletions.
    const removed = [];
    let removedTotal = 0;
    let currentFile = "(unknown)";
    for (const line of lines) {
        const header = /^diff --git a\/(.+?) b\//.exec(line);
        if (header) {
            currentFile = header[1];
            continue;
        }
        if (line.startsWith("-") && !line.startsWith("---")) {
            removedTotal += 1;
            if (removed.length < 200)
                removed.push(`${currentFile}: ${line.slice(1)}`);
        }
    }
    const bound = binding(root, options.base);
    const dir = resolve(root, STATE_REL, "context");
    mkdirSync(dir, { recursive: true });
    const stem = `review-pack-${bound.diff_sha256.slice(0, 12)}`;
    let diffSection = full;
    let spill = null;
    if (lines.length > maxDiffLines) {
        spill = resolve(dir, `${stem}.patch`);
        writeFileSync(spill, full, "utf8");
        diffSection = `Diff is ${lines.length} lines; written to ${posix(relative(root, spill))}. Read it there.`;
    }
    const body = [
        "# Review evidence pack",
        "",
        `Base: ${base}`,
        `Diff: ${bound.diff_sha256}`,
        `Generated: ${new Date().toISOString()}`,
        "",
        "## Commits",
        "",
        commits || "(none)",
        "",
        "## Diffstat",
        "",
        stat || "(empty)",
        "",
        "## Deleted files (always review what left, not only what arrived)",
        "",
        deletions.length ? deletions.join("\n") : "(none)",
        "",
        `## Removed lines (budgeted; ${removedTotal} total)`,
        "",
        removed.length ? removed.join("\n") : "(none)",
        removed.length < removedTotal ? `\n...[${removedTotal - removed.length} more removed lines in the diff]` : "",
        "",
        "## Renames",
        "",
        renames.length ? renames.join("\n") : "(none)",
        "",
        "## Untracked new files",
        "",
        untracked.length ? untracked.join("\n") : "(none)",
        "",
        "## Diff",
        "",
        diffSection,
        "",
    ].join("\n");
    const out = resolve(dir, `${stem}.md`);
    writeFileSync(out, body, "utf8");
    return {
        ok: true,
        base,
        diff_sha256: bound.diff_sha256,
        pack: posix(relative(root, out)),
        spill: spill ? posix(relative(root, spill)) : null,
        commits: commits ? commits.split("\n").length : 0,
        deleted_files: deletions,
        renames,
        untracked,
        diff_lines: lines.length,
        removed_lines: removedTotal,
    };
}
// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------
export async function reviewCommand(positional, options) {
    const root = targetFrom(options);
    const subcommand = positional[0] || "status";
    if (subcommand === "start") {
        const started = startReview(root, options);
        if (!started.ok) {
            printJson({ command: "review start", target: root, ...started });
            process.exitCode = EXIT.DEGRADED;
            return;
        }
        const session = started.session;
        printJson({
            command: "review start",
            target: root,
            diff_sha256: session.diff_sha256,
            modules: session.modules,
            assurance: started.plan.assurance.effective,
            convened: session.required_lenses,
            not_convened: session.excluded_lenses,
            round: session.lineage.length + 1,
            max_rounds: maxRounds(root),
            protocol: [
                "1. review-pack: assemble the evidence, including the deletion audit",
                "2. review blue < claims.json: the author states what was verified, with evidence",
                "3. review lens <name> [--agent ID] < findings.json: one independent report per convened lens, every finding located",
                "4. review verdict: computed from what was recorded, never asserted",
            ],
        });
        return;
    }
    if (subcommand === "blue") {
        const payload = await stdinJson();
        const result = recordBlue(root, payload);
        printJson({ command: "review blue", target: root, ...result });
        if (!result.ok)
            process.exitCode = result.stale ? EXIT.STALE : EXIT.VIOLATION;
        return;
    }
    if (subcommand === "lens") {
        const lens = positional[1];
        if (!lens)
            throw new Error("review lens requires a lens name.");
        const payload = await stdinJson();
        const result = recordLens(root, lens, payload, options.agent === undefined ? null : String(options.agent));
        printJson({ command: "review lens", target: root, lens, ...result });
        if (!result.ok)
            process.exitCode = result.stale ? EXIT.STALE : EXIT.VIOLATION;
        return;
    }
    if (subcommand === "verdict") {
        const result = reviewVerdict(root, String(options.reviewer ?? "reviewer"), String(options.notes ?? ""));
        printJson({ command: "review verdict", target: root, ...result });
        if (!result.ok)
            process.exitCode = result.stale ? EXIT.STALE : EXIT.VIOLATION;
        else if (result.verdict !== "ACCEPT")
            process.exitCode = EXIT.GATE;
        return;
    }
    if (subcommand === "backlog") {
        const action = positional[1] || "list";
        if (action === "add") {
            const result = backlogAdd(root, await stdinJson());
            printJson({ command: "review backlog add", target: root, ...result });
            if (!result.ok)
                process.exitCode = result.stale ? EXIT.STALE : EXIT.VIOLATION;
            return;
        }
        if (action === "list") {
            const session = readSession(root);
            const entries = (session?.backlog ?? []).map((entry) => ({ ...entry, expired: Date.parse(entry.expiry) <= Date.now() }));
            printJson({ command: "review backlog list", target: root, count: entries.length, expired: entries.filter((entry) => entry.expired).length, entries });
            return;
        }
        throw new Error("review backlog supports add or list.");
    }
    if (subcommand === "team") {
        const plan = buildVerifyPlan(root, [], options);
        const definition = catalog(root);
        const team = convenedLenses(plan.assurance.controls, definition.modules.filter((module) => plan.modules.includes(module.id)));
        printJson({
            command: "review team",
            target: root,
            assurance: plan.assurance.effective,
            modules: plan.modules,
            convened: team.convened.map((lens) => ({ lens, stage: REVIEW_LENSES[lens].stage, stage_name: REVIEW_STAGES[REVIEW_LENSES[lens].stage] })),
            not_convened: team.excluded,
        });
        return;
    }
    if (subcommand === "status") {
        const session = readSession(root);
        if (!session) {
            printJson({ command: "review status", target: root, session: null });
            return;
        }
        const current = binding(root);
        const stale = current.diff_sha256 !== session.diff_sha256 || current.base_commit !== session.base_commit;
        printJson({
            command: "review status",
            target: root,
            diff_sha256: session.diff_sha256,
            stale,
            stage: currentStage(session),
            blue: session.blue ? session.blue.claims.length : 0,
            reported: Object.keys(session.lenses),
            missing: session.required_lenses.filter((lens) => !session.lenses[lens]),
            verdict: session.verdict,
            round: session.lineage.length + 1,
        });
        return;
    }
    throw new Error("review supports start, blue, lens <name>, verdict, status, team, or backlog add|list.");
}
export function reviewPackCommand(options) {
    const root = targetFrom(options);
    const result = reviewPack(root, options);
    printJson({ command: "review-pack", target: root, ...result });
    if (result.degraded)
        process.exitCode = EXIT.DEGRADED;
}
export async function authorshipCommand(positional, options) {
    const root = targetFrom(options);
    const subcommand = positional[0] || "show";
    if (subcommand === "record") {
        const payload = (await stdinJson());
        if (!payload.agent || !Array.isArray(payload.files))
            throw new Error('authorship record expects {"agent": "...", "files": [...]} on stdin.');
        recordAuthorship(root, String(payload.agent), payload.files.map(String));
        printJson({ command: "authorship record", target: root, ok: true, agent: payload.agent, files: payload.files.length });
        return;
    }
    if (subcommand === "show") {
        const session = readSession(root);
        const files = session ? changedFiles(root, session) : gitAvailable(root) ? changedFiles(root, { base_commit: gitBase(root) }) : [];
        printJson({
            command: "authorship show",
            target: root,
            base_commit: gitAvailable(root) ? gitBase(root) : "NO_GIT",
            files: files.length,
            authors: authorsOf(root, files),
            entries: readAuthorship(root).entries.length,
            note: "Authorship on this host is recorded per conversation by the afterFileEdit hook; it is a claim about who edited, not an authenticated identity.",
        });
        return;
    }
    if (boolOption(options, "help"))
        return;
    throw new Error("authorship supports record or show.");
}
