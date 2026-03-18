/**
 * Auth page — login / register with math captcha.
 * Features: password toggle eye, confirm password, live match indicator, strength bar.
 */

import { t, getLang, setLang, getAvailableLanguages } from './i18n.js';
import { apiFetch } from './api.js';

let captchaData = null;

export async function render(container) {
    container.innerHTML = `
        <div class="auth-page">
            <div class="auth-pieces" aria-hidden="true">
                <span class="auth-piece auth-piece-1">\u2655</span>
                <span class="auth-piece auth-piece-2">\u265E</span>
                <span class="auth-piece auth-piece-3">\u2657</span>
            </div>
            <div class="auth-card">
                <div class="auth-header">
                    <img class="auth-logo" id="auth-logo-img" src="/branding/logo" width="80" height="80" style="object-fit:contain" alt="" />
                    <h2>${document.title || 'Chess Learn'}</h2>
                    <p>${t('auth.subtitle')}</p>
                </div>

                <div class="tabs tabs-boxed justify-center mb-4">
                    <button class="tab tab-active" id="tab-login">${t('auth.login')}</button>
                    <button class="tab" id="tab-register">${t('auth.register')}</button>
                </div>

                <!-- Login Form -->
                <form id="form-login" class="auth-form auth-form-animate">
                    <div class="form-control mb-3">
                        <label class="label" for="login-username"><span class="label-text">${t('auth.username')}</span></label>
                        <input type="text" id="login-username" class="input input-bordered w-full" placeholder="${t('auth.usernamePlaceholder')}" autocomplete="username" required aria-required="true" />
                    </div>
                    <div class="form-control mb-3">
                        <label class="label" for="login-password"><span class="label-text">${t('auth.password')}</span></label>
                        <div class="input-password-wrap">
                            <input type="password" id="login-password" class="input input-bordered w-full" placeholder="${t('auth.passwordPlaceholder')}" autocomplete="current-password" required aria-required="true" />
                            <button type="button" class="btn-eye" data-target="login-password" aria-label="${t('auth.showPassword')}">${eyeIconClosed()}</button>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary btn-lg w-full auth-submit">${t('auth.submit.login')}</button>
                    <div id="login-error" class="auth-error" role="alert" aria-live="assertive"></div>
                </form>

                <!-- Register Form -->
                <form id="form-register" class="auth-form auth-form-animate" style="display:none">
                    <div class="form-control mb-3">
                        <label class="label" for="reg-username"><span class="label-text">${t('auth.username')}</span></label>
                        <input type="text" id="reg-username" class="input input-bordered w-full" placeholder="${t('auth.usernameMinHint')}" autocomplete="username" required aria-required="true" />
                    </div>
                    <div class="form-control mb-3">
                        <label class="label" for="reg-password"><span class="label-text">${t('auth.password')}</span></label>
                        <div class="input-password-wrap">
                            <input type="password" id="reg-password" class="input input-bordered w-full" placeholder="${t('auth.passwordMinHint')}" autocomplete="new-password" required aria-required="true" />
                            <button type="button" class="btn-eye" data-target="reg-password" aria-label="${t('auth.showPassword')}">${eyeIconClosed()}</button>
                        </div>
                        <div class="password-strength" id="password-strength" aria-live="polite">
                            <div class="strength-bar" role="meter" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0" aria-label="${t('auth.passwordStrength')}"><div class="strength-fill" id="strength-fill"></div></div>
                            <span class="strength-label" id="strength-label"></span>
                        </div>
                    </div>
                    <div class="form-control mb-3">
                        <label class="label" for="reg-password2"><span class="label-text">${t('auth.confirmPassword')}</span></label>
                        <div class="input-password-wrap">
                            <input type="password" id="reg-password2" class="input input-bordered w-full" placeholder="${t('auth.retypePassword')}" autocomplete="new-password" required aria-required="true" />
                            <button type="button" class="btn-eye" data-target="reg-password2" aria-label="${t('auth.showPassword')}">${eyeIconClosed()}</button>
                        </div>
                        <div class="password-match" id="password-match" aria-live="polite"></div>
                    </div>
                    <div class="form-control mb-3">
                        <label class="label" for="reg-captcha" id="captcha-label"><span class="label-text">${t('auth.captchaLoading')}</span></label>
                        <input type="number" id="reg-captcha" class="input input-bordered w-full" placeholder="${t('auth.captchaPlaceholder')}" required aria-required="true" />
                    </div>
                    <button type="submit" class="btn btn-primary btn-lg w-full auth-submit">${t('auth.submit.register')}</button>
                    <div id="register-error" class="auth-error" role="alert" aria-live="assertive"></div>
                </form>

                <div class="auth-lang-switcher">
                    ${getAvailableLanguages().map(l =>
                        `<button class="auth-lang-btn ${l.code === getLang() ? 'active' : ''}" data-lang="${l.code}">${l.flag}</button>`
                    ).join('')}
                </div>
            </div>
        </div>
    `;

    // Logo fallback (no inline onerror — CSP blocks it)
    const logoImg = document.getElementById('auth-logo-img');
    if (logoImg) {
        logoImg.addEventListener('error', () => {
            logoImg.outerHTML = '<svg class="auth-logo" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M9 9l1.5 1.5L12 9l1.5 1.5L15 9"/><path d="M9 15h6"/></svg>';
        });
    }

    // Tab switching
    document.getElementById('tab-login').addEventListener('click', () => switchTab('login'));
    document.getElementById('tab-register').addEventListener('click', () => switchTab('register'));

    // Form submissions
    document.getElementById('form-login').addEventListener('submit', handleLogin);
    document.getElementById('form-register').addEventListener('submit', handleRegister);

    // Eye toggle buttons
    document.querySelectorAll('.btn-eye').forEach(btn => {
        btn.addEventListener('click', () => togglePasswordVisibility(btn));
    });

    // Language switcher
    document.querySelectorAll('.auth-lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.lang;
            localStorage.setItem('chess-learn-lang', lang);
            setLang(lang);
        });
    });

    // Live password match + strength
    document.getElementById('reg-password').addEventListener('input', () => {
        updateStrengthBar();
        updateMatchIndicator();
    });
    document.getElementById('reg-password2').addEventListener('input', updateMatchIndicator);
}

