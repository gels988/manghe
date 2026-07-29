(function(){
    const DB_NAME = 'mayiju_local';
    const DB_VERSION = 2;
    const BUS_NAME = 'mayiju_bus_v1';
    const STORE_NAMES = ['users', 'donations', 'gas_transfer_log', 'activation_codes'];
    const SELF_CHECK_REPORT_KEY = 'mayiju.selfcheck.report';
    const STATE_KEYS = [
        'currentUser',
        'mayiju.session',
        'mayiju_access',
        'aim2m_activated',
        'mayiju.profile',
        'aim2m_activation_meta',
        'aim2m_activation_sig',
        'mayiju_referral_link',
        'mayiju_referral_flash',
        SELF_CHECK_REPORT_KEY
    ];
    const OFFICIAL_WEB_ORIGIN = 'https://dushu-cd1.pages.dev';
    const OFFICIAL_API_ORIGIN = 'https://rome-moss-gained-originally.trycloudflare.com';
    const DISALLOWED_PUBLIC_HOSTS = new Set([
        'gels988.github.io'
    ]);
    const MAX_ROWS_PER_STORE = 5000;
    const MAX_LOCAL_STATE_VALUE_LENGTH = 32768;
    const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    // #region debug-point C:db-runtime
    const DEBUG_SERVER_URL = `http://${location.hostname || '127.0.0.1'}:7777/event`;
    const DEBUG_SESSION_ID = "b-device-flow";
    function reportDebugEvent(hypothesisId, location, msg, data){
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
        }).catch(()=>{});
    }
    reportDebugEvent('C', 'db_client.js:load', '[DEBUG] db client script loaded', {
        hostname: location.hostname || '',
        hasIndexedDB: typeof indexedDB !== 'undefined'
    });
    // #endregion
    const STORE_SCHEMAS = {
        users: {
            required: ['id'],
            stringFields: ['id', 'email', 'phone_number', 'password_hash', 'referrer_id', 'created_at', 'last_active', 'activated_via', 'last_payment_method', 'last_payment_ref', 'purchase_completed_at'],
            numberFields: ['balance_g', 'gas_balance', 'total_donation', 'referred_paid_count', 'referral_reward_g', 'free_activation_slots'],
            booleanFields: ['reward_granted_to_referrer', 'is_active', 'is_paid_customer'],
            maxStringLength: 512
        },
        donations: {
            required: ['id'],
            stringFields: ['id', 'user_id', 'tx_hash', 'to_wallet', 'payment_method', 'status', 'created_at'],
            numberFields: ['amount_u', 'gas_reward', 'referral_reward_to_parent'],
            booleanFields: [],
            maxStringLength: 512
        },
        gas_transfer_log: {
            required: ['id'],
            stringFields: ['id', 'from_user_id', 'to_user_id', 'type', 'created_at'],
            numberFields: ['amount'],
            booleanFields: [],
            maxStringLength: 256
        },
        activation_codes: {
            required: ['id'],
            stringFields: ['id', 'owner_user_id', 'issued_to_user_id', 'code', 'note', 'status', 'created_at', 'redeemed_at', 'source_type'],
            numberFields: ['cost_g'],
            booleanFields: [],
            maxStringLength: 1024
        }
    };

    function safeParse(str, fallback){
        try{ return JSON.parse(str); }catch{ return fallback; }
    }

    function safeNumber(value, fallback){
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function normalizeReferralLink(value){
        if(!value) return null;
        try{
            const parsed = new URL(String(value));
            const ref = parsed.searchParams.get('ref');
            if(DISALLOWED_PUBLIC_HOSTS.has(parsed.hostname)){
                const target = new URL('/register.html', OFFICIAL_WEB_ORIGIN);
                if(ref) target.searchParams.set('ref', ref);
                return target.toString();
            }
            return parsed.toString();
        }catch{
            return null;
        }
    }

    function normalizeReferralFlash(value){
        const payload = safeParse(value, null);
        if(!payload || typeof payload !== 'object') return null;
        const normalizedLink = normalizeReferralLink(payload.link);
        return JSON.stringify(Object.assign({}, payload, {
            link: normalizedLink || new URL('/register.html', OFFICIAL_WEB_ORIGIN).toString()
        }));
    }

    function repairLocalState(report){
        const repaired = report && Array.isArray(report.repaired) ? report.repaired : [];
        const warnings = report && Array.isArray(report.warnings) ? report.warnings : [];

        const referralLink = localStorage.getItem('mayiju_referral_link');
        const normalizedReferralLink = normalizeReferralLink(referralLink);
        if(referralLink && normalizedReferralLink && normalizedReferralLink !== referralLink){
            localStorage.setItem('mayiju_referral_link', normalizedReferralLink);
            repaired.push('local_state:mayiju_referral_link');
        }

        const referralFlash = localStorage.getItem('mayiju_referral_flash');
        const normalizedReferralFlash = normalizeReferralFlash(referralFlash);
        if(referralFlash && normalizedReferralFlash && normalizedReferralFlash !== referralFlash){
            localStorage.setItem('mayiju_referral_flash', normalizedReferralFlash);
            repaired.push('local_state:mayiju_referral_flash');
        }

        const runtimeState = localStorage.getItem(SELF_CHECK_REPORT_KEY);
        if(runtimeState){
            const parsed = safeParse(runtimeState, null);
            if(parsed && typeof parsed === 'object'){
                parsed.official_web_origin = OFFICIAL_WEB_ORIGIN;
                parsed.official_api_origin = OFFICIAL_API_ORIGIN;
                localStorage.setItem(SELF_CHECK_REPORT_KEY, JSON.stringify(parsed));
            }else{
                warnings.push('local_state:selfcheck_report_invalid');
            }
        }
    }

    function uuid(){
        if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'id_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
    }

    function isPlainObject(value){
        if(!value || typeof value !== 'object') return false;
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }

    function sanitizeObject(input){
        const out = {};
        if(!isPlainObject(input)) return out;
        for(const [key, value] of Object.entries(input)){
            if(DANGEROUS_KEYS.has(key)) continue;
            out[key] = value;
        }
        return out;
    }

    function openDb(){
        return new Promise((resolve, reject)=>{
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = ()=>{
                const db = req.result;
                if(!db.objectStoreNames.contains('users')){
                    const store = db.createObjectStore('users', { keyPath:'id' });
                    store.createIndex('email', 'email', { unique: true });
                    store.createIndex('phone_number', 'phone_number', { unique: true });
                    store.createIndex('referrer_id', 'referrer_id', { unique: false });
                    store.createIndex('created_at', 'created_at', { unique: false });
                }
                if(!db.objectStoreNames.contains('donations')){
                    const store = db.createObjectStore('donations', { keyPath:'id' });
                    store.createIndex('user_id', 'user_id', { unique: false });
                    store.createIndex('tx_hash', 'tx_hash', { unique: true });
                    store.createIndex('created_at', 'created_at', { unique: false });
                }
                if(!db.objectStoreNames.contains('gas_transfer_log')){
                    const store = db.createObjectStore('gas_transfer_log', { keyPath:'id' });
                    store.createIndex('from_user_id', 'from_user_id', { unique: false });
                    store.createIndex('to_user_id', 'to_user_id', { unique: false });
                    store.createIndex('created_at', 'created_at', { unique: false });
                }
                if(!db.objectStoreNames.contains('activation_codes')){
                    const store = db.createObjectStore('activation_codes', { keyPath:'id' });
                    store.createIndex('code', 'code', { unique: true });
                    store.createIndex('owner_user_id', 'owner_user_id', { unique: false });
                    store.createIndex('issued_to_user_id', 'issued_to_user_id', { unique: false });
                    store.createIndex('created_at', 'created_at', { unique: false });
                }
            };
            req.onsuccess = ()=> resolve(req.result);
            req.onerror = ()=> reject(req.error || new Error('IDB_OPEN_FAIL'));
        });
    }

    async function tx(storeName, mode, fn){
        const db = await openDb();
        return new Promise((resolve, reject)=>{
            const t = db.transaction(storeName, mode);
            const store = t.objectStore(storeName);
            Promise.resolve()
                .then(()=> fn(store, t))
                .then((result)=> resolve(result))
                .catch(reject);
            t.onerror = ()=> reject(t.error || new Error('IDB_TX_FAIL'));
        });
    }

    async function getAll(storeName){
        return tx(storeName, 'readonly', (store)=> new Promise((resolve, reject)=>{
            const req = store.getAll();
            req.onsuccess = ()=> resolve(req.result || []);
            req.onerror = ()=> reject(req.error || new Error('IDB_GETALL_FAIL'));
        }));
    }

    async function clearStore(storeName){
        return tx(storeName, 'readwrite', (store)=> new Promise((resolve, reject)=>{
            const req = store.clear();
            req.onsuccess = ()=> resolve(true);
            req.onerror = ()=> reject(req.error || new Error('IDB_CLEAR_FAIL'));
        }));
    }

    async function putMany(storeName, rows){
        const items = Array.isArray(rows) ? rows : [];
        const saved = [];
        for(const row of items){
            const data = sanitizeObject(row || {});
            if(!data.id) data.id = uuid();
            if(!data.created_at) data.created_at = new Date().toISOString();
            saved.push(await tx(storeName, 'readwrite', (store)=> new Promise((resolve, reject)=>{
                const req = store.put(data);
                req.onsuccess = ()=> resolve(data);
                req.onerror = ()=> reject(req.error || new Error('IDB_PUT_FAIL'));
            })));
        }
        if(saved.length){
            broadcast(`${storeName}:update`, saved);
        }
        return saved;
    }

    function applyFilters(rows, filters){
        let out = rows;
        for(const f of filters){
            if(f.op === 'eq'){
                out = out.filter(r => String(r[f.field]) === String(f.value));
            }
        }
        return out;
    }

    function applyOrder(rows, order){
        if(!order) return rows;
        const { field, ascending } = order;
        const dir = ascending ? 1 : -1;
        return rows.slice().sort((a,b)=>{
            const av = a[field];
            const bv = b[field];
            if(av === bv) return 0;
            return av > bv ? dir : -dir;
        });
    }

    function validateStoreRows(storeName, rows, errors){
        const schema = STORE_SCHEMAS[storeName];
        if(!schema){
            errors.push(`STORE_UNKNOWN:${storeName}`);
            return;
        }
        if(!Array.isArray(rows)){
            errors.push(`STORE_NOT_ARRAY:${storeName}`);
            return;
        }
        if(rows.length > MAX_ROWS_PER_STORE){
            errors.push(`STORE_TOO_LARGE:${storeName}`);
            return;
        }
        rows.forEach((row, index)=>{
            if(!isPlainObject(row)){
                errors.push(`${storeName}[${index}]:ROW_NOT_OBJECT`);
                return;
            }
            for(const key of schema.required){
                if(row[key] === undefined || row[key] === null || row[key] === ''){
                    errors.push(`${storeName}[${index}]:MISSING_${key}`);
                }
            }
            for(const key of schema.stringFields){
                if(row[key] === undefined || row[key] === null) continue;
                if(typeof row[key] !== 'string'){
                    errors.push(`${storeName}[${index}]:${key}_NOT_STRING`);
                    continue;
                }
                if(row[key].length > schema.maxStringLength){
                    errors.push(`${storeName}[${index}]:${key}_TOO_LONG`);
                }
            }
            for(const key of schema.numberFields){
                if(row[key] === undefined || row[key] === null) continue;
                if(typeof row[key] !== 'number' || !Number.isFinite(row[key])){
                    errors.push(`${storeName}[${index}]:${key}_NOT_NUMBER`);
                }
            }
            for(const key of schema.booleanFields){
                if(row[key] === undefined || row[key] === null) continue;
                if(typeof row[key] !== 'boolean'){
                    errors.push(`${storeName}[${index}]:${key}_NOT_BOOLEAN`);
                }
            }
        });
    }

    function validateSnapshotSchema(snapshot){
        const data = snapshot && snapshot.stores ? snapshot.stores : snapshot;
        const localState = snapshot && snapshot.local_state;
        const errors = [];
        const warnings = [];
        if(!data || typeof data !== 'object'){
            return { ok: false, errors: ['SNAPSHOT_INVALID'], warnings };
        }
        for(const storeName of STORE_NAMES){
            validateStoreRows(storeName, Array.isArray(data[storeName]) ? data[storeName] : [], errors);
        }
        if(localState !== undefined){
            if(!isPlainObject(localState)){
                errors.push('LOCAL_STATE_NOT_OBJECT');
            }else{
                for(const [key, value] of Object.entries(localState)){
                    if(!STATE_KEYS.includes(key)){
                        warnings.push(`LOCAL_STATE_UNKNOWN_KEY:${key}`);
                        continue;
                    }
                    if(value !== null && value !== undefined && typeof value !== 'string'){
                        errors.push(`LOCAL_STATE_INVALID_TYPE:${key}`);
                    }
                    if(typeof value === 'string' && value.length > MAX_LOCAL_STATE_VALUE_LENGTH){
                        errors.push(`LOCAL_STATE_TOO_LONG:${key}`);
                    }
                }
            }
        }
        return { ok: errors.length === 0, errors, warnings };
    }

    function broadcast(type, payload){
        try{
            const bc = new BroadcastChannel(BUS_NAME);
            bc.postMessage({ type, payload, at: Date.now() });
            bc.close();
        }catch{}
    }

    class Query{
        constructor(table){
            this.table = table;
            this.storeName = table === 'app_users' ? 'users' : table;
            this.filters = [];
            this._order = null;
            this._limit = null;
            this._single = false;
            this._maybeSingle = false;
            this._action = 'select';
            this._payload = null;
        }
        select(){
            return this;
        }
        insert(payload){
            this._action = 'insert';
            this._payload = payload;
            return this;
        }
        update(payload){
            this._action = 'update';
            this._payload = payload;
            return this;
        }
        eq(field, value){
            this.filters.push({ op:'eq', field, value });
            return this;
        }
        order(field, opts){
            this._order = { field, ascending: opts && opts.ascending !== false };
            return this;
        }
        limit(n){
            this._limit = n;
            return this;
        }
        single(){
            this._single = true;
            return this;
        }
        maybeSingle(){
            this._maybeSingle = true;
            return this;
        }
        then(resolve, reject){
            this.exec().then(resolve, reject);
        }
        async exec(){
            try{
                if(this._action === 'insert'){
                    const rows = Array.isArray(this._payload) ? this._payload : [this._payload];
                    const inserted = [];
                    for(const row of rows){
                        const data = sanitizeObject(row || {});
                        if(!data.id) data.id = uuid();
                        if(!data.created_at) data.created_at = new Date().toISOString();
                        inserted.push(await tx(this.storeName, 'readwrite', (store)=> new Promise((resolve, reject)=>{
                            const req = store.add(data);
                            req.onsuccess = ()=> resolve(data);
                            req.onerror = ()=> reject(req.error || new Error('IDB_INSERT_FAIL'));
                        })));
                    }
                    broadcast(`${this.storeName}:insert`, inserted);
                    return { data: this._single ? inserted[0] : inserted, error: null };
                }

                if(this._action === 'update'){
                    const updatePatch = sanitizeObject(this._payload || {});
                    const all = await getAll(this.storeName);
                    const matched = applyFilters(all, this.filters);
                    const updated = [];
                    for(const row of matched){
                        const next = Object.assign({}, row, updatePatch);
                        updated.push(await tx(this.storeName, 'readwrite', (store)=> new Promise((resolve, reject)=>{
                            const req = store.put(next);
                            req.onsuccess = ()=> resolve(next);
                            req.onerror = ()=> reject(req.error || new Error('IDB_UPDATE_FAIL'));
                        })));
                    }
                    if(updated.length){
                        broadcast(`${this.storeName}:update`, updated);
                    }
                    return { data: this._single ? updated[0] : updated, error: null };
                }

                const all = await getAll(this.storeName);
                let rows = applyFilters(all, this.filters);
                rows = applyOrder(rows, this._order);
                if(Number.isFinite(this._limit)) rows = rows.slice(0, this._limit);

                if(this._single){
                    if(rows.length !== 1){
                        return { data: null, error: { message: 'SINGLE_EXPECT_ONE' } };
                    }
                    return { data: rows[0], error: null };
                }
                if(this._maybeSingle){
                    if(rows.length === 0) return { data: null, error: null };
                    if(rows.length > 1) return { data: null, error: { message: 'MAYBE_SINGLE_EXPECT_ZERO_OR_ONE' } };
                    return { data: rows[0], error: null };
                }
                return { data: rows, error: null };
            }catch(e){
                return { data: null, error: { message: String(e && e.message ? e.message : e) } };
            }
        }
    }

    const SESSION_KEY = 'mayiju.session';

    function getSessionObj(){
        return safeParse(localStorage.getItem(SESSION_KEY), null);
    }

    function setSessionObj(s){
        localStorage.setItem(SESSION_KEY, JSON.stringify(s || {}));
    }

    const auth = {
        async getSession(){
            const s = getSessionObj();
            if(!s || !s.userId){
                return { data:{ session: null }, error: null };
            }
            const userRes = await new Query('users').eq('id', s.userId).maybeSingle().exec();
            const user = userRes.data ? { id: userRes.data.id, email: userRes.data.email || null, phone: userRes.data.phone_number || null } : { id: s.userId };
            return { data:{ session: { user, access_token: s.accessToken || '', refresh_token: s.refreshToken || '' } }, error: null };
        },
        async getUser(){
            const s = getSessionObj();
            if(!s || !s.userId){
                return { data:{ user: null }, error: { message:'NO_SESSION' } };
            }
            const userRes = await new Query('users').eq('id', s.userId).maybeSingle().exec();
            if(!userRes.data){
                return { data:{ user: null }, error: { message:'NO_USER' } };
            }
            return { data:{ user: { id: userRes.data.id, email: userRes.data.email || null, phone: userRes.data.phone_number || null } }, error: null };
        },
        async setSession(tokens){
            const s = getSessionObj() || {};
            setSessionObj(Object.assign({}, s, { accessToken: tokens && tokens.access_token ? tokens.access_token : s.accessToken, refreshToken: tokens && tokens.refresh_token ? tokens.refresh_token : s.refreshToken }));
            return { data:{ session: getSessionObj() }, error: null };
        }
    };

    function rpc(name, params){
        const q = {
            then: (resolve, reject)=>{
                (async ()=>{
                    try{
                        if(name === 'increment_gas'){
                            const userId = params && (params.user_id || params.userId);
                            const amount = parseFloat(params && params.amount);
                            if(!userId || !Number.isFinite(amount)) return { data:null, error:{ message:'RPC_PARAMS' } };
                            const res = await new Query('users').eq('id', userId).maybeSingle().exec();
                            const user = res.data;
                            if(!user) return { data:null, error:{ message:'NO_USER' } };
                            const current = Number.isFinite(parseFloat(user.balance_g)) ? parseFloat(user.balance_g) : (Number.isFinite(parseFloat(user.gas_balance)) ? parseFloat(user.gas_balance) : 0);
                            const next = current + amount;
                            await new Query('users').update({ balance_g: next, gas_balance: next }).eq('id', userId).exec();
                            return { data:{ user_id: userId, amount, balance_g: next }, error:null };
                        }
                        return { data:null, error:{ message:'RPC_NOT_SUPPORTED' } };
                    }catch(e){
                        return { data:null, error:{ message:String(e && e.message ? e.message : e) } };
                    }
                })().then(resolve, reject);
            }
        };
        return q;
    }

    async function exportSnapshot(){
        const stores = {};
        for(const storeName of STORE_NAMES){
            stores[storeName] = await getAll(storeName);
        }
        const local_state = {};
        for(const key of STATE_KEYS){
            const value = localStorage.getItem(key);
            if(value !== null){
                local_state[key] = value;
            }
        }
        return {
            meta: {
                db_name: DB_NAME,
                db_version: DB_VERSION,
                exported_at: new Date().toISOString(),
                store_names: STORE_NAMES.slice(),
                state_keys: STATE_KEYS.slice()
            },
            stores,
            local_state
        };
    }

    async function importSnapshot(snapshot, opts){
        const mode = opts && opts.mode === 'replace' ? 'replace' : 'merge';
        const stateMode = opts && opts.state_mode === 'preserve_local' ? 'preserve_local' : 'overwrite_import';
        const data = snapshot && snapshot.stores ? snapshot.stores : snapshot;
        if(!data || typeof data !== 'object'){
            throw new Error('SNAPSHOT_INVALID');
        }
        const schemaCheck = validateSnapshotSchema(snapshot);
        if(!schemaCheck.ok){
            throw new Error(`SNAPSHOT_SCHEMA_INVALID:${schemaCheck.errors.join(',')}`);
        }
        const summary = { mode, state_mode: stateMode, stores: {}, imported_at: new Date().toISOString() };
        for(const storeName of STORE_NAMES){
            const rows = Array.isArray(data[storeName]) ? data[storeName] : [];
            if(mode === 'replace'){
                await clearStore(storeName);
            }
            const saved = await putMany(storeName, rows);
            summary.stores[storeName] = saved.length;
        }
        const localState = snapshot && snapshot.local_state && typeof snapshot.local_state === 'object'
            ? snapshot.local_state
            : {};
        summary.local_state = {};
        for(const key of STATE_KEYS){
            if(Object.prototype.hasOwnProperty.call(localState, key)){
                const value = localState[key];
                if(stateMode === 'preserve_local'){
                    summary.local_state[key] = localStorage.getItem(key) === null ? 'missing_local' : 'kept_local';
                }else{
                    if(value === null || value === undefined){
                        localStorage.removeItem(key);
                        summary.local_state[key] = 'removed';
                    }else{
                        localStorage.setItem(key, String(value));
                        summary.local_state[key] = 'restored';
                    }
                }
            }
        }
        summary.restored_identity = readRestoredIdentity();
        return summary;
    }

    async function previewImportConflicts(snapshot){
        const data = snapshot && snapshot.stores ? snapshot.stores : snapshot;
        if(!data || typeof data !== 'object'){
            throw new Error('SNAPSHOT_INVALID');
        }
        const schemaCheck = validateSnapshotSchema(snapshot);
        if(!schemaCheck.ok){
            throw new Error(`SNAPSHOT_SCHEMA_INVALID:${schemaCheck.errors.join(',')}`);
        }
        const preview = {
            generated_at: new Date().toISOString(),
            stores: {},
            local_state: {},
            totals: { incoming: 0, conflicts: 0, new_rows: 0, state_conflicts: 0 },
            warnings: schemaCheck.warnings
        };
        for(const storeName of STORE_NAMES){
            const incoming = Array.isArray(data[storeName]) ? data[storeName] : [];
            const existing = await getAll(storeName);
            const existingMap = new Map(existing.map((row)=> [String(row.id), row]));
            const conflicts = [];
            let newRows = 0;
            for(const row of incoming){
                preview.totals.incoming += 1;
                const key = String(row && row.id ? row.id : '');
                if(key && existingMap.has(key)){
                    conflicts.push({
                        id: key,
                        incoming_summary: summarizeRow(row),
                        existing_summary: summarizeRow(existingMap.get(key))
                    });
                    preview.totals.conflicts += 1;
                }else{
                    newRows += 1;
                    preview.totals.new_rows += 1;
                }
            }
            preview.stores[storeName] = {
                incoming_count: incoming.length,
                conflict_count: conflicts.length,
                new_count: newRows,
                conflicts
            };
        }
        const localState = snapshot && snapshot.local_state && typeof snapshot.local_state === 'object'
            ? snapshot.local_state
            : {};
        for(const key of STATE_KEYS){
            if(!Object.prototype.hasOwnProperty.call(localState, key)) continue;
            const existingValue = localStorage.getItem(key);
            const incomingValue = localState[key];
            const conflict = existingValue !== null && String(existingValue) !== String(incomingValue);
            if(conflict) preview.totals.state_conflicts += 1;
            preview.local_state[key] = {
                has_existing: existingValue !== null,
                conflict,
                existing_summary: existingValue === null ? '(empty)' : summarizeStateValue(existingValue),
                incoming_summary: summarizeStateValue(incomingValue)
            };
        }
        return preview;
    }

    function summarizeRow(row){
        if(!row || typeof row !== 'object') return '(empty)';
        const keys = ['id', 'email', 'phone_number', 'user_id', 'code', 'tx_hash', 'status', 'amount_u', 'balance_g', 'cost_g', 'created_at'];
        const picked = [];
        for(const key of keys){
            if(row[key] !== undefined && row[key] !== null && row[key] !== ''){
                picked.push(`${key}=${String(row[key])}`);
            }
            if(picked.length >= 4) break;
        }
        return picked.join(' | ') || JSON.stringify(row).slice(0, 120);
    }

    function summarizeStateValue(value){
        if(value === null || value === undefined || value === '') return '(empty)';
        const text = String(value);
        return text.length > 140 ? text.slice(0, 140) + '...' : text;
    }

    function readRestoredIdentity(){
        const currentUser = safeParse(localStorage.getItem('currentUser'), null);
        const session = safeParse(localStorage.getItem('mayiju.session'), null);
        const profile = safeParse(localStorage.getItem('mayiju.profile'), null);
        const activated = window.MayijuSecurity && typeof window.MayijuSecurity.verifyActivationState === 'function'
            ? window.MayijuSecurity.verifyActivationState()
            : (localStorage.getItem('mayiju_access') === '1' || localStorage.getItem('aim2m_activated') === '1');
        return {
            current_user_id: currentUser && currentUser.id ? currentUser.id : null,
            current_user_label: currentUser ? (currentUser.email || currentUser.phone || currentUser.id || null) : null,
            session_user_id: session && session.userId ? session.userId : null,
            activated,
            profile_label: profile ? (profile.email || profile.phone || profile.id || null) : null
        };
    }

    async function repairData(){
        const report = {
            checked_at: new Date().toISOString(),
            repaired: [],
            warnings: []
        };

        const users = await getAll('users');
        for(const user of users){
            const next = Object.assign({}, user);
            let changed = false;
            const balance = Number.isFinite(parseFloat(next.balance_g)) ? parseFloat(next.balance_g) : (Number.isFinite(parseFloat(next.gas_balance)) ? parseFloat(next.gas_balance) : 0);
            if(next.balance_g !== balance){ next.balance_g = balance; changed = true; }
            if(next.gas_balance !== balance){ next.gas_balance = balance; changed = true; }
            if(typeof next.total_donation !== 'number'){ next.total_donation = Number(next.total_donation || 0); changed = true; }
            if(typeof next.referred_paid_count !== 'number'){ next.referred_paid_count = Number(next.referred_paid_count || 0); changed = true; }
            const unlockedSlots = Math.max(0, Math.floor(Number(next.referred_paid_count || 0) / 3));
            const currentSlots = safeNumber(next.free_activation_slots, unlockedSlots);
            if(next.free_activation_slots !== Math.max(currentSlots, unlockedSlots)){ next.free_activation_slots = Math.max(currentSlots, unlockedSlots); changed = true; }
            if(typeof next.reward_granted_to_referrer !== 'boolean'){ next.reward_granted_to_referrer = Boolean(next.reward_granted_to_referrer); changed = true; }
            if(typeof next.is_active !== 'boolean'){ next.is_active = Boolean(next.is_active); changed = true; }
            if(changed){
                await putMany('users', [next]);
                report.repaired.push(`users:${next.id}`);
            }
        }

        const donations = await getAll('donations');
        for(const donation of donations){
            const next = Object.assign({}, donation);
            let changed = false;
            if(typeof next.status !== 'string' || !next.status){
                next.status = 'completed';
                changed = true;
            }
            if(typeof next.amount_u !== 'number'){
                next.amount_u = Number(next.amount_u || 0);
                changed = true;
            }
            if(typeof next.gas_reward !== 'number'){
                next.gas_reward = Number(next.gas_reward || 0);
                changed = true;
            }
            if(changed){
                await putMany('donations', [next]);
                report.repaired.push(`donations:${next.id}`);
            }
        }

        const activationCodes = await getAll('activation_codes');
        for(const item of activationCodes){
            const next = Object.assign({}, item);
            let changed = false;
            if(typeof next.status !== 'string' || !next.status){
                next.status = 'new';
                changed = true;
            }
            if(typeof next.cost_g !== 'number'){
                next.cost_g = Number(next.cost_g || 660);
                changed = true;
            }
            const expectedSourceType = next.cost_g === 0 ? 'free_referral_quota' : 'balance_purchase';
            if(typeof next.source_type !== 'string' || !next.source_type){
                next.source_type = expectedSourceType;
                changed = true;
            }
            if(changed){
                await putMany('activation_codes', [next]);
                report.repaired.push(`activation_codes:${next.id}`);
            }
        }

        repairLocalState(report);

        if(users.length === 0){
            report.warnings.push('users:empty');
        }
        saveSelfCheckReport(report);
        return report;
    }

    function saveSelfCheckReport(report){
        localStorage.setItem(SELF_CHECK_REPORT_KEY, JSON.stringify(Object.assign({
            generated_at: new Date().toISOString()
        }, report || {})));
    }

    function getSelfCheckReport(){
        return safeParse(localStorage.getItem(SELF_CHECK_REPORT_KEY), null);
    }

    function channel(){
        const handlers = [];
        const bc = (()=>{ try{ return new BroadcastChannel(BUS_NAME); }catch{ return null; } })();
        if(bc){
            bc.onmessage = (ev)=>{
                const msg = ev.data;
                for(const h of handlers){
                    try{ h(msg); }catch{}
                }
            };
        }
        return {
            on: function(_type, _filter, cb){
                handlers.push((msg)=>{
                    if(!msg || typeof msg.type !== 'string') return;
                    if(msg.type.startsWith('users:')){
                        cb({ new: msg.payload });
                    }
                });
                return this;
            },
            subscribe: function(){
                return { data:{ subscription: { state:'SUBSCRIBED' } }, error:null };
            }
        };
    }

    window.supabaseInstance = {
        auth,
        from: (table)=> new Query(table),
        rpc,
        channel
    };
    // #region debug-point C:db-ready
    reportDebugEvent('C', 'db_client.js:ready', '[DEBUG] db client ready', {
        hasSupabaseInstance: !!window.supabaseInstance,
        methods: ['auth', 'from', 'rpc', 'channel']
    });
    // #endregion

    window.MayijuLocalDB = {
        exportSnapshot,
        importSnapshot,
        previewImportConflicts,
        validateSnapshotSchema,
        repairData,
        saveSelfCheckReport,
        getSelfCheckReport,
        listStores: ()=> STORE_NAMES.slice(),
        readStore: (storeName)=> getAll(storeName),
        clearStore
    };
})();
