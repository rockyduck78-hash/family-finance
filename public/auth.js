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

// On page load, sync token from URL query param to localStorage
function syncTokenFromURL() {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
        localStorage.setItem('ff-token', urlToken);
        // Clean URL without token
        window.history.replaceState({}, '', window.location.pathname);
        return urlToken;
    }
    return localStorage.getItem('ff-token');
}

function requireAuth() {
    const token = syncTokenFromURL();
    if (!getUser() || !token) {
        window.location.href = '/';
        return false;
    }
    return true;
}

function authHeaders() {
    const token = getToken();
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

// Navigate to a protected page with token
function navPage(page) {
    const token = getToken();
    if (!token || !getUser()) { window.location.href = '/'; return; }
    window.location.href = page + '?token=' + encodeURIComponent(token);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

async function apiGet(url) {
    const res = await fetch(API + url, { headers: authHeaders() });
    if (res.status === 401) { clearUser(); window.location.href = '/'; return { error: 'Session expired' }; }
    return res.json();
}

async function apiPost(url, data) {
    const res = await fetch(API + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data)
    });
    if (res.status === 401) { clearUser(); window.location.href = '/'; return { error: 'Session expired' }; }
    return res.json();
}

async function apiPut(url, data) {
    const res = await fetch(API + url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data)
    });
    if (res.status === 401) { clearUser(); window.location.href = '/'; return { error: 'Session expired' }; }
    return res.json();
}

async function apiDelete(url) {
    const res = await fetch(API + url, {
        method: 'DELETE',
        headers: authHeaders()
    });
    if (res.status === 401) { clearUser(); window.location.href = '/'; return { error: 'Session expired' }; }
    return res.json();
}

function renderSidebar(activePage) {
    const user = getUser();
    const token = getToken();
    const nav = (page) => `${page}?token=${encodeURIComponent(token)}`;
    return `
        <aside class="sidebar">
            <div class="sidebar-header">
                <h2>Finance</h2>
                <div class="user-info">${user}</div>
            </div>
            <nav class="sidebar-nav">
                <a href="${nav('/dashboard')}" class="nav-item ${activePage === 'dashboard' ? 'active' : ''}">
                    <span class="icon">📊</span>
                    <span>Dashboard</span>
                </a>
                <a href="${nav('/transactions')}" class="nav-item ${activePage === 'transactions' ? 'active' : ''}">
                    <span class="icon">💳</span>
                    <span>Transactions</span>
                </a>
                <a href="${nav('/kids')}" class="nav-item ${activePage === 'kids' ? 'active' : ''}">
                    <span class="icon">👨‍👩‍👧‍👦</span>
                    <span>Kids</span>
                </a>
                <a href="${nav('/transfer')}" class="nav-item ${activePage === 'transfer' ? 'active' : ''}">
                    <span class="icon">💸</span>
                    <span>Transfer</span>
                </a>
            </nav>
            <div class="sidebar-footer">
                <button class="logout-btn" onclick="logout()">
                    <span class="icon">🚪</span>
                    <span>Logout</span>
                </button>
            </div>
        </aside>
    `;
}

function logout() {
    clearUser();
    window.location.href = '/';
}
