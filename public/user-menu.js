function initUserMenu(username) {
    document.getElementById('user-display').textContent = username;
    document.getElementById('user-avatar').textContent = username[0].toUpperCase();
    loadTheme();
    loadCustomization();
    _injectBackupButton();
    _injectDeleteAccountButton();
    _injectDeleteAccountModal();
}

function _injectBackupButton() {
    const dropdown = document.querySelector('.user-dropdown');
    if (!dropdown || dropdown.querySelector('.backup-btn')) return;
    const divider = document.createElement('div');
    divider.className = 'divider';
    const btn = document.createElement('button');
    btn.className = 'backup-btn';
    btn.innerHTML = '&#128190; Download Backup';
    btn.onclick = downloadBackup;
    const dividers = dropdown.querySelectorAll('.divider');
    const lastDivider = dividers[dividers.length - 1];
    if (lastDivider) {
        dropdown.insertBefore(divider, lastDivider);
        dropdown.insertBefore(btn, lastDivider);
    } else {
        dropdown.appendChild(divider);
        dropdown.appendChild(btn);
    }
}

function _injectDeleteAccountButton() {
    const dropdown = document.querySelector('.user-dropdown');
    if (!dropdown || dropdown.querySelector('.delete-account-btn')) return;
    const divider = document.createElement('div');
    divider.className = 'divider';
    const btn = document.createElement('button');
    btn.className = 'delete-account-btn danger';
    btn.innerHTML = '&#128465; Delete Account';
    btn.onclick = showDeleteAccount;
    const signOutBtn = dropdown.querySelector('.danger');
    if (signOutBtn) {
        dropdown.insertBefore(divider, signOutBtn);
        dropdown.insertBefore(btn, signOutBtn);
    } else {
        dropdown.appendChild(divider);
        dropdown.appendChild(btn);
    }
}

