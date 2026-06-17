const API = '';

function getUser() {
    return localStorage.getItem('currentUser');
}

function setUser(username) {
    localStorage.setItem('currentUser', username);
}

function clearUser() {
    localStorage.removeItem('currentUser');
}

function requireAuth() {
    if (!getUser()) {
        window.location.href = '/';
        return false;
    }
    return true;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

async function apiGet(url) {
    const res = await fetch(API + url);
    return res.json();
}

async function apiPost(url, data) {
    const res = await fetch(API + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

async function apiPut(url, data) {
    const res = await fetch(API + url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

function renderSidebar(activePage) {
    const user = getUser();
    return `
        <aside class="sidebar">
            <div class="sidebar-header">
                <h2>Finance</h2>
                <div class="user-info">${user}</div>
            </div>
            <nav class="sidebar-nav">
                <a href="/dashboard" class="nav-item ${activePage === 'dashboard' ? 'active' : ''}">
                    <span class="icon">📊</span>
                    <span>Dashboard</span>
                </a>
                <a href="/transactions" class="nav-item ${activePage === 'transactions' ? 'active' : ''}">
                    <span class="icon">💳</span>
                    <span>Transactions</span>
                </a>
                <a href="/kids" class="nav-item ${activePage === 'kids' ? 'active' : ''}">
                    <span class="icon">👨‍👩‍👧‍👦</span>
                    <span>Kids</span>
                </a>
                <a href="/transfer" class="nav-item ${activePage === 'transfer' ? 'active' : ''}">
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
