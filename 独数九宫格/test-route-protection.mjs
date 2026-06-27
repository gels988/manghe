// 路由保护测试脚本
import http from 'http';

console.log('=== 双轨制聊天室 - 路由保护测试 ===\n');

// 测试 1：无 Token 访问
console.log('【测试 1】无 Token 访问 /api/test');
http.get('http://127.0.0.1:8790/api/test', (res) => {
    console.log(`状态码: ${res.statusCode}`);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(`响应: ${data}\n`);
        
        // 测试 2：访问 /health（无需认证）
        console.log('【测试 2】访问 /health 端点（无需认证）');
        http.get('http://127.0.0.1:8790/health', (res) => {
            console.log(`状态码: ${res.statusCode}`);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`响应: ${data}\n`);
                console.log('✓ 测试完成！');
            });
        });
    });
}).on('error', (err) => {
    console.error(`错误: ${err.message}`);
});
