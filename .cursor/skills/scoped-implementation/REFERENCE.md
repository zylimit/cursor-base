# Scoped Implementation Reference

## Before editing

- Inspect repository status and current contents immediately before each edit.
- Locate the closest existing implementation and tests.
- Resolve whether files are generated, vendored, migrated, or user-modified.
- Name owned paths. Treat shared configuration, lockfiles, schemas, and generated output as shared ownership.

## During editing

Preserve external behavior outside the goal. Avoid broad renames, opportunistic cleanup, dependency changes, or formatting unrelated files. Prefer a small complete slice over partial edits across many modules.

Parallel reads are encouraged. Parallel writes require disjoint path ownership and one integration owner; otherwise serialize them.

## Before handoff

Inspect the complete diff for scope drift, debug artifacts, secrets, and accidental generated changes. Run the narrowest affected checks, then expand according to contract and impact. Request read-only review for material behavior changes.

A quality waiver needs owner, reason, exact scope, and expiry. It cannot waive safety and must appear under `Not verified` and `Evidence`.