export function destroy() {}

/* ---------- Eye toggle ---------- */

function togglePasswordVisibility(btn) {
    const targetId = btn.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = eyeIconOpen();
    } else {
        input.type = 'password';
        btn.innerHTML = eyeIconClosed();
    }
}

function eyeIconClosed() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
    </svg>`;
}

function eyeIconOpen() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>`;
}

/* ---------- Password strength ---------- */

function getPasswordStrength(pw) {
    if (!pw) return { score: 0, label: '', cls: '' };
    let score = 0;
    if (pw.length >= 4) score++;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 1) return { score: 1, label: t('auth.strength.weak'), cls: 'str-weak' };
    if (score === 2) return { score: 2, label: t('auth.strength.medium'), cls: 'str-medium' };
    if (score === 3) return { score: 3, label: t('auth.strength.good'), cls: 'str-good' };
    return { score: 4, label: t('auth.strength.strong'), cls: 'str-strong' };
}

function updateStrengthBar() {
    const pw = document.getElementById('reg-password').value;
    const fill = document.getElementById('strength-fill');
    const label = document.getElementById('strength-label');
    if (!fill || !label) return;

    const s = getPasswordStrength(pw);
    fill.style.width = pw ? `${s.score * 25}%` : '0%';
    fill.className = 'strength-fill ' + s.cls;
    label.textContent = s.label;
    label.className = 'strength-label ' + s.cls;
    // Update meter aria value
    const meter = fill.closest('[role="meter"]');
    if (meter) meter.setAttribute('aria-valuenow', String(s.score));
}

/* ---------- Password match ---------- */

function updateMatchIndicator() {
    const pw1 = document.getElementById('reg-password').value;
    const pw2 = document.getElementById('reg-password2').value;
    const el = document.getElementById('password-match');
    if (!el) return;

    if (!pw2) {
        el.textContent = '';
        el.className = 'password-match';
        return;
    }

    if (pw1 === pw2) {
        el.textContent = `\u2714 ${t('auth.password.match')}`;
        el.className = 'password-match match-ok';
    } else {
        el.textContent = `\u2718 ${t('auth.password.noMatch')}`;
        el.className = 'password-match match-no';
    }
}

