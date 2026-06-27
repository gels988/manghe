        const supabase = window.supabaseInstance;
        const REFERRAL_REWARD = 222;
        const GIFT_COST = 660;
        const GIFT_SECRET = 'MAYIJU_GIFT_660_V1';

        if (!supabase) {
            console.error('Supabase client not initialized via db_client.js');
            showNotification('数据库客户端初始化失败', 'error');
        }

        let currentUser = null;
        let currentUserData = null;
        let citizensData = [];
        let activationCodes = [];
        let donationRecords = [];
        let transferLogs = [];
        let lastSelfCheckReport = null;
        let ledgerStateMode = 'overwrite_import';

        function renderProfileCard(profile) {
            const safeProfile = profile || {};
            document.getElementById('profile-name').textContent = safeProfile.display_name || safeProfile.email || safeProfile.phone || '未登录';
            document.getElementById('profile-contact').textContent = safeProfile.email || safeProfile.phone || '未同步';
            document.getElementById('profile-source').textContent = safeProfile.source_table || 'localStorage';
        }

        async function refreshProfileSync() {
            if (!window.MayijuIdentity) return;
            const profile = await window.MayijuIdentity.syncProfile({ device: 'desktop' });
            renderProfileCard(profile);
        }

        async function init() {
            try {
                await checkAuth();
                if (!currentUser) {
                    showNotification('请先登录主系统', 'error');
                    setTimeout(() => backToMain(), 2000);
                    return;
                }
                document.getElementById('owner-email').textContent = currentUser.email || currentUser.phone || '已登录用户';
                await loadData();
            } catch (error) {
                console.error('初始化失败', error);
                showNotification('系统初始化失败: ' + error.message, 'error');
            }
        }

        async function checkAuth() {
            if (window.MayijuIdentity) {
                const profile = await window.MayijuIdentity.syncProfile({ device: 'desktop' });
                if (profile && profile.id) {
                    currentUser = {
                        id: profile.id,
                        email: profile.email,
                        phone: profile.phone
                    };
                    renderProfileCard(profile);
                    return;
                }
            }

            const localUser = safeParse(localStorage.getItem('currentUser'));
            if (localUser && localUser.id) {
                currentUser = {
                    id: localUser.id,
                    email: localUser.email || null,
                    phone: localUser.phone || null
                };
                renderProfileCard(window.MayijuIdentity ? window.MayijuIdentity.normalizeProfile(localUser, localUser) : localUser);
                return;
            }

            const { data: { session } } = await supabase.auth.getSession();
            if (session && session.user) {
                currentUser = session.user;
                renderProfileCard(window.MayijuIdentity ? window.MayijuIdentity.normalizeProfile(session.user, session.user) : session.user);
            }
        }

        function safeParse(str) {
            try { return JSON.parse(str); } catch { return null; }
        }

        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function simpleHash(text) {
            let hash = 2166136261;
            const str = String(text || '');
            for (let i = 0; i < str.length; i++) {
                hash ^= str.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
        }

        function buildGiftCode(ownerId) {
            const stamp = Date.now().toString(36).toUpperCase().slice(-8);
            const ownerFrag = simpleHash(ownerId || 'guest').slice(0, 4);
            const payload = `${stamp}-${ownerFrag}`;
            const sign = simpleHash(`${payload}|${GIFT_SECRET}`).slice(0, 8);
            return `GIFT-${payload}-${sign}`;
        }

        async function loadData() {
            try {
                const [userRes, citizensRes, codesRes, donationRes, transferRes] = await Promise.all([
                    supabase.from('users').select('*').eq('id', currentUser.id).maybeSingle(),
                    supabase.from('users').select('*').eq('referrer_id', currentUser.id).order('created_at', { ascending: false }),
                    supabase.from('activation_codes').select('*').eq('owner_user_id', currentUser.id).order('created_at', { ascending: false }),
                    supabase.from('donations').select('*').order('created_at', { ascending: false }),
                    supabase.from('gas_transfer_log').select('*').order('created_at', { ascending: false })
                ]);

                if (userRes.error) throw new Error(userRes.error.message || 'USER_LOAD_FAIL');
                if (citizensRes.error) throw new Error(citizensRes.error.message || 'CITIZEN_LOAD_FAIL');
                if (codesRes.error) throw new Error(codesRes.error.message || 'CODE_LOAD_FAIL');
                if (donationRes.error) throw new Error(donationRes.error.message || 'DONATION_LOAD_FAIL');
                if (transferRes.error) throw new Error(transferRes.error.message || 'TRANSFER_LOAD_FAIL');

                currentUserData = userRes.data || {
                    id: currentUser.id,
                    balance_g: 0,
                    gas_balance: 0
                };
                citizensData = citizensRes.data || [];
                activationCodes = codesRes.data || [];
                donationRecords = donationRes.data || [];
                transferLogs = transferRes.data || [];

                updateStats();
                renderCitizens();
                renderGiftCodes();
                renderTradeLogs();
                generatePromoLink();
                await refreshLedgerBox();
                await runLocalSelfCheck({ silent: true });
            } catch (error) {
                console.error('加载数据失败:', error);
                showNotification('数据加载失败: ' + error.message, 'error');
            }
        }

        function updateStats() {
            const balance = Number(currentUserData?.balance_g || currentUserData?.gas_balance || 0);
            const paidCitizens = citizensData.filter(c => Number(c.total_donation || 0) >= GIFT_COST);
            const availableGiftCount = Math.floor(balance / GIFT_COST);
            document.getElementById('gas-balance').textContent = balance;
            document.getElementById('citizen-count').textContent = citizensData.length;
            document.getElementById('active-count').textContent = paidCitizens.length;
            document.getElementById('donated-count').textContent = availableGiftCount;
        }

        function generatePromoLink() {
            const displayElement = document.getElementById('invite-link');
            if (!displayElement) return;

            const ownerId = currentUser && currentUser.id ? currentUser.id : 'USER_LOCAL';
            const baseUrl = window.location.origin ? (window.location.origin + '/register.html') : 'register.html';
            const link = baseUrl + '?ref=' + encodeURIComponent(ownerId);
            displayElement.textContent = link;
            displayElement.dataset.link = link;
            return link;
        }

        function copyInviteLink() {
            const displayElement = document.getElementById('invite-link');
            if (!displayElement) return;
            const link = displayElement.dataset.link || displayElement.textContent;
            if (!link || link === '生成中...') {
                showNotification('链接尚未生成', 'error');
                return;
            }
            navigator.clipboard.writeText(link).then(() => {
                showNotification('邀请链接已复制', 'success');
            }).catch(() => {
                const textArea = document.createElement('textarea');
                textArea.value = link;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showNotification('邀请链接已复制', 'success');
            });
        }

        function renderGiftCodes() {
            const container = document.getElementById('gift-code-container');
            if (!container) return;
            if (!activationCodes.length) {
                container.innerHTML = `
                    <div class="note gift-empty-note">
                        当前还没有赠送激活码。每推荐成交 3 人可累计 666G，可立即生成 1 个赠送码并扣减 660G。
                    </div>
                `;
                return;
            }

            container.innerHTML = activationCodes.map(code => `
                <div class="gift-card">
                    <div class="gift-code-text">${escapeHtml(code.code)}</div>
                    <div class="gift-code-meta">
                        备注: ${escapeHtml(code.note || '未填写')} | 状态: ${escapeHtml(code.status || 'new')} | 扣减: ${escapeHtml(code.cost_g || GIFT_COST)}G
                    </div>
                    <div class="btn-group btn-group-top">
                        <button class="btn btn-primary gift-copy-btn" data-code="${escapeHtml(code.code)}">📋 复制激活码</button>
                    </div>
                </div>
            `).join('');
            container.querySelectorAll('.gift-copy-btn').forEach((btn) => {
                btn.addEventListener('click', () => copyGiftCode(btn.dataset.code || ''));
            });
        }

        function renderTradeLogs() {
            const container = document.getElementById('trade-log-container');
            if (!container) return;
            const ownedCitizenIds = new Set(citizensData.map(item => item.id));
            const ownedDonations = donationRecords.filter(item => ownedCitizenIds.has(item.user_id));
            const ownedRewards = transferLogs.filter(item => item.type === 'single_referral_reward' && item.to_user_id === currentUser.id);
            const ownGiftCosts = transferLogs.filter(item => item.type === 'gift_code_issue' && item.from_user_id === currentUser.id);
            const logs = [];
            const keyword = String((document.getElementById('trade-log-filter') || {}).value || '').trim().toLowerCase();

            citizensData.forEach((citizen) => {
                const paid = Number(citizen.total_donation || 0) >= GIFT_COST;
                logs.push({
                    at: citizen.purchase_completed_at || citizen.last_active || citizen.created_at,
                    title: `${citizen.email || citizen.phone_number || '未命名客户'} ${paid ? '已成交' : '已登记'}`,
                    meta: `成交额: ${citizen.total_donation || 0} | 奖励状态: ${citizen.reward_granted_to_referrer ? '已发 222G' : '待成交'}`,
                    keyword: `${citizen.id || ''} ${citizen.email || ''} ${citizen.phone_number || ''}`
                });
            });

            ownedDonations.forEach((item) => {
                logs.push({
                    at: item.created_at,
                    title: `成交入账 ${item.amount_u || 0} / ${item.payment_method || item.to_wallet || '未记录方式'}`,
                    meta: `客户ID: ${item.user_id} | 推荐奖励: ${item.referral_reward_to_parent || 0}G | 凭证: ${item.tx_hash || '无'}`,
                    keyword: `${item.user_id || ''} ${item.tx_hash || ''} ${item.payment_method || ''}`
                });
            });

            ownedRewards.forEach((item) => {
                logs.push({
                    at: item.created_at,
                    title: `推荐奖励到账 +${item.amount || 0}G`,
                    meta: `来源客户ID: ${item.from_user_id || '未知'} | 类型: ${item.type}`,
                    keyword: `${item.from_user_id || ''} ${item.to_user_id || ''} ${item.type || ''}`
                });
            });

            ownGiftCosts.forEach((item) => {
                logs.push({
                    at: item.created_at,
                    title: `赠送激活码扣减 -${item.amount || GIFT_COST}G`,
                    meta: `扣减类型: ${item.type} | 当前已生成码数: ${activationCodes.length}`,
                    keyword: `${item.type || ''} ${item.from_user_id || ''}`
                });
            });

            const filtered = logs
                .filter((item) => !keyword || `${item.title} ${item.meta} ${item.keyword || ''}`.toLowerCase().includes(keyword))
                .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
            if (!filtered.length) {
                container.innerHTML = '<div class="log-item">当前还没有推荐成交日志。</div>';
                return;
            }

            container.innerHTML = filtered.map((item) => `
                <div class="log-item">
                    <div>${escapeHtml(item.title)}</div>
                    <div class="log-meta">${escapeHtml(new Date(item.at || Date.now()).toLocaleString('zh-CN'))}<br>${escapeHtml(item.meta)}</div>
                </div>
            `).join('');
        }

        function exportTradeLogsCsv() {
            const keyword = String((document.getElementById('trade-log-filter') || {}).value || '').trim().toLowerCase();
            const rows = [];
            const ownedCitizenIds = new Set(citizensData.map(item => item.id));

            citizensData.forEach((citizen) => {
                rows.push({
                    time: citizen.purchase_completed_at || citizen.last_active || citizen.created_at,
                    type: Number(citizen.total_donation || 0) >= GIFT_COST ? 'customer_paid' : 'customer_registered',
                    target: citizen.email || citizen.phone_number || citizen.id || '',
                    amount: citizen.total_donation || 0,
                    reward: citizen.reward_granted_to_referrer ? REFERRAL_REWARD : 0,
                    note: citizen.id || ''
                });
            });
            donationRecords.filter(item => ownedCitizenIds.has(item.user_id)).forEach((item) => {
                rows.push({
                    time: item.created_at,
                    type: 'donation',
                    target: item.user_id || '',
                    amount: item.amount_u || 0,
                    reward: item.referral_reward_to_parent || 0,
                    note: item.tx_hash || ''
                });
            });
            transferLogs.filter(item => item.to_user_id === currentUser.id || item.from_user_id === currentUser.id).forEach((item) => {
                rows.push({
                    time: item.created_at,
                    type: item.type || 'transfer',
                    target: item.to_user_id || item.from_user_id || '',
                    amount: item.amount || 0,
                    reward: item.type === 'single_referral_reward' ? item.amount || 0 : 0,
                    note: item.from_user_id || ''
                });
            });

            const filtered = rows.filter((row) => !keyword || `${row.target} ${row.note} ${row.type}`.toLowerCase().includes(keyword));
            const csv = ['time,type,target,amount,reward,note']
                .concat(filtered.map((row) => [row.time, row.type, row.target, row.amount, row.reward, row.note].map(csvEscape).join(',')))
                .join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mayiju-trade-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showNotification('推荐日志 CSV 已导出', 'success');
        }

        function csvEscape(value) {
            const text = String(value == null ? '' : value);
            return `"${text.replace(/"/g, '""')}"`;
        }

        async function refreshLedgerBox() {
            const box = document.getElementById('ledger-json-box');
            if (!box || !window.MayijuLocalDB) return;
            const snapshot = await window.MayijuLocalDB.exportSnapshot();
            box.value = JSON.stringify(snapshot, null, 2);
        }

        async function exportLedger() {
            if (!window.MayijuLocalDB) {
                showNotification('本地账本接口未就绪', 'error');
                return;
            }
            const snapshot = await window.MayijuLocalDB.exportSnapshot();
            const text = JSON.stringify(snapshot, null, 2);
            document.getElementById('ledger-json-box').value = text;
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mayiju-ledger-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showNotification('账本已导出', 'success');
        }

        async function copyLedgerSnapshot() {
            const box = document.getElementById('ledger-json-box');
            if (!box.value.trim()) {
                await refreshLedgerBox();
            }
            box.select();
            box.setSelectionRange(0, box.value.length);
            document.execCommand('copy');
            showNotification('账本文本已复制', 'success');
        }

        function triggerLedgerImport() {
            document.getElementById('ledger-file-input').click();
        }

        async function importLedgerText() {
            const text = document.getElementById('ledger-json-box').value.trim();
            if (!text) {
                showNotification('请先粘贴账本文本', 'error');
                return;
            }
            await importLedgerPayload(text);
        }

        async function importLedgerPayload(text) {
            if (!window.MayijuLocalDB) {
                showNotification('本地账本接口未就绪', 'error');
                return;
            }
            try {
                const parsed = JSON.parse(text);
                const summary = await window.MayijuLocalDB.importSnapshot(parsed, { mode: 'merge', state_mode: ledgerStateMode });
                await checkAuth();
                renderLedgerImportResult(summary);
                showNotification(`账本已导入；用户=${summary.restored_identity && summary.restored_identity.current_user_label ? summary.restored_identity.current_user_label : '未恢复'}；激活=${summary.restored_identity && summary.restored_identity.activated ? '是' : '否'}`, 'success');
                await loadData();
            } catch (error) {
                console.error(error);
                showNotification('账本导入失败: ' + error.message, 'error');
            }
        }

        async function previewLedgerConflicts() {
            const text = document.getElementById('ledger-json-box').value.trim();
            const box = document.getElementById('ledger-conflict-preview');
            if (!text) {
                box.innerHTML = '<div class="report-line warn">请先粘贴或导出账本 JSON。</div>';
                return;
            }
            if (!window.MayijuLocalDB) {
                box.innerHTML = '<div class="report-line bad">本地账本接口未就绪。</div>';
                return;
            }
            try {
                const parsed = JSON.parse(text);
                const preview = await window.MayijuLocalDB.previewImportConflicts(parsed);
                const lines = [];
                lines.push(`<div class="report-line ok">导入总行数: ${preview.totals.incoming} | 新增: ${preview.totals.new_rows} | 记录冲突: ${preview.totals.conflicts} | 状态冲突: ${preview.totals.state_conflicts || 0}</div>`);
                Object.keys(preview.stores).forEach((storeName) => {
                    const store = preview.stores[storeName];
                    lines.push(`<div class="report-line ${store.conflict_count ? 'warn' : 'ok'}">${storeName}: incoming ${store.incoming_count} | new ${store.new_count} | conflict ${store.conflict_count}</div>`);
                    store.conflicts.slice(0, 5).forEach((item) => {
                        lines.push(`<div class="report-line warn">${escapeHtml(storeName)} / ${escapeHtml(item.id)}<br>现有: ${escapeHtml(item.existing_summary)}<br>导入: ${escapeHtml(item.incoming_summary)}</div>`);
                    });
                });
                Object.keys(preview.local_state || {}).forEach((key) => {
                    const item = preview.local_state[key];
                    lines.push(`<div class="report-line ${item.conflict ? 'warn' : 'ok'}">state / ${escapeHtml(key)}<br>现有: ${escapeHtml(item.existing_summary)}<br>导入: ${escapeHtml(item.incoming_summary)}</div>`);
                });
                box.innerHTML = lines.join('');
                showNotification('冲突预览已生成', 'success');
            } catch (error) {
                console.error(error);
                box.innerHTML = `<div class="report-line bad">冲突预览失败: ${escapeHtml(error.message)}</div>`;
                showNotification('冲突预览失败', 'error');
            }
        }

        function setLedgerStateMode(mode) {
            ledgerStateMode = mode === 'preserve_local' ? 'preserve_local' : 'overwrite_import';
            const hint = document.getElementById('ledger-state-mode-hint');
            const keepBtn = document.getElementById('stateModeKeepBtn');
            const overwriteBtn = document.getElementById('stateModeOverwriteBtn');
            if (keepBtn) keepBtn.className = `btn ${ledgerStateMode === 'preserve_local' ? 'btn-primary' : 'btn-secondary'}`;
            if (overwriteBtn) overwriteBtn.className = `btn ${ledgerStateMode === 'overwrite_import' ? 'btn-primary' : 'btn-secondary'}`;
            if (hint) {
                hint.textContent = ledgerStateMode === 'preserve_local'
                    ? '当前策略：保留本机状态。只导入账本数据，不覆盖本机当前登录态、激活态。'
                    : '当前策略：覆盖为导入状态。适合把 A 机的登录态、激活态完整迁移到 B 机。';
            }
        }

        function renderLedgerImportResult(summary) {
            const box = document.getElementById('ledger-import-result');
            if (!box || !summary) return;
            const identity = summary.restored_identity || {};
            const lines = [];
            lines.push(`<div class="report-line ok">导入完成：state_mode=${escapeHtml(summary.state_mode || 'overwrite_import')}</div>`);
            lines.push(`<div class="report-line ${identity.current_user_id ? 'ok' : 'warn'}">当前用户：${escapeHtml(identity.current_user_label || '未恢复')}</div>`);
            lines.push(`<div class="report-line ${identity.session_user_id ? 'ok' : 'warn'}">会话用户ID：${escapeHtml(identity.session_user_id || '未恢复')}</div>`);
            lines.push(`<div class="report-line ${identity.activated ? 'ok' : 'warn'}">激活状态：${identity.activated ? '已恢复激活态' : '未恢复激活态'}</div>`);
            lines.push(`<div class="report-line ${summary.state_mode === 'overwrite_import' ? 'ok' : 'warn'}">${summary.state_mode === 'overwrite_import' ? '已按导入状态覆盖本机身份层' : '已保留本机身份层，仅合并账本数据'}</div>`);
            box.innerHTML = lines.join('');
        }

        async function runLocalSelfCheck(opts) {
            const silent = opts && opts.silent;
            const reportEl = document.getElementById('selfcheck-report');
            const report = [];
            const dbReady = !!window.MayijuLocalDB;
            report.push({ level: dbReady ? 'ok' : 'bad', text: `本地数据库接口: ${dbReady ? '正常' : '缺失'}` });
            report.push({ level: currentUser ? 'ok' : 'bad', text: `当前身份: ${currentUser ? (currentUser.email || currentUser.phone || currentUser.id) : '未识别'}` });
            report.push({ level: currentUserData ? 'ok' : 'bad', text: `当前 GAS 余额: ${Number(currentUserData?.balance_g || currentUserData?.gas_balance || 0)}` });
            report.push({ level: citizensData.length ? 'ok' : 'warn', text: `推荐客户数: ${citizensData.length}` });
            report.push({ level: activationCodes.length ? 'ok' : 'warn', text: `赠送激活码数: ${activationCodes.length}` });

            const missingDonationRefs = citizensData.filter(c => Number(c.total_donation || 0) >= GIFT_COST && !c.reward_granted_to_referrer);
            report.push({
                level: missingDonationRefs.length ? 'warn' : 'ok',
                text: missingDonationRefs.length ? `发现 ${missingDonationRefs.length} 个已成交但未标记奖励客户` : '推荐奖励结算状态正常'
            });

            const canGift = Number(currentUserData?.balance_g || currentUserData?.gas_balance || 0) >= GIFT_COST;
            report.push({ level: canGift ? 'ok' : 'warn', text: canGift ? '当前可生成赠送激活码' : '当前 GAS 未达 660，暂不可生成赠送码' });

            lastSelfCheckReport = {
                generated_at: new Date().toISOString(),
                report,
                stats: {
                    gas_balance: Number(currentUserData?.balance_g || currentUserData?.gas_balance || 0),
                    citizen_count: citizensData.length,
                    paid_count: citizensData.filter(c => Number(c.total_donation || 0) >= GIFT_COST).length,
                    gift_code_count: activationCodes.length
                }
            };
            if (window.MayijuLocalDB) {
                window.MayijuLocalDB.saveSelfCheckReport(lastSelfCheckReport);
            }

            if (reportEl) {
                reportEl.innerHTML = report.map(item => `<div class="report-line ${item.level}">${escapeHtml(item.text)}</div>`).join('');
            }
            if (!silent) {
                showNotification('本地自检已完成', 'success');
            }
            return lastSelfCheckReport;
        }

        async function runLocalRepair() {
            if (!window.MayijuLocalDB) {
                showNotification('本地修复接口未就绪', 'error');
                return;
            }
            try {
                const result = await window.MayijuLocalDB.repairData();
                await loadData();
                const reportEl = document.getElementById('selfcheck-report');
                if (reportEl) {
                    const repaired = (result.repaired || []).map(item => `<div class="report-line ok">已修复: ${escapeHtml(item)}</div>`).join('');
                    const warnings = (result.warnings || []).map(item => `<div class="report-line warn">提醒: ${escapeHtml(item)}</div>`).join('');
                    reportEl.innerHTML = repaired + warnings + '<div class="report-line ok">本地修复完成</div>';
                }
                showNotification(`本地修复完成，共处理 ${(result.repaired || []).length} 项`, 'success');
            } catch (error) {
                console.error(error);
                showNotification('自动修复失败: ' + error.message, 'error');
            }
        }

        function exportSelfCheckReport() {
            const payload = lastSelfCheckReport || { generated_at: new Date().toISOString(), report: [] };
            const text = JSON.stringify(payload, null, 2);
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mayiju-selfcheck-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showNotification('自检报告已导出', 'success');
        }

        function renderCitizens() {
            const container = document.getElementById('citizens-container');
            if (!citizensData.length) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🏝️</div>
                        <p>暂无子民</p>
                        <p class="empty-state-note">分享邀请链接后，新用户会自动记录为您的单层推荐。</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = '<div class="citizen-list">' + citizensData.map(citizen => {
                const paid = Number(citizen.total_donation || 0) >= GIFT_COST;
                const reward = citizen.reward_granted_to_referrer ? REFERRAL_REWARD : 0;
                const lastActive = citizen.last_active ? formatTime(citizen.last_active) : '从未活跃';
                const name = citizen.email || citizen.phone_number || '未命名客户';
                return `
                    <div class="citizen-item">
                        <div class="citizen-info">
                            <div class="citizen-name">
                                ${escapeHtml(name)}
                                ${paid ? '<span class="badge badge-donated">💎 已成交</span>' : ''}
                            </div>
                            <div class="citizen-meta">
                                <span>成交额: ${escapeHtml(citizen.total_donation || 0)}</span>
                                <span>推荐奖励: ${escapeHtml(reward)}G</span>
                                <span>🕐 ${escapeHtml(lastActive)}</span>
                            </div>
                        </div>
                        <div class="citizen-status">
                            ${paid ? '<span class="badge badge-active">✅ 已开通</span>' : '<span class="badge badge-inactive">⏸️ 未成交</span>'}
                            <div class="gas-amount">${escapeHtml(reward)}</div>
                            <div class="action-buttons">
                                <button class="action-btn btn-primary citizen-detail-btn" data-id="${escapeHtml(citizen.id)}">详情</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('') + '</div>';
            container.querySelectorAll('.citizen-detail-btn').forEach((btn) => {
                btn.addEventListener('click', () => viewDetail(btn.dataset.id || ''));
            });
        }

        async function generateGiftCode() {
            const balance = Number(currentUserData?.balance_g || currentUserData?.gas_balance || 0);
            if (balance < GIFT_COST) {
                showNotification('GAS 不足 660，暂时无法生成赠送激活码', 'error');
                return;
            }

            const note = document.getElementById('gift-recipient-note').value.trim();
            const code = buildGiftCode(currentUser.id);
            const nextBalance = balance - GIFT_COST;

            try {
                await supabase.from('activation_codes').insert({
                    owner_user_id: currentUser.id,
                    code,
                    note: note || null,
                    cost_g: GIFT_COST,
                    status: 'new',
                    created_at: new Date().toISOString()
                });

                await supabase.from('users').update({
                    balance_g: nextBalance,
                    gas_balance: nextBalance,
                    last_active: new Date().toISOString()
                }).eq('id', currentUser.id);

                await supabase.from('gas_transfer_log').insert({
                    from_user_id: currentUser.id,
                    to_user_id: null,
                    amount: GIFT_COST,
                    type: 'gift_code_issue',
                    created_at: new Date().toISOString()
                });

                document.getElementById('gift-recipient-note').value = '';
                showNotification('已生成赠送激活码，并自动扣减 660G', 'success');
                await loadData();
            } catch (error) {
                console.error(error);
                showNotification('生成失败: ' + error.message, 'error');
            }
        }

        function copyGiftCode(code) {
            navigator.clipboard.writeText(code).then(() => {
                showNotification('激活码已复制', 'success');
            }).catch(() => {
                const textArea = document.createElement('textarea');
                textArea.value = code;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showNotification('激活码已复制', 'success');
            });
        }

        function formatTime(dateString) {
            const date = new Date(dateString);
            const now = new Date();
            const diff = Math.floor((now - date) / 1000);
            if (diff < 60) return '刚刚';
            if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
            if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
            if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
            return formatDate(dateString);
        }

        function formatDate(dateString) {
            const date = new Date(dateString);
            return `${date.getMonth() + 1}/${date.getDate()}`;
        }

        function viewDetail(citizenId) {
            const citizen = citizensData.find(c => c.id === citizenId);
            if (!citizen) return;
            alert(
                `客户详情:\n\n` +
                `联系方式: ${citizen.email || citizen.phone_number || '未填写'}\n` +
                `推荐人: ${citizen.referrer_id || '无'}\n` +
                `成交金额: ${citizen.total_donation || 0}\n` +
                `奖励状态: ${citizen.reward_granted_to_referrer ? '已给上级 222G' : '未结算'}\n` +
                `注册时间: ${formatDate(citizen.created_at)}\n` +
                `最后活跃: ${citizen.last_active ? formatTime(citizen.last_active) : '从未'}`
            );
        }

        function showNotification(message, type = 'info') {
            const notif = document.getElementById('notification');
            notif.textContent = message;
            notif.className = `notification ${type} show`;
            setTimeout(() => {
                notif.classList.remove('show');
            }, 3000);
        }

        function backToMain() {
            if (window.opener) {
                window.close();
            } else {
                window.location.href = 'index.html/index.html';
            }
        }

        window.addEventListener('DOMContentLoaded', function() {
            generatePromoLink();
            setLedgerStateMode(ledgerStateMode);
            const refreshProfileBtn = document.getElementById('refreshProfileBtn');
            if (refreshProfileBtn) {
                refreshProfileBtn.addEventListener('click', refreshProfileSync);
            }
            const openRegisterBtn = document.getElementById('openRegisterBtn');
            if (openRegisterBtn) {
                openRegisterBtn.addEventListener('click', () => {
                    window.open('register.html', '_blank', 'noopener,noreferrer');
                });
            }
            const copyInviteBtn = document.getElementById('copyInviteBtn');
            if (copyInviteBtn) {
                copyInviteBtn.addEventListener('click', copyInviteLink);
            }
            const regenInviteBtn = document.getElementById('regenInviteBtn');
            if (regenInviteBtn) {
                regenInviteBtn.addEventListener('click', generatePromoLink);
            }
            const generateGiftCodeBtn = document.getElementById('generateGiftCodeBtn');
            if (generateGiftCodeBtn) {
                generateGiftCodeBtn.addEventListener('click', generateGiftCode);
            }
            const filterTradeLogsBtn = document.getElementById('filterTradeLogsBtn');
            if (filterTradeLogsBtn) {
                filterTradeLogsBtn.addEventListener('click', renderTradeLogs);
            }
            const exportTradeLogsBtn = document.getElementById('exportTradeLogsBtn');
            if (exportTradeLogsBtn) {
                exportTradeLogsBtn.addEventListener('click', exportTradeLogsCsv);
            }
            const exportLedgerBtn = document.getElementById('exportLedgerBtn');
            if (exportLedgerBtn) {
                exportLedgerBtn.addEventListener('click', exportLedger);
            }
            const copyLedgerBtn = document.getElementById('copyLedgerBtn');
            if (copyLedgerBtn) {
                copyLedgerBtn.addEventListener('click', copyLedgerSnapshot);
            }
            const selectLedgerFileBtn = document.getElementById('selectLedgerFileBtn');
            if (selectLedgerFileBtn) {
                selectLedgerFileBtn.addEventListener('click', triggerLedgerImport);
            }
            const importLedgerTextBtn = document.getElementById('importLedgerTextBtn');
            if (importLedgerTextBtn) {
                importLedgerTextBtn.addEventListener('click', importLedgerText);
            }
            const previewLedgerBtn = document.getElementById('previewLedgerBtn');
            if (previewLedgerBtn) {
                previewLedgerBtn.addEventListener('click', previewLedgerConflicts);
            }
            const stateModeKeepBtn = document.getElementById('stateModeKeepBtn');
            if (stateModeKeepBtn) {
                stateModeKeepBtn.addEventListener('click', () => setLedgerStateMode('preserve_local'));
            }
            const stateModeOverwriteBtn = document.getElementById('stateModeOverwriteBtn');
            if (stateModeOverwriteBtn) {
                stateModeOverwriteBtn.addEventListener('click', () => setLedgerStateMode('overwrite_import'));
            }
            const runLocalSelfCheckBtn = document.getElementById('runLocalSelfCheckBtn');
            if (runLocalSelfCheckBtn) {
                runLocalSelfCheckBtn.addEventListener('click', () => runLocalSelfCheck());
            }
            const runLocalRepairBtn = document.getElementById('runLocalRepairBtn');
            if (runLocalRepairBtn) {
                runLocalRepairBtn.addEventListener('click', runLocalRepair);
            }
            const exportSelfCheckBtn = document.getElementById('exportSelfCheckBtn');
            if (exportSelfCheckBtn) {
                exportSelfCheckBtn.addEventListener('click', exportSelfCheckReport);
            }
            const backToMainBtn = document.getElementById('backToMainBtn');
            if (backToMainBtn) {
                backToMainBtn.addEventListener('click', backToMain);
            }
            const fileInput = document.getElementById('ledger-file-input');
            if (fileInput) {
                fileInput.addEventListener('change', async function(event) {
                    const file = event.target.files && event.target.files[0];
                    if (!file) return;
                    const text = await file.text();
                    document.getElementById('ledger-json-box').value = text;
                    await importLedgerPayload(text);
                    event.target.value = '';
                });
            }
        });
        window.onload = init;
    

