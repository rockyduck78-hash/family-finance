const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { generateSecret, generateSync, verifySync, generateURI } = require('otplib');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!process.env.JWT_SECRET) {
    console.warn('WARNING: JWT_SECRET not set. Generating a random secret. Set JWT_SECRET env var for persistent sessions.');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = '24h';

// Trusted device secret (derived from JWT_SECRET for 2FA remember-me)
const TRUSTED_DEVICE_SECRET = crypto.createHash('sha256').update(JWT_SECRET + ':trusted-device').digest('hex');
const TRUSTED_DEVICE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

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
    email: { type: String, required: true },
    password: { type: String, required: true },
    resetCode: { type: String, default: null },
    resetCodeExpiry: { type: Date, default: null },
    twoFactorSecret: { type: String, default: null },
    twoFactorEnabled: { type: Boolean, default: false },
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
    pendingRequests: { type: [{
        id: { type: Number },
        fromUsername: { type: String },
        toUsername: { type: String },
        amount: { type: Number },
        description: { type: String },
        date: { type: String }
    }], default: [] },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Trust first proxy (needed for secure cookies behind Render's reverse proxy)
app.set('trust proxy', 1);

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Rate limiters for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: 'Too many attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const forgotLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Input validation helpers
function isValidUsername(u) {
    return typeof u === 'string' && u.trim().length >= 3 && u.trim().length <= 30 && /^[a-zA-Z0-9_-]+$/.test(u.trim());
}
function isValidEmail(e) {
    return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}
function isValidPassword(p) {
    return typeof p === 'string' && p.length >= 6 && p.length <= 128;
}
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// Generate a trusted device token (30-day JWT)
function generateTrustedDeviceToken(username) {
    return jwt.sign({ username, trustedDevice: true }, TRUSTED_DEVICE_SECRET, { expiresIn: '30d' });
}

// Verify a trusted device token
function verifyTrustedDeviceToken(token) {
    try {
        const decoded = jwt.verify(token, TRUSTED_DEVICE_SECRET);
        if (decoded.trustedDevice) return decoded.username;
    } catch (e) {}
    return null;
}

// Log MongoDB connection state for API calls
app.use('/api', (req, res, next) => {
    if (!mongoReady && mongoose.connection.readyState !== 1) {
        console.error('API request while MongoDB not connected:', req.method, req.path);
    }
    next();
});

// JWT auth middleware - protects API routes (not login/register/forgot endpoints)
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.authUser = decoded.username;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Verify the logged-in user matches the route username
function ownerOnly(req, res, next) {
    if (req.authUser !== req.params.username) {
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
}

// Helper functions
async function getUser(username) {
    return await User.findOne({ username });
}

// Auth
app.post('/api/register', authLimiter, async (req, res) => {
    try {
        const { username, password, email } = req.body;

        if (!username || !password || !email) {
            return res.status(400).json({ error: 'Username, email, and password are required' });
        }
        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'Username must be 3-30 characters (letters, numbers, _, -)' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (!isValidPassword(password)) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existing = await User.findOne({ username });
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const emailExists = await User.findOne({ email });
        if (emailExists) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);

        await User.create({
            username,
            password: hashedPassword,
            email,
            transactions: [],
            kids: [],
            pendingApprovals: [],
            scheduledPayments: [],
            settings: {}
        });
        
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        res.json({ success: true, token });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Try bcrypt first, then plaintext fallback for existing users
        let passwordMatch = false;
        try {
            passwordMatch = await bcrypt.compare(password, user.password);
        } catch (e) {
            // Not a bcrypt hash, try plaintext
        }
        if (!passwordMatch && user.password === password) {
            // Plaintext match - transparently upgrade to bcrypt
            passwordMatch = true;
            user.password = await bcrypt.hash(password, 10);
            await user.save();
            console.log(`Migrated password to bcrypt for user: ${username}`);
        }
        
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Incorrect password' });
        }
        
        // Check for trusted device token in header - skip 2FA if valid
        const trustedDeviceToken = req.headers['x-trusted-device'];
        if (user.twoFactorEnabled && trustedDeviceToken) {
            const trustedUser = verifyTrustedDeviceToken(trustedDeviceToken);
            if (trustedUser === username) {
                const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
                return res.json({ success: true, token });
            }
        }
        
        if (user.twoFactorEnabled) {
            const tempToken = jwt.sign({ username, temp: true }, JWT_SECRET, { expiresIn: '5m' });
            return res.json({ success: true, requires2FA: true, token: tempToken });
        }
        
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        res.json({ success: true, token });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// User data
app.get('/api/user/:username', authMiddleware, ownerOnly, async (req, res) => {
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
            settings: user.settings || {},
            twoFactorEnabled: user.twoFactorEnabled || false
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Transactions
app.put('/api/user/:username/transactions', authMiddleware, ownerOnly, async (req, res) => {
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
app.put('/api/user/:username/kids', authMiddleware, ownerOnly, async (req, res) => {
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
app.post('/api/user/:username/kids/:kidId/request-money', authMiddleware, ownerOnly, async (req, res) => {
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
        
        if (!amount || isNaN(amount) || amount <= 0 || amount > 100000) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        if (!user.pendingApprovals) user.pendingApprovals = [];
        
        user.pendingApprovals.push({
            id: Date.now(),
            kidId: kid.id,
            kidName: kid.name,
            type: 'add',
            amount: parseFloat(amount),
            description: sanitize(description || 'Request'),
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
app.post('/api/user/:username/kids/:kidId/request-spend', authMiddleware, ownerOnly, async (req, res) => {
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
        
        if (!amount || isNaN(amount) || amount <= 0 || amount > 100000) {
            return res.status(400).json({ error: 'Invalid amount' });
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
            amount: parseFloat(amount),
            description: sanitize(description || 'Spend'),
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
app.post('/api/user/:username/approve/:approvalId', authMiddleware, ownerOnly, async (req, res) => {
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
app.post('/api/user/:username/deny/:approvalId', authMiddleware, ownerOnly, async (req, res) => {
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
app.post('/api/user/:username/kids/:kidId/transfer-to-kid', authMiddleware, ownerOnly, async (req, res) => {
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
        if (!amount || isNaN(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Invalid amount' });

        if (!user.pendingApprovals) user.pendingApprovals = [];

        user.pendingApprovals.push({
            id: Date.now(),
            type: 'kid-transfer',
            fromKidId: fromKid.id,
            fromKidName: fromKid.name,
            toKidId: toKid.id,
            toKidName: toKid.name,
            amount: parseFloat(amount),
            description: sanitize(description || `${fromKid.name} → ${toKid.name}`),
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
app.get('/api/user/:username/scheduled-payments', authMiddleware, ownerOnly, async (req, res) => {
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

app.post('/api/user/:username/scheduled-payments', authMiddleware, ownerOnly, async (req, res) => {
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
            description: sanitize(description || 'Allowance'),
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

app.put('/api/user/:username/scheduled-payments/:paymentId', authMiddleware, ownerOnly, async (req, res) => {
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

app.delete('/api/user/:username/scheduled-payments/:paymentId', authMiddleware, ownerOnly, async (req, res) => {
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
app.post('/api/transfer', authLimiter, authMiddleware, async (req, res) => {
    try {
        const { from, to, amount, note } = req.body;

        if (req.authUser !== from) {
            return res.status(403).json({ error: 'Cannot send on behalf of another user' });
        }
        
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
            description: `Sent to ${to}: ${sanitize(note) || 'Transfer'}`,
            amount, type: 'expense', category: 'transfer', date: now
        });
        
        recipient.transactions.push({
            id: Date.now() + 1,
            description: `Received from ${from}: ${sanitize(note) || 'Transfer'}`,
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

// List all usernames (for dropdowns)
app.get('/api/users', authMiddleware, async (req, res) => {
    try {
        const users = await User.find({}, { username: 1, _id: 0 });
        res.json(users.map(u => u.username));
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Request money from another user
app.post('/api/user/:username/request-money', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const { username } = req.params;
        const { toUsername, amount, description } = req.body;

        if (!toUsername) return res.status(400).json({ error: 'Recipient required' });
        if (toUsername === username) return res.status(400).json({ error: "Can't request from yourself" });
        if (!amount || isNaN(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Invalid amount' });

        const recipient = await User.findOne({ username: toUsername });
        if (!recipient) return res.status(404).json({ error: 'User not found' });

        if (!recipient.pendingRequests) recipient.pendingRequests = [];

        recipient.pendingRequests.push({
            id: Date.now(),
            fromUsername: username,
            toUsername: toUsername,
            amount: parseFloat(amount),
            description: sanitize(description || 'Money request'),
            date: new Date().toISOString()
        });

        await recipient.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get pending requests for a user
app.get('/api/user/:username/requests', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user.pendingRequests || []);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Approve a money request
app.post('/api/user/:username/approve-request/:requestId', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const { username, requestId } = req.params;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const idx = (user.pendingRequests || []).findIndex(r => r.id === parseInt(requestId));
        if (idx === -1) return res.status(404).json({ error: 'Request not found' });

        const request = user.pendingRequests[idx];
        const sender = await User.findOne({ username: request.fromUsername });
        if (!sender) return res.status(404).json({ error: 'Requester not found' });

        // Check sender has enough balance
        const income = (sender.transactions || []).filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const expenses = (sender.transactions || []).filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        if (request.amount > (income - expenses)) {
            return res.status(400).json({ error: 'Requester has insufficient balance' });
        }

        const now = new Date().toISOString();
        if (!sender.transactions) sender.transactions = [];
        if (!user.transactions) user.transactions = [];

        sender.transactions.push({
            id: Date.now(),
            description: `Sent to ${username}: ${request.description}`,
            amount: request.amount, type: 'expense', category: 'transfer', date: now
        });

        user.transactions.push({
            id: Date.now() + 1,
            description: `Received from ${request.fromUsername}: ${request.description}`,
            amount: request.amount, type: 'income', category: 'transfer', date: now
        });

        user.pendingRequests.splice(idx, 1);
        await sender.save();
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Deny a money request
app.post('/api/user/:username/deny-request/:requestId', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const { username, requestId } = req.params;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const idx = (user.pendingRequests || []).findIndex(r => r.id === parseInt(requestId));
        if (idx === -1) return res.status(404).json({ error: 'Request not found' });

        user.pendingRequests.splice(idx, 1);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Change password
app.post('/api/user/:username/change-password', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const { username } = req.params;
        const { currentPassword, newPassword } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
        if (!isValidPassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 6 characters' });

        let passwordMatch = false;
        try { passwordMatch = await bcrypt.compare(currentPassword, user.password); } catch (e) {}
        if (!passwordMatch && user.password === currentPassword) passwordMatch = true;
        if (!passwordMatch) return res.status(401).json({ error: 'Incorrect current password' });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Change username
app.post('/api/user/:username/change-username', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const { username } = req.params;
        const { newUsername, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!newUsername || !password) return res.status(400).json({ error: 'New username and password required' });
        if (!isValidUsername(newUsername)) return res.status(400).json({ error: 'Username must be 3-30 characters (letters, numbers, _, -)' });

        let passwordMatch = false;
        try { passwordMatch = await bcrypt.compare(password, user.password); } catch (e) {}
        if (!passwordMatch && user.password === password) passwordMatch = true;
        if (!passwordMatch) return res.status(401).json({ error: 'Incorrect password' });

        const exists = await User.findOne({ username: newUsername });
        if (exists) return res.status(400).json({ error: 'Username already taken' });
        user.username = newUsername;
        await user.save();

        const newToken = jwt.sign({ username: newUsername }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        res.json({ success: true, newUsername, token: newToken });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Settings (theme)
app.get('/api/user/:username/settings', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user.settings || {});
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/user/:username/settings', authMiddleware, ownerOnly, async (req, res) => {
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

// ===== Doublons Bank Integration =====
const DOUBLONS_API = 'https://doublons-bank.vercel.app';

// Proxy: Register on Doublons Bank
app.post('/api/doublons/register', authLimiter, authMiddleware, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        const r = await fetch(DOUBLONS_API + '/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json(data);
        res.json(data);
    } catch (err) {
        console.error('Doublons register error:', err.message);
        res.status(502).json({ error: 'Doublons Bank unavailable' });
    }
});

// Proxy: Login to Doublons Bank
app.post('/api/doublons/login', authLimiter, authMiddleware, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        const r = await fetch(DOUBLONS_API + '/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json(data);
        res.json(data);
    } catch (err) {
        console.error('Doublons login error:', err.message);
        res.status(502).json({ error: 'Doublons Bank unavailable' });
    }
});

// Proxy: Get Doublons Bank accounts
app.post('/api/doublons/accounts', authLimiter, authMiddleware, async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Token required' });
        const r = await fetch(DOUBLONS_API + '/accounts', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json(data);
        res.json(data);
    } catch (err) {
        console.error('Doublons accounts error:', err.message);
        res.status(502).json({ error: 'Doublons Bank unavailable' });
    }
});

// Proxy: Create Doublons Bank account
app.post('/api/doublons/accounts/create', authLimiter, authMiddleware, async (req, res) => {
    try {
        const { token, name } = req.body;
        if (!token || !name) return res.status(400).json({ error: 'Token and name required' });
        const r = await fetch(DOUBLONS_API + '/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ name, currency: 'USD' })
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json(data);
        res.json(data);
    } catch (err) {
        console.error('Doublons create account error:', err.message);
        res.status(502).json({ error: 'Doublons Bank unavailable' });
    }
});

// Proxy: Transfer on Doublons Bank
app.post('/api/doublons/transfer', authLimiter, authMiddleware, async (req, res) => {
    try {
        const { token, from_id, to_id, amount } = req.body;
        if (!token || !from_id || !to_id || !amount) return res.status(400).json({ error: 'All fields required' });
        const r = await fetch(DOUBLONS_API + '/transfers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ from_id, to_id, amount: amount.toString(), currency: 'USD' })
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json(data);
        res.json(data);
    } catch (err) {
        console.error('Doublons transfer error:', err.message);
        res.status(502).json({ error: 'Doublons Bank unavailable' });
    }
});

// Save Doublons Bank token to user profile
app.post('/api/user/:username/doublons-token', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.settings) user.settings = {};
        user.settings.doublonsToken = req.body.token || null;
        user.settings.doublonsEmail = req.body.email || null;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Forgot password - send reset code
app.post('/api/forgot-password', forgotLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });
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
                res.json({ success: true, emailed: false });
            }
        } else {
            res.json({ success: true, emailed: false });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify reset code
app.post('/api/verify-reset-code', forgotLimiter, async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
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
app.post('/api/reset-password', forgotLimiter, async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!newPassword) return res.status(400).json({ error: 'New password required' });
        if (!isValidPassword(newPassword)) return res.status(400).json({ error: 'Password must be at least 6 characters' });
        if (!user.resetCode || !user.resetCodeExpiry) return res.status(400).json({ error: 'No reset code active' });
        if (new Date() > user.resetCodeExpiry) return res.status(400).json({ error: 'Code expired' });
        if (user.resetCode !== code) return res.status(401).json({ error: 'Incorrect code' });
        user.password = await bcrypt.hash(newPassword, 10);
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
app.post('/api/forgot-username', forgotLimiter, async (req, res) => {
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

// 2FA Setup - Generate secret and QR code
app.post('/api/user/:username/2fa/setup', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.twoFactorEnabled) return res.status(400).json({ error: '2FA is already enabled' });

        const secret = generateSecret();
        const otpauth = generateURI({ secret, issuer: 'Family Finance', label: user.email });

        user.twoFactorSecret = secret;
        await user.save();

        const qrCodeUrl = await QRCode.toDataURL(otpauth);

        res.json({ success: true, secret, qrCode: qrCodeUrl });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// 2FA Verify - Verify code during setup
app.post('/api/user/:username/2fa/verify', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.twoFactorEnabled) return res.status(400).json({ error: '2FA is already enabled' });
        if (!user.twoFactorSecret) return res.status(400).json({ error: 'No 2FA setup in progress' });

        const { code } = req.body;
        const result = verifySync({ token: code, secret: user.twoFactorSecret });
        const isValid = result && result.valid;
        if (!isValid) return res.status(401).json({ error: 'Invalid verification code' });

        user.twoFactorEnabled = true;
        await user.save();

        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// 2FA Disable
app.post('/api/user/:username/2fa/disable', authMiddleware, ownerOnly, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.twoFactorEnabled) return res.status(400).json({ error: '2FA is not enabled' });

        const { password, code } = req.body;
        let passwordMatch = false;
        try { passwordMatch = await bcrypt.compare(password, user.password); } catch (e) {}
        if (!passwordMatch && user.password === password) passwordMatch = true;
        if (!passwordMatch) return res.status(401).json({ error: 'Incorrect password' });

        if (code) {
            const result = verifySync({ token: code, secret: user.twoFactorSecret });
            const isValid = result && result.valid;
            if (!isValid) return res.status(401).json({ error: 'Invalid 2FA code' });
        } else {
            return res.status(400).json({ error: '2FA code required to disable' });
        }

        user.twoFactorEnabled = false;
        user.twoFactorSecret = null;
        await user.save();

        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// 2FA Login - Verify code during login (requires temp token)
app.post('/api/user/:username/2fa/login', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        if (!decoded.temp || decoded.username !== req.params.username) {
            return res.status(403).json({ error: 'Invalid token for 2FA' });
        }

        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.twoFactorEnabled) return res.status(400).json({ error: '2FA is not enabled' });

        const { code } = req.body;
        const result = verifySync({ token: code, secret: user.twoFactorSecret });
        const isValid = result && result.valid;
        if (!isValid) return res.status(401).json({ error: 'Invalid 2FA code' });

        // Generate trusted device token so 2FA is not required on next login from this device
        const trustedToken = generateTrustedDeviceToken(user.username);

        const fullToken = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        res.json({ success: true, token: fullToken, trustedDevice: trustedToken });
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
