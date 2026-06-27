# Security Audit Report 独数九宫格 v2

File Name: `Security_Audit_Report_DushuJiugongge_v2.md`
Project Root: `d:\独数九宫格`
Audit Date: `2026-06-01`
Audit Scope: second-pass hardening for inline event removal, CSP tightening, snapshot schema validation, and activation-state signing

## 1. Executive Summary 执行摘要

- Overall Risk Level 总体风险等级: `Medium`
- Critical / High Findings Count 关键/高危数量: `Critical 0 / High 0 unresolved`
- This Round 本轮新增完成项:
  - 全页面移除内联 `onclick`
  - CSP 升级为 `script nonce + script-src-attr 'none'`
  - 账本导入加入 JSON Schema 风格校验与大小边界
  - 激活态加入本地签名校验与旧状态迁移
- Production Readiness 生产结论:
  - 中文: 代码层面的 DOM 事件注入面已进一步收缩，脚本执行面已从 `unsafe-inline` 收紧到 nonce 模式，账本导入前会执行结构校验。残余风险主要来自本地优先架构本身，不来自本轮新增代码缺陷。
  - English: DOM event injection surface is reduced, script execution is tightened from `unsafe-inline` to nonce mode, and ledger import now validates structure before merge. Residual risk is architectural and local-trust related rather than a new code-level defect from this round.

## 2. Methodology 审计方法论

- White-box static review 白盒静态审计
- Focused hardening review 重点加固复审
- IDE diagnostics on edited files 已编辑文件诊断
- Runtime verification 运行验证:
  - `node --check static-server.mjs`
  - `node --check signaling-server.mjs`
  - HEAD request against local test server on port `8010`
  - HTML content check for injected `nonce` on `<script>` tags

## 3. Trust Model 信任模型

- Trusted only after verification 仅在验证后信任:
  - Imported ledger JSON
  - Browser activation state
  - Cross-page button invocation
- Residual architectural trust 仍保留的架构信任:
  - Browser local storage remains user-controlled
  - Client code still contains signing logic and cannot replace a server-side entitlement system

## 4. Core Logic Security 核心逻辑安全

- Event handling 事件处理:
  - All inline `onclick` handlers were replaced with explicit `addEventListener` bindings.
  - This removes compatibility pressure that previously forced weaker `script-src` policy.
- Ledger import 账本导入:
  - Snapshot import and conflict preview now reject structurally invalid objects before touching storage.
- Activation state 激活态:
  - Activation now writes a signature marker and verification checks it before treating the browser as activated.
  - Legacy activation state is upgraded forward on load for compatibility.

## 5. Data Security 数据安全

- Import integrity 导入完整性:
  - Store row counts, object shape, scalar types, and local-state sizes are validated.
- Browser state tamper evidence 本地状态防篡改痕迹:
  - `aim2m_activation_sig` is now included in exported/imported state and revalidated on use.

## 6. Identity & Access Control 身份与访问控制

- Improvement 改进:
  - Main UI no longer trusts activation purely because `aim2m_activated=1`.
  - Verified state now depends on signature validation via `MayijuSecurity.verifyActivationState()`.
- Limitation 局限:
  - This is tamper-evident, not tamper-proof. A determined local attacker with code access can still forge state.

## 7. Attack Resilience 抗攻击能力

- CSP Hardening CSP 加固:
  - `script-src 'self' 'nonce-...'`
  - `script-src-attr 'none'`
  - `form-action 'self'`
- UI Invocation Hardening UI 触发面收缩:
  - No remaining inline `onclick` in HTML pages.

## 8. Vulnerability Findings 漏洞清单 (CVSS 3.1)

| ID | Title 标题 | Severity 严重性 | Status 状态 | Evidence 证据 | Remediation 修复 |
|---|---|---|---|---|---|
| SEC-V2-001 | Inline event handler execution surface 内联事件执行面 | Medium | Remediated 已修复 | Full-folder HTML grep returned no `onclick=` after patch. | Replaced with `addEventListener` bindings across `index`, `register`, `juanzeng`, `zixitong`, `zijian`. |
| SEC-V2-002 | Overly permissive script CSP 过宽脚本 CSP | High | Remediated 已修复 | Local HEAD response shows `script-src 'self' 'nonce-...'` and `script-src-attr 'none'`. | Static server now injects per-response nonce into HTML `<script>` tags and serves a stricter CSP. |
| SEC-V2-003 | Unschematized ledger import 未经结构约束的账本导入 | High | Remediated 已修复 | `validateSnapshotSchema()` guards `importSnapshot()` and `previewImportConflicts()`. | Added schema-like validation, store row limits, state-size limits, and plain-object checks. |
| SEC-V2-004 | Activation flag trusted without verification 未校验即信任激活态 | Medium | Remediated 已修复 | Main UI now calls `verifyActivationState()` and local state stores `aim2m_activation_sig`. | Added local signing, verification, and legacy upgrade path in `shared_identity.js`. |

## 9. Security Maturity Score 安全成熟度 (1-10)

- Overall Score 总分: `7.0 / 10`
- Architecture 架构: `5.8`
- Code Quality 代码质量: `7.8`
- Monitoring 监控: `5.8`
- Transparency 透明性: `7.5`
- Recovery / Compatibility 恢复与兼容: `8.0`

## 10. Residual Risks 残余风险

- Residual-01:
  - 中文: 本地签名只能提供“简易防篡改”，不能替代真正的服务端许可证或离线签名公钥体系。
  - English: Local signing is tamper-evident only and cannot replace a server-issued entitlement or offline public-key verification model.
- Residual-02:
  - 中文: `style-src` 仍保留 `'unsafe-inline'`，因为页面还大量依赖行内样式。
  - English: `style-src` still allows `'unsafe-inline'` because the UI still depends heavily on inline styles.

## 11. Verification Evidence 验证证据

- `onclick=` grep across `*.html`: no matches
- `GetDiagnostics`: no new diagnostics in edited files
- `node --check static-server.mjs`: passed
- `node --check signaling-server.mjs`: passed
- Local HEAD response on `http://127.0.0.1:8010/register.html`: CSP nonce present
- Local HTML body check: injected `nonce` found on both external and inline `<script>` tags

## 12. 15-Minute Next Actions 15分钟下一步

1. Remove inline `style=""` attributes and move them into CSS classes so `style-src` can also drop `'unsafe-inline'`.
2. Replace local activation checksum with offline asymmetric signature verification if a signer/private key workflow exists.
3. Add per-store versioning and snapshot checksum to exported ledger packages.
4. Add explicit audit log entries for import rejection and signature mismatch.
