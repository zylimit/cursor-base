# Test Design Reference

## Dimension checklist

**Must** (a break here is a contract- or data-level disaster): cross-boundary contracts — export
and import round-trip consistency, serialise and deserialise, request and response shape;
parsers and data cleaning — several source formats, field-name normalisation, header detection,
bad-encoding tolerance; dedupe and merge keys — key computation, conflict detection, overwrite or
ignore decisions; key boundaries and exceptions — null and empty, NaN and infinity, out of range,
huge and negative values, with special attention to defensive early-return branches.

**Recommended**: pure utilities (coordinate conversion, formatting, state mapping); state
transitions and enum mappings; parameter validation and fallback on key endpoints; core
interaction flows when a browser driver is installed.

**Not**: pixel or snapshot tests (brittle, heavy to maintain; the eye and the design reference do
this); third-party libraries' own behaviour; getters, setters, and branch-free pass-throughs.

A rule or skill change is tested by a real pressure scenario that shows the decision; matching a
title or slogan word for word is a static check, not a behaviour test.

## Choosing the level

Pick the cheapest level that can still catch the error you are hunting; the order is by failure
point, not by ceremony:

| Error to catch | Level and why |
| --- | --- |
| a computation, parsing, dedupe, or state rule is wrong | a focused rule test with explicit input and output; fast at separating boundaries from neighbours |
| data is lost or changes meaning across a service, format, or version boundary | a contract or integration test, field by field; an independent format fixture stops two ends from cancelling each other's errors |
| the user cannot complete the action, does not know whether it succeeded, or cannot recover | a component interaction or core-flow end-to-end test; when the error only appears in the full chain, this runs first |
| permission, path, transaction, concurrency, or recovery fails | a test at the real trust or state boundary — rejection, isolation, recovery — inside the required plan and protected attributes |

A low-level pass does not certify the user's task; a passing target does not certify another
required target. Cost schedules execution and trade-offs; it never pushes the core end-to-end
test to "later" or deletes what the profile, the plan, or the user explicitly required.

## Independent oracles

**One-way first, round trip third.** Take a concrete input and a fixed expected value from the
current rule. The implementation, the importer, and the exporter computing the same `expected`
makes shared errors confirm each other; a round trip returning the original may be two errors
cancelling. Check by failure point: (1) one-way output — given the internal object, verify the
external contract's fields, units, formats, and bounds directly, not through the importer you just
changed; (2) one-way input — an independently confirmed external fixture, not produced by the
exporter under test, with its supported fields and version noted; (3) round-trip preservation —
loss, duplication, or drift across both, and whether the caller's input was modified. A unit
example: if internal is millimetres and external is metres, `2500 mm → 2.5 m` and `2.5 m → 2500 mm`
are two one-way expectations; a missing divide and a missing multiply still round-trip to 2500.
Without a confirmed "two decimal places", `"2.50"` is not a requirement.

Choose a normal value and a neighbouring or boundary value that separates the target error; not
only zero, identity points, and empty sets. Structural completeness is checked field by field —
equal counts do not prove each object is right. To assert an input unchanged, keep an independent
copy and compare it.

**Enough** when the assertion accepts the specified normal behaviour, rejects the specific error it
claims to catch, and its `expected` has an independent source. A missing rule pauses only the
dependent assertion and goes back as a source gap — never a convenient interpretation that turns
green.

**Fixtures that reach the error.** Follow the production entry point's identity, permission,
state, and preceding steps. Calling an internal function past validation tests local logic; it
does not certify the user path. Asynchronous cases need controllable event order — a fixed wait
that saw no event is not proof of a correct rejection. Errors that only appear after reopening or
in the target environment keep their necessary boundary test.

## Fault classes and the three ways

The `tester` agent classifies a failure by fault; this skill routes it three ways. They are the
same triage read at two moments — diagnosis first, routing second — and every fault class lands
in exactly one row:

