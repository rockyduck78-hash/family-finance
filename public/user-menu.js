function initUserMenu(username) {
    document.getElementById('user-display').textContent = username;
    document.getElementById('user-avatar').textContent = username[0].toUpperCase();
    loadTheme();
    loadCustomization();
}

function toggleUserMenu() {
    document.getElementById('user-menu').classList.toggle('open');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('user-menu');
    if (menu && !menu.contains(e.target)) {
        menu.classList.remove('open');
    }
});

// Theme
function setTheme(theme) {
    document.body.className = theme === 'light' ? '' : 'theme-' + theme;
    localStorage.setItem('ff-theme', theme);
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
    saveSetting('theme', theme);
}

function loadTheme() {
    const saved = localStorage.getItem('ff-theme') || 'light';
    document.body.className = saved === 'light' ? '' : 'theme-' + saved;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === saved));
}

// Customization
const defaultSettings = {
    theme: 'light',
    density: 'normal',
    statsLayout: 'grid',
    incomeExpensesChart: 'doughnut',
    categoryChart: 'bar',
    colorPalette: 'default',
    showStats: true,
    showCharts: true
};

let userSettings = { ...defaultSettings };

async function loadCustomization() {
    const user = localStorage.getItem('currentUser');
    if (!user) return;
    try {
        const data = await apiGet('/api/user/' + user + '/settings');
        if (data && !data.error) {
            userSettings = { ...defaultSettings, ...data };
        }
    } catch (e) {}
    applyCustomization();
}

function applyCustomization() {
    document.body.classList.remove('density-compact', 'density-comfortable');
    if (userSettings.density === 'compact') document.body.classList.add('density-compact');
    if (userSettings.density === 'comfortable') document.body.classList.add('density-comfortable');

    document.body.classList.remove('stats-grid-view', 'stats-list-view');
    document.body.classList.add(userSettings.statsLayout === 'list' ? 'stats-list-view' : 'stats-grid-view');

    const statsSection = document.querySelector('.stats-grid');
    const chartsSection = document.querySelector('.charts-grid');
    if (statsSection) statsSection.style.display = userSettings.showStats ? '' : 'none';
    if (chartsSection) chartsSection.style.display = userSettings.showCharts ? '' : 'none';

    if (typeof rebuildCharts === 'function') rebuildCharts();
}

async function saveSetting(key, value) {
    userSettings[key] = value;
    const user = localStorage.getItem('currentUser');
    if (user) {
        apiPut('/api/user/' + user + '/settings', userSettings);
    }
    applyCustomization();
}

function showCustomize() {
    document.getElementById('user-menu').classList.remove('open');
    const modal = document.getElementById('customize-modal');
    modal.classList.add('active');

    document.querySelectorAll('.customize-option').forEach(btn => {
        const group = btn.dataset.group;
        const value = btn.dataset.value;
        if (group && value) {
            btn.classList.toggle('active', String(userSettings[group]) === value);
        }
    });
}

function closeCustomizeModal() {
    document.getElementById('customize-modal').classList.remove('active');
}

function setCustomOption(group, value, el) {
    el.closest('.customize-options').querySelectorAll('.customize-option').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    saveSetting(group, value);
}

function toggleSection(group, el) {
    const current = userSettings[group];
    const next = !current;
    el.classList.toggle('active', next);
    el.dataset.value = String(next);
    saveSetting(group, next);
}

// Change Password Modal
function showChangePassword() {
    document.getElementById('user-menu').classList.remove('open');
    document.getElementById('change-pw-modal').classList.add('active');
}

function closeChangePwModal() {
    document.getElementById('change-pw-modal').classList.remove('active');
}

async function submitChangePw() {
    const user = localStorage.getItem('currentUser');
    const current = document.getElementById('pw-current').value;
    const newPw = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;
    if (!current || !newPw) return alert('Fill in all fields');
    if (newPw !== confirm) return alert('Passwords do not match');
    const data = await apiPost('/api/user/' + user + '/change-password', { currentPassword: current, newPassword: newPw });
    if (data.error) return alert(data.error);
    alert('Password changed!');
    closeChangePwModal();
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
}

// Change Username Modal
function showChangeUsername() {
    document.getElementById('user-menu').classList.remove('open');
    document.getElementById('change-un-modal').classList.add('active');
}

function closeChangeUnModal() {
    document.getElementById('change-un-modal').classList.remove('active');
}