/* ---------- Tab switching ---------- */

function switchTab(tab) {
    const loginTab = document.getElementById('tab-login');
    const registerTab = document.getElementById('tab-register');
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');

    if (tab === 'login') {
        loginTab.classList.add('tab-active');
        registerTab.classList.remove('tab-active');
        loginForm.style.display = '';
        registerForm.style.display = 'none';
        retriggerAnimation(loginForm);
    } else {
        loginTab.classList.remove('tab-active');
        registerTab.classList.add('tab-active');
        loginForm.style.display = 'none';
        registerForm.style.display = '';
        retriggerAnimation(registerForm);
        loadCaptcha();
    }
}

function retriggerAnimation(el) {
    el.classList.remove('auth-form-animate');
    void el.offsetWidth; // force reflow
    el.classList.add('auth-form-animate');
}

/* ---------- Captcha ---------- */

async function loadCaptcha() {
    try {
        const resp = await fetch('/api/auth/captcha');
        captchaData = await resp.json();
        const label = document.getElementById('captcha-label');
        if (label) label.textContent = `${t('auth.captcha')} : ${captchaData.question}`;
    } catch (e) {
        console.error('Captcha load error:', e);
    }
}

/* ---------- Login ---------- */

async function handleLogin(e) {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';

    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-password');
    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    // Reset aria-invalid
    usernameEl.removeAttribute('aria-invalid');
    passwordEl.removeAttribute('aria-invalid');

    if (!username || !password) {
        errorEl.textContent = t('auth.error.fillAll');
        if (!username) usernameEl.setAttribute('aria-invalid', 'true');
        if (!password) passwordEl.setAttribute('aria-invalid', 'true');
        return;
    }

    try {
        const resp = await apiFetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        if (resp.ok) {
            window.location.hash = '#live';
            window.location.reload();
        } else {
            const data = await resp.json();
            errorEl.textContent = data.detail || t('auth.error.login');
            usernameEl.setAttribute('aria-invalid', 'true');
            passwordEl.setAttribute('aria-invalid', 'true');
        }
    } catch (err) {
        errorEl.textContent = t('auth.error.connection');
    }
}

/* ---------- Register ---------- */

async function handleRegister(e) {
    e.preventDefault();
    const errorEl = document.getElementById('register-error');
    errorEl.textContent = '';

    const usernameEl = document.getElementById('reg-username');
    const passwordEl = document.getElementById('reg-password');
    const password2El = document.getElementById('reg-password2');
    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    const password2 = password2El.value;
    const captchaAnswer = parseInt(document.getElementById('reg-captcha').value);

    // Reset aria-invalid
    usernameEl.removeAttribute('aria-invalid');
    passwordEl.removeAttribute('aria-invalid');
    password2El.removeAttribute('aria-invalid');

    if (!username || !password || !password2) {
        errorEl.textContent = t('auth.error.fillAll');
        if (!username) usernameEl.setAttribute('aria-invalid', 'true');
        if (!password) passwordEl.setAttribute('aria-invalid', 'true');
        if (!password2) password2El.setAttribute('aria-invalid', 'true');
        return;
    }

    if (password !== password2) {
        errorEl.textContent = t('auth.error.passwordMismatch');
        password2El.setAttribute('aria-invalid', 'true');
        return;
    }

    if (!captchaData) {
        errorEl.textContent = t('auth.error.captchaNotLoaded');
        await loadCaptcha();
        return;
    }

    try {
        const resp = await apiFetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                captcha_id: captchaData.captcha_id,
                captcha_answer: captchaAnswer,
            }),
        });

        if (resp.ok) {
            window.location.hash = '#live';
            window.location.reload();
        } else {
            const data = await resp.json();
            errorEl.textContent = data.detail || t('auth.error.register');
            await loadCaptcha();
            document.getElementById('reg-captcha').value = '';
        }
    } catch (err) {
        errorEl.textContent = t('auth.error.connection');
    }
}
