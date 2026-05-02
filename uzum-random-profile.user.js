// ==UserScript==
// @name         Uzum Reviews - Random Profile Name Auto Learn
// @namespace    https://uzum.uz/
// @version      1.0.2
// @description  Кнопки на странице отзывов Uzum для смены имени, фамилии и пола через автоматически пойманный запрос сохранения профиля
// @author       You
// @match        https://uzum.uz/ru/user/*
// @match        https://www.uzum.uz/ru/user/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.uzum.uz
// @connect      randomall.ru
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AalaislA/uzum-scripts/main/uzum-random-profile.user.js
// @downloadURL  https://raw.githubusercontent.com/AalaislA/uzum-scripts/main/uzum-random-profile.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        randomAll: {
            female: 5556,
            male: 4103,
        },

        reloadAfterSuccess: false,
    };

    const STORAGE_KEY = 'tm_uzum_random_profile_v3';

    const state = {
        busy: false,
        auth: {
            bearer: null,
            xIid: null,
            headers: {},
            lastApiUrl: null,
            recentRequests: [],
            learnedNameRequest: null,
        },
    };

    function safeText(value) {
        if (value === undefined || value === null) return '';
        return String(value);
    }

    function cutText(value, limit = 300) {
        return safeText(value).slice(0, limit);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: options.url,
                headers: options.headers || {},
                data: options.data,
                timeout: options.timeout || 25000,
                responseType: options.responseType || 'text',
                withCredentials: true,
                anonymous: false,
                onload: resolve,
                onerror: reject,
                ontimeout: () => reject(new Error('Таймаут запроса')),
            });
        });
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.auth));
        } catch {}
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw);

            state.auth = {
                ...state.auth,
                ...parsed,
                headers: parsed.headers || {},
                recentRequests: parsed.recentRequests || [],
            };
        } catch {}
    }

    function normalizeHeaders(headersLike) {
        const result = {};

        try {
            if (!headersLike) return result;

            if (typeof headersLike.forEach === 'function') {
                headersLike.forEach((value, key) => {
                    result[String(key).toLowerCase()] = String(value);
                });
                return result;
            }

            if (Array.isArray(headersLike)) {
                for (const item of headersLike) {
                    if (Array.isArray(item) && item.length >= 2) {
                        result[String(item[0]).toLowerCase()] = String(item[1]);
                    }
                }
                return result;
            }

            if (typeof headersLike === 'object') {
                for (const key of Object.keys(headersLike)) {
                    result[String(key).toLowerCase()] = String(headersLike[key]);
                }
            }
        } catch {}

        return result;
    }

    function bodyToText(body) {
        try {
            if (body === undefined || body === null) return '';

            if (typeof body === 'string') return body;

            if (body instanceof URLSearchParams) {
                return body.toString();
            }

            if (
                typeof FormData !== 'undefined' &&
                body &&
                typeof body.entries === 'function' &&
                String(body.constructor?.name || '').toLowerCase().includes('formdata')
            ) {
                const params = new URLSearchParams();

                for (const [key, value] of body.entries()) {
                    if (typeof value === 'string') {
                        params.append(key, value);
                    } else if (value && value.name) {
                        params.append(key, value.name);
                    }
                }

                return params.toString();
            }

            return String(body);
        } catch {
            return safeText(body);
        }
    }

    function captureAuthFromHeaders(headers, url = null) {
        const normalized = normalizeHeaders(headers);

        if (url && /api\.uzum\.uz/i.test(url)) {
            state.auth.lastApiUrl = url;
        }

        for (const [key, value] of Object.entries(normalized)) {
            if (!value) continue;

            state.auth.headers[key] = value;

            if (key === 'authorization' && /^Bearer\s+/i.test(value)) {
                state.auth.bearer = value.replace(/^Bearer\s+/i, '').trim();
            }

            if (key === 'x-iid') {
                state.auth.xIid = value.trim();
            }
        }

        saveState();
    }

    function scoreProfileRequest(url, method, bodyText) {
        const text = `${url} ${method} ${bodyText}`.toLowerCase();
        let score = 0;

        if (/\/api\/user\/name/i.test(url)) score += 80;
        if (/\/api\/user/i.test(url)) score += 40;
        if (/\/api\/profile/i.test(url)) score += 35;
        if (/\/api\/customer/i.test(url)) score += 25;
        if (/\/api\/account/i.test(url)) score += 20;

        if (/firstname|first_name|lastName|lastname|last_name|surname|fullname|full_name|gender|sex|name/i.test(bodyText)) {
            score += 45;
        }

        if (/name|profile|gender|sex|user|customer|account/i.test(text)) {
            score += 15;
        }

        if (/\/ru\/user\/settings/i.test(location.pathname)) {
            score += 10;
        }

        return score;
    }

    function rememberNameRequest(url, method, headers, body) {
        if (!url || !/api\.uzum\.uz/i.test(url)) return;

        const upperMethod = String(method || 'GET').toUpperCase();

        if (upperMethod === 'GET' || upperMethod === 'OPTIONS') return;

        const bodyText = bodyToText(body);
        const normalizedHeaders = normalizeHeaders(headers);

        const candidate = {
            url,
            method: upperMethod,
            headers: normalizedHeaders,
            body: bodyText,
            score: scoreProfileRequest(url, upperMethod, bodyText),
            capturedAt: Date.now(),
        };

        state.auth.recentRequests.unshift(candidate);
        state.auth.recentRequests = state.auth.recentRequests.slice(0, 20);

        const currentScore = state.auth.learnedNameRequest?.score || 0;

        if (!state.auth.learnedNameRequest || candidate.score >= currentScore) {
            state.auth.learnedNameRequest = candidate;
        }

        console.log('[Uzum Random Name] Пойман НЕ-GET запрос к api.uzum.uz:', candidate);

        saveState();
    }

    function decodeJwtPayload(token) {
        try {
            const part = token.split('.')[1];
            if (!part) return null;

            const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);

            return JSON.parse(atob(padded));
        } catch {
            return null;
        }
    }

    function scanStorageForToken() {
        const jwtRegex = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
        const uuidRegex = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
        const candidates = [];

        function scanText(text) {
            if (!text) return;

            const value = String(text);

            const jwtMatches = value.match(jwtRegex);
            if (jwtMatches) candidates.push(...jwtMatches);

            const iidMatch = value.match(uuidRegex);
            if (iidMatch && !state.auth.xIid) {
                state.auth.xIid = iidMatch[0];
            }
        }

        function scanStorage(storage) {
            try {
                for (let i = 0; i < storage.length; i++) {
                    const key = storage.key(i);
                    const value = storage.getItem(key);

                    scanText(key);
                    scanText(value);

                    if (/iid/i.test(key) && value && !state.auth.xIid) {
                        state.auth.xIid = value;
                    }
                }
            } catch {}
        }

        scanStorage(localStorage);
        scanStorage(sessionStorage);
        scanText(document.cookie);

        const now = Math.floor(Date.now() / 1000);

        const valid = [...new Set(candidates)]
            .map(token => ({ token, payload: decodeJwtPayload(token) }))
            .filter(item => item.payload && (!item.payload.exp || item.payload.exp > now + 60))
            .sort((a, b) => (b.payload.exp || 0) - (a.payload.exp || 0));

        if (valid[0]?.token) {
            state.auth.bearer = valid[0].token;
        }

        saveState();
    }

    async function waitForAuth(timeoutMs = 10000) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            scanStorageForToken();

            if (state.auth.bearer && state.auth.xIid) {
                return {
                    bearer: state.auth.bearer,
                    xIid: state.auth.xIid,
                };
            }

            await sleep(300);
        }

        return {
            bearer: state.auth.bearer,
            xIid: state.auth.xIid,
        };
    }

    function installNetworkHooks() {
        const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        if (w.__uzumRandomProfileHooksInstalled) return;
        w.__uzumRandomProfileHooksInstalled = true;

        const originalFetch = w.fetch;

        if (typeof originalFetch === 'function') {
            w.fetch = function patchedFetch(input, init = {}) {
                try {
                    const url = typeof input === 'string' ? input : input?.url;
                    const method = init?.method || input?.method || 'GET';

                    const inputHeaders = input?.headers ? normalizeHeaders(input.headers) : {};
                    const initHeaders = init?.headers ? normalizeHeaders(init.headers) : {};
                    const headers = { ...inputHeaders, ...initHeaders };

                    captureAuthFromHeaders(headers, url);
                    rememberNameRequest(url, method, headers, init?.body);
                } catch (error) {
                    console.warn('[Uzum Random Name] fetch hook error:', error);
                }

                return originalFetch.apply(this, arguments);
            };
        }

        const OriginalXHR = w.XMLHttpRequest;

        if (OriginalXHR && OriginalXHR.prototype) {
            const originalOpen = OriginalXHR.prototype.open;
            const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;
            const originalSend = OriginalXHR.prototype.send;

            OriginalXHR.prototype.open = function patchedOpen(method, url) {
                this.__uzumRandomProfileMeta = {
                    method,
                    url,
                    headers: {},
                };

                return originalOpen.apply(this, arguments);
            };

            OriginalXHR.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
                try {
                    if (this.__uzumRandomProfileMeta) {
                        this.__uzumRandomProfileMeta.headers[String(name).toLowerCase()] = String(value);
                    }
                } catch {}

                return originalSetRequestHeader.apply(this, arguments);
            };

            OriginalXHR.prototype.send = function patchedSend(body) {
                try {
                    const meta = this.__uzumRandomProfileMeta;

                    if (meta) {
                        captureAuthFromHeaders(meta.headers, meta.url);
                        rememberNameRequest(meta.url, meta.method, meta.headers, body);
                    }
                } catch (error) {
                    console.warn('[Uzum Random Name] XHR hook error:', error);
                }

                return originalSend.apply(this, arguments);
            };
        }
    }

    function htmlToText(value) {
        const html = String(value || '');
        const doc = new DOMParser().parseFromString(html, 'text/html');

        return (doc.body.textContent || html)
            .replace(/\s+/g, ' ')
            .trim();
    }

    function parseFullName(raw) {
        const text = htmlToText(raw)
            .replace(/[«»"“”]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const parts = text.split(' ').filter(Boolean);

        if (parts.length < 2) {
            throw new Error('RandomAll вернул непонятный формат имени: ' + text);
        }

        const firstName = parts[0].replace(/[^\p{L}'’`-]/gu, '').trim();
        const lastName = parts.slice(1).join(' ').replace(/[^\p{L}\s'’`-]/gu, '').trim();

        if (!firstName || !lastName) {
            throw new Error('Не получилось разобрать имя и фамилию: ' + text);
        }

        return {
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`,
        };
    }

    async function getRandomPerson(gender) {
        const generatorId = CONFIG.randomAll[gender];

        const variants = [
            {
                label: 'JSON {}',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                data: JSON.stringify({}),
            },
            {
                label: 'buttonId 1',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                data: JSON.stringify({ buttonId: 1 }),
            },
            {
                label: 'without body',
                headers: {
                    'Accept': 'application/json',
                },
                data: undefined,
            },
        ];

        const errors = [];

        for (const variant of variants) {
            try {
                const requestOptions = {
                    method: 'POST',
                    url: `https://randomall.ru/api/gens/${generatorId}`,
                    headers: variant.headers,
                };

                if (variant.data !== undefined) {
                    requestOptions.data = variant.data;
                }

                const response = await gmRequest(requestOptions);
                const responseText = safeText(response.responseText || response.response || '');

                if (response.status >= 200 && response.status < 300) {
                    let json;

                    try {
                        json = JSON.parse(responseText);
                    } catch {
                        throw new Error('RandomAll вернул не JSON: ' + cutText(responseText, 300));
                    }

                    const randomResult = json.msg || json.result || json.data || json.text;

                    if (!randomResult) {
                        throw new Error('RandomAll не вернул имя. Ответ: ' + cutText(responseText, 300));
                    }

                    const person = parseFullName(randomResult);

                    person.gender = gender;
                    person.genderCode = gender === 'female' ? 'FEMALE' : 'MALE';
                    person.genderLower = gender === 'female' ? 'female' : 'male';
                    person.genderShort = gender === 'female' ? 'F' : 'M';

                    console.log('[RandomAll OK]', variant.label, json);

                    return person;
                }

                errors.push(`${variant.label}: статус ${response.status}, ответ: ${cutText(responseText, 300)}`);
            } catch (error) {
                errors.push(`${variant.label}: ${error.message}`);
            }
        }

        console.error('[RandomAll errors]', errors);

        throw new Error(
            'RandomAll не сгенерировал имя. Последние ошибки: ' +
            errors.slice(-2).join(' | ')
        );
    }

    function compactKey(key) {
        return String(key || '').toLowerCase().replace(/[^a-zа-яё]/g, '');
    }

    function mapGenderValue(current, person) {
        if (typeof current === 'string') {
            const trimmed = current.trim();

            if (/^[mf]$/i.test(trimmed)) {
                return person.genderShort;
            }

            if (/^(male|female)$/i.test(trimmed)) {
                return trimmed === trimmed.toLowerCase()
                    ? person.genderLower
                    : person.genderCode;
            }

            if (/муж|жен/i.test(trimmed)) {
                return person.gender === 'female' ? 'Женский' : 'Мужской';
            }
        }

        return person.genderCode;
    }

    function makeReplacementForKey(key, currentValue, parentObject, person) {
        const keyName = compactKey(key);

        if (
            keyName === 'firstname' ||
            keyName === 'givenname'
        ) {
            return { changed: true, value: person.firstName };
        }

        if (
            keyName === 'lastname' ||
            keyName === 'surname' ||
            keyName === 'familyname'
        ) {
            return { changed: true, value: person.lastName };
        }

        if (
            keyName === 'fullname' ||
            keyName === 'fio'
        ) {
            return { changed: true, value: person.fullName };
        }

        if (keyName === 'name') {
            const parentKeys = parentObject && typeof parentObject === 'object'
                ? Object.keys(parentObject).map(compactKey)
                : [];

            const hasSeparateLastName =
                parentKeys.includes('lastname') ||
                parentKeys.includes('surname') ||
                parentKeys.includes('familyname');

            const currentText = safeText(currentValue).trim();

            return {
                changed: true,
                value: hasSeparateLastName || !/\s+/.test(currentText)
                    ? person.firstName
                    : person.fullName,
            };
        }

        if (keyName === 'gender' || keyName === 'sex') {
            return { changed: true, value: mapGenderValue(currentValue, person) };
        }

        return { changed: false, value: currentValue };
    }

    function applyPersonToJsonTemplate(template, person) {
        let changed = false;

        function cloneAndWalk(value, parentObject = null, parentKey = null) {
            if (Array.isArray(value)) {
                return value.map(item => cloneAndWalk(item, value, parentKey));
            }

            if (value && typeof value === 'object') {
                const result = {};

                for (const key of Object.keys(value)) {
                    const replacement = makeReplacementForKey(key, value[key], value, person);

                    if (replacement.changed) {
                        result[key] = replacement.value;
                        changed = true;
                    } else {
                        result[key] = cloneAndWalk(value[key], value, key);
                    }
                }

                return result;
            }

            return value;
        }

        return {
            value: cloneAndWalk(template),
            changed,
        };
    }

    function updateUrlParams(url, person) {
        try {
            const parsed = new URL(url, location.origin);
            let changed = false;

            for (const [key, value] of parsed.searchParams.entries()) {
                const replacement = makeReplacementForKey(key, value, null, person);

                if (replacement.changed) {
                    parsed.searchParams.set(key, replacement.value);
                    changed = true;
                }
            }

            return {
                url: parsed.toString(),
                changed,
            };
        } catch {
            return {
                url,
                changed: false,
            };
        }
    }

    function tryParseJson(text) {
        try {
            if (!text) return null;
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    function looksLikeUrlEncoded(text) {
        return Boolean(text && text.includes('=') && !text.trim().startsWith('{'));
    }

    function applyPersonToUrlEncodedBody(bodyText, person) {
        try {
            const params = new URLSearchParams(bodyText);
            let changed = false;

            for (const [key, value] of params.entries()) {
                const replacement = makeReplacementForKey(key, value, null, person);

                if (replacement.changed) {
                    params.set(key, replacement.value);
                    changed = true;
                }
            }

            return {
                value: params.toString(),
                changed,
            };
        } catch {
            return {
                value: bodyText,
                changed: false,
            };
        }
    }

    function getDefaultJsonPayloads(person) {
        return [
            {
                firstName: person.firstName,
                lastName: person.lastName,
                gender: person.genderCode,
            },
            {
                name: person.firstName,
                surname: person.lastName,
                gender: person.genderCode,
            },
            {
                first_name: person.firstName,
                last_name: person.lastName,
                gender: person.genderCode,
            },
            {
                firstname: person.firstName,
                lastname: person.lastName,
                gender: person.genderCode,
            },
            {
                firstName: person.firstName,
                lastName: person.lastName,
                sex: person.genderCode,
            },
            {
                name: person.firstName,
                surname: person.lastName,
                sex: person.genderCode,
            },
            {
                name: person.fullName,
                gender: person.genderCode,
            },
            {
                fullName: person.fullName,
                gender: person.genderCode,
            },
        ];
    }

    function buildRequestVariants(person, learnedRequest) {
        const variants = [];
        const urlResult = updateUrlParams(learnedRequest.url, person);
        const learnedContentType = learnedRequest.headers?.['content-type'] || '';
        const bodyText = safeText(learnedRequest.body);

        const jsonBody = tryParseJson(bodyText);

        if (jsonBody) {
            const applied = applyPersonToJsonTemplate(jsonBody, person);

            if (applied.changed) {
                variants.push({
                    url: urlResult.url,
                    data: JSON.stringify(applied.value),
                    contentType: 'application/json',
                    payloadLog: applied.value,
                    source: 'learned-json-template',
                });
            }
        }

        if (looksLikeUrlEncoded(bodyText)) {
            const applied = applyPersonToUrlEncodedBody(bodyText, person);

            if (applied.changed) {
                variants.push({
                    url: urlResult.url,
                    data: applied.value,
                    contentType: learnedContentType || 'application/x-www-form-urlencoded;charset=UTF-8',
                    payloadLog: applied.value,
                    source: 'learned-urlencoded-template',
                });
            }
        }

        if (urlResult.changed && !bodyText) {
            variants.push({
                url: urlResult.url,
                data: undefined,
                contentType: learnedContentType || 'application/json',
                payloadLog: null,
                source: 'learned-url-params',
            });
        }

        if (variants.length === 0) {
            for (const payload of getDefaultJsonPayloads(person)) {
                variants.push({
                    url: urlResult.url,
                    data: JSON.stringify(payload),
                    contentType: 'application/json',
                    payloadLog: payload,
                    source: 'default-json-payload',
                });
            }
        }

        const seen = new Set();

        return variants.filter(variant => {
            const key = `${variant.url}|${variant.contentType}|${variant.data || ''}`;

            if (seen.has(key)) return false;

            seen.add(key);
            return true;
        });
    }

    function buildUzumHeaders(auth, contentType) {
        const headers = {
            'accept': 'application/json',
            'accept-language': 'ru',
            'authorization': `Bearer ${auth.bearer}`,
            'x-iid': auth.xIid,
            'origin': 'https://uzum.uz',
            'referer': 'https://uzum.uz/',
        };

        if (contentType) {
            headers['content-type'] = contentType;
        }

        const reusableHeaderNames = [
            'x-device-id',
            'x-app-version',
            'x-platform',
            'x-client',
            'x-request-id',
            'x-user-id',
            'baggage',
            'sentry-trace',
        ];

        for (const name of reusableHeaderNames) {
            if (state.auth.headers[name]) {
                headers[name] = state.auth.headers[name];
            }
        }

        return headers;
    }

    async function sendUzumRequest(method, variant, auth) {
        const response = await gmRequest({
            method,
            url: variant.url,
            headers: buildUzumHeaders(auth, variant.contentType),
            data: variant.data,
            timeout: 25000,
        });

        const responseText = safeText(response.responseText || response.response || '');

        let json = null;

        try {
            json = responseText ? JSON.parse(responseText) : null;
        } catch {}

        return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            text: responseText,
            json,
            method,
            url: variant.url,
            payload: variant.payloadLog,
            source: variant.source,
        };
    }

    async function updateUzumProfile(person) {
        const auth = await waitForAuth(10000);

        if (!auth.bearer) {
            throw new Error(
                'Не нашёл Bearer token. Обнови страницу Uzum с включённым скриптом и дождись полной загрузки.'
            );
        }

        if (!auth.xIid) {
            throw new Error(
                'Не нашёл x-iid. Обнови страницу Uzum с включённым скриптом и дождись полной загрузки.'
            );
        }

        const learnedRequest = state.auth.learnedNameRequest;

        if (!learnedRequest) {
            throw new Error(
                'Скрипт ещё не поймал реальный запрос сохранения профиля. Открой /ru/user/settings, вручную измени имя/фамилию/пол и нажми сохранить.'
            );
        }

        const method = String(learnedRequest.method || '').toUpperCase();

        if (!method || method === 'GET' || method === 'OPTIONS') {
            throw new Error(
                'Пойман неправильный шаблон запроса. Нажми "Сброс шаблона", потом вручную сохрани профиль на странице настроек.'
            );
        }

        const variants = buildRequestVariants(person, learnedRequest);
        const errors = [];

        for (const variant of variants) {
            const result = await sendUzumRequest(method, variant, auth);

            console.log('[Uzum profile update attempt]', {
                method,
                url: variant.url,
                source: variant.source,
                payload: variant.payloadLog,
                status: result.status,
                response: result.text,
                json: result.json,
            });

            if (result.ok) {
                console.log('[Uzum profile update success]', result);
                return result;
            }

            errors.push(result);

            if (result.status === 401 || result.status === 403) {
                state.auth.bearer = null;
                saveState();

                throw new Error(
                    `Uzum не принял авторизацию. Статус ${result.status}. Обнови страницу и попробуй снова. Ответ: ${cutText(result.text, 200)}`
                );
            }
        }

        const last = errors[errors.length - 1] || {};

        console.error('[Uzum profile update failed]', errors);

        throw new Error(
            `Uzum не принял запрос. Последний ответ: ${last.status || 'без статуса'} ${cutText(last.text, 350)}`
        );
    }

    function isReviewsPage() {
        return /\/ru\/user\/reviews/i.test(location.pathname);
    }

    function injectStyles() {
        if (document.getElementById('uzum-random-name-style')) return;

        const style = document.createElement('style');

        style.id = 'uzum-random-name-style';
        style.textContent = `
        #uzum-random-name-panel {
            position: fixed;
            top: var(--uzum-random-name-top-offset, 140px);
            right: var(--uzum-random-name-right-offset, 24px);
            display: inline-flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            padding: 8px 10px;
            background: rgba(255, 255, 255, 0.96);
            border-radius: 14px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.12);
            font-family: Inter, Arial, sans-serif;
            z-index: 999999;
            backdrop-filter: blur(6px);
            width: max-content;
            max-width: calc(100vw - 32px);
            transition: top 0.16s ease;
        }

        .uzum-random-name-btn {
            border: 0;
            border-radius: 10px;
            padding: 9px 12px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            color: #fff;
            background: #6E43FF;
            box-shadow: 0 4px 12px rgba(110, 67, 255, 0.25);
            transition: transform 0.12s ease, opacity 0.12s ease;
            white-space: nowrap;
        }

        .uzum-random-name-btn:hover {
            transform: translateY(-1px);
        }

        .uzum-random-name-btn:disabled {
            opacity: 0.55;
            cursor: not-allowed;
            transform: none;
        }

        .uzum-random-name-btn.female {
            background: #E83E8C;
        }

        .uzum-random-name-btn.debug {
            background: #333;
        }

        .uzum-random-name-btn.reset {
            background: #777;
        }

        .uzum-random-name-status {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            width: 520px;
            max-width: 520px;
            padding: 8px 10px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.96);
            box-shadow: 0 6px 18px rgba(0,0,0,0.10);
            font-size: 12px;
            line-height: 1.35;
            color: #555;
            white-space: pre-line;
            word-break: break-word;
            text-align: left;
            pointer-events: none;
        }

        .uzum-random-name-status:empty {
            display: none;
        }
    `;

        document.head.appendChild(style);
    }

    function getPageContainerRightOffset() {
        const container = document.querySelector('.page-container');

        if (!container) {
            return 24;
        }

        const rect = container.getBoundingClientRect();
        const rightOffset = Math.round(window.innerWidth - rect.right);

        return Math.max(0, rightOffset);
    }

    function syncPanelPositionToPageContainer() {
        const panel = document.getElementById('uzum-random-name-panel');

        if (!panel) return;

        const rightOffset = getPageContainerRightOffset();

        // Вверху страницы — 140px.
        // При прокрутке плашка поднимается, но не выше 16px от верхнего края.
        const startTop = 180;
        const minTop = 16;
        const topOffset = Math.max(minTop, startTop - window.scrollY);

        panel.style.setProperty(
            '--uzum-random-name-right-offset',
            `${rightOffset}px`
        );

        panel.style.setProperty(
            '--uzum-random-name-top-offset',
            `${topOffset}px`
        );
    }

    function findProfileTitle() {
        const xpathTitle = document.evaluate(
            '/html/body/div[1]/div[1]/div/header/h1',
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue;

        if (xpathTitle) {
            return xpathTitle;
        }

        return document.querySelector('header h1.HeadlineMSemibold, header h1');
    }

    function updateDisplayedName(fullName) {
        const title = findProfileTitle();

        if (title) {
            title.textContent = fullName;
        }
    }

    function createButton(text, className, gender, statusEl, buttons) {
        const btn = document.createElement('button');

        btn.type = 'button';
        btn.className = `uzum-random-name-btn ${className}`;
        btn.textContent = text;

        btn.addEventListener('click', async () => {
            if (state.busy) return;

            state.busy = true;
            buttons.forEach(button => button.disabled = true);

            statusEl.textContent = 'Ищу токены...\nГенерирую имя...';

            try {
                const person = await getRandomPerson(gender);

                statusEl.textContent = `Новое имя:\n${person.fullName}\nОтправляю запрос в Uzum...`;

                await updateUzumProfile(person);

                statusEl.textContent = `Готово:\n${person.fullName}`;
                updateDisplayedName(person.fullName);

                if (CONFIG.reloadAfterSuccess) {
                    setTimeout(() => location.reload(), 900);
                }
            } catch (error) {
                console.error('[Uzum Random Name]', error);
                statusEl.textContent = 'Ошибка:\n' + error.message;
            } finally {
                state.busy = false;
                buttons.forEach(button => button.disabled = false);
                syncPanelPositionToPageContainer();
            }
        });

        return btn;
    }

    function createDebugButton(statusEl) {
        const btn = document.createElement('button');

        btn.type = 'button';
        btn.className = 'uzum-random-name-btn debug';
        btn.textContent = 'Проверка';

        btn.addEventListener('click', async () => {
            const auth = await waitForAuth(3000);
            const learned = state.auth.learnedNameRequest;

            let learnedText = 'нет';

            if (learned) {
                try {
                    const path = new URL(learned.url).pathname;
                    learnedText = `${learned.method} ${path} score:${learned.score}`;
                } catch {
                    learnedText = `${learned.method} ${learned.url} score:${learned.score}`;
                }
            }

            statusEl.textContent =
                `Bearer: ${auth.bearer ? 'найден' : 'нет'}\n` +
                `x-iid: ${auth.xIid ? 'найден' : 'нет'}\n` +
                `шаблон: ${learnedText}`;

            console.log('[Uzum Random Name auth state]', {
                bearer: auth.bearer ? auth.bearer.slice(0, 20) + '...' : null,
                xIid: auth.xIid,
                learnedNameRequest: state.auth.learnedNameRequest,
                recentRequests: state.auth.recentRequests,
                headers: state.auth.headers,
            });

            syncPanelPositionToPageContainer();
        });

        return btn;
    }

    function createResetButton(statusEl) {
        const btn = document.createElement('button');

        btn.type = 'button';
        btn.className = 'uzum-random-name-btn reset';
        btn.textContent = 'Сброс шаблона';

        btn.addEventListener('click', () => {
            state.auth.learnedNameRequest = null;
            state.auth.recentRequests = [];
            saveState();

            statusEl.textContent =
                'Шаблон сброшен.\n' +
                'Зайди в настройки, вручную измени профиль и нажми сохранить.';

            syncPanelPositionToPageContainer();
        });

        return btn;
    }

    function mountPanel() {
        const existing = document.getElementById('uzum-random-name-panel');

        if (!isReviewsPage()) {
            if (existing) existing.remove();
            return;
        }

        if (existing) {
            syncPanelPositionToPageContainer();
            return;
        }

        injectStyles();

        const panel = document.createElement('span');
        panel.id = 'uzum-random-name-panel';

        const status = document.createElement('span');
        status.className = 'uzum-random-name-status';

        const buttons = [];

        const femaleBtn = createButton('♀ Женское имя', 'female', 'female', status, buttons);
        const maleBtn = createButton('♂ Мужское имя', 'male', 'male', status, buttons);
        const debugBtn = createDebugButton(status);
        const resetBtn = createResetButton(status);

        buttons.push(femaleBtn, maleBtn, debugBtn, resetBtn);

        panel.appendChild(femaleBtn);
        panel.appendChild(maleBtn);
        panel.appendChild(debugBtn);
        panel.appendChild(resetBtn);
        panel.appendChild(status);

        document.body.appendChild(panel);
        syncPanelPositionToPageContainer();
    }

    function startDomObserver() {
        mountPanel();

        const observer = new MutationObserver(() => {
            mountPanel();
            syncPanelPositionToPageContainer();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        window.addEventListener('resize', syncPanelPositionToPageContainer);
        window.addEventListener('scroll', syncPanelPositionToPageContainer, { passive: true });

        setInterval(syncPanelPositionToPageContainer, 1000);

        let lastPath = location.pathname;

        setInterval(() => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                mountPanel();
                syncPanelPositionToPageContainer();
            }
        }, 700);
    }

    function start() {
        loadState();
        scanStorageForToken();
        installNetworkHooks();

        if (document.body) {
            startDomObserver();
        } else {
            document.addEventListener('DOMContentLoaded', startDomObserver, { once: true });
        }
    }

    start();
})();
