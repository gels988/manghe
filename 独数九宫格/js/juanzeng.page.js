        const supabaseClient = window.supabaseInstance;
        const SYSTEM_PRICE = 660;
        const REFERRAL_REWARD = 222;
        const GIFT_SECRET = 'MAYIJU_GIFT_660_V1';

        let currentUser = null;
        let currentBalance = 0;

        async function init() {
            try {
                document.getElementById('donation-amount').value = String(SYSTEM_PRICE);
                refreshEstimate();
                await checkAuth();

                if (!currentUser) {
                    showNotification('未登录（游客模式）', 'warning');
                    document.getElementById('user-email').textContent = '游客（仅浏览）';
                    const sBtn = document.getElementById('submit-btn');
                    if (sBtn) {
                        sBtn.disabled = true;
                        sBtn.textContent = '请先登录';
                    }
                    return;
                }

                document.getElementById('user-email').textContent = currentUser.email || currentUser.phone || '已登录用户';
                await loadBalance();
                await loadHistory();
                subscribeBalance();
            } catch (e) {
                console.error('初始化失败', e);
                showNotification('系统初始化失败', 'error');
            }
        }

        async function checkAuth() {
            if (window.MayijuIdentity) {
                const profile = await window.MayijuIdentity.syncProfile({ device: 'desktop' });
                if (profile && profile.id) {
                    currentUser = {
                        id: profile.id,
                        email: profile.email || profile.phone || '已登录用户',
                        phone: profile.phone || null
                    };
                    return;
                }
            }

            const localUser = safeParse(localStorage.getItem('currentUser'));
            if (localUser && localUser.id) {
                currentUser = {
                    id: localUser.id,
                    email: localUser.email || localUser.phone || '已登录用户',
                    phone: localUser.phone || null
                };
                return;
            }

            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session && session.user) {
                currentUser = session.user;
                return;
            }

            const localPhone = localStorage.getItem('mayiju_user_phone');
            if (localPhone) {
                const { data } = await supabaseClient
                    .from('app_users')
                    .select('*')
                    .eq('phone_number', localPhone)
                    .maybeSingle();
                if (data) {
                    currentUser = { ...data, email: localPhone + '@mayiju.local', id: data.id };
                }
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

        function normalizeCode(raw) {
            return String(raw || '').trim().toUpperCase();
        }

        function toHex8(n) {
            return Math.abs(n).toString(16).toUpperCase().padStart(8, '0');
        }

        function computeKeygenRawKey(name) {
            const CORE_SALT = 'AIM2M_GOD_MODE_99';
            let hash = 0;
            const str = String(name || '') + CORE_SALT;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return toHex8(hash);
        }

        function extractCodeAndName(raw) {
            const text = String(raw || '').trim();
            const codeMatch = text.match(/AIM2M-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-OFFLINE/);
            const nameMatch = text.match(/(?:^|\s|\n)NAME\s*=\s*([^\n\r]+)\s*$/i);
            return {
                code: codeMatch ? normalizeCode(codeMatch[0]) : normalizeCode(text),
                name: nameMatch ? String(nameMatch[1] || '').trim() : ''
            };
        }

        function validateKeygenCode(raw) {
            const { code, name } = extractCodeAndName(raw);
            if (!/^AIM2M-[0-9A-F]{4}-[0-9A-F]{4}-OFFLINE$/.test(code)) return { ok: false, reason: 'FORMAT' };
            if (!name) return { ok: true, mode: 'format-only', code, name: '' };
            const rawKey = computeKeygenRawKey(name);
            const expected = `AIM2M-${rawKey.slice(0, 4)}-${rawKey.slice(4, 8)}-OFFLINE`;
            return { ok: expected === code, mode: 'full', code, name };
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

        function validateGiftCode(raw) {
            const text = normalizeCode(raw);
            const match = text.match(/GIFT-([0-9A-Z]{6,10})-([0-9A-Z]{4,8})-([0-9A-F]{8})/);
            if (!match) return { ok: false, reason: 'FORMAT' };
            const payload = `${match[1]}-${match[2]}`;
            const expected = simpleHash(`${payload}|${GIFT_SECRET}`).slice(0, 8);
            return { ok: expected === match[3], mode: 'gift', code: match[0] };
        }

        function getTrustedOpenerOrigin() {
            if (!window.opener || window.opener.closed) return null;
            if (window.location.origin && window.location.origin !== 'null') {
                return window.location.origin;
            }
            if (document.referrer) {
                try {
                    const refOrigin = new URL(document.referrer).origin;
                    if (refOrigin && refOrigin !== 'null') {
                        return refOrigin;
                    }
                } catch (error) {
                    console.warn('无法解析 opener 来源', error);
                }
            }
            return null;
        }

        async function markActivated(meta) {
            if (window.MayijuSecurity && typeof window.MayijuSecurity.persistActivation === 'function') {
                window.MayijuSecurity.persistActivation(meta || {});
            } else {
                localStorage.setItem('mayiju_access', '1');
                localStorage.setItem('aim2m_activated', '1');
                localStorage.setItem('aim2m_activation_meta', JSON.stringify(meta || {}));
            }
            if (currentUser && currentUser.id) {
                const userRes = await supabaseClient.from('users').select('*').eq('id', currentUser.id).maybeSingle();
                const current = userRes.data || {};
                await supabaseClient.from('users').update({
                    is_active: true,
                    total_donation: meta && meta.amount ? Math.max(Number(current.total_donation || 0), Number(meta.amount || 0)) : Number(current.total_donation || 0),
                    activated_via: meta && meta.type ? meta.type : current.activated_via || null,
                    last_active: new Date().toISOString()
                }).eq('id', currentUser.id);
            }
        }

        async function updateGiftCodeStatus(code, patch) {
            if (!code) return;
            const res = await supabaseClient.from('activation_codes').select('*').eq('code', code).maybeSingle();
            if (res.data) {
                await supabaseClient.from('activation_codes').update(patch || {}).eq('id', res.data.id);
            }
        }

        async function offlineActivateByCode() {
            const raw = document.getElementById('activation-code').value || '';
            const keygenCheck = validateKeygenCode(raw);
            const giftCheck = validateGiftCode(raw);

            if (!keygenCheck.ok && !giftCheck.ok) {
                showNotification('激活码无效（或名称不匹配）', 'error');
                return;
            }

            const meta = keygenCheck.ok
                ? { type: 'keygen', mode: keygenCheck.mode, code: keygenCheck.code, name: keygenCheck.name || null, at: new Date().toISOString() }
                : { type: 'gift-code', mode: giftCheck.mode, code: giftCheck.code, amount: SYSTEM_PRICE, at: new Date().toISOString() };

            await markActivated(meta);
            if (giftCheck.ok) {
                await updateGiftCodeStatus(giftCheck.code, {
                    status: 'redeemed',
                    issued_to_user_id: currentUser && currentUser.id ? currentUser.id : null,
                    redeemed_at: new Date().toISOString()
                });
            }
            showNotification('已开通，正在进入数独...', 'success');
            setTimeout(() => { window.location.href = 'index.html/index.html'; }, 900);
        }

        async function offlineActivateManual() {
            await finalizePaidActivation({
                amount: SYSTEM_PRICE,
                method: 'offline_manual',
                proof: 'OFFLINE-660-MANUAL'
            });
        }

        function refreshEstimate() {
            document.getElementById('estimated-gas').textContent = '0';
            document.getElementById('current-tier').textContent = `${REFERRAL_REWARD}G`;
        }

        async function loadUserRow() {
            if (!currentUser || !currentUser.id) return null;
            const res = await supabaseClient.from('users').select('*').eq('id', currentUser.id).maybeSingle();
            return res.data || null;
        }

        async function applyReferralReward(userRow, amount, paymentMethod, proof) {
            if (!userRow || !userRow.referrer_id || Number(amount) < SYSTEM_PRICE || userRow.reward_granted_to_referrer) {
                return;
            }

            const referrerRes = await supabaseClient.from('users').select('*').eq('id', userRow.referrer_id).maybeSingle();
            const referrer = referrerRes.data;
            if (!referrer) return;

            const nextBalance = Number(referrer.balance_g || referrer.gas_balance || 0) + REFERRAL_REWARD;
            await supabaseClient.from('users').update({
                balance_g: nextBalance,
                gas_balance: nextBalance,
                referred_paid_count: Number(referrer.referred_paid_count || 0) + 1,
                last_active: new Date().toISOString()
            }).eq('id', referrer.id);

            await supabaseClient.from('users').update({
                reward_granted_to_referrer: true,
                referral_reward_g: REFERRAL_REWARD,
                is_paid_customer: true,
                purchase_completed_at: new Date().toISOString(),
                last_payment_method: paymentMethod,
                last_payment_ref: proof
            }).eq('id', userRow.id);

            await supabaseClient.from('gas_transfer_log').insert({
                from_user_id: userRow.id,
                to_user_id: referrer.id,
                amount: REFERRAL_REWARD,
                type: 'single_referral_reward',
                created_at: new Date().toISOString()
            });
        }

        async function finalizePaidActivation({ amount, method, proof }) {
            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.textContent = '处理中...';

            try {
                if (!currentUser || !currentUser.id) {
                    throw new Error('请先注册或登录');
                }
                if (!amount || Number(amount) < SYSTEM_PRICE) {
                    throw new Error(`开通金额需不低于 ${SYSTEM_PRICE}`);
                }
                if (!proof || proof.length < 4) {
                    throw new Error('请填写付款凭证或备注号');
                }

                const duplicate = await supabaseClient.from('donations').select('*').eq('tx_hash', proof).maybeSingle();
                if (duplicate.data) {
                    throw new Error('该付款凭证已提交');
                }

                const userRow = await loadUserRow();
                if (!userRow) throw new Error('未找到当前用户');

                await supabaseClient.from('donations').insert({
                    user_id: currentUser.id,
                    amount_u: Number(amount),
                    gas_reward: 0,
                    tx_hash: proof,
                    to_wallet: method,
                    payment_method: method,
                    status: 'completed',
                    referral_reward_to_parent: userRow.referrer_id ? REFERRAL_REWARD : 0,
                    created_at: new Date().toISOString()
                });

                await supabaseClient.from('users').update({
                    is_active: true,
                    is_paid_customer: true,
                    total_donation: Math.max(Number(userRow.total_donation || 0), Number(amount)),
                    purchase_completed_at: new Date().toISOString(),
                    last_payment_method: method,
                    last_payment_ref: proof,
                    last_active: new Date().toISOString()
                }).eq('id', currentUser.id);

                await applyReferralReward(userRow, amount, method, proof);
                await markActivated({ type: 'paid-donation', amount, method, proof, at: new Date().toISOString() });
                await loadBalance();
                await loadHistory();
                document.getElementById('tx-hash').value = '';
                document.getElementById('donation-amount').value = String(SYSTEM_PRICE);
                refreshEstimate();
                showNotification('已完成开通；若存在推荐人，系统已自动为上级结算 222G', 'success');
                setTimeout(() => { window.location.href = 'index.html/index.html'; }, 900);
            } catch (e) {
                console.error(e);
                showNotification('提交失败: ' + e.message, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = '✓ 付款完成并立即开通';
            }
        }

        async function submitDonation() {
            const amount = parseFloat(document.getElementById('donation-amount').value);
            const proof = document.getElementById('tx-hash').value.trim();
            const method = document.getElementById('payment-method').value;
            await finalizePaidActivation({ amount, method, proof });
        }

        async function loadBalance() {
            const userRow = await loadUserRow();
            currentBalance = Number((userRow && (userRow.balance_g != null ? userRow.balance_g : userRow.gas_balance)) || 0);
            document.getElementById('gas-balance').textContent = currentBalance.toLocaleString();
            if (window.MayijuIdentity) {
                window.MayijuIdentity.saveProfile({
                    ...currentUser,
                    gas_balance: currentBalance,
                    balance_g: currentBalance
                }, { device: 'desktop', silent: true });
            }
            const openerOrigin = getTrustedOpenerOrigin();
            if (openerOrigin) {
                try {
                    window.opener.postMessage({ type: 'gas-updated', balance: currentBalance }, openerOrigin);
                } catch (error) {
                    console.warn('同步余额到主窗口失败', error);
                }
            }
        }

        function subscribeBalance() {
            supabaseClient
                .channel('balance-changes')
                .on('postgres_changes',
                    { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${currentUser.id}` },
                    async () => {
                        await loadBalance();
                    }
                )
                .subscribe();
        }

        async function loadHistory() {
            const { data, error } = await supabaseClient
                .from('donations')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(10);

            if (error || !data || data.length === 0) {
                document.getElementById('history-card').style.display = 'none';
                return;
            }

            document.getElementById('history-card').style.display = 'block';
            const container = document.getElementById('records-list');
            container.innerHTML = data.map(record => {
                const date = new Date(record.created_at).toLocaleDateString('zh-CN');
                const methodLabel = record.payment_method || record.to_wallet || '未记录';
                return `
                    <div class="record-item">
                        <div>
                            <div class="record-amount">${escapeHtml(record.amount_u)} USDT / USD</div>
                            <div class="record-time">${escapeHtml(date)} | 方式: ${escapeHtml(methodLabel)}</div>
                        </div>
                        <div class="record-side">
                            <div class="record-gas">${escapeHtml(record.gas_reward || 0)} Gas</div>
                            <span class="record-status status-completed">已开通</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function copyPaymentValue(value) {
            navigator.clipboard.writeText(String(value || '')).then(() => {
                showNotification('已复制收款信息', 'success');
            }).catch(() => {
                const input = document.createElement('input');
                input.value = String(value || '');
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
                showNotification('已复制收款信息', 'success');
            });
        }

        function showNotification(msg, type) {
            const el = document.getElementById('notification');
            el.textContent = msg;
            el.className = `notification ${type} show`;
            setTimeout(() => el.classList.remove('show'), 3000);
        }

        function closeWindow() {
            if (window.opener) {
                window.close();
            } else {
                window.location.href = 'index.html/index.html';
            }
        }

        window.onload = () => {
            setTimeout(() => {
                if (window.MayijuSecurity && typeof window.MayijuSecurity.upgradeLegacyActivationState === 'function') {
                    window.MayijuSecurity.upgradeLegacyActivationState();
                }
                if (!window.opener && !currentUser) {
                    console.warn('建议从主系统打开此页面以确保登录态同步');
                }
                const closeBtn = document.getElementById('closeWindowBtn');
                if (closeBtn) {
                    closeBtn.addEventListener('click', closeWindow);
                }
                document.querySelectorAll('.payment-copy-btn').forEach((btn) => {
                    btn.addEventListener('click', () => copyPaymentValue(btn.dataset.copyValue || ''));
                });
                const submitBtn = document.getElementById('submit-btn');
                if (submitBtn) {
                    submitBtn.addEventListener('click', submitDonation);
                }
                const activateByCodeBtn = document.getElementById('offlineActivateCodeBtn');
                if (activateByCodeBtn) {
                    activateByCodeBtn.addEventListener('click', offlineActivateByCode);
                }
                const activateManualBtn = document.getElementById('offlineActivateManualBtn');
                if (activateManualBtn) {
                    activateManualBtn.addEventListener('click', offlineActivateManual);
                }
                init();
            }, 100);
        };
    

