const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// SMTP config for sending reset emails (optional - falls back to showing code on screen)
const transporter = process.env.SMTP_HOST ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
}) : null;

const SMTP_FROM = process.env.SMTP_FROM || 'Family Finance <noreply@familyfinance.app>';

if (!MONGODB_URI) {
    console.error('MONGODB_URI environment variable is not set!');
    console.error('Please add MONGODB_URI to your Render environment variables.');
}

// Connect to MongoDB with retry
let mongoReady = false;

async function connectMongo() {
    try {
        if (!MONGODB_URI) {
            console.error('MONGODB_URI not set!');
            return;
        }
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            heartbeatFrequencyMS: 30000,
            maxPoolSize: 5
        });
        mongoReady = true;
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        mongoReady = false;
        setTimeout(connectMongo, 10000);
    }
}

connectMongo();

mongoose.connection.on('disconnected', () => {
    mongoReady = false;
    console.log('MongoDB disconnected');
    setTimeout(connectMongo, 5000);
});

mongoose.connection.on('connected', () => {
    mongoReady = true;
    console.log('MongoDB connected event fired');
    processScheduledPayments();
});

// Schemas
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, default: null },
    password: { type: String, required: true },
    resetCode: { type: String, default: null },
    resetCodeExpiry: { type: Date, default: null },
    transactions: { type: [{ 
        id: { type: Number },
        description: { type: String },
        amount: { type: Number },
        type: { type: String },
        category: { type: String },
        date: { type: String }
    }], default: [] },
    kids: { type: [{ 
        id: { type: Number },
        name: { type: String },
        password: { type: String },
        balance: { type: Number, default: 0 },
        transactions: { type: [{ 
            id: { type: Number },
            description: { type: String },
            amount: { type: Number },
            type: { type: String },
            date: { type: String }
        }], default: [] }
    }], default: [] },
    pendingApprovals: { type: [{ 
        id: { type: Number },
        kidId: { type: Number },
        kidName: { type: String },
        type: { type: String },
        fromKidId: { type: Number },
        fromKidName: { type: String },
        toKidId: { type: Number },
        toKidName: { type: String },
        amount: { type: Number },
        description: { type: String },
        date: { type: String }
    }], default: [] },
    scheduledPayments: { type: [{ 
        id: { type: Number },
        kidId: { type: Number },
        kidName: { type: String },
        amount: { type: Number },
        description: { type: String },
        frequency: { type: String },
        dayOfWeek: { type: Number },
        dayOfMonth: { type: Number },
        lastPaid: { type: String },
        active: { type: Boolean, default: true },
        created: { type: String }
    }], default: [] },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Log MongoDB connection state for API calls
app.use('/api', (req, res, next) => {
    if (!mongoReady && mongoose.connection.readyState !== 1) {
        console.error('API request while MongoDB not connected:', req.method, req.path);
    }
    next();
});

// Helper functions
async function getUser(username) {
    return await User.findOne({ username });
}

