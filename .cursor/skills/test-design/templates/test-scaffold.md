# Minimal test scaffold

Use the repository's existing runner, directories, and commands first. Scaffold only when there
is none, only with authorisation for any new dependency, and only far enough that one smoke case
runs — that proves the runner works, nothing about the product. No coverage gate, no CI wiring
unless asked. The stacks below are examples; the project's own conventions win.

## Back end (Python, pytest)

Dependency: `pytest`; `pytest-asyncio` only when async functions or routes are tested.
Directory: `api/tests/`, files `test_*.py`, first line `# risk: high|medium|low`.
Configuration (`api/pytest.ini` or the pyproject section; the third line only with pytest-asyncio):

```ini
[pytest]
testpaths = tests
asyncio_mode = auto
```

Smoke case (`api/tests/test_smoke.py`):

```python
# risk: low
def test_scaffold_alive():
    assert 1 + 1 == 2
```

Run: `cd api && python -m pytest -q`

A round-trip example with independent expectations — assume the project confirmed that a site
has four fields, that export followed by import preserves them field by field with no extra
sites, and that the caller's input is not modified; order is not part of this contract:

```python
# risk: high
from copy import deepcopy
import pytest
from exporters.kmz import build_kml, pack_kmz
from parsers.kmz import parse_kmz

@pytest.mark.parametrize("site_rows", [
    [
        {"id": "site-a", "name": "North", "longitude": 103.8, "latitude": 1.3},
        {"id": "site-b", "name": "South", "longitude": 110.4, "latitude": -6.2},
    ],
    [{"id": "site-c", "name": "West", "longitude": -73.9, "latitude": 40.7}],
    [],
])
def test_export_import_preserves_site_fields(site_rows):
    expected = deepcopy(site_rows)
    kml = build_kml(site_rows, [], [])
    res = parse_kmz(pack_kmz(kml))
    assert sorted(res.sites, key=lambda r: r["id"]) == sorted(expected, key=lambda r: r["id"])
    assert res.lessors == []
    assert site_rows == expected
```

Two distinct sites catch "right count, same row twice", lost fields, and swapped names or
coordinates; a second group and the empty input catch a hard-coded first fixture; the independent
`expected` copy catches a modified input. The round trip alone can still hide two cancelling
errors — format interoperability needs the one-way expectations from the reference: check the
export's mandated fields directly and import an independently confirmed external fixture.

A real database only when unavoidable: minimal fixture, a test database, transaction rollback;
never the production or baseline store.

## Front end (TypeScript, vitest)

Dependencies: `vitest`; `@testing-library/react` and `jsdom` only for component rendering.
Scripts: `"test": "vitest run"`. Configuration (`web/vitest.config.ts`; pure-function tests may
omit `environment`):

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } }); // "jsdom" for components
```

A numeric contract example — assume the project confirmed the input latitude is in degrees, that
200 metres returns 200 at the equator and 400 at ±60°, and that zero radius returns zero; the
expectations come from these agreed examples, not from restating the formula:

```ts
// risk: medium
import { describe, it, expect } from "vitest";
import { metersToProjRadius } from "./utils";

describe("metersToProjRadius contract", () => {
  it.each([
    [200, 0, 200],
    [200, 60, 400],
    [200, -60, 400],
    [0, 60, 0],
  ])("radius %s at latitude %s gives %s", (meters, latitude, expected) => {
    expect(metersToProjRadius(meters, latitude)).toBeCloseTo(expected, 5);
  });
});
```

The non-zero latitudes catch "returns the metres unchanged"; north and south catch sign handling;
the known values catch a degrees/radians mix-up. Polar behaviour, invalid input, and tolerance are
not in this example's contract — confirm them with the source before asserting them.

Run: `cd web && npm run test`

## Trade-offs

- Test pure logic, contracts, and parsers first by feeding constructed data to pure functions:
  fast and stable. Component rendering and end-to-end come later by budget and value — unless the
  error only appears in the full chain, in which case the flow test runs first.
- Every assertion names its rule source and what it actually covers; a running smoke proves the
  runner, not the product; a passing test proves the rule as written, not that a person confirmed
  the rule.
- These snippets are not a mandatory list and not evidence of any run.
