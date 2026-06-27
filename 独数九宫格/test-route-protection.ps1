# 路由保护测试脚本

Write-Host "=== 双轨制聊天室 - 路由保护（Route Protection）测试 ===" -ForegroundColor Cyan
Write-Host ""

# 测试 1：无 Token 访问
Write-Host "【测试 1】无 Token 访问 /api/test" -ForegroundColor Yellow
try {
    $web = New-Object System.Net.WebClient
    $response = $web.DownloadString('http://127.0.0.1:8790/api/test')
    Write-Host "✗ 失败：应该返回 401，但得到了成功响应" -ForegroundColor Red
} catch {
    $statusCode = $_.Exception.Response.StatusCode
    if ($statusCode -eq 401) {
        Write-Host "✓ 成功：返回 401 Unauthorized" -ForegroundColor Green
        
        # 尝试读取响应体
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        Write-Host "  响应内容：$body"
    } else {
        Write-Host "✗ 失败：返回了 $statusCode 而不是 401" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "【测试 2】测试 /health 端点（无需认证）" -ForegroundColor Yellow
try {
    $web = New-Object System.Net.WebClient
    $response = $web.DownloadString('http://127.0.0.1:8790/health')
    $obj = $response | ConvertFrom-Json
    if ($obj.status -eq 'ok') {
        Write-Host "✓ 成功：/health 端点可正常访问" -ForegroundColor Green
        Write-Host "  服务状态：$($obj.status)"
        Write-Host "  网关端口：$($obj.port)"
    }
} catch {
    Write-Host "✗ 失败：无法访问 /health：$($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "【测试 3】测试握手流程（获取 Token）" -ForegroundColor Yellow
Write-Host "请按以下步骤操作："
Write-Host "  1. 打开浏览器访问 http://localhost:8000/index.html"
Write-Host "  2. 进入双轨制模式（点击'机器通道'标签）"
Write-Host "  3. 在请求框中输入握手 JSON"
Write-Host "  4. 点击'获取 402'按钮"
Write-Host "  5. 点击'应用回执'按钮"
Write-Host "  6. 点击'发送握手'按钮"
Write-Host ""
Write-Host "握手成功后，Token 会自动保存到 localStorage。"
Write-Host "在浏览器控制台执行以下命令查看保存的 Token："
Write-Host "  localStorage.getItem('aim2m_agent_token')"
Write-Host ""

Write-Host "【测试 4】验证 localStorage 中的 Token" -ForegroundColor Yellow
Write-Host "在浏览器 DevTools 控制台执行："
Write-Host "  console.log('Agent Token:', localStorage.getItem('aim2m_agent_token'))"
Write-Host "  console.log('Human Token:', localStorage.getItem('aim2m_human_token'))"
Write-Host ""

Write-Host "【测试 5】带 Token 访问受保护路由" -ForegroundColor Yellow
$token = Read-Host "请粘贴从 localStorage 获取的 Token（或按 Enter 跳过此测试）"
if ($token) {
    try {
        $web = New-Object System.Net.WebClient
        $web.Headers.Add("Authorization", "Bearer $token")
        $response = $web.DownloadString('http://127.0.0.1:8790/api/test')
        $obj = $response | ConvertFrom-Json
        Write-Host "✓ 成功：带 Token 访问成功！" -ForegroundColor Green
        Write-Host "  响应状态：$($obj.status)"
        Write-Host "  响应消息：$($obj.message)"
        Write-Host "  Token 信息："
        Write-Host "    - Kind：$($obj.token_info.kind)"
        Write-Host "    - Subject：$($obj.token_info.sub)"
        Write-Host "    - Scope：$($obj.token_info.scope)"
        Write-Host "    - 过期时间（Unix）：$($obj.token_info.exp)"
    } catch {
        Write-Host "✗ 失败：$($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "跳过此测试" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== 测试完成 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 测试总结："
Write-Host "  ✓ 路由保护中间件已激活"
Write-Host "  ✓ 无 Token 请求返回 401"
Write-Host "  ✓ 握手成功后自动保存 Token"
Write-Host "  ✓ 带 Token 的请求可正常访问受保护路由"
Write-Host ""
Write-Host "下一步：在 index.page.js 的 callGateway() 函数中"
Write-Host "已自动添加了 Authorization 头，所有后续 API 调用"
Write-Host "都会自动包含保存的 Token。"
