---
name: test-scaffold
description: test-builder 搭建测试基建时的最小 scaffold 参考。按技术栈选用，目标是「能跑通一个样例」即可，不过度配置。
---

# 测试基建最小 scaffold 参考

> 原则：最小可用。先让空套件 + 一个样例用例跑通，再写真测试。不引入覆盖率门禁、不接 CI（除非用户要求）。

## 后端 · pytest（Python / FastAPI）

**依赖**（进 `api/requirements.txt` 或 dev 依赖）：`pytest`；要测 async 函数 / 路由再加 `pytest-asyncio`。
**目录约定**：`api/tests/`，文件名 `test_*.py`，文件头标 `# risk: high|medium|low`。
**最小配置**（`api/pytest.ini` 或 pyproject 段，用了 pytest-asyncio 才加第三行）：
```ini
[pytest]
testpaths = tests
asyncio_mode = auto
```
**样例用例**（`api/tests/test_smoke.py`，验证基建可跑）：
```python
def test_scaffold_alive():
    assert 1 + 1 == 2
```
**跑**：`cd api && python -m pytest -q`

## 前端 · vitest（TypeScript / React + Vite）

**依赖**（`web` devDependencies）：`vitest`；测组件渲染再加 `@testing-library/react` 与 `jsdom`。
**目录约定**：就近 `*.test.ts` 或 `web/src/__tests__/`；scripts 加 `"test": "vitest run"`。
**最小配置**（`web/vitest.config.ts`，纯函数测试可省 environment）：
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node" },   // 测组件改 "jsdom"
});
```
**样例用例**（`web/src/utils.test.ts`，优先测无副作用纯函数）：
```ts
import { describe, it, expect } from "vitest";
describe("utils 纯函数", () => {
  it("scaffold alive", () => expect(1 + 1).toBe(2));
});
```
**跑**：`cd web && npm run test`

## 取舍提醒

- 先测纯逻辑 / 契约 / 解析：构造数据喂纯函数即可，跑得快、稳；需要真库时用最小 fixture + 测试库，绝不碰生产或基线数据。
- 组件渲染、E2E（Playwright）成本高，按预算和价值排后。
- scaffold 阶段只求样例能跑通，高价值用例按 test-builder [测试维度清单] 补。
