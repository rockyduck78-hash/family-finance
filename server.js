const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {} }, null, 2));
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
    try {
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        const defaultData = { users: {} };
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Auth
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    const data = readData();
    
    if (data.users[username]) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    
    data.users[username] = { 
        password, 
        transactionPassword: null,
        transactions: [], 
        kids: [],
        pendingApprovals: []
    };
    writeData(data);
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const data = readData();
    
    if (!data.users[username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    if (data.users[username].password !== password) {
        return res.status(401).json({ error: 'Incorrect password' });
    }
    
    res.json({ success: true });
});

// Transaction password
app.post('/api/set-transaction-password', (req, res) => {
    const { username, password } = req.body;
    const data = readData();
    
    if (!data.users[username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    data.users[username].transactionPassword = password;
    writeData(data);
    res.json({ success: true });
});

app.post('/api/verify-transaction-password', (req, res) => {
    const { username, password } = req.body;
    const data = readData();
    
    if (!data.users[username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    if (!data.users[username].transactionPassword) {
        return res.json({ success: true });
    }
    if (data.users[username].transactionPassword !== password) {
        return res.status(401).json({ error: 'Incorrect password' });
    }
    
    res.json({ success: true });
});

// User data
app.get('/api/user/:username', (req, res) => {
    const data = readData();
    if (!data.users[req.params.username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    const user = data.users[req.params.username];
    res.json({
        transactions: user.transactions || [],
        kids: user.kids || [],
        pendingApprovals: user.pendingApprovals || [],
        hasTransactionPassword: !!user.transactionPassword
    });
});

// Transactions
app.put('/api/user/:username/transactions', (req, res) => {
    const data = readData();
    if (!data.users[req.params.username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    data.users[req.params.username].transactions = req.body.transactions;
    writeData(data);
    res.json({ success: true });
});

// Kids
app.put('/api/user/:username/kids', (req, res) => {
    const data = readData();
    if (!data.users[req.params.username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    data.users[req.params.username].kids = req.body.kids;
    writeData(data);
    res.json({ success: true });
});

// Kid requests to add money (goes to pending)
app.post('/api/user/:username/kids/:kidId/request-money', (req, res) => {
    const { username, kidId } = req.params;
    const { amount, description } = req.body;
    const data = readData();
    
    if (!data.users[username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const user = data.users[username];
    const kid = user.kids.find(k => k.id === parseInt(kidId));
    
    if (!kid) {
        return res.status(404).json({ error: 'Kid not found' });
    }
    
    if (!user.pendingApprovals) user.pendingApprovals = [];
    
    user.pendingApprovals.push({
        id: Date.now(),
        kidId: kid.id,
        kidName: kid.name,
        type: 'add',
        amount: amount,
        description: description,
        date: new Date().toISOString()
    });
    
    writeData(data);
    res.json({ success: true });
});

// Kid requests to spend money (goes to pending)
app.post('/api/user/:username/kids/:kidId/request-spend', (req, res) => {
    const { username, kidId } = req.params;
    const { amount, description } = req.body;
    const data = readData();
    
    if (!data.users[username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const user = data.users[username];
    const kid = user.kids.find(k => k.id === parseInt(kidId));
    
    if (!kid) {
        return res.status(404).json({ error: 'Kid not found' });
    }
    
    if (amount > kid.balance) {
        return res.status(400).json({ error: 'Insufficient kid balance' });
    }
    
    if (!user.pendingApprovals) user.pendingApprovals = [];
    
    user.pendingApprovals.push({
        id: Date.now(),
        kidId: kid.id,
        kidName: kid.name,
        type: 'spend',
        amount: amount,
        description: description,
        date: new Date().toISOString()
    });
    
    writeData(data);
    res.json({ success: true });
});

// Approve a pending request
app.post('/api/user/:username/approve/:approvalId', (req, res) => {
    const { username, approvalId } = req.params;
    const data = readData();
    
    if (!data.users[username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const user = data.users[username];
    const approvalIndex = (user.pendingApprovals || []).findIndex(a => a.id === parseInt(approvalId));
    
    if (approvalIndex === -1) {
        return res.status(404).json({ error: 'Approval not found' });
    }
    
    const approval = user.pendingApprovals[approvalIndex];
    const now = new Date().toISOString();
    
    if (!user.transactions) user.transactions = [];
    
    if (approval.type === 'add') {
        const kidIndex = user.kids.findIndex(k => k.id === approval.kidId);
        if (kidIndex === -1) return res.status(404).json({ error: 'Kid not found' });
        if (!user.kids[kidIndex].transactions) user.kids[kidIndex].transactions = [];
        
        const income = user.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const expenses = user.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        if (approval.amount > (income - expenses)) {
            return res.status(400).json({ error: 'Insufficient parent balance' });
        }
        
        user.kids[kidIndex].balance += approval.amount;
        user.kids[kidIndex].transactions.push({
            id: Date.now(),
            description: approval.description,
            amount: approval.amount,
            type: 'income',
            date: now
        });
        user.transactions.push({
            id: Date.now() + 2,
            description: `Given to ${approval.kidName}: ${approval.description}`,
            amount: approval.amount,
            type: 'expense',
            category: 'kids',
            date: now
        });
    } else if (approval.type === 'kid-transfer') {
        const fromKid = user.kids.find(k => k.id === approval.fromKidId);
        const toKid = user.kids.find(k => k.id === approval.toKidId);
        
        if (!fromKid || !toKid) return res.status(404).json({ error: 'Kid not found' });
        if (approval.amount > fromKid.balance) return res.status(400).json({ error: 'Insufficient kid balance' });
        
        if (!fromKid.transactions) fromKid.transactions = [];
        if (!toKid.transactions) toKid.transactions = [];
        
        fromKid.balance -= approval.amount;
        fromKid.transactions.push({
            id: Date.now(),
            description: `Sent to ${toKid.name}: ${approval.description}`,
            amount: approval.amount,
            type: 'expense',
            date: now
        });
        
        toKid.balance += approval.amount;
        toKid.transactions.push({
            id: Date.now() + 1,
            description: `Received from ${fromKid.name}: ${approval.description}`,
            amount: approval.amount,
            type: 'income',
            date: now
        });
    } else {
        const kidIndex = user.kids.findIndex(k => k.id === approval.kidId);
        if (kidIndex === -1) return res.status(404).json({ error: 'Kid not found' });
        if (!user.kids[kidIndex].transactions) user.kids[kidIndex].transactions = [];
        
        if (approval.amount > user.kids[kidIndex].balance) {
            return res.status(400).json({ error: 'Insufficient kid balance' });
        }
        
        user.kids[kidIndex].balance -= approval.amount;
        user.kids[kidIndex].transactions.push({
            id: Date.now(),
            description: approval.description,
            amount: approval.amount,
            type: 'expense',
            date: now
        });
        user.transactions.push({
            id: Date.now() + 2,
            description: `Received from ${approval.kidName}: ${approval.description}`,
            amount: approval.amount,
            type: 'income',
            category: 'kids',
            date: now
        });
    }
    
    user.pendingApprovals.splice(approvalIndex, 1);
    writeData(data);
    res.json({ success: true });
});

// Deny a pending request
app.post('/api/user/:username/deny/:approvalId', (req, res) => {
    const { username, approvalId } = req.params;
    const data = readData();
    
    if (!data.users[username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const user = data.users[username];
    const index = (user.pendingApprovals || []).findIndex(a => a.id === parseInt(approvalId));
    
    if (index === -1) {
        return res.status(404).json({ error: 'Approval not found' });
    }
    
    user.pendingApprovals.splice(index, 1);
    writeData(data);
    res.json({ success: true });
});

// Kid-to-kid transfer request
app.post('/api/user/:username/kids/:kidId/transfer-to-kid', (req, res) => {
    const { username, kidId } = req.params;
    const { targetKidId, amount, description } = req.body;
    const data = readData();

    if (!data.users[username]) {
        return res.status(404).json({ error: 'User not found' });
    }

    const user = data.users[username];
    const fromKid = user.kids.find(k => k.id === parseInt(kidId));
    const toKid = user.kids.find(k => k.id === parseInt(targetKidId));

    if (!fromKid) return res.status(404).json({ error: 'Source kid not found' });
    if (!toKid) return res.status(404).json({ error: 'Target kid not found' });
    if (fromKid.id === toKid.id) return res.status(400).json({ error: 'Cannot transfer to yourself' });
    if (amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });

    if (!user.pendingApprovals) user.pendingApprovals = [];

    user.pendingApprovals.push({
        id: Date.now(),
        type: 'kid-transfer',
        fromKidId: fromKid.id,
        fromKidName: fromKid.name,
        toKidId: toKid.id,
        toKidName: toKid.name,
        amount: amount,
        description: description || `${fromKid.name} → ${toKid.name}`,
        date: new Date().toISOString()
    });

    writeData(data);
    res.json({ success: true });
});

// Scheduled payments
app.get('/api/user/:username/scheduled-payments', (req, res) => {
    const data = readData();
    if (!data.users[req.params.username]) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json(data.users[req.params.username].scheduledPayments || []);
});

app.post('/api/user/:username/scheduled-payments', (req, res) => {
    const { username } = req.params;
    const { kidId, amount, description, frequency, dayOfWeek, dayOfMonth } = req.body;
    const data = readData();

    if (!data.users[username]) return res.status(404).json({ error: 'User not found' });

    const user = data.users[username];
    const kid = user.kids.find(k => k.id === parseInt(kidId));
    if (!kid) return res.status(404).json({ error: 'Kid not found' });

    if (!user.scheduledPayments) user.scheduledPayments = [];

    const payment = {
        id: Date.now(),
        kidId: kid.id,
        kidName: kid.name,
        amount: parseFloat(amount),
        description: description || 'Allowance',
        frequency,
        dayOfWeek: parseInt(dayOfWeek) || 0,
        dayOfMonth: parseInt(dayOfMonth) || 1,
        lastPaid: null,
        active: true,
        created: new Date().toISOString()
    };

    user.scheduledPayments.push(payment);
    writeData(data);
    res.json({ success: true, payment });
});

app.put('/api/user/:username/scheduled-payments/:paymentId', (req, res) => {
    const { username, paymentId } = req.params;
    const { active } = req.body;
    const data = readData();

    if (!data.users[username]) return res.status(404).json({ error: 'User not found' });

    const user = data.users[username];
    const payment = (user.scheduledPayments || []).find(p => p.id === parseInt(paymentId));
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    payment.active = active;
    writeData(data);
    res.json({ success: true });
});

app.delete('/api/user/:username/scheduled-payments/:paymentId', (req, res) => {
    const { username, paymentId } = req.params;
    const data = readData();

    if (!data.users[username]) return res.status(404).json({ error: 'User not found' });

    const user = data.users[username];
    const index = (user.scheduledPayments || []).findIndex(p => p.id === parseInt(paymentId));
    if (index === -1) return res.status(404).json({ error: 'Payment not found' });

    user.scheduledPayments.splice(index, 1);
    writeData(data);
    res.json({ success: true });
});

function processScheduledPayments() {
    const data = readData();
    const now = new Date();
    let changed = false;

    for (const username of Object.keys(data.users)) {
        const user = data.users[username];
        if (!user.scheduledPayments || !user.kids) continue;

        for (const sp of user.scheduledPayments) {
            if (!sp.active) continue;
            if (!sp.lastPaid) {
                sp.lastPaid = now.toISOString();
                changed = true;
                continue;
            }

            const lastPaid = new Date(sp.lastPaid);
            const diffDays = Math.floor((now - lastPaid) / (1000 * 60 * 60 * 24));
            let shouldPay = false;

            if (sp.frequency === 'daily' && diffDays >= 1) {
                shouldPay = true;
            } else if (sp.frequency === 'weekly' && diffDays >= 7) {
                shouldPay = true;
            } else if (sp.frequency === 'biweekly' && diffDays >= 14) {
                shouldPay = true;
            } else if (sp.frequency === 'monthly' && (now.getDate() >= sp.dayOfMonth && now.getDate() <= sp.dayOfMonth + 1)) {
                const monthDiff = (now.getFullYear() - lastPaid.getFullYear()) * 12 + now.getMonth() - lastPaid.getMonth();
                if (monthDiff >= 1 || (monthDiff === 0 && now.getDate() === sp.dayOfMonth)) {
                    shouldPay = true;
                }
            }

            if (shouldPay) {
                const kid = user.kids.find(k => k.id === sp.kidId);
                if (kid) {
                    if (!user.transactions) user.transactions = [];
                    if (!kid.transactions) kid.transactions = [];

                    user.transactions.push({
                        id: Date.now(),
                        description: `Auto: ${sp.description} → ${sp.kidName}`,
                        amount: sp.amount,
                        type: 'expense',
                        category: 'kids',
                        date: now.toISOString()
                    });

                    kid.balance += sp.amount;
                    kid.transactions.push({
                        id: Date.now() + 1,
                        description: sp.description,
                        amount: sp.amount,
                        type: 'income',
                        date: now.toISOString()
                    });

                    sp.lastPaid = now.toISOString();
                    changed = true;
                }
            }
        }
    }

    if (changed) writeData(data);
}

setInterval(processScheduledPayments, 60 * 1000);
processScheduledPayments();

// Transfer
app.post('/api/transfer', (req, res) => {
    const { from, to, amount, note } = req.body;
    const data = readData();
    
    if (!data.users[from]) {
        return res.status(404).json({ error: 'Sender not found' });
    }
    if (!data.users[to]) {
        return res.status(404).json({ error: 'Recipient not found' });
    }
    if (from === to) {
        return res.status(400).json({ error: 'Cannot send to yourself' });
    }
    
    const senderTx = data.users[from].transactions || [];
    const income = senderTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenses = senderTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = income - expenses;
    
    if (amount > balance) {
        return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const now = new Date().toISOString();
    
    if (!data.users[from].transactions) data.users[from].transactions = [];
    if (!data.users[to].transactions) data.users[to].transactions = [];
    
    data.users[from].transactions.push({
        id: Date.now(),
        description: `Sent to ${to}: ${note || 'Transfer'}`,
        amount, type: 'expense', category: 'transfer', date: now
    });
    
    data.users[to].transactions.push({
        id: Date.now() + 1,
        description: `Received from ${from}: ${note || 'Transfer'}`,
        amount, type: 'income', category: 'transfer', date: now
    });
    
    writeData(data);
    res.json({ success: true });
});

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/transactions', (req, res) => res.sendFile(path.join(__dirname, 'public', 'transactions.html')));
app.get('/kids', (req, res) => res.sendFile(path.join(__dirname, 'public', 'kids.html')));
app.get('/transfer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'transfer.html')));

// Network info
app.get('/api/network-info', (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let ip = 'localhost';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ip = iface.address;
                break;
            }
        }
    }
    res.json({ ip, port: PORT, url: `http://${ip}:${PORT}` });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
