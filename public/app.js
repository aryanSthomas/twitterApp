// ── Shared utilities across all pages ─────────────────────────────────────────

const API = 'http://localhost:3000/api';

function getToken() { return localStorage.getItem('token'); }
function getUser() { return JSON.parse(localStorage.getItem('user') || 'null'); }

function setAuth(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
}

function clearAuth() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

function requireLogin() {
    if (!getToken()) { window.location.href = '/'; return false; }
    return true;
}

async function apiFetch(path, options = {}) {
    const token = getToken();
    const res = await fetch(API + path, {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token } : {}),
        },
        ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return new Date(iso).toLocaleDateString();
}

function initials(name) { return name ? name[0].toUpperCase() : '?'; }

function logout() {
    apiFetch('/logout', { method: 'POST' }).catch(() => { });
    clearAuth();
    window.location.href = '/';
}
