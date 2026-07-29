(function(){
    const STORAGE_KEY = 'mayiju.profile';
    const ACTIVATION_META_KEY = 'aim2m_activation_meta';
    const ACTIVATION_SIG_KEY = 'aim2m_activation_sig';
    const ACTIVATION_FLAG_KEYS = ['mayiju_access', 'aim2m_activated'];
    const ACTIVATION_SECRET = 'AIM2M_LOCAL_ACTIVATION_SIG_V1';

    function safeParse(str, fallback){
        try{
            return JSON.parse(str);
        }catch{
            return fallback;
        }
    }

    function simpleHash(text){
        let hash = 2166136261;
        const str = String(text || '');
        for(let i = 0; i < str.length; i++){
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }

    function stableStringify(value){
        if(value === null || value === undefined) return 'null';
        if(Array.isArray(value)){
            return '[' + value.map((item)=> stableStringify(item)).join(',') + ']';
        }
        if(typeof value === 'object'){
            const keys = Object.keys(value).sort();
            return '{' + keys.map((key)=> JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
        }
        return JSON.stringify(value);
    }

    function getCurrentIdentityScope(){
        const currentUser = safeParse(localStorage.getItem('currentUser'), null);
        const session = safeParse(localStorage.getItem('mayiju.session'), null);
        const profile = safeParse(localStorage.getItem(STORAGE_KEY), null);
        const aim2mProfile = safeParse(localStorage.getItem('aim2m_profile'), null);
        const localPhone = localStorage.getItem('mayiju_user_phone');
        const profileLabel = [
            aim2mProfile && (aim2mProfile.name || aim2mProfile.display_name || aim2mProfile.email || aim2mProfile.phone),
            profile && (profile.email || profile.phone || profile.id),
            currentUser && (currentUser.email || currentUser.phone || currentUser.id),
            session && (session.email || session.phone || session.userId),
            localPhone
        ].find(Boolean) || '';
        return {
            current_user_id: currentUser && currentUser.id ? String(currentUser.id) : '',
            session_user_id: session && session.userId ? String(session.userId) : '',
            profile_label: String(profileLabel || ''),
            origin: window.location && window.location.origin ? window.location.origin : 'local'
        };
    }

    function normalizeActivationMeta(meta){
        const source = meta && typeof meta === 'object' ? meta : {};
        return {
            type: source.type || 'unknown',
            mode: source.mode || null,
            code: source.code || null,
            name: source.name || null,
            amount: source.amount == null ? null : Number(source.amount),
            method: source.method || null,
            proof: source.proof || null,
            at: source.at || new Date().toISOString()
        };
    }

    function signActivationMeta(meta){
        const payload = {
            meta: normalizeActivationMeta(meta),
            identity: getCurrentIdentityScope()
        };
        return simpleHash(stableStringify(payload) + '|' + ACTIVATION_SECRET);
    }

    function persistActivation(meta){
        const normalized = normalizeActivationMeta(meta);
        const sig = signActivationMeta(normalized);
        for(const key of ACTIVATION_FLAG_KEYS){
            localStorage.setItem(key, '1');
        }
        localStorage.setItem(ACTIVATION_META_KEY, JSON.stringify(normalized));
        localStorage.setItem(ACTIVATION_SIG_KEY, sig);
        return { meta: normalized, sig };
    }

    function clearActivation(){
        for(const key of ACTIVATION_FLAG_KEYS){
            localStorage.removeItem(key);
        }
        localStorage.removeItem(ACTIVATION_META_KEY);
        localStorage.removeItem(ACTIVATION_SIG_KEY);
    }

    function verifyActivationState(){
        const hasFlag = ACTIVATION_FLAG_KEYS.some((key)=> localStorage.getItem(key) === '1');
        if(!hasFlag) return false;
        const meta = safeParse(localStorage.getItem(ACTIVATION_META_KEY), null);
        const sig = localStorage.getItem(ACTIVATION_SIG_KEY);
        if(!meta || !sig) return false;
        return signActivationMeta(meta) === sig;
    }

    function upgradeLegacyActivationState(){
        const hasFlag = ACTIVATION_FLAG_KEYS.some((key)=> localStorage.getItem(key) === '1');
        const meta = safeParse(localStorage.getItem(ACTIVATION_META_KEY), null);
        const sig = localStorage.getItem(ACTIVATION_SIG_KEY);
        if(!hasFlag) return false;
        if(meta && !sig){
            persistActivation(meta);
            return true;
        }
        if(!meta){
            persistActivation({ type: 'legacy-state', at: new Date().toISOString() });
            return true;
        }
        return false;
    }

    function saveProfile(profile, opts){
        const data = Object.assign({}, profile || {});
        const payload = Object.assign({}, data, { saved_at: new Date().toISOString() });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        if(!(opts && opts.silent)){
            try{ window.dispatchEvent(new CustomEvent('mayiju:profile', { detail: payload })); }catch{}
        }
        return payload;
    }

    function loadProfile(){
        return safeParse(localStorage.getItem(STORAGE_KEY), null);
    }

    function syncProfile(){
        return loadProfile();
    }

    function normalizeProfile(profile, fallback){
        const source = profile || fallback || {};
        return {
            id: source.id || null,
            email: source.email || null,
            phone: source.phone || source.phone_number || null,
            display_name: source.display_name || source.email || source.phone || source.phone_number || '未命名用户',
            source_table: source.source_table || 'localStorage',
            gas_balance: source.gas_balance != null ? source.gas_balance : (source.balance_g != null ? source.balance_g : 0)
        };
    }

    function clearProfile(){
        localStorage.removeItem(STORAGE_KEY);
    }

    window.MayijuIdentity = {
        saveProfile,
        loadProfile,
        syncProfile,
        normalizeProfile,
        clearProfile
    };

    window.MayijuSecurity = {
        normalizeActivationMeta,
        signActivationMeta,
        persistActivation,
        verifyActivationState,
        clearActivation,
        upgradeLegacyActivationState
    };
})();
