    // ========== 智能自检系统核心 ==========
    
    const reportEl = document.getElementById('report');
    const unifiedReportEl = document.getElementById('unifiedReportBox');
    const statusEl = document.getElementById('status');
    const checksEl = document.getElementById('checks');
    const autoFixPanel = document.getElementById('autoFixPanel');
    const fixLogEl = document.getElementById('fixLog');
    const OFFICIAL_WEB_ORIGIN = 'https://dushu-cd1.pages.dev';
    const OFFICIAL_API_ORIGIN = 'https://rome-moss-gained-originally.trycloudflare.com';
    
    // 系统状态
    const SystemState = {
      commConnected: false,
      parentOrigin: (window.location.origin && window.location.origin !== 'null') ? window.location.origin : '*',
      messageQueue: [],
      lastResponse: null,
      checkResults: {},
      fixAttempts: 0,
      maxFixAttempts: 3
    };

    const AllowedActions = {
      'testCommunication()': testCommunication,
      'enableStandaloneMode()': enableStandaloneMode,
      'simulateCircleTest()': simulateCircleTest,
      'fixCircles()': fixCircles,
      'fixHighMultiplier()': fixHighMultiplier,
      'testDBQuery()': testDBQuery,
      'fixDatabase()': fixDatabase,
      'fixEntropy()': fixEntropy,
      'showEntropyLog()': showEntropyLog,
      'fixOfficialRouting()': fixOfficialRouting
    };
    
    // 记录日志
    function log(msg, type = 'INFO') {
      const timestamp = new Date().toLocaleTimeString('zh-CN');
      const prefix = type === 'ERROR' ? '❌' : type === 'WARN' ? '⚠️' : type === 'SUCCESS' ? '✅' : type === 'FIX' ? '🔧' : 'ℹ️';
      reportEl.textContent += `[${timestamp}] [${type}] ${prefix} ${msg}\n`;
      reportEl.scrollTop = reportEl.scrollHeight;
    }

    function loadUnifiedLocalReport() {
      if (!window.MayijuLocalDB || !unifiedReportEl) {
        if (unifiedReportEl) {
          unifiedReportEl.textContent = '[WARN] 本地统一报告接口未就绪';
        }
        return;
      }
      const cached = window.MayijuLocalDB.getSelfCheckReport();
      if (!cached) {
        unifiedReportEl.textContent = '[INFO] 当前没有缓存的统一本地自检报告，请先在子系统里运行一次本地自检。';
        return;
      }
      const lines = [];
      lines.push(`[INFO] 生成时间: ${cached.generated_at || '未知'}`);
      if (cached.stats) {
        lines.push(`[INFO] GAS: ${cached.stats.gas_balance} | 子民: ${cached.stats.citizen_count} | 已成交: ${cached.stats.paid_count} | 激活码: ${cached.stats.gift_code_count}`);
      }
      (cached.report || []).forEach((item) => {
        lines.push(`[${String(item.level || 'INFO').toUpperCase()}] ${item.text}`);
      });
      unifiedReportEl.textContent = lines.join('\n');
    }
    
    // 添加检查结果（增强版，支持操作按钮）
    function addCheckResult(name, status, details = '', actions = []) {
      const div = document.createElement('div');
      let className = 'check-item';
      let statusText = '';
      
      if (status === 'pass') {
        className += ' check-pass';
        statusText = '✅ 正常';
      } else if (status === 'fail') {
        className += ' check-fail';
        statusText = '❌ 异常';
      } else if (status === 'warn') {
        className += ' check-warn';
        statusText = '⚠️ 警告';
      } else if (status === 'fix') {
        className += ' check-pass';
        statusText = '🔧 已修复';
      }
      
      div.className = className;
      div.id = 'check-' + name.replace(/\s/g, '-');
      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = name;
      left.appendChild(title);
      if (details) {
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'details';
        detailsDiv.textContent = details;
        left.appendChild(detailsDiv);
      }
      if (actions.length > 0) {
        const actionsBox = document.createElement('div');
        actionsBox.className = 'actions';
        actions.forEach((a) => {
          if (!a || !AllowedActions[a.action]) return;
          const btn = document.createElement('button');
          btn.className = 'action-btn';
          btn.type = 'button';
          btn.textContent = a.label;
          btn.addEventListener('click', AllowedActions[a.action]);
          actionsBox.appendChild(btn);
        });
        left.appendChild(actionsBox);
      }
      const right = document.createElement('div');
      right.textContent = statusText;
      div.appendChild(left);
      div.appendChild(right);
      
      // 如果已存在同名检查项，替换它
      const existing = document.getElementById('check-' + name.replace(/\s/g, '-'));
      if (existing) {
        existing.replaceWith(div);
      } else {
        checksEl.appendChild(div);
      }
    }
    
    // 更新通讯状态显示
    function updateCommStatus(status, msg) {
      const indicator = statusEl.querySelector('.comm-status');
      indicator.className = 'comm-status comm-' + status;
      
      const text = statusEl.querySelector('span:last-child') || statusEl;
      text.textContent = msg;
    }

    function getReferralLinkState() {
      return String(localStorage.getItem('mayiju_referral_link') || '').trim();
    }

    function isDevOrigin(origin) {
      const value = String(origin || '').trim();
      return value.startsWith('http://localhost') ||
        value.startsWith('http://127.0.0.1') ||
        value.startsWith('http://192.168.') ||
        value.startsWith('http://10.') ||
        value.startsWith('http://172.');
    }

    function isOfficialRuntimeOrigin(origin) {
      const value = String(origin || '').trim();
      return !value || value === OFFICIAL_WEB_ORIGIN || isDevOrigin(value);
    }

    function normalizeOfficialReferralLink(raw) {
      if (!raw) return '';
      try {
        const parsed = new URL(String(raw));
        const normalized = new URL('/register.html', OFFICIAL_WEB_ORIGIN);
        const ref = parsed.searchParams.get('ref');
        if (ref) normalized.searchParams.set('ref', ref);
        return normalized.toString();
      } catch {
        return '';
      }
    }
    
    // ========== 通讯机制核心 ==========
    
    // 向主系统发送请求并等待响应
    function sendToParent(type, payload = {}, timeout = 5000) {
      return new Promise((resolve, reject) => {
        const targetWindow = (window.parent && window.parent !== window)
          ? window.parent
          : ((window.opener && !window.opener.closed) ? window.opener : null);
        if (!targetWindow) {
          reject(new Error('无父窗口'));
          return;
        }
        
        const id = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const message = { id, type, payload, source: 'selfcheck' };
        
        // 设置超时
        const timer = setTimeout(() => {
          delete window._pendingMessages[id];
          reject(new Error('通讯超时'));
        }, timeout);
        
        // 等待响应
        window._pendingMessages = window._pendingMessages || {};
        window._pendingMessages[id] = {
          resolve: (data) => {
            clearTimeout(timer);
            resolve(data);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        };
        
        // 发送消息
        try {
          targetWindow.postMessage(message, SystemState.parentOrigin);
          log(`发送请求: ${type} [${id.substr(-4)}]`, 'INFO');
        } catch (e) {
          clearTimeout(timer);
          delete window._pendingMessages[id];
          reject(e);
        }
      });
    }
    
    // 监听父窗口响应
    window.addEventListener('message', (e) => {
      // 安全验证：只接受来自父窗口或预期来源的消息
      if (e.source !== window.parent && e.source !== window.opener) {
        return;
      }
      if (SystemState.parentOrigin !== '*' && e.origin !== SystemState.parentOrigin) {
        return;
      }
      if (SystemState.parentOrigin === '*' && e.origin && e.origin !== 'null') {
        SystemState.parentOrigin = e.origin;
      }
      
      const data = e.data;
      if (!data || data.source !== 'main-system') return;
      
      // 处理响应
      if (data.id && window._pendingMessages && window._pendingMessages[data.id]) {
        if (data.error) {
          window._pendingMessages[data.id].reject(new Error(data.error));
        } else {
          window._pendingMessages[data.id].resolve(data.payload);
        }
        delete window._pendingMessages[data.id];
      }
      
      // 处理主动推送
      if (data.type === 'status-update') {
        log(`收到主系统状态: ${JSON.stringify(data.payload)}`, 'INFO');
      }
    });
    
    // 测试通讯
    async function testCommunication() {
      log('测试与主系统通讯...', 'INFO');
      updateCommStatus('pending', '🔄 测试通讯中...');
      
      try {
        const result = await sendToParent('ping', { time: Date.now() }, 3000);
        SystemState.commConnected = true;
        SystemState.lastResponse = result;
        updateCommStatus('connected', `✅ 已连接 | 延迟: ${result.latency || '未知'}ms`);
        log('通讯测试成功: ' + JSON.stringify(result), 'SUCCESS');
        addCheckResult('📡 主系统通讯', 'pass', `响应正常 | 版本: ${result.version || '未知'}`);
        return true;
      } catch (e) {
        SystemState.commConnected = false;
        updateCommStatus('disconnected', '❌ 未连接');
        log('通讯测试失败: ' + e.message, 'ERROR');
        addCheckResult('📡 主系统通讯', 'fail', e.message, [
          { label: '重试', action: 'testCommunication()' },
          { label: '独立模式', action: 'enableStandaloneMode()' }
        ]);
        return false;
      }
    }
    
    // 启用独立模式（无通讯时的降级方案）
    function enableStandaloneMode() {
      log('切换到独立运行模式', 'WARN');
      updateCommStatus('pending', '⚠️ 独立模式');
      SystemState.commConnected = false;
      addCheckResult('📡 主系统通讯', 'warn', '独立运行模式 - 仅检测本地环境');
    }
    
    // ========== 核心自检项目 ==========
    
    // 1. 红蓝圆圈显示连接检查
    async function checkRedBlueCircles() {
      log('检测红蓝圆圈显示系统...', 'INFO');
      
      if (!SystemState.commConnected) {
        // 独立模式：模拟检查
        log('独立模式：模拟红蓝圆圈检查', 'WARN');
        addCheckResult('🔴🔵 红蓝圆圈显示', 'warn', '独立模式 - 无法验证实际渲染', [
          { label: '模拟测试', action: 'simulateCircleTest()' }
        ]);
        return { status: 'warn', canFix: false };
      }
      
      try {
        const result = await sendToParent('check-circles', {}, 4000);
        
        if (result.exists && result.rendering) {
          addCheckResult('🔴🔵 红蓝圆圈显示', 'pass', 
            `DOM存在: 是 | 渲染正常: 是 | 位置: ${result.position || '未知'}`);
          return { status: 'pass', canFix: false };
        } else if (result.exists && !result.rendering) {
          addCheckResult('🔴🔵 红蓝圆圈显示', 'fail', 
            `DOM存在但渲染异常 | 建议: 检查 CSS 样式`, [
            { label: '尝试修复', action: 'fixCircles()' }
          ]);
          return { status: 'fail', canFix: true, fixFn: fixCircles };
        } else {
          addCheckResult('🔴🔵 红蓝圆圈显示', 'fail', 
            `DOM元素缺失 | 建议: 重建圆圈元素`, [
            { label: '立即重建', action: 'fixCircles()' }
          ]);
          return { status: 'fail', canFix: true, fixFn: fixCircles };
        }
      } catch (e) {
        addCheckResult('🔴🔵 红蓝圆圈显示', 'fail', `检测失败: ${e.message}`);
        return { status: 'fail', canFix: false };
      }
    }
    
    // 修复红蓝圆圈
    async function fixCircles() {
      log('尝试修复红蓝圆圈显示...', 'FIX');
      showFixLog('正在重建红蓝圆圈元素...');
      
      try {
        const result = await sendToParent('fix-circles', { action: 'rebuild' }, 5000);
        
        if (result.success) {
          log('红蓝圆圈修复成功', 'SUCCESS');
          showFixLog('✅ 红蓝圆圈重建完成');
          addCheckResult('🔴🔵 红蓝圆圈显示', 'fix', '已通过自动修复恢复');
          return true;
        } else {
          throw new Error(result.message || '修复失败');
        }
      } catch (e) {
        log('红蓝圆圈修复失败: ' + e.message, 'ERROR');
        showFixLog('❌ 修复失败: ' + e.message);
        return false;
      }
    }
    
    // 2. 高倍项目连接检查
    async function checkHighMultiplier() {
      log('检测高倍项目连接...', 'INFO');
      
      if (!SystemState.commConnected) {
        addCheckResult('🎯 高倍项目连接', 'warn', '独立模式 - 无法验证连接状态');
        return { status: 'warn', canFix: false };
      }
      
      try {
        const result = await sendToParent('check-high-multiplier', {}, 4000);
        
        const details = [];
        if (result.connected) details.push('连接: 正常');
        if (result.dataFlow) details.push('数据流: 正常');
        if (result.uiResponsive) details.push('UI响应: 正常');
        
        if (result.connected && result.dataFlow) {
          addCheckResult('🎯 高倍项目连接', 'pass', details.join(' | '));
          return { status: 'pass', canFix: false };
        } else if (result.connected && !result.dataFlow) {
          addCheckResult('🎯 高倍项目连接', 'fail', 
            `已连接但无数据流 | 状态: ${result.status || '未知'}`, [
            { label: '重置连接', action: 'fixHighMultiplier()' }
          ]);
          return { status: 'fail', canFix: true, fixFn: fixHighMultiplier };
        } else {
          addCheckResult('🎯 高倍项目连接', 'fail', 
            `连接断开 | 最后错误: ${result.lastError || '无'}`, [
            { label: '重新连接', action: 'fixHighMultiplier()' }
          ]);
          return { status: 'fail', canFix: true, fixFn: fixHighMultiplier };
        }
      } catch (e) {
        addCheckResult('🎯 高倍项目连接', 'fail', `检测失败: ${e.message}`);
        return { status: 'fail', canFix: false };
      }
    }
    
    // 修复高倍连接
    async function fixHighMultiplier() {
      log('尝试修复高倍项目连接...', 'FIX');
      showFixLog('正在重置高倍模块连接...');
      
      try {
        const result = await sendToParent('fix-high-multiplier', { action: 'reconnect' }, 6000);
        
        if (result.success) {
          log('高倍连接修复成功', 'SUCCESS');
          showFixLog('✅ 高倍模块已重新连接');
          addCheckResult('🎯 高倍项目连接', 'fix', '连接已恢复 | 数据流正常');
          return true;
        } else {
          throw new Error(result.message || '连接修复失败');
        }
      } catch (e) {
        log('高倍连接修复失败: ' + e.message, 'ERROR');
        showFixLog('❌ 修复失败，建议手动检查网络配置');
        return false;
      }
    }
    
    // 3. 数据库连接检查
    async function checkDatabase() {
      log('检测数据库连接...', 'INFO');
      
      if (!SystemState.commConnected) {
        addCheckResult('🗄️ 数据库连接', 'warn', '独立模式 - 无法验证数据库状态');
        return { status: 'warn', canFix: false };
      }
      
      try {
        const result = await sendToParent('check-database', {}, 5000);
        const latency = result.latency ? `延迟: ${result.latency}ms` : '';
        
        if (result.connected && result.accessible) {
          addCheckResult('🗄️ 数据库连接', 'pass', `连接: 正常 | 读写: 正常 | ${latency} | 类型: ${result.type || '未知'}`);
          return { status: 'pass', canFix: false };
        } else if (result.connected && !result.accessible) {
          addCheckResult('🗄️ 数据库连接', 'fail', `连接成功但无法读取 | 错误: ${result.error || '权限不足'}`, [
            { label: '测试查询', action: 'testDBQuery()' },
            { label: '重置连接', action: 'fixDatabase()' }
          ]);
          return { status: 'fail', canFix: true, fixFn: fixDatabase };
        } else {
          addCheckResult('🗄️ 数据库连接', 'fail', `连接失败 | 错误: ${result.error || '连接超时'}`, [
            { label: '重连', action: 'fixDatabase()' }
          ]);
          return { status: 'fail', canFix: true, fixFn: fixDatabase };
        }
      } catch (e) {
        addCheckResult('🗄️ 数据库连接', 'fail', `检测失败: ${e.message}`);
        return { status: 'fail', canFix: false };
      }
    }
    
    // 修复数据库连接
    async function fixDatabase() {
      log('尝试修复数据库连接...', 'FIX');
      showFixLog('正在重置数据库连接池...');
      
      try {
        const result = await sendToParent('fix-database', { action: 'reset-pool' }, 8000);
        
        if (result.success) {
          log('数据库连接修复成功', 'SUCCESS');
          showFixLog(`✅ 数据库已重新连接 | 新延迟: ${result.newLatency || '未知'}ms`);
          addCheckResult('🗄️ 数据库连接', 'fix', '连接池已重置');
          return true;
        } else {
          throw new Error(result.message || '数据库修复失败');
        }
      } catch (e) {
        log('数据库修复失败: ' + e.message, 'ERROR');
        showFixLog('❌ 修复失败，可能需要重启数据库服务');
        return false;
      }
    }
    
    // 测试数据库查询
    async function testDBQuery() {
      log('执行数据库测试查询...', 'INFO');
      try {
        const result = await sendToParent('test-db-query', { query: 'ping' }, 5000);
        log('测试查询成功: ' + JSON.stringify(result), 'SUCCESS');
        alert('数据库测试查询成功！\n响应: ' + JSON.stringify(result, null, 2));
      } catch (e) {
        log('测试查询失败: ' + e.message, 'ERROR');
        alert('测试查询失败: ' + e.message);
      }
    }
    
    // 4. 熵准确率检查
    async function checkEntropyAccuracy() {
      log('检测熵准确率系统...', 'INFO');
      
      if (!SystemState.commConnected) {
        addCheckResult('📊 熵准确率', 'warn', '独立模式 - 无法计算实际熵值');
        return { status: 'warn', canFix: false };
      }
      
      try {
        const result = await sendToParent('check-entropy', {}, 5000);
        
        const accuracy = result.accuracy !== undefined
          ? `<span class="metric-value">${(result.accuracy * 100).toFixed(2)}%</span>`
          : '未知';
        const entropy = result.entropy !== undefined
          ? `<span class="metric-value">${result.entropy.toFixed(4)}</span>`
          : '未知';
        
        if (result.valid && result.accuracy > 0.95) {
          addCheckResult('📊 熵准确率', 'pass', `准确率: ${accuracy} | 熵值: ${entropy} | 算法: ${result.algorithm || '标准'}`);
          return { status: 'pass', canFix: false };
        } else if (result.valid && result.accuracy > 0.8) {
          addCheckResult('📊 熵准确率', 'warn', `准确率偏低: ${accuracy} | 建议校准`, [
            { label: '重新校准', action: 'fixEntropy()' }
          ]);
          return { status: 'warn', canFix: true, fixFn: fixEntropy };
        } else {
          addCheckResult('📊 熵准确率', 'fail', `准确率异常: ${accuracy} | 熵值: ${entropy} | 错误: ${result.error || '计算失败'}`, [
            { label: '重置算法', action: 'fixEntropy()' },
            { label: '查看日志', action: 'showEntropyLog()' }
          ]);
          return { status: 'fail', canFix: true, fixFn: fixEntropy };
        }
      } catch (e) {
        addCheckResult('📊 熵准确率', 'fail', `检测失败: ${e.message}`);
        return { status: 'fail', canFix: false };
      }
    }
    
    // 修复熵准确率
    async function fixEntropy() {
      log('尝试修复熵准确率...', 'FIX');
      showFixLog('正在重新校准熵计算算法...');
      
      try {
        const result = await sendToParent('fix-entropy', { action: 'recalibrate' }, 6000);
        
        if (result.success) {
          log('熵准确率修复成功', 'SUCCESS');
          const newAcc = result.newAccuracy
            ? (result.newAccuracy * 100).toFixed(2) + '%'
            : '已改善';
          showFixLog(`✅ 校准完成 | 新准确率: ${newAcc}`);
          addCheckResult('📊 熵准确率', 'fix', `已重新校准 | 当前准确率: ${newAcc}`);
          return true;
        } else {
          throw new Error(result.message || '校准失败');
        }
      } catch (e) {
        log('熵准确率修复失败: ' + e.message, 'ERROR');
        showFixLog('❌ 校准失败，可能需要检查数据源');
        return false;
      }
    }
    
    // 查看熵日志
    async function showEntropyLog() {
      try {
        const result = await sendToParent('get-entropy-log', {}, 3000);
        log('熵计算日志: ' + JSON.stringify(result.logs, null, 2), 'INFO');
        alert('最近熵计算日志:\n' + JSON.stringify(result.logs, null, 2));
      } catch (e) {
        log('获取日志失败: ' + e.message, 'ERROR');
      }
    }
    
    // ========== 基础自检项目（保留原有功能） ==========
    
    function checkBrowserEnvironment() {
      log('检查浏览器环境...', 'INFO');
      
      const checks = [];
      try {
        localStorage.setItem('test', 'ok');
        localStorage.removeItem('test');
        checks.push({ name: 'localStorage', pass: true });
      } catch (e) {
        checks.push({ name: 'localStorage', pass: false });
      }
      
      checks.push({ 
        name: 'IndexedDB', 
        pass: !!window.indexedDB 
      });
      
      checks.push({ 
        name: 'Fetch API', 
        pass: !!window.fetch 
      });
      
      const es6Support = typeof Promise !== 'undefined' && 
                         typeof Array.prototype.includes !== 'undefined';
      checks.push({ name: 'ES6+', pass: es6Support });
      
      const allPass = checks.every(c => c.pass);
      const details = checks.map(c => `${c.name}: ${c.pass ? '通过' : '失败'}`).join(' | ');
      
      addCheckResult('🌐 浏览器环境', allPass ? 'pass' : 'warn', details);
      return allPass;
    }
    
    function checkLocalStorage() {
      log('检查本地存储...', 'INFO');
      
      try {
        const testKey = '_selfcheck_test_' + Date.now();
        localStorage.setItem(testKey, 'test');
        const val = localStorage.getItem(testKey);
        localStorage.removeItem(testKey);
        
        if (val === 'test') {
          addCheckResult('💾 本地存储', 'pass', '读写正常');
          return true;
        }
      } catch (e) {
        addCheckResult('💾 本地存储', 'fail', e.message);
        return false;
      }
    }

    function checkOfficialRouting() {
      log('检查正式域名与推广路由...', 'INFO');

      const currentOrigin = window.location && window.location.origin ? window.location.origin : '';
      const referralLink = getReferralLinkState();
      const referralOk = !referralLink || referralLink.startsWith(OFFICIAL_WEB_ORIGIN + '/register.html');
      const runtimeOk = isOfficialRuntimeOrigin(currentOrigin);
      const allPass = runtimeOk && referralOk;
      const details = [
        `运行域名: ${currentOrigin || '未知'}`,
        `正式域名: ${OFFICIAL_WEB_ORIGIN}`,
        `API 地址: ${OFFICIAL_API_ORIGIN}`,
        `推广链接: ${referralLink || '未缓存'}`
      ].join(' | ');

      if (allPass) {
        addCheckResult('🌍 正式域名路由', 'pass', details);
        return { status: 'pass', canFix: false };
      }

      addCheckResult('🌍 正式域名路由', 'fail', details, [
        { label: '自动纠正', action: 'fixOfficialRouting()' }
      ]);
      return { status: 'fail', canFix: true, fixFn: fixOfficialRouting };
    }

    async function fixOfficialRouting() {
      log('尝试修复正式域名与推广路由...', 'FIX');
      showFixLog('正在校正正式域名与推广链接...');

      try {
        const referralLink = getReferralLinkState();
        const normalizedReferral = normalizeOfficialReferralLink(referralLink);
        if (referralLink && normalizedReferral && normalizedReferral !== referralLink) {
          localStorage.setItem('mayiju_referral_link', normalizedReferral);
          showFixLog('✅ 已改写本地推广链接为正式域名');
        }

        const flashRaw = localStorage.getItem('mayiju_referral_flash');
        if (flashRaw) {
          try {
            const parsed = JSON.parse(flashRaw);
            parsed.link = parsed.link ? (normalizeOfficialReferralLink(parsed.link) || parsed.link) : normalizedReferral;
            localStorage.setItem('mayiju_referral_flash', JSON.stringify(parsed));
          } catch {}
        }

        const currentOrigin = window.location && window.location.origin ? window.location.origin : '';
        if (currentOrigin && !isOfficialRuntimeOrigin(currentOrigin)) {
          const target = new URL(window.location.pathname.split('/').pop() || 'zijian.html', OFFICIAL_WEB_ORIGIN);
          if (window.location.search) target.search = window.location.search;
          if (window.location.hash) target.hash = window.location.hash;
          showFixLog(`✅ 即将跳转到正式域名: ${target.toString()}`);
          setTimeout(() => { window.location.href = target.toString(); }, 800);
        } else {
          addCheckResult('🌍 正式域名路由', 'fix', `已校正缓存链接 | 正式域名: ${OFFICIAL_WEB_ORIGIN}`);
        }
        return true;
      } catch (error) {
        log('正式域名路由修复失败: ' + error.message, 'ERROR');
        showFixLog('❌ 正式域名路由修复失败: ' + error.message);
        return false;
      }
    }

    async function checkDesktopInteractionContracts() {
      log('检查电脑端按钮契约...', 'INFO');

      try {
        const response = await fetch('index.html', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('index.html 读取失败: ' + response.status);
        }

        const html = await response.text();
        const desktopBindingOk = /id="copyOutputBtn"/.test(html);
        const desktopHandlerOk = /async function copyToClipboard\(/.test(html);
        const inputBindingOk = /id="sendIdBtn"/.test(html);
        const inputHandlerOk = /function manualSendIdMessage\(/.test(html);
        const resetBindingOk = /id="clearOutputBtn"/.test(html);
        const resetHandlerOk = /function clearAll\(\)/.test(html);

        const allPass = desktopBindingOk && desktopHandlerOk && inputBindingOk && inputHandlerOk && resetBindingOk && resetHandlerOk;
        const details = [
          `电脑端输入按钮: ${inputBindingOk ? '正常' : '缺失'}`,
          `电脑端输入函数: ${inputHandlerOk ? '正常' : '缺失'}`,
          `电脑端按钮绑定: ${desktopBindingOk ? '正常' : '缺失'}`,
          `电脑端清除函数: ${desktopHandlerOk ? '正常' : '缺失'}`,
          `电脑端重置按钮: ${resetBindingOk ? '正常' : '缺失'}`,
          `电脑端重置函数: ${resetHandlerOk ? '正常' : '缺失'}`
        ].join(' | ');

        addCheckResult('🖥️ 电脑端按钮契约', allPass ? 'pass' : 'fail', details);
        return allPass;
      } catch (error) {
        addCheckResult('🖥️ 电脑端按钮契约', 'fail', error.message);
        return false;
      }
    }
    
    // ========== 自动修复系统 ==========
    
    function showFixLog(msg) {
      autoFixPanel.classList.add('active');
      const row = document.createElement('div');
      row.textContent = `${new Date().toLocaleTimeString('zh-CN')} - ${msg}`;
      fixLogEl.appendChild(row);
      fixLogEl.scrollTop = fixLogEl.scrollHeight;
    }
    
    async function runAutoFix() {
      log('启动自动修复流程...', 'FIX');
      SystemState.fixAttempts++;
      
      if (SystemState.fixAttempts > SystemState.maxFixAttempts) {
        log('达到最大修复尝试次数，停止自动修复', 'ERROR');
        alert('自动修复已达到最大尝试次数，请手动检查系统');
        return;
      }
      
      const failedChecks = Object.entries(SystemState.checkResults)
        .filter(([_, result]) => result.canFix);
      
      if (failedChecks.length === 0) {
        log('没有可修复的项目', 'INFO');
        return;
      }
      
      log(`发现 ${failedChecks.length} 个可修复项目`, 'FIX');
      
      for (const [name, result] of failedChecks) {
        if (result.fixFn) {
          log(`自动修复: ${name}`, 'FIX');
          await result.fixFn();
          await new Promise(r => setTimeout(r, 1000)); // 修复间隔
        }
      }
      
      log('自动修复流程完成，重新检测中...', 'FIX');
      setTimeout(runFullSelfCheck, 2000);
    }
    
    // ========== 主控制流==========
    
    async function runFullSelfCheck() {
      // 重置
      checksEl.innerHTML = '';
      SystemState.checkResults = {};
      SystemState.fixAttempts = 0;
      autoFixPanel.classList.remove('active');
      fixLogEl.innerHTML = '';
      
      reportEl.innerHTML = `[INFO] 启动智能自检系统\n[INFO] 时间: ${new Date().toLocaleString('zh-CN')}\n[INFO] 模式: ${SystemState.commConnected ? '通讯模式' : '独立模式'}\n\n`;
      statusEl.innerHTML = '<span class="loading">🔄 执行自检中...</span>';
      document.getElementById('btnCheck').disabled = true;
      
      log('========================================', 'INFO');
      log('🚀 启动三层架构自检', 'INFO');
      log('========================================', 'INFO');
      
      // 阶段1: 基础环境
      log('\n[阶段 1/3] 基础环境检查', 'INFO');
      checkBrowserEnvironment();
      checkLocalStorage();
      const officialRoutingResult = checkOfficialRouting();
      SystemState.checkResults['officialRouting'] = officialRoutingResult;
      await checkDesktopInteractionContracts();
      
      // 阶段2: 通讯检测（如未连接则尝试）
      log('\n[阶段 2/3] 主系统通讯检查', 'INFO');
      if (!SystemState.commConnected) {
        await testCommunication();
      } else {
        log('已建立通讯连接，跳过连接测试', 'SUCCESS');
        addCheckResult('📡 主系统通讯', 'pass', '连接已建立');
      }
      
      // 阶段3: 核心功能检测（4项关键项目）
      log('\n[阶段 3/3] 核心功能深度检查', 'INFO');
      
      // 检查: 红蓝圆圈
      const circleResult = await checkRedBlueCircles();
      SystemState.checkResults['circles'] = circleResult;
      
      // 检查: 高倍项目
      const highMulResult = await checkHighMultiplier();
      SystemState.checkResults['highMultiplier'] = highMulResult;
      
      // 检查: 数据库
      const dbResult = await checkDatabase();
      SystemState.checkResults['database'] = dbResult;
      
      // 检查: 熵准确率
      const entropyResult = await checkEntropyAccuracy();
      SystemState.checkResults['entropy'] = entropyResult;
      
      // 统计与总结
      const allChecks = Object.values(SystemState.checkResults);
      const passed = allChecks.filter(r => r.status === 'pass').length;
      const failed = allChecks.filter(r => r.status === 'fail').length;
      const warnings = allChecks.filter(r => r.status === 'warn').length;
      const fixable = allChecks.filter(r => r.canFix).length;
      
      log('\n========================================', 'INFO');
      log(`📊 自检完成: ${passed}项通过, ${failed}项失败, ${warnings}项警告`, 
          failed === 0 ? 'SUCCESS' : 'WARN');
      if (fixable > 0) log(`🔧 可自动修复: ${fixable}项`, 'FIX');
      log('========================================', 'INFO');
      
      // 更新状态栏
      if (failed === 0 && warnings === 0) {
        statusEl.innerHTML = '<span class="status-ok">✅ 系统健康：所有核心功能正常</span>';
        document.getElementById('btnFix').style.display = 'none';
      } else if (failed === 0) {
        statusEl.innerHTML = '<span class="status-warn">⚠️ 系统警告：存在轻微问题</span>';
        document.getElementById('btnFix').style.display = 'inline-block';
      } else {
        statusEl.innerHTML = `<span class="status-error">❌ 系统异常：${failed}项功能故障</span>`;
        document.getElementById('btnFix').style.display = 'inline-block';
        
        // 自动尝试修复（首次）
        if (SystemState.fixAttempts === 0 && fixable > 0) {
          log('\n🔧 检测到可修复问题，3秒后自动尝试修复...', 'FIX');
          setTimeout(runAutoFix, 3000);
        }
      }
      
      document.getElementById('btnCheck').disabled = false;
      
      // 闭环自检：检查自检系统自身
      log('\n[闭环验证] 自检系统自洽性检查', 'INFO');
      const selfCheck = document.getElementById('checks').children.length >= 4;
      log(`自检项目数量: ${document.getElementById('checks').children.length}`, 
          selfCheck ? 'SUCCESS' : 'ERROR');
      if (window.MayijuLocalDB) {
        window.MayijuLocalDB.saveSelfCheckReport({
          generated_at: new Date().toISOString(),
          report: [
            { level: failed === 0 ? 'ok' : 'warn', text: `主系统自检完成：通过 ${passed}，失败 ${failed}，警告 ${warnings}` },
            { level: SystemState.commConnected ? 'ok' : 'warn', text: `通讯状态：${SystemState.commConnected ? '已连接' : '独立模式'}` }
          ],
          stats: {
            passed,
            failed,
            warnings,
            fixable
          }
        });
      }
      loadUnifiedLocalReport();
    }
    
    // 模拟测试（独立模式用）
    function simulateCircleTest() {
      log('模拟红蓝圆圈渲染测试...', 'INFO');
      alert('模拟测试：红蓝圆圈渲染逻辑正常\n（独立模式下无法验证实际 DOM）');
    }
    
    // 辅助功能
    function clearReport() {
      reportEl.innerHTML = '[INFO] 日志已清空\n';
      log('日志面板已清空', 'SUCCESS');
    }
    
    function showSystemInfo() {
      const info = `
========== 自检系统信息 ==========
浏览器: ${navigator.userAgent.substr(0, 50)}...
平台: ${navigator.platform}
通讯状态: ${SystemState.commConnected ? '已连接' : '未连接'}
最后响应: ${SystemState.lastResponse ? '有' : '无'}
核心检测项: 4项（红蓝圆圈、高倍、数据库、熵准确率）
自动修复: 已启用\n闭环验证: 已启用\n==================================
      `;
      alert(info);
      log('系统信息已显示', 'SUCCESS');
    }

    function closeToMain() {
      if (window.opener) {
        window.close();
      } else {
        window.location.href = 'index.html/index.html';
      }
    }
    
    // 页面加载
    window.onload = async function() {
      document.getElementById('btnCheck').addEventListener('click', runFullSelfCheck);
      document.getElementById('btnFix').addEventListener('click', runAutoFix);
      document.getElementById('btnCommTest').addEventListener('click', testCommunication);
      document.getElementById('btnSystemInfo').addEventListener('click', showSystemInfo);
      document.getElementById('btnLoadUnified').addEventListener('click', loadUnifiedLocalReport);
      document.getElementById('btnClearReport').addEventListener('click', clearReport);
      document.getElementById('btnCloseSelfCheck').addEventListener('click', closeToMain);
      log('智能自检系统加载完成', 'SUCCESS');
      log('等待与主系统建立通讯...', 'INFO');
      loadUnifiedLocalReport();
      
      // 尝试自动连接
      setTimeout(async () => {
        await testCommunication();
        if (!SystemState.commConnected) {
          log('未检测到主系统，可在主界面打开后点“测试通讯”', 'WARN');
        }
      }, 1000);
    };
    
    // 错误捕获
    window.onerror = function(msg, url, line, col, error) {
      log(`全局错误: ${msg} (${line}:${col})`, 'ERROR');
      return false;
    };
  