function _injectDeleteAccountModal() {
    if (document.getElementById('delete-account-modal')) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'delete-account-modal';
    overlay.innerHTML = `
        <div class="modal">
            <h3>&#128465; Delete Account</h3>
            <p style="color:var(--red-500,#ef4444);font-weight:600;margin-bottom:12px;">This action is permanent and cannot be undone.</p>
            <p style="font-size:14px;color:var(--gray-500,#6b7280);margin-bottom:16px;">All your data including transactions, kids, settings, and family group membership will be permanently deleted.</p>
            <div class="form-group">
                <label>Enter your password to confirm</label>
                <input type="password" id="delete-account-password" placeholder="Your password">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeDeleteAccountModal()">Cancel</button>
                <button class="btn btn-primary" style="background:var(--red-500,#ef4444);border-color:var(--red-500,#ef4444);" onclick="submitDeleteAccount()">Delete Account</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function downloadBackup() {
    document.getElementById('user-menu').classList.remove('open');
    const user = localStorage.getItem('currentUser');
    const token = localStorage.getItem('ff-token');
    if (!user || !token) return notifyError('Not logged in');

    notifyInfo('Preparing backup...');
    try {
        const res = await fetch('/api/user/' + user + '/backup', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return notifyError(err.error || 'Backup failed');
        }
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ff-backup-' + user + '-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notifySuccess('Backup downloaded — store it somewhere safe');
    } catch (e) {
        notifyError('Backup failed: ' + e.message);
    }
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
    showCharts: true,
    fontSize: 'medium',
    accentColor: '#0060a9',
    cardStyle: 'rounded',
    fontFamily: 'system',
    glowMode: false,
    animatedBg: false,
    swirlBg: false,
    bgColor: '#f9fafb',
    bgBrightness: 100,
    sectionOrder: ['stats', 'charts', 'recent']
};

const chartPalettes = {
    default: ['#0060a9', '#1a73c7', '#4a9ae5', '#6bb5f0', '#94cdf7', '#b8e0fb', '#d1ebfd'],
    ocean: ['#0077b6', '#00b4d8', '#90e0ef', '#48cae4', '#023e8a', '#0096c7', '#ade8f4'],
    forest: ['#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2', '#b7e4c7', '#d8f3dc'],
    sunset: ['#e63946', '#f4845f', '#f7a072', '#ffb4a2', '#e5989b', '#b5838d', '#6d6875'],
    royal: ['#7b2cbf', '#9d4edd', '#c77dff', '#e0aaff', '#3c096c', '#5a189a', '#240046'],
    monochrome: ['#111827', '#1f2937', '#374151', '#4b5563', '#6b7280', '#9ca3af', '#d1d5db']
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

    // Font size
    document.body.classList.remove('font-small', 'font-medium', 'font-large');
    document.body.classList.add('font-' + (userSettings.fontSize || 'medium'));

    // Accent color
    if (userSettings.accentColor) {
        document.documentElement.style.setProperty('--accent', userSettings.accentColor);
    }

    // Card style
    document.body.classList.remove('card-rounded', 'card-sharp', 'card-glass');
    document.body.classList.add('card-' + (userSettings.cardStyle || 'rounded'));

    // Font family
    document.body.classList.remove('font-system', 'font-serif', 'font-mono', 'font-handwriting');
    document.body.classList.add('font-' + (userSettings.fontFamily || 'system'));

    // Glow mode
    document.body.classList.toggle('glow-mode', !!userSettings.glowMode);

    // Animated background
    document.body.classList.toggle('animated-bg', !!userSettings.animatedBg);

    // Colorful swirl background
    document.body.classList.toggle('swirl-bg', !!userSettings.swirlBg);

    // Background color
    if (userSettings.bgColor && userSettings.bgColor !== '#f9fafb') {
        document.documentElement.style.setProperty('--bg-color', userSettings.bgColor);
        document.body.style.background = userSettings.bgColor;
    } else {
        document.documentElement.style.removeProperty('--bg-color');
        document.body.style.background = '';
    }

    // Background brightness
    const brightness = userSettings.bgBrightness || 100;
    if (brightness !== 100) {
        document.body.style.filter = 'brightness(' + (brightness / 100) + ')';
    } else {
        document.body.style.filter = '';
    }

    // Section order (dashboard only)
    applySectionOrder();

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
            if (group === 'accentColor') {
                btn.classList.toggle('active', userSettings.accentColor === value);
            } else             if (group === 'glowMode') {
                btn.classList.toggle('active', !!userSettings.glowMode);
            } else if (group === 'animatedBg') {
                btn.classList.toggle('active', !!userSettings.animatedBg);
            } else if (group === 'swirlBg') {
                btn.classList.toggle('active', !!userSettings.swirlBg);
            } else {
                btn.classList.toggle('active', String(userSettings[group]) === value);
            }
        }
    });

    const picker = document.getElementById('accent-color-picker');
    if (picker) picker.value = userSettings.accentColor || '#0060a9';
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

function setAccentColor(color) {
    saveSetting('accentColor', color);
}

function toggleGlow(el) {
    const next = !userSettings.glowMode;
    el.classList.toggle('active', next);
    saveSetting('glowMode', next);
}

function toggleAnimatedBg(el) {
    const next = !userSettings.animatedBg;
    el.classList.toggle('active', next);
    saveSetting('animatedBg', next);
}

function toggleSwirlBg(el) {
    const next = !userSettings.swirlBg;
    el.classList.toggle('active', next);
    saveSetting('swirlBg', next);
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
    if (!current || !newPw) return notifyError('Fill in all fields');
    if (newPw !== confirm) return notifyError('Passwords do not match');
    const data = await apiPost('/api/user/' + user + '/change-password', { currentPassword: current, newPassword: newPw });
    if (data.error) return notifyError(data.error);
    notifySuccess('Password changed!');
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
    if (!newUn || !pw) return notifyError('Fill in all fields');
    const data = await apiPost('/api/user/' + user + '/change-username', { newUsername: newUn, password: pw });
    if (data.error) return notifyError(data.error);
    localStorage.setItem('currentUser', data.newUsername);
    if (data.token) localStorage.setItem('ff-token', data.token);
    document.getElementById('user-display').textContent = data.newUsername;
    document.getElementById('user-avatar').textContent = data.newUsername[0].toUpperCase();
    closeChangeUnModal();
    notifySuccess('Username changed!');
    document.getElementById('un-new').value = '';
    document.getElementById('un-password').value = '';
}

function logout() {
    clearUser();
    window.location.href = '/';
}

// Delete Account
function showDeleteAccount() {
    document.getElementById('user-menu').classList.remove('open');
    document.getElementById('delete-account-modal').classList.add('active');
    document.getElementById('delete-account-password').value = '';
}

function closeDeleteAccountModal() {
    document.getElementById('delete-account-modal').classList.remove('active');
}

async function submitDeleteAccount() {
    const user = localStorage.getItem('currentUser');
    const password = document.getElementById('delete-account-password').value;
    if (!password) return notifyError('Enter your password to confirm');

    const confirmed = await showConfirm('Are you absolutely sure? This will permanently delete your account and all data.', { confirmText: 'Delete Forever', danger: true });
    if (!confirmed) return;

    const data = await apiDelete('/api/user/' + user, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    if (data.error) return notifyError(data.error);
    notifySuccess('Account deleted');
    closeDeleteAccountModal();
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
        if (data.error) return notifyError(data.error);

        statusEl.innerHTML = '<p style="color:#22c55e;font-weight:600">Scan QR code and enter code to enable</p>';
        setupEl.style.display = 'block';
        document.getElementById('twofa-qr').src = data.qrCode;
        actionBtn.textContent = 'Verify & Enable';
        actionBtn.style.display = 'inline-block';
        actionBtn.onclick = verify2FASetup;
    } catch (e) {
        notifyError('Failed to start 2FA setup');
    }
}

async function verify2FASetup() {
    const user = localStorage.getItem('currentUser');
    const code = document.getElementById('twofa-verify-code').value.trim();
    if (!code || code.length !== 6) return notifyError('Enter a 6-digit code');

    try {
        const data = await apiPost('/api/user/' + user + '/2fa/verify', { code });
        if (data.error) return notifyError(data.error);
        notifySuccess('2FA enabled successfully!');
        close2FAModal();
    } catch (e) {
        notifyError('Failed to verify code');
    }
}

async function disable2FA() {
    const user = localStorage.getItem('currentUser');
    const password = document.getElementById('twofa-disable-pw').value;
    const code = document.getElementById('twofa-disable-code').value.trim();
    if (!password) return notifyError('Enter your password');
    if (!code || code.length !== 6) return notifyError('Enter a 6-digit code');

    try {
        const data = await apiPost('/api/user/' + user + '/2fa/disable', { password, code });
        if (data.error) return notifyError(data.error);
        notifySuccess('2FA has been disabled');
        close2FAModal();
    } catch (e) {
        notifyError('Failed to disable 2FA');
    }
}

// Forget trusted device - will require 2FA code on next login
async function forgetDevice() {
    localStorage.removeItem('ff-trusted');
    notifyInfo('This device has been forgotten. You will need to enter your 2FA code on next login.');
}

// Background Color
function setBgColor(color, el) {
    saveSetting('bgColor', color);
    document.querySelectorAll('.bg-preset').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    const picker = document.getElementById('bg-color-picker');
    if (picker) picker.value = color;
}

function adjustBgBrightness(val) {
    saveSetting('bgBrightness', parseInt(val));
}

function resetBgColor() {
    saveSetting('bgColor', '#f9fafb');
    saveSetting('bgBrightness', 100);
    document.getElementById('bg-color-picker').value = '#f9fafb';
    document.getElementById('bg-brightness').value = 100;
    document.querySelectorAll('.bg-preset').forEach(b => {
        b.classList.toggle('active', b.dataset.bg === '#f9fafb');
    });
}

// Section Order (Drag & Drop)
function applySectionOrder() {
    const list = document.getElementById('drag-section-list');
    if (!list) return;
    const order = userSettings.sectionOrder || ['stats', 'charts', 'recent'];
    const container = document.querySelector('.dashboard-sections') || document.querySelector('.main-content');
    if (!container) return;
    const sections = {
        stats: container.querySelector('.stats-grid'),
        charts: container.querySelector('.charts-grid'),
        recent: container.querySelector('.recent-section') || container.querySelector('.card:last-child')
    };
    order.forEach(key => {
        if (sections[key]) container.appendChild(sections[key]);
    });
}

function initDragAndDrop() {
    const list = document.getElementById('drag-section-list');
    if (!list) return;
    let dragItem = null;

    list.querySelectorAll('.drag-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            dragItem = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            list.querySelectorAll('.drag-item').forEach(i => i.classList.remove('drag-over'));
            dragItem = null;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
            if (dragItem && dragItem !== item) {
                const items = [...list.querySelectorAll('.drag-item')];
                const fromIdx = items.indexOf(dragItem);
                const toIdx = items.indexOf(item);
                if (fromIdx < toIdx) {
                    list.insertBefore(dragItem, item.nextSibling);
                } else {
                    list.insertBefore(dragItem, item);
                }
                const newOrder = [...list.querySelectorAll('.drag-item')].map(i => i.dataset.section);
                saveSetting('sectionOrder', newOrder);
            }
        });
    });
}

// Initialize drag-and-drop when customize modal opens
const origShowCustomize = showCustomize;
showCustomize = function() {
    origShowCustomize();
    setTimeout(() => {
        initDragAndDrop();
        // Sync background color presets
        document.querySelectorAll('.bg-preset').forEach(b => {
            b.classList.toggle('active', b.dataset.bg === userSettings.bgColor);
        });
        const bgPicker = document.getElementById('bg-color-picker');
        if (bgPicker) bgPicker.value = userSettings.bgColor || '#f9fafb';
        const bgBright = document.getElementById('bg-brightness');
        if (bgBright) bgBright.value = userSettings.bgBrightness || 100;
    }, 50);
};
