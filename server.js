const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const defaultAllowedOrigins = ['http://localhost:5173', 'https://frescoo.tech', 'https://www.frescoo.tech'];
const allowedOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const effectiveAllowedOrigins = allowedOrigins.length > 0 ? allowedOrigins : defaultAllowedOrigins;
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
    console.error('JWT_SECRET is missing or too short. Use at least 24 characters.');
    process.exit(1);
}

if (isProduction) {
    app.set('trust proxy', 1);
}

// Security & Middleware
app.disable('x-powered-by');
app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
    })
);
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || effectiveAllowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('CORS origin denied'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false,
    })
);
app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 500, // Increased for 150 concurrent users
        standardHeaders: true,
        legacyHeaders: false,
    })
);
app.use(express.json({ limit: '10kb' }));
// express-mongo-sanitize has known compatibility issues with Express 5 in some setups.
// Re-enable once upgraded to a version fully compatible with this stack.
// app.use(mongoSanitize());
app.use(hpp());
app.use(compression()); // Gzip payload to save Cloudflare bandwidth




if (isProduction) {
    app.use((req, res, next) => {
        const forwardedProto = req.headers['x-forwarded-proto'];
        if (forwardedProto && forwardedProto !== 'https') {
            return res.status(400).json({ error: 'HTTPS is required' });
        }
        return next();
    });
}

// Load Routes
const authRoutes = require('./src/routes/authRoutes');
const productRoutes = require('./src/routes/productRoutes');
const adminProductRoutes = require('./src/routes/adminProductRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const offersRoutes = require('./src/routes/offersRoutes');
const miscRoutes = require('./src/routes/miscRoutes');
const { auth } = require('./src/config/auth');
const { syncConfiguredSuperAdmins } = require('./src/controllers/authController');

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/admin/products', adminProductRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api', miscRoutes);

// Better Auth handler on dedicated prefix to avoid collision with custom auth routes.
app.all('/api/ba/*path', (req, res) => {
    return auth.handler(req, res);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Fresco Organics API' });
});

app.use((err, req, res, next) => {
    if (err && err.message === 'CORS origin denied') {
        return res.status(403).json({ error: 'CORS forbidden' });
    }

    console.error('Unhandled error:', err);
    return res.status(500).json({
        error: isProduction ? 'Internal server error' : err.message,
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fresco_organics', {
        maxPoolSize: 200, // Handle 150 concurrent users
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    })
    .then(async () => {
        console.log('✅ Successfully connected to MongoDB');

        try {
            const syncResult = await syncConfiguredSuperAdmins();
            if (syncResult.modified > 0) {
                console.log(
                    `✅ Super admin sync complete. Updated ${syncResult.modified} account(s) from SUPER_ADMIN_EMAILS.`
                );
            }
        } catch (syncError) {
            console.error('⚠️ Failed to sync super admin users:', syncError.message);
        }

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1);
    });

