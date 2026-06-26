// Inline notification system (toast/snackbar)
// Usage: notify('message', 'success' | 'error' | 'info' | 'warning')

function notify(message, type = 'info') {
    const container = document.getElementById('notification-container') || createNotificationContainer();
    
    const toast = document.createElement('div');
    toast.className = 'notification-toast notification-' + type;
    
    const icons = {
        success: '&#10003;',
        error: '&#10007;',
        warning: '&#9888;',
        info: '&#8505;'
    };
    
    toast.innerHTML = `
        <span class="notification-icon">${icons[type] || icons.info}</span>
        <span class="notification-message">${escapeHtml(message)}</span>
        <button class="notification-close" onclick="dismissNotification(this.parentElement)">&#10005;</button>
    `;
    
    container.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('notification-show');
    });
    
    // Auto-dismiss after 5 seconds (errors stay longer)
    const duration = type === 'error' ? 8000 : 5000;
    setTimeout(() => dismissNotification(toast), duration);
    
    return toast;
}

function dismissNotification(toast) {
    if (!toast || !toast.parentElement) return;
    toast.classList.remove('notification-show');
    toast.classList.add('notification-hide');
    setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 300);
}

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    document.body.appendChild(container);
    return container;
}

// Convenience methods
function notifySuccess(msg) { return notify(msg, 'success'); }
function notifyError(msg) { return notify(msg, 'error'); }
function notifyWarning(msg) { return notify(msg, 'warning'); }
function notifyInfo(msg) { return notify(msg, 'info'); }

// In-app confirm dialog — replaces native browser confirm()
// Usage: const yes = await showConfirm('Are you sure?')
function showConfirm(message, { confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
        // Remove any existing confirm dialog
        const existing = document.getElementById('ff-confirm-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'ff-confirm-overlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:9999',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:rgba(0,0,0,0.45)', 'backdrop-filter:blur(2px)',
            'animation:ff-fade-in 0.15s ease'
        ].join(';');

        overlay.innerHTML = `
            <div style="
                background:var(--white,#fff);
                border-radius:16px;
                padding:28px 28px 22px;
                max-width:360px;
                width:calc(100% - 40px);
                box-shadow:0 20px 60px rgba(0,0,0,0.25);
                animation:ff-slide-up 0.18s ease;
            ">
                <p style="
                    margin:0 0 22px;
                    font-size:15px;
                    line-height:1.5;
                    color:var(--gray-800,#1f2937);
                    font-weight:500;
                ">${escapeHtml(message)}</p>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button id="ff-confirm-cancel" class="btn btn-secondary" style="min-width:90px;">${escapeHtml(cancelText)}</button>
                    <button id="ff-confirm-ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" style="min-width:90px;">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        // Inject keyframe animations once
        if (!document.getElementById('ff-confirm-styles')) {
            const style = document.createElement('style');
            style.id = 'ff-confirm-styles';
            style.textContent = `
                @keyframes ff-fade-in { from { opacity:0 } to { opacity:1 } }
                @keyframes ff-slide-up { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
                #ff-confirm-overlay .btn-danger { background:var(--red-500,#ef4444); color:#fff; border-color:var(--red-500,#ef4444); }
                #ff-confirm-overlay .btn-danger:hover { background:var(--red-600,#dc2626); }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);

        function finish(result) {
            overlay.style.animation = 'ff-fade-in 0.12s ease reverse';
            setTimeout(() => overlay.remove(), 120);
            resolve(result);
        }

        document.getElementById('ff-confirm-ok').addEventListener('click', () => finish(true));
        document.getElementById('ff-confirm-cancel').addEventListener('click', () => finish(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
        document.addEventListener('keydown', function handler(e) {
            if (e.key === 'Escape') { finish(false); document.removeEventListener('keydown', handler); }
            if (e.key === 'Enter') { finish(true); document.removeEventListener('keydown', handler); }
        });

        // Focus the confirm button
        requestAnimationFrame(() => document.getElementById('ff-confirm-ok').focus());
    });
}
