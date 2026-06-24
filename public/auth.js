const API = '';

function getUser() {
    return localStorage.getItem('currentUser');
}

function getToken() {
    return localStorage.getItem('ff-token');
}

function setUser(username) {
    localStorage.setItem('currentUser', username);
}

function setToken(token) {
    localStorage.setItem('ff-token', token);
}

function clearUser() {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('ff-token');
}

function requireAuth() {
    if (!getUser() || !getToken()) {
        window.location.href = '/';
        return false;
    }
    return true;
}

function authHeaders() {
    const token = getToken();
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

async function loadNavBalance() {
    const user = getUser();
    if (!user) return;
    try {
        const data = await apiGet('/api/user/' + user);
        if (!data.error && data.balance !== undefined) {
            const el = document.getElementById('nav-balance-amount');
            if (el) el.textContent = formatCurrency(data.balance);
        }
    } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
    if (getUser()) loadNavBalance();
});

async function apiGet(url) {
    const res = await fetch(API + url, { credentials: 'same-origin', headers: authHeaders() });
    if (res.status === 401) { clearUser(); window.location.href = '/'; return { error: 'Session expired' }; }
    return res.json();
}

async function apiPost(url, data) {
    const res = await fetch(API + url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data)
    });
    if (res.status === 401) { clearUser(); window.location.href = '/'; return { error: 'Session expired' }; }
    return res.json();
}

async function apiPut(url, data) {
    const res = await fetch(API + url, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data)
    });
    if (res.status === 401) { clearUser(); window.location.href = '/'; return { error: 'Session expired' }; }
    return res.json();
}

async function apiDelete(url) {
    const res = await fetch(API + url, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: authHeaders()
    });
    if (res.status === 401) { clearUser(); window.location.href = '/'; return { error: 'Session expired' }; }
    return res.json();
}

