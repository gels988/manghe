# 路由保护（Route Protection）实施指南

## 修改概述

已为双轨制聊天室成功添加了"路由保护"中间件，拦截所有非法请求。

## 第一步：后端修改（gateway-server.mjs）

### 1.1 添加 Token 存储空间
**位置：** 第 9 行（导入部分后）
```javascript
const activeTokens = new Map();
```
作用：保存所有活跃的有效 Token，用于 /api/ 路由认证。

### 1.2 添加认证中间件函数
**位置：** 第 30 行（json 函数之后）
```javascript
function authMiddleware(req, res, pathname){
    // 检查是否是受保护的路由（/api/ 开头）
    if(!pathname.startsWith('/api/')){
        return { authorized: true };
    }
    
    // 从请求头获取 Authorization
    const authHeader = req.headers['authorization'] || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    
    if(!match || !match[1]){
        json(res, 401, { error: 'Invalid or missing Token' });
        return { authorized: false };
    }
    
    const token = match[1].trim();
    
    // 简单验证：token 非空即有效（后续可升级为完整验证）
    if(!token){
        json(res, 401, { error: 'Invalid or missing Token' });
        return { authorized: false };
    }
    
    // 验证 token 是否在活跃列表中
    const tokenData = activeTokens.get(token);
    if(!tokenData){
        json(res, 401, { error: 'Invalid or missing Token' });
        return { authorized: false };
    }
    
    // 检查 token 是否过期
    if(tokenData.exp && tokenData.exp < Math.floor(Date.now() / 1000)){
        json(res, 401, { error: 'Invalid or missing Token' });
        return { authorized: false };
    }
    
    return { authorized: true, tokenData };
}
```
作用：检查请求头中的 `Authorization: Bearer <Token>`，验证 Token 有效性。

### 1.3 在握手成功时保存 Token
**位置：** /handshake 端点（返回 200 时）

已修改两处地方：
- 人类通道成功激活时
- 智能体回执有效时

添加了：
```javascript
const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
activeTokens.set(token, payload);
```

### 1.4 添加受保护的 /api/test 路由
**位置：** /handshake 之后

```javascript
// 受保护的 /api/ 路由认证检查
const authCheck = authMiddleware(req, res, url.pathname);
if(!authCheck.authorized){
    return;
}

if(req.method === 'GET' && url.pathname === '/api/test'){
    json(res, 200, {
        status: 'success',
        message: 'Protected API route accessed successfully',
        token_info: authCheck.tokenData
    });
    return;
}
```

## 第二步：前端修改（index.page.js）

### 2.1 扩展 STORAGE_KEYS
**位置：** 第 115 行（STORAGE_KEYS 对象）

添加了两个新的存储键：
```javascript
agentToken: 'aim2m_agent_token',
humanToken: 'aim2m_human_token'
```

### 2.2 修改 callGateway 函数
**位置：** 第 1807 行（callGateway 函数）

现在会自动从 localStorage 获取 Token 并添加到请求头：
```javascript
async function callGateway(path, payload){
    // 构建请求头，自动添加 Authorization
    const headers = { 'Content-Type': 'application/json' };
    
    // 尝试从 localStorage 获取有效的 token
    const agentToken = localStorage.getItem(STORAGE_KEYS.agentToken);
    const humanToken = localStorage.getItem(STORAGE_KEYS.humanToken);
    const activeToken = agentToken || humanToken;
    
    if(activeToken){
        headers['Authorization'] = `Bearer ${activeToken}`;
    }
    
    // ... 后续 fetch 逻辑
}
```

### 2.3 握手成功后自动保存 Token
**位置：** previewAgentHandshake() 函数（第 1895 行）

握手成功时保存 Token：
```javascript
// 握手成功后保存 token
if(result.status === 200 && result.data && result.data.issued_token){
    const issuedToken = result.data.issued_token;
    if(issuedToken.kind === 'agent'){
        localStorage.setItem(STORAGE_KEYS.agentToken, issuedToken.value);
    }else if(issuedToken.kind === 'human'){
        localStorage.setItem(STORAGE_KEYS.humanToken, issuedToken.value);
    }
}
```

**位置：** requestHumanGatewayToken() 函数（第 1968 行）

人类通道握手成功时也保存 Token。

## 工作流程

1. **无 Token 请求**
   ```
   GET /api/test
   → 401 Unauthorized: { error: "Invalid or missing Token" }
   ```

2. **握手请求**
   ```
   POST /handshake (身份+激活码 或 X402回执)
   → 200 OK: { issued_token: { kind: "human|agent", value: "..." } }
   → 前端自动保存 Token 到 localStorage
   ```

3. **后续带 Token 请求**
   ```
   GET /api/test
   Authorization: Bearer <Token>
   → 200 OK: { status: "success", token_info: {...} }
   ```

## 测试方法

### 步骤 1：重启网关服务
```bash
# 终端中按 Ctrl+C 停止当前服务
# 然后重新启动
npm run gateway
```

### 步骤 2：测试 - 无 Token 访问（应返回 401）
在浏览器地址栏访问：
```
http://127.0.0.1:8790/api/test
```

预期响应：
```json
{
  "error": "Invalid or missing Token"
}
```
HTTP 状态码：**401 Unauthorized**

### 步骤 3：正常握手流程（获取 Token）
1. 打开 http://localhost:8000/index.html
2. 进入"双轨制"模式（点击"机器通道"）
3. 点击"获取 402"按钮
4. 填入发开的 `dev_receipt_example`
5. 点击"发送握手"
6. 成功后，Token 会自动保存到 localStorage

### 步骤 4：验证 Token 已保存
在浏览器控制台执行：
```javascript
localStorage.getItem('aim2m_agent_token')
// 应该返回长字符串，类似：
// "eyJraW5kIjoiYWdlbnQiLC..." (base64url编码)
```

### 步骤 5：测试 - 有 Token 访问（应返回 200）
再次访问受保护的路由，这次会自动添加 Token 头：
```
http://127.0.0.1:8790/api/test
```

预期响应：
```json
{
  "status": "success",
  "message": "Protected API route accessed successfully",
  "token_info": {
    "kind": "agent",
    "sub": "X402-DEMO-001",
    "scope": "agent-handshake",
    "iat": 1718051234,
    "exp": 1718054834,
    "quote_id": "quote_abc123"
  }
}
```
HTTP 状态码：**200 OK**

## 核心加密逻辑保持不变 ✓

- ✓ `verifyToken()` 函数：HMAC-SHA256 签名验证逻辑未改动
- ✓ `issueToken()` 函数：Token 生成逻辑未改动  
- ✓ `verifyHumanVoucher()` 函数：离线激活码验证逻辑未改动
- ✓ `computeKeygenCode()` 函数：密钥生成逻辑未改动
- ✓ `verifyReceipt()` 函数：X402 回执验证逻辑未改动

所有修改都只是在这些核心函数之外添加了**认证检查层**，不影响现有的加密和验证逻辑。

## 下一步优化（可选）

1. **Token 撤销表**：在 /logout 端点中从 activeTokens 删除 Token
2. **刷新机制**：添加 /refresh 端点来续期 Token
3. **权限控制**：在 authMiddleware 中检查 Token 的 scope 字段
4. **持久化**：使用数据库（如 SQLite）替代内存 Map

---

修改完成！系统已准备好进行路由保护的完整测试。
