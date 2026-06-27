# Security Fixes 独数九宫格 v1

File Name: `Security_Fixes_DushuJiugongge_v1.md`
Project Root: `d:\独数九宫格`
Updated At: `2026-06-01`

## Summary 概要

- This document records the concrete code changes applied during the security audit.
- 本文档记录本轮安全审计期间已经实际落地的代码修复。

## Modified Files 已修改文件

1. `register.html`
2. `juanzeng.html`
3. `zixitong.html`
4. `signaling-server.mjs`
5. `static-server.mjs`

## Applied Fixes 已应用修复

### 1. `register.html`

- Replaced direct password persistence with PBKDF2-derived storage format:

```text
pbkdf2$120000$<salt-hex>$<hash-hex>
```

- Added:
  - `bytesToHex(bytes)`
  - `hashPassword(password)`
- Security outcome 安全效果:
  - 中文: 不再把用户输入口令直接写入 `password_hash`。
  - English: Raw user passwords are no longer written directly into storage.

### 2. `juanzeng.html`

- Added `getTrustedOpenerOrigin()` to resolve a trusted opener origin.
- Replaced wildcard message target:

```js
window.opener.postMessage({ type: 'gas-updated', balance: currentBalance }, openerOrigin);
```

- Security outcome 安全效果:
  - 中文: 仅在可证明来源时向主窗口同步余额，关闭 `'*'` 目标广播。
  - English: Balance sync now requires a provable opener origin instead of wildcard delivery.

### 3. `zixitong.html`

- Hardened popup creation:

```js
window.open('register.html', '_blank', 'noopener,noreferrer')
```

- Security outcome 安全效果:
  - 中文: 降低新打开页面反向控制当前页面的风险。
  - English: Reduces reverse-tabnabbing and opener abuse.

### 4. `signaling-server.mjs`

- Added:
  - `RATE_LIMIT_WINDOW_MS = 10000`
  - `MAX_MESSAGES_PER_WINDOW = 120`
- Switched from lifetime counter to windowed rate accounting.
- Applied payload byte-size checks to all incoming messages.
- Deferred room/peer binding until join validation passes.
- Rejected invalid `msg.data` types for relay.
- Security outcome 安全效果:
  - 中文: 提升滥用抗性，避免通过长连接累计消息轻易打掉合法会话。
  - English: Improves abuse resistance and availability under noisy or malicious clients.

### 5. `static-server.mjs`

- Added method allow-list: only `GET` and `HEAD`.
- Added proper `HEAD` handling.
- Applied security headers to redirect responses.
- Security outcome 安全效果:
  - 中文: 收缩静态服务暴露面，避免不必要方法进入文件服务路径。
  - English: Narrows attack surface and keeps hardening headers consistent across redirects.

## Validation 验证

- `GetDiagnostics` returned no diagnostics for:
  - `register.html`
  - `juanzeng.html`
  - `zixitong.html`
  - `signaling-server.mjs`
  - `static-server.mjs`
- `node --check` passed for:
  - `signaling-server.mjs`
  - `static-server.mjs`

## Deferred / Residual Items 延后与残余项

- Client-side auth/activation state remains mutable in browser storage.
- CSP still depends on `'unsafe-inline'`.
- Supabase policy correctness cannot be proven from this repository alone.

## Recommended Next Patch Set 下一组建议补丁

1. Replace inline event handlers with delegated listeners across all HTML pages.
2. Move activation state to signed tokens or server-verified entitlements.
3. Add strict JSON schema validation before any ledger import is accepted.
4. Add integrity/version metadata for exported snapshots.