async function submitChangeUn() {
    const user = localStorage.getItem('currentUser');
    const newUn = document.getElementById('un-new').value.trim();
    const pw = document.getElementById('un-password').value;
    if (!newUn || !pw) return alert('Fill in all fields');
    const data = await apiPost('/api/user/' + user + '/change-username', { newUsername: newUn, password: pw });
    if (data.error) return alert(data.error);
    localStorage.setItem('currentUser', data.newUsername);
    if (data.token) localStorage.setItem('ff-token', data.token);
    document.getElementById('user-display').textContent = data.newUsername;
    document.getElementById('user-avatar').textContent = data.newUsername[0].toUpperCase();
    closeChangeUnModal();
    alert('Username changed!');
    document.getElementById('un-new').value = '';
    document.getElementById('un-password').value = '';
}

function logout() {
    clearUser();
    window.location.href = '/';
}

// 2FA Setup
async function show2FASetup() {
    document.getElementById('user-menu').classList.remove('open');
    const user = localStorage.getItem('currentUser');
    if (!user) return;

    const modal = document.getElementById('twofa-modal');
    const statusEl = document.getElementById('twofa-status');
    const setupEl = document.getElementById('twofa-setup');
    const disableEl = document.getElementById('twofa-disable');
    const actionBtn = document.getElementById('twofa-action-btn');

    setupEl.style.display = 'none';
    disableEl.style.display = 'none';
    actionBtn.style.display = 'none';
    statusEl.innerHTML = '<p>Loading...</p>';
    modal.classList.add('active');

    try {
        const data = await apiGet('/api/user/' + user);
        if (data.error) {
            statusEl.innerHTML = '<p style="color:red">' + data.error + '</p>';
            return;
        }

        if (data.twoFactorEnabled) {
            statusEl.innerHTML = '<p style="color:#22c55e;font-weight:600">2FA is currently enabled</p>';
            disableEl.style.display = 'block';
            actionBtn.textContent = 'Disable 2FA';
            actionBtn.style.display = 'inline-block';
            actionBtn.style.background = '#ef4444';
            actionBtn.onclick = disable2FA;
        } else {
            statusEl.innerHTML = '<p style="color:#f59e0b;font-weight:600">2FA is not enabled</p>';
            actionBtn.textContent = 'Enable 2FA';
            actionBtn.style.display = 'inline-block';
            actionBtn.onclick = start2FASetup;
        }
    } catch (e) {
        statusEl.innerHTML = '<p style="color:red">Failed to load 2FA status</p>';
    }
}

function close2FAModal() {
    document.getElementById('twofa-modal').classList.remove('active');
    document.getElementById('twofa-action-btn').style.background = '';
}

async function start2FASetup() {
    const user = localStorage.getItem('currentUser');
    const statusEl = document.getElementById('twofa-status');
    const setupEl = document.getElementById('twofa-setup');
    const actionBtn = document.getElementById('twofa-action-btn');

    try {
        const data = await apiPost('/api/user/' + user + '/2fa/setup', {});
        if (data.error) return alert(data.error);

        statusEl.innerHTML = '<p style="color:#22c55e;font-weight:600">Scan QR code and enter code to enable</p>';
        setupEl.style.display = 'block';
        document.getElementById('twofa-qr').src = data.qrCode;
        actionBtn.textContent = 'Verify & Enable';
        actionBtn.style.display = 'inline-block';
        actionBtn.onclick = verify2FASetup;
    } catch (e) {
        alert('Failed to start 2FA setup');
    }
}

async function verify2FASetup() {
    const user = localStorage.getItem('currentUser');
    const code = document.getElementById('twofa-verify-code').value.trim();
    if (!code || code.length !== 6) return alert('Enter a 6-digit code');

    try {
        const data = await apiPost('/api/user/' + user + '/2fa/verify', { code });
        if (data.error) return alert(data.error);
        alert('2FA enabled successfully!');
        close2FAModal();
    } catch (e) {
        alert('Failed to verify code');
    }
}

async function disable2FA() {
    const user = localStorage.getItem('currentUser');
    const password = document.getElementById('twofa-disable-pw').value;
    const code = document.getElementById('twofa-disable-code').value.trim();
    if (!password) return alert('Enter your password');
    if (!code || code.length !== 6) return alert('Enter a 6-digit code');

    try {
        const data = await apiPost('/api/user/' + user + '/2fa/disable', { password, code });
        if (data.error) return alert(data.error);
        alert('2FA has been disabled');
        close2FAModal();
    } catch (e) {
        alert('Failed to disable 2FA');
    }
}