// Auth
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        const existing = await User.findOne({ username });
        
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        if (email) {
            const emailExists = await User.findOne({ email });
            if (emailExists) {
                return res.status(400).json({ error: 'Email already registered' });
            }
        }
        
        await User.create({
            username,
            password,
            email: email || null,
            transactions: [],
            kids: [],
            pendingApprovals: [],
            scheduledPayments: [],
            settings: {}
        });
        
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.password !== password) {
            return res.status(401).json({ error: 'Incorrect password' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// User data
app.get('/api/user/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            transactions: user.transactions || [],
            kids: user.kids || [],
            pendingApprovals: user.pendingApprovals || [],
            scheduledPayments: user.scheduledPayments || [],
            settings: user.settings || {}
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Transactions
app.put('/api/user/:username/transactions', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        user.transactions = req.body.transactions;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error('Save transactions error:', err.message);
        res.status(500).json({ error: 'Failed to save: ' + err.message });
    }
});

// Kids
app.put('/api/user/:username/kids', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        user.kids = req.body.kids;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Kid requests to add money (goes to pending)
app.post('/api/user/:username/kids/:kidId/request-money', async (req, res) => {
    try {
        const { username, kidId } = req.params;
        const { amount, description } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
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
        
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Kid requests to spend money (goes to pending)
app.post('/api/user/:username/kids/:kidId/request-spend', async (req, res) => {
    try {
        const { username, kidId } = req.params;
        const { amount, description } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
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
        
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Approve a pending request
app.post('/api/user/:username/approve/:approvalId', async (req, res) => {
    try {
        const { username, approvalId } = req.params;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
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
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Deny a pending request
app.post('/api/user/:username/deny/:approvalId', async (req, res) => {
    try {
        const { username, approvalId } = req.params;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const index = (user.pendingApprovals || []).findIndex(a => a.id === parseInt(approvalId));
        
        if (index === -1) {
            return res.status(404).json({ error: 'Approval not found' });
        }
        
        user.pendingApprovals.splice(index, 1);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Kid-to-kid transfer request
app.post('/api/user/:username/kids/:kidId/transfer-to-kid', async (req, res) => {
    try {
        const { username, kidId } = req.params;
        const { targetKidId, amount, description } = req.body;
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

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

        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Scheduled payments
app.get('/api/user/:username/scheduled-payments', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user.scheduledPayments || []);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/user/:username/scheduled-payments', async (req, res) => {
    try {
        const { username } = req.params;
        const { kidId, amount, description, frequency, dayOfWeek, dayOfMonth } = req.body;
        const user = await User.findOne({ username });

        if (!user) return res.status(404).json({ error: 'User not found' });

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
        await user.save();
        res.json({ success: true, payment });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/user/:username/scheduled-payments/:paymentId', async (req, res) => {
    try {
        const { username, paymentId } = req.params;
        const { active } = req.body;
        const user = await User.findOne({ username });

        if (!user) return res.status(404).json({ error: 'User not found' });

        const payment = (user.scheduledPayments || []).find(p => p.id === parseInt(paymentId));
        if (!payment) return res.status(404).json({ error: 'Payment not found' });

        payment.active = active;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/user/:username/scheduled-payments/:paymentId', async (req, res) => {
    try {
        const { username, paymentId } = req.params;
        const user = await User.findOne({ username });

        if (!user) return res.status(404).json({ error: 'User not found' });

        const index = (user.scheduledPayments || []).findIndex(p => p.id === parseInt(paymentId));
        if (index === -1) return res.status(404).json({ error: 'Payment not found' });

        user.scheduledPayments.splice(index, 1);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

async function processScheduledPayments() {
    if (!mongoReady || mongoose.connection.readyState !== 1) return;
    try {
        const users = await User.find({});
        const now = new Date();

        for (const user of users) {
            if (!user.scheduledPayments || !user.kids) continue;
            let changed = false;

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

            if (changed) await user.save();
        }
    } catch (err) {
        console.error('Error processing scheduled payments:', err);
    }
}

setInterval(processScheduledPayments, 60 * 1000);

// Transfer
app.post('/api/transfer', async (req, res) => {
    try {
        const { from, to, amount, note } = req.body;
        
        const sender = await User.findOne({ username: from });
        const recipient = await User.findOne({ username: to });
        
        if (!sender) {
            return res.status(404).json({ error: 'Sender not found' });
        }
        if (!recipient) {
            return res.status(404).json({ error: 'Recipient not found' });
        }
        if (from === to) {
            return res.status(400).json({ error: 'Cannot send to yourself' });
        }
        
        const senderTx = sender.transactions || [];
        const income = senderTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const expenses = senderTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const balance = income - expenses;
        
        if (amount > balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        const now = new Date().toISOString();
        
        if (!sender.transactions) sender.transactions = [];
        if (!recipient.transactions) recipient.transactions = [];
        
        sender.transactions.push({
            id: Date.now(),
            description: `Sent to ${to}: ${note || 'Transfer'}`,
            amount, type: 'expense', category: 'transfer', date: now
        });
        
        recipient.transactions.push({
            id: Date.now() + 1,
            description: `Received from ${from}: ${note || 'Transfer'}`,
            amount, type: 'income', category: 'transfer', date: now
        });
        
        await sender.save();
        await recipient.save();
        
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Change password
app.post('/api/user/:username/change-password', async (req, res) => {
    try {
        const { username } = req.params;
        const { currentPassword, newPassword } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.password !== currentPassword) return res.status(401).json({ error: 'Incorrect current password' });
        user.password = newPassword;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Change username
app.post('/api/user/:username/change-username', async (req, res) => {
    try {
        const { username } = req.params;
        const { newUsername, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.password !== password) return res.status(401).json({ error: 'Incorrect password' });
        const exists = await User.findOne({ username: newUsername });
        if (exists) return res.status(400).json({ error: 'Username already taken' });
        user.username = newUsername;
        await user.save();
        res.json({ success: true, newUsername });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Settings (theme)
app.get('/api/user/:username/settings', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user.settings || {});
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/user/:username/settings', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.settings = req.body;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Forgot password - send reset code
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'No account with that email' });

        const code = crypto.randomInt(100000, 999999).toString();
        user.resetCode = code;
        user.resetCodeExpiry = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();

        if (transporter) {
            try {
                await transporter.sendMail({
                    from: SMTP_FROM,
                    to: email,
                    subject: 'Family Finance - Password Reset Code',
                    text: `Your reset code is: ${code}\nThis code expires in 15 minutes.`,
                    html: `<p>Your password reset code is:</p><h2 style="letter-spacing:4px">${code}</h2><p>This code expires in 15 minutes.</p>`
                });
                res.json({ success: true, emailed: true });
            } catch (err) {
                console.error('Email send error:', err.message);
                res.json({ success: true, emailed: false, code });
            }
        } else {
            res.json({ success: true, emailed: false, code });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify reset code
app.post('/api/verify-reset-code', async (req, res) => {
    try {
        const { email, code } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.resetCode || !user.resetCodeExpiry) return res.status(400).json({ error: 'No reset code active' });
        if (new Date() > user.resetCodeExpiry) return res.status(400).json({ error: 'Code expired' });
        if (user.resetCode !== code) return res.status(401).json({ error: 'Incorrect code' });
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Reset password
app.post('/api/reset-password', async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.resetCode || !user.resetCodeExpiry) return res.status(400).json({ error: 'No reset code active' });
        if (new Date() > user.resetCodeExpiry) return res.status(400).json({ error: 'Code expired' });
        if (user.resetCode !== code) return res.status(401).json({ error: 'Incorrect code' });
        user.password = newPassword;
        user.resetCode = null;
        user.resetCodeExpiry = null;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Forgot username - look up by email
app.post('/api/forgot-username', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'No account with that email' });
        res.json({ success: true, username: user.username });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/transactions', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'transactions.html'));
});
app.get('/kids', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'kids.html'));
});
app.get('/transfer', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'transfer.html'));
});
app.get('/forgot-password', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

// Health check for Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        mongodbUri: MONGODB_URI ? 'configured' : 'NOT SET'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