| Fault class (diagnosis) | Routes as | Who changes what |
| --- | --- | --- |
| product | code wrong | `root-cause-debugging` fixes the product; the assertion stays |
| test | test wrong | the tester fixes the assertion or the fixture |
| environment | no route yet | the run is wrong, not the code or the contract: report `BLOCKED` with the missing tool, version, or host fact; a missing tool is never a pass |
| prerequisite | no route yet | an earlier step or fixture never established the state; fix the ordering and re-run before attributing anything |
| flaky (suspected) | no route yet | quarantine with the failure rate and the evidence; a retry to green is not a diagnosis, and "flaky" asserted without a second observation is a guess |
| requirement in doubt | spec wrong | nobody edits: the counter-example goes to `product-spec` iteration mode and the case is skipped with the reason |

The three "no route yet" classes are why the tester's list is longer: a failure whose cause is
the run cannot be charged to the product or to the contract, and calling it either is how a real
defect gets closed as noise.

## Reading another tool's report

Before consuming a script, model, or browser report as evidence, ask five things and take only
what survives:

| Check | Question | When it fails |
| --- | --- | --- |
| object and ownership | is this the current source, diff, artefact, run, or session? | wrong object, stale evidence, or ambiguous session supports nothing |
| environment and parameters | actual version, working directory, fixture, strict or draft flags, isolation? | an unexecuted or differently-hosted check is not coverage |
| completion | how many samples should have been checked, how many were reached, did the process finish, where did timeouts or capture failures land? | an empty set, a missing tool, or a timeout without events is not 100% |
| findings versus verdict | which findings entered the pass condition; how do warnings, sampling, caps, and filters affect it? | listed-but-not-judged issues still need judging; truncated is not complete |
| raw result and protocol | actual exit code, errors, report path, required events; how does the tool express block versus done? | exit 0 may mean the script never touched the object |

Structural validity, a cleared marker, a role's `DONE`, or a visible list never substitute for
the behaviour and the fresh receipt. "There is a report but no proof it ran" is resolved by checking
this run's generation conditions, not by another file's modification time.

## Ratio and ageing as maintenance diagnostics

Test code that stays within roughly a third to a half of the effective code is a maintenance
target for a project that adopted it, not a completion criterion for a change. Use the project's
existing formula and denominator; measure the whole stock of the project or independently
deliverable component, not each function, file, or diff. Documents, generated code, dependencies,
and static data are not code; runner, reporter, helper, and fixture code is test code wherever it
lives. Deviation points at real gaps, duplicated set-up, or cheaper equivalent coverage — never at
padding, compressing format, changing the denominator, or deleting key assertions, and never at
the PASS/FAIL result.

Ageing is event-driven, lightly periodic: a requirement, contract, or implementation change,
duplicate assertions, new replacement coverage, flakiness, or a sudden slowdown triggers a review
of the related cases; a monthly look covers only brittle, expensive, or ownerless ones. Long green
or old age never justifies deleting a protective test; retirement needs the rule withdrawn or an
effective replacement with its location named. Four floor classes never retire: secret leakage,
data destruction, breaking someone else's project (installer), and shipping the wrong version
(release assembly). Quarantine only non-required diagnostics, with owner, reason, deadline, and
replacement evidence; a product FAIL never disappears into quarantine.

## Red-lock for defects

A production-behaviour bug or a core parser or contract defect gets a red test first — a test
that fails now, for the expected reason — before the fix; the fix turns it green and the original
reproduction is re-run. Cosmetic inputs, parameter variations, and copy defects are recorded as
residue and not red-locked. The lock's inputs and assertions are never weakened during the fix; if
a new fact shows the test's premise was wrong, the orchestrator recalibrates the basis explicitly.

## Failure triage examples

- "Refund shows as complete" may mean fulfilment finished or accounting cleared. Check both meanings
  in the sources before deciding which side is wrong; an `expected` chosen for convenience is a
  false green tomorrow.
- A green that compares counts after an "import everything" feature cannot see a duplicated row; a
  latitude correction tested only at the equator cannot see a wrong sign.
- A test asserting the implementation's own formula against itself is a tautology, not an oracle.

## Completion

The required checks in the plan run and are re-runnable; runner output shows passed, failed, and
exit; no red remains, and what could not run is `BLOCKED` or under *Not verified*; each new case
names the regression it prevents; untested items carry a reason; "passes the confirmed rule" and
"business meaning undecided" are stated separately; nothing is committed on the user's behalf.
