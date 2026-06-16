function initUserMenu(username) {
    document.getElementById('user-display').textContent = username;
    document.getElementById('user-avatar').textContent = username[0].toUpperCase();
    loadTheme();
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
    const user = localStorage.getItem('currentUser');
    if (user) fetch('/api/user/' + user + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme })
    });
}

function loadTheme() {
    const saved = localStorage.getItem('ff-theme') || 'light';
    document.body.className = saved === 'light' ? '' : 'theme-' + saved;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === saved));
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
    const res = await fetch('/api/user/' + user + '/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: newPw })
    });
    const data = await res.json();
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
    const res = await fetch('/api/user/' + user + '/change-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newUsername: newUn, password: pw })
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    localStorage.setItem('currentUser', data.newUsername);
    document.getElementById('user-display').textContent = data.newUsername;
    document.getElementById('user-avatar').textContent = data.newUsername[0].toUpperCase();
    closeChangeUnModal();
    alert('Username changed!');
    document.getElementById('un-new').value = '';
    document.getElementById('un-password').value = '';
}

function logout() {
    localStorage.removeItem('currentUser');
    sessionStorage.clear();
    window.location.href = '/';
}
