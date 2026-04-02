const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
}

exports.authMiddleware = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (ex) {
        res.status(400).json({ error: 'Invalid token.' });
    }
};

const isAdminRole = (role) => role === 'admin' || role === 'super-admin';

exports.adminMiddleware = (req, res, next) => {
    if (!req.user || !isAdminRole(req.user.role)) {
        return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    next();
};

exports.superAdminMiddleware = (req, res, next) => {
    if (!req.user || req.user.role !== 'super-admin') {
        return res.status(403).json({ error: 'Access denied. Super admin privileges required.' });
    }
    next();
};

exports.isAdminRole = isAdminRole;