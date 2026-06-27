        let inviteReferrerId = null;
        // #region debug-point B:register-runtime
        const DEBUG_SERVER_URL = `http://${location.hostname || '127.0.0.1'}:7777/event`;
        const DEBUG_SESSION_ID = "b-device-flow";
        function reportDebugEvent(hypothesisId, location, msg, data) {
            fetch(DEBUG_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: DEBUG_SESSION_ID,
                    runId: 'pre-fix',
                    hypothesisId,
                    location,
                    msg,
                    data: data || {},
                    ts: Date.now()
                })
            }).catch(() => {});
        }
        window.addEventListener('error', (event) => {
            reportDebugEvent('B', 'register.page.js:global-error', '[DEBUG] register page runtime error', {
                message: event && event.message ? event.message : 'UNKNOWN',
                filename: event && event.filename ? event.filename : '',
                lineno: event && event.lineno ? event.lineno : 0
            });
        });
        // #endregion
        (function () {
            try {
                const params = new URLSearchParams(window.location.search);
                const ref = params.get('ref');
                if (ref) {
                    inviteReferrerId = ref;
                    localStorage.setItem('invite_referrer_id', ref);
                }
            } catch (e) {}
        })();

        function bytesToHex(bytes) {
            return Array.from(bytes || []).map((b) => b.toString(16).padStart(2, '0')).join('');
        }

        async function hashPassword(password) {
            if (!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues)) {
                throw new Error('当前浏览器不支持安全密码存储，请更换现代浏览器后再注册');
            }
            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const encoder = new TextEncoder();
            const baseKey = await window.crypto.subtle.importKey(
                'raw',
                encoder.encode(String(password || '')),
                'PBKDF2',
                false,
                ['deriveBits']
            );
            const derivedBits = await window.crypto.subtle.deriveBits(
                {
                    name: 'PBKDF2',
                    salt,
                    iterations: 120000,
                    hash: 'SHA-256'
                },
                baseKey,
                256
            );
            const hashBytes = new Uint8Array(derivedBits);
            return `pbkdf2$120000$${bytesToHex(salt)}$${bytesToHex(hashBytes)}`;
        }

        async function handleRegister() {
            const email = document.getElementById('register-email').value.trim();
            const phone = document.getElementById('register-phone').value.trim();
            const password = document.getElementById('register-password').value;
            const confirm = document.getElementById('register-confirm').value;
            const messageEl = document.getElementById('register-message');
            
            // 验证输入
            if (!email && !phone) {
                messageEl.textContent = '邮箱或手机号至少填一项';
                messageEl.style.color = '#ff4444';
                return;
            }
            
            if (!password || password.length < 6) {
                messageEl.textContent = '密码至少6位';
                messageEl.style.color = '#ff4444';
                return;
            }
            
            if (password !== confirm) {
                messageEl.textContent = '两次密码不一致';
                messageEl.style.color = '#ff4444';
                return;
            }
            
            messageEl.textContent = '注册中...';
            messageEl.style.color = '#ffd700';
            // #region debug-point B:register-submit
            reportDebugEvent('B', 'register.page.js:handleRegister:start', '[DEBUG] register submit start', {
                hasEmail: !!email,
                hasPhone: !!phone,
                passwordLength: password ? password.length : 0,
                hasSupabase: !!window.supabaseInstance,
                hasIdentity: !!window.MayijuIdentity,
                hostname: location.hostname || ''
            });
            // #endregion
            
            try {
                const supabase = window.supabaseInstance;
                if (!supabase) throw new Error('本地数据库未就绪');

                if(email){
                    const checkEmail = await supabase.from('users').select('*').eq('email', email).maybeSingle();
                    if(checkEmail && checkEmail.data) throw new Error('该邮箱已被注册');
                }
                if(phone){
                    const checkPhone = await supabase.from('users').select('*').eq('phone_number', phone).maybeSingle();
                    if(checkPhone && checkPhone.data) throw new Error('该手机号已被注册');
                }

                const passwordHash = await hashPassword(password);

                const newUserPayload = {
                    email: email || null,
                    phone_number: phone || null,
                    password_hash: passwordHash,
                    balance_g: 0,
                    gas_balance: 0,
                    total_donation: 0,
                    referred_paid_count: 0,
                    reward_granted_to_referrer: false,
                    is_active: false,
                    referrer_id: inviteReferrerId || localStorage.getItem('invite_referrer_id') || null,
                    created_at: new Date().toISOString()
                };

                const createdRes = await supabase
                    .from('users')
                    .insert(newUserPayload)
                    .select()
                    .single();

                if(createdRes.error || !createdRes.data) throw new Error('注册失败');

                const currentUser = {
                    id: createdRes.data.id,
                    email: createdRes.data.email || email,
                    phone: createdRes.data.phone_number || phone,
                    gas_balance: createdRes.data.balance_g || 0
                };

                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                localStorage.setItem('mayiju.session', JSON.stringify({ userId: currentUser.id }));
                localStorage.removeItem('mayiju_access');
                localStorage.removeItem('aim2m_activated');
                localStorage.removeItem('aim2m_activation_meta');
                localStorage.removeItem('aim2m_activation_sig');
                localStorage.removeItem('invite_referrer_id');

                if(window.MayijuIdentity){
                    window.MayijuIdentity.saveProfile(currentUser, { device: 'desktop', silent: true });
                }
                // #region debug-point B:register-success
                reportDebugEvent('B', 'register.page.js:handleRegister:success', '[DEBUG] register submit success', {
                    userId: currentUser.id,
                    hasEmail: !!currentUser.email,
                    hasPhone: !!currentUser.phone
                });
                // #endregion
                
                messageEl.textContent = '注册成功，正在跳转...';
                messageEl.style.color = '#00cc66';
                
                // 延迟跳转
                setTimeout(() => {
                    window.location.href = 'juanzeng.html';
                }, 1500);

            } catch (error) {
                // #region debug-point B:register-fail
                reportDebugEvent('B', 'register.page.js:handleRegister:fail', '[DEBUG] register submit failed', {
                    message: error && error.message ? error.message : 'UNKNOWN'
                });
                // #endregion
                console.error(error);
                messageEl.textContent = `错误：${error.message}`;
                messageEl.style.color = '#ff4444';
            }
        }

        window.addEventListener('DOMContentLoaded', () => {
            // #region debug-point B:register-ready
            reportDebugEvent('B', 'register.page.js:domcontentloaded', '[DEBUG] register page ready', {
                hasSubmitBtn: !!document.getElementById('registerSubmitBtn'),
                hasBackBtn: !!document.getElementById('registerBackBtn'),
                hasSupabase: !!window.supabaseInstance,
                hasIdentity: !!window.MayijuIdentity
            });
            // #endregion
            const submitBtn = document.getElementById('registerSubmitBtn');
            const backBtn = document.getElementById('registerBackBtn');
            if (submitBtn) {
                submitBtn.addEventListener('click', handleRegister);
            }
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    window.location.href = 'juanzeng.html';
                });
            }
        });
    
