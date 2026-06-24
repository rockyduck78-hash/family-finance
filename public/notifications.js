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
