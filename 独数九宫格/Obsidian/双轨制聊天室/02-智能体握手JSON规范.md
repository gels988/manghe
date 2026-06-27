# [双轨制聊天室] 智能体握手 JSON 规范

## Handshake_Request
```json
{
  "version": "x402-handshake-v1",
  "route": "agent",
  "agent": {
    "id": "X402-DEMO-001",
    "role": "crawler",
    "intent": "handshake",
    "capabilities": ["json-exchange", "task-sync"]
  },
  "auth": {
    "presented_token": null
  },
  "payment": {
    "mode": "x402",
    "receipt": null,
    "quote_id": "quote-demo-001"
  },
  "session": {
    "nonce": "nonce-demo-001",
    "reply_format": "json"
  }
}
```

## Handshake_Response
```json
{
  "version": "x402-handshake-v1",
  "status": "accepted | payment-required | routed-human | invalid-request",
  "route": "agent-handshake | x402-paywall | human-chat | gateway",
  "gateway": {
    "room": "03",
    "ws_url": "ws://host:8787",
    "human_snapshot": {
      "route": "human",
      "token_type": "Human_Token",
      "activated": true,
      "room": "03",
      "salt_ready": true,
      "bridge_ready": true,
      "ws_connected": true,
      "p2p_connected": false
    }
  },
  "paywall": {
    "http_status": 402,
    "required_scheme": "x402",
    "quote_id": "quote-demo-001"
  },
  "issued_token": {
    "kind": "agent",
    "value": "agent-x402-demo-001-k3f5a9",
    "scope": "x402-handshake",
    "expires_in": 3600
  },
  "errors": [],
  "echo": {
    "agent_id": "X402-DEMO-001",
    "payment_mode": "x402"
  }
}
```

## 规则
- presented_token.kind == human 且有效 -> 直接路由到 human-chat
- receipt.scheme == x402 且 proof 有效 -> 签发 Agent_Token
- 两者都没有 -> 返回 HTTP 402
