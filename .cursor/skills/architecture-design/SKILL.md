---
name: architecture-design
description: Designs or reviews module boundaries with the seven architecture principles and makes each decision enforceable through the catalog, arch-check, and ADRs. Use for new modules, boundary or layering changes.
---

# Architecture Design

1. Write the task envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Map the current structure: `node scripts/harness.mjs repo-map` and read the module catalog before proposing anything.
3. Evaluate the design against the seven principles — open-closed, dependency inversion, single responsibility, interface segregation, least knowledge, Liskov substitution, composite reuse. Judge with real dependency edges, not intent.
4. Make every accepted decision enforceable: declare it in `harness/module-catalog.json` (`dependsOn`, `forbiddenDependencies`, `layers`, `provides`), and record it as an ADR whose `Enforced-by:` names a real check.
5. Prove it holds: `node scripts/harness.mjs arch-check`, `catalog lint`, and `adr-check` must pass. A principle no check can see is a preference, not a decision.

An unenforced boundary decays silently in a large repository; the catalog and `arch-check` are what keep the design and the code from drifting apart.

Return the standard receipt: **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for each principle's review questions and its mapping to an enforcement mechanism.
