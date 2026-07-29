# Security Fixes 独数九宫格 v4

File Name: `Security_Fixes_DushuJiugongge_v4.md`
Project Root: `d:\独数九宫格`
Updated At: `2026-06-01`

## Summary 概要

- This document records the post-restore connection repair and fourth-pass non-index script externalization.
- 本文件记录主界面恢复后的连接修复，以及第四轮“非主界面脚本外置化”结果。

## Modified Files 已修改文件

1. `index.html/index.html`
2. `zijian.html`
3. `register.html`
4. `juanzeng.html`
5. `zixitong.html`
6. `js/register.page.js`
7. `js/juanzeng.page.js`
8. `js/zixitong.page.js`
9. `js/zijian.page.js`

## Applied Fixes 已应用修复

### A. Restored Main UI Connection Repair 恢复版主界面连接修复

- Added shared helpers to restored main page:
  - `../js/db_client.js`
  - `../js/shared_identity.js`
- Added external page map:

```text
register -> ../register.html
donate   -> ../juanzeng.html
growth   -> ../zixitong.html
selfcheck-> ../zijian.html
```

- Result 效果:
  - 中文: 主界面框架保持不变，但入口已重新连到真实页面。
  - English: Main UI layout stays intact while entry points reconnect to the real pages.

### B. Self-check Bridge Repair 自检桥接修复

- `zijian.html` now falls back to `window.opener` when `window.parent` is unavailable.
- `index.html/index.html` now responds to self-check requests such as:
  - `ping`
  - `check-circles`
  - `fix-circles`
  - `check-high-multiplier`
  - `fix-high-multiplier`
  - `check-database`
  - `fix-database`
  - `test-db-query`
  - `check-entropy`
  - `fix-entropy`
  - `get-entropy-log`

### C. Non-index Script Externalization 非主界面脚本外置化

- Moved inline scripts out of:
  - `register.html` -> `js/register.page.js`
  - `juanzeng.html` -> `js/juanzeng.page.js`
  - `zixitong.html` -> `js/zixitong.page.js`
  - `zijian.html` -> `js/zijian.page.js`

- Result 效果:
  - 中文: 非主界面页面的 CSP 维护成本下降，后续再拆分模块会更容易。
  - English: Non-main pages are easier to maintain under strict CSP and future modularization.

## Validation 验证

- `GetDiagnostics` on all modified HTML/JS files: no diagnostics
- HTML script references confirmed:
  - `register.html` uses `js/register.page.js`
  - `juanzeng.html` uses `js/juanzeng.page.js`
  - `zixitong.html` uses `js/zixitong.page.js`
  - `zijian.html` uses `js/zijian.page.js`

## Residual Items 残余项

- `index.html/index.html` inline script remains, by design, to preserve the restored main framework.
- Shared bridge logic is still embedded in the main page rather than extracted into a dedicated bridge module.

## Recommended Next Steps 下一步建议

1. Externalize restored main page script into `js/index.page.js` without changing HTML layout.
2. Extract self-check bridge into `js/selfcheck.bridge.js`.
3. Add simple smoke tests for cross-page navigation and opener messaging.
