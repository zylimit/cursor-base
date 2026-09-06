---
id: meta-tests-stay-off-the-release-chain
occurrences: 2
first_seen: 2026-09-06
last_seen: 2026-09-06
graduated: false
---

# A check that tests the checker stays off the default run and the release chain

cc-base put a golden mutation matrix — thirteen injected bugs replayed through the whole
command suite to prove the golden recorder could see them — on its release chain. It cost 65
minutes per release on top of a 15-minute full run, and it proved something about the test
infrastructure, not about the product. The user stopped it twice, then had the whole apparatus
deleted: "anything unrelated to the code is garbage; the scaffold must not be over-complex." The
same user, the same day, asked this repository to make its guard mutation test optional.

Before adding any "verify the verifier" mechanism — meta-tests, a second ledger over the ledger,
a gate that generates gates — name who saves what time. Without a concrete beneficiary, do not
add it. Keep the default test run and the release chain to checks that directly prove the code:
unit and regression tests, static audits, manifest and parity checks. Put meta-tests behind an
explicit opt-in and run them when the infrastructure they test changes. Periodically prune
existing mechanisms on two criteria: does it verify the code itself, and has it ever caught
anything. Before starting a long step, state its expected duration and what it proves.

Evidence: cc-base commit `346b354` and `.claude/feedback/meta-tests-not-in-release-chain-scaffold-stay-lean.md`
(2026-09-06); this repository's `tests/guard-mutations.mjs`, moved out of `node --test` to
`npm run test:mutation` on the user's instruction the same day.
