# 1. Quality attributes are declared per module, at one of six strengths

Status: accepted
Date: 2026-08-06
Enforced-by: catalog-lint, arch-check, fitness

## Context

The harness could prove that checks executed, but not what property they established. A repository
could show every check green while holding no evidence that a module was secure, private, or
reliable. At the same time, a single strictness level is its own defect: applied uniformly it makes
a throwaway prototype as expensive as a payments service, which pushes teams to disable checks
wholesale rather than tune them.

## Decision

Every module may declare quality attributes drawn from ISO/IEC 25010, each at one of six
strengths: `critical`, `high`, `medium`, `low`, `minimal`, `none`. Verification checks declare
which attributes a passing run is evidence for. Coverage is then decidable: an attribute is
covered when a check the module selected claims it and passes, and is not covered when any
claiming check fails.

`critical` and `high` close the completion gate. `medium` and `low` are reported. `minimal` and
`none` require a written reason, so opting out stays a recorded decision instead of the quiet
default every attribute drifts toward.

## Consequences

A failing check outweighs a passing one for the same attribute, because a demonstration that a
property does not hold is stronger than a demonstration that some part of it does.

Runtime attributes cannot use this binding. A load test measures a deployed system, so
`class: runtime` results are accepted within a time window and labelled as not diff-bound.

Declaring an attribute without wiring a check that claims it produces a visible gap rather than
silent success. That is intended: the gap is the honest state.

## Rejected alternatives

A single boolean "strict mode": rejected because it forces the same bar on every module and gives
teams only one lever, which is to turn it off.

Inferring attributes from check class: rejected because `class` describes the kind of tool, not the
property it protects, and one tool often evidences several attributes.
