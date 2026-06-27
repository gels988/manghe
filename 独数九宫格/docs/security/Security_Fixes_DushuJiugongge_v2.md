# Security Fixes 独数九宫格 v2

File Name: `Security_Fixes_DushuJiugongge_v2.md`
Project Root: `d:\独数九宫格`
Updated At: `2026-06-01`

## Summary 概要

- This file records the second-pass hardening changes applied after the first audit report.
- 本文件记录首轮审计之后追加落地的第二轮加固修改。

## Modified Files 已修改文件

1. `index.html/index.html`
2. `register.html`
3. `juanzeng.html`
4. `zixitong.html`
5. `zijian.html`
6. `js/shared_identity.js`
7. `js/db_client.js`
8. `static-server.mjs`

## Applied Fixes 已应用修复

### A. Inline Event Removal 移除内联事件

- Removed all remaining inline `onclick` handlers from:
  - `index.html/index.html`
  - `register.html`
  - `juanzeng.html`
  - `zixitong.html`
  - `zijian.html`
- Replaced them with explicit `addEventListener` bindings.
- Result 效果:
  - 中文: 页面不再依赖 HTML 事件属性执行脚本。
  - English: Pages no longer rely on HTML event attributes for execution.

### B. Stricter CSP 更严格的 CSP

- `static-server.mjs` now:
  - generates a per-response nonce
  - injects nonce into HTML `<script>` tags
  - serves:

```text
script-src 'self' 'nonce-...'
script-src-attr 'none'
form-action 'self'
```

- Result 效果:
  - 中文: 脚本执行面已从 `unsafe-inline` 迁移到 nonce 模式。
  - English: Script execution now uses nonce mode instead of `unsafe-inline`.

### C. Ledger Schema Validation 账本 Schema 校验

- Added `validateSnapshotSchema(snapshot)` in `js/db_client.js`.
- Added checks for:
  - plain-object rows
  - required fields
  - string/number/boolean types
  - per-store row limits
  - local-state value length limits
  - dangerous keys such as `__proto__`
- Validation now runs before:
  - `importSnapshot()`
  - `previewImportConflicts()`

### D. Activation State Signing 激活态签名

- Added `window.MayijuSecurity` in `js/shared_identity.js` with:
  - `persistActivation(meta)`
  - `verifyActivationState()`
  - `upgradeLegacyActivationState()`
  - `clearActivation()`
- Added new state key:

```text
aim2m_activation_sig
```

- Main UI and donation page now use the shared signing helpers.

### E. Legacy Compatibility 旧状态兼容

- Existing activated local browsers are upgraded forward by `upgradeLegacyActivationState()`.
- Register flow now clears:
  - `mayiju_access`
  - `aim2m_activated`
  - `aim2m_activation_meta`
  - `aim2m_activation_sig`

## Validation 验证

- `onclick=` search across all HTML pages: no matches
- `GetDiagnostics` on all edited files: no diagnostics
- `node --check static-server.mjs`: passed
- `node --check signaling-server.mjs`: passed
- Live local verification:
  - HEAD request confirms stricter CSP
  - HTML response confirms injected script nonce

## Residual Items 残余项

- `style-src 'unsafe-inline'` still remains
- local activation signing is not equivalent to a server-backed or asymmetric license model

## Recommended Next Steps 下一步建议

1. Convert inline `style=""` attributes to classes and tighten `style-src`.
2. Add export-time snapshot checksum and version signature.
3. Record import rejection / activation verification failure into a local audit log.
