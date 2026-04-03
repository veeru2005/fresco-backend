const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const TOKEN_EXPIRES_IN = '12h';
const SERVICE_PINCODES_BY_CITY = Object.freeze({
    mangalagiri: ['522503'],
    vadeswaram: ['522502', '522302'],
    'kl university': ['522502', '522302'],
});

const normalizeEmail = (email) =>
    String(email || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .toLowerCase();

const superAdminEmails = String(process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => normalizeEmail(email))
    .filter(Boolean);

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
}

const resolveRoleForEmail = (email, existingRole) => {
    const normalizedEmail = normalizeEmail(email);
    if (superAdminEmails.includes(normalizedEmail)) {
        return 'super-admin';
    }
    if (existingRole === 'admin' || existingRole === 'super-admin') {
        return existingRole;
    }
    return 'user';
};

const extractClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || null;
};

const markLoginActivity = (user, req) => {
    user.lastLoginAt = new Date();
    user.lastLoginIp = extractClientIp(req);
    user.lastLoginUserAgent = req.headers['user-agent'] || '';
};

const sanitizeText = (value) => String(value || '').trim();
const normalizeServiceLocation = (value) => sanitizeText(value).toLowerCase();

const normalizeMobileNumber = (value) => sanitizeText(value).replace(/\D/g, '');

const getAllowedPincodesForCity = (city) => {
    const normalizedCity = normalizeServiceLocation(city);
    return SERVICE_PINCODES_BY_CITY[normalizedCity] || [];
};

const isAllowedServiceLocation = (city) => getAllowedPincodesForCity(city).length > 0;

const isAllowedPincodeForCity = (city, pincode) =>
    getAllowedPincodesForCity(city).includes(sanitizeText(pincode));

const getLocationValidationError = (profile = {}) => {
    const hasLocationData = Boolean(profile.city || profile.pincode);
    if (!hasLocationData) return null;

    if (!isAllowedServiceLocation(profile.city)) {
        return 'City must be one of Mangalagiri, Vadeswaram, or KL University.';
    }

    if (!/^\d{6}$/.test(sanitizeText(profile.pincode))) {
        return 'Please provide a valid 6-digit pincode.';
    }

    if (!isAllowedPincodeForCity(profile.city, profile.pincode)) {
        const allowedPincodes = getAllowedPincodesForCity(profile.city);
        return `Pincode must be ${allowedPincodes.join(', ')} for ${profile.city}.`;
    }

    return null;
};

const normalizeProfileFields = (input = {}) => ({
    fullName: sanitizeText(input.fullName || input.name),
    mobileNumber: normalizeMobileNumber(input.mobileNumber),
    address: sanitizeText(input.address),
    city: sanitizeText(input.city),
    state: sanitizeText(input.state),
    pincode: sanitizeText(input.pincode),
    gender: sanitizeText(input.gender),
    country: sanitizeText(input.country),
});

const hasCompleteSignupProfile = (profile) =>
    Boolean(
        profile.fullName &&
            profile.mobileNumber &&
            profile.address &&
            profile.city &&
            profile.state &&
            profile.pincode &&
            profile.gender &&
            profile.country
    );

const buildAuthResponse = (user, token) => ({
    token,
    username: user.name,
    email: user.email,
    role: user.role,
    user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        fullName: user.fullName || '',
        mobileNumber: user.mobileNumber || '',
        address: user.address || '',
        city: user.city || '',
        state: user.state || '',
        pincode: user.pincode || '',
        gender: user.gender || '',
        country: user.country || '',
    },
});

exports.syncConfiguredSuperAdmins = async () => {
    if (superAdminEmails.length === 0) {
        return { matched: 0, modified: 0 };
    }

    const result = await User.updateMany(
        { email: { $in: superAdminEmails }, role: { $ne: 'super-admin' } },
        { $set: { role: 'super-admin' } }
    );

    return {
        matched: result.matchedCount || 0,
        modified: result.modifiedCount || 0,
    };
};

exports.register = async (req, res) => {
    try {
        const { username, name, email, password } = req.body;
        const profileFields = normalizeProfileFields(req.body || {});
        const normalizedEmail = normalizeEmail(email);
        const safeName = (username || name || '').trim();

        if (!safeName || !normalizedEmail || !password) {
            return res.status(400).json({ error: 'username, email and password are required' });
        }

        const locationValidationError = getLocationValidationError(profileFields);
        if (locationValidationError) {
            return res.status(400).json({ error: locationValidationError });
        }
        
        let existingUser = await User.findOne({ email: normalizedEmail });
        
        if (existingUser) {
            // Allow setting password if the user was created by super admin without a password
            if (!existingUser.password) {
                if (profileFields.mobileNumber) {
                    const existingMobileUser = await User.findOne({ mobileNumber: profileFields.mobileNumber, _id: { $ne: existingUser._id } });
                    if (existingMobileUser) {
                        return res.status(409).json({ error: 'Mobile number is already linked to another account' });
                    }
                }
                
                existingUser.password = await bcrypt.hash(password, 10);
                existingUser.name = safeName;
                existingUser.fullName = profileFields.fullName || safeName;
                if (profileFields.mobileNumber) existingUser.mobileNumber = profileFields.mobileNumber;
                if (profileFields.address) existingUser.address = profileFields.address;
                if (profileFields.city) existingUser.city = profileFields.city;
                if (profileFields.state) existingUser.state = profileFields.state;
                if (profileFields.pincode) existingUser.pincode = profileFields.pincode;
                if (profileFields.gender) existingUser.gender = profileFields.gender;
                if (profileFields.country) existingUser.country = profileFields.country;
                existingUser.lastLoginAt = new Date();
                existingUser.lastLoginIp = extractClientIp(req);
                existingUser.lastLoginUserAgent = req.headers['user-agent'] || '';
                
                await existingUser.save();
                const token = jwt.sign({ userId: existingUser._id, role: existingUser.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
                return res.status(200).json(buildAuthResponse(existingUser, token));
            }
            return res.status(400).json({ error: 'User already exists' });
        }

        if (profileFields.mobileNumber) {
            const existingMobileUser = await User.findOne({ mobileNumber: profileFields.mobileNumber });
            if (existingMobileUser) {
                return res.status(409).json({ error: 'Mobile number is already linked to another account' });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            name: safeName,
            email: normalizedEmail,
            password: hashedPassword,
            role: resolveRoleForEmail(normalizedEmail, 'user'),
            fullName: profileFields.fullName || safeName,
            mobileNumber: profileFields.mobileNumber,
            address: profileFields.address,
            city: profileFields.city,
            state: profileFields.state,
            pincode: profileFields.pincode,
            gender: profileFields.gender,
            country: profileFields.country,
            lastLoginAt: new Date(),
            lastLoginIp: extractClientIp(req),
            lastLoginUserAgent: req.headers['user-agent'] || '',
        });
        await user.save();

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
        res.status(201).json(buildAuthResponse(user, token));
    } catch (error) {
        if (error?.code === 11000) {
            const duplicateField = Object.keys(error.keyPattern || {})[0];
            if (duplicateField === 'email') {
                return res.status(409).json({ error: 'Email is already linked to another account' });
            }
            if (duplicateField === 'mobileNumber') {
                return res.status(409).json({ error: 'Mobile number is already linked to another account' });
            }
        }
        res.status(500).json({ error: 'Error registering user' });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, username, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        const user = await User.findOne(normalizedEmail ? { email: normalizedEmail } : { name: username });
        if (!user) {
            return res.status(404).json({ error: 'User not found. Please sign up first.' });
        }

        if (!user.password) {
            return res.status(400).json({ error: 'This account uses Google sign-in. Please continue with Google.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const resolvedRole = resolveRoleForEmail(user.email, user.role);
        if (resolvedRole !== user.role) {
            user.role = resolvedRole;
        }
        markLoginActivity(user, req);
        await user.save();

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
        res.status(200).json(buildAuthResponse(user, token));
    } catch (error) {
        res.status(500).json({ error: 'Error logging in' });
    }
};

exports.googleAuth = async (req, res) => {
    try {
        if (!googleClient || !GOOGLE_CLIENT_ID) {
            return res.status(500).json({ error: 'Google auth is not configured on server' });
        }

        const { idToken, mode } = req.body;
        const profileFields = normalizeProfileFields(req.body || {});
        if (!idToken) {
            return res.status(400).json({ error: 'Google idToken is required' });
        }

        const authMode = String(mode || 'signin').toLowerCase();
        if (authMode !== 'signin' && authMode !== 'signup') {
            return res.status(400).json({ error: 'Invalid auth mode. Use signin or signup.' });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email || !payload.sub) {
            return res.status(401).json({ error: 'Invalid Google token' });
        }

        const email = normalizeEmail(payload.email);
        const baseName = (payload.name || email.split('@')[0] || 'user').trim();
        const googleId = payload.sub;

        let user = await User.findOne({ email });

        if (authMode === 'signup' && user) {
            if (!user.password && !user.googleId) {
                // Allow signup to proceed for accounts pre-created by super admin
            } else {
                return res.status(409).json({ error: 'Account already exists. Try signing in.' });
            }
        }

        if (authMode === 'signin' && !user) {
            return res.status(404).json({ error: 'User not found. Please sign up first.' });
        }

        if (authMode === 'signup' && !hasCompleteSignupProfile(profileFields)) {
            return res.status(400).json({
                error: 'Please provide fullName, mobileNumber, address, city, state, pincode, gender, and country to complete signup.',
            });
        }

        const locationValidationError = getLocationValidationError(profileFields);
        if (locationValidationError) {
            return res.status(400).json({ error: locationValidationError });
        }

        if (!user) {
            if (profileFields.mobileNumber) {
                const existingMobileUser = await User.findOne({ mobileNumber: profileFields.mobileNumber });
                if (existingMobileUser) {
                    return res.status(409).json({ error: 'Mobile number is already linked to another account' });
                }
            }

            user = await User.create({
                name: baseName,
                email,
                googleId,
                role: resolveRoleForEmail(email, 'user'),
                fullName: profileFields.fullName || baseName,
                mobileNumber: profileFields.mobileNumber,
                address: profileFields.address,
                city: profileFields.city,
                state: profileFields.state,
                pincode: profileFields.pincode,
                gender: profileFields.gender,
                country: profileFields.country,
                lastLoginAt: new Date(),
                lastLoginIp: extractClientIp(req),
                lastLoginUserAgent: req.headers['user-agent'] || '',
            });
        } else {
            const resolvedRole = resolveRoleForEmail(email, user.role);
            if (!user.googleId) {
                user.googleId = googleId;
            }
            if (resolvedRole !== user.role) {
                user.role = resolvedRole;
            }

            if (profileFields.fullName && !user.fullName) user.fullName = profileFields.fullName;
            if (profileFields.mobileNumber && !user.mobileNumber) {
                const existingMobileUser = await User.findOne({
                    mobileNumber: profileFields.mobileNumber,
                    _id: { $ne: user._id },
                });
                if (existingMobileUser) {
                    return res.status(409).json({ error: 'Mobile number is already linked to another account' });
                }
                user.mobileNumber = profileFields.mobileNumber;
            }
            if (profileFields.address && !user.address) user.address = profileFields.address;
            if (profileFields.city && !user.city) user.city = profileFields.city;
            if (profileFields.state && !user.state) user.state = profileFields.state;
            if (profileFields.pincode && !user.pincode) user.pincode = profileFields.pincode;
            if (profileFields.gender && !user.gender) user.gender = profileFields.gender;
            if (profileFields.country && !user.country) user.country = profileFields.country;

            markLoginActivity(user, req);
            await user.save();
        }

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
        return res.status(200).json(buildAuthResponse(user, token));
    } catch (error) {
        if (error?.code === 11000) {
            const duplicateField = Object.keys(error.keyPattern || {})[0];
            if (duplicateField === 'email') {
                return res.status(409).json({ error: 'Email is already linked to another account' });
            }
            if (duplicateField === 'mobileNumber') {
                return res.status(409).json({ error: 'Mobile number is already linked to another account' });
            }
        }
        const fallbackMessage = 'Google sign-in failed';
        const errorMessage =
            process.env.NODE_ENV === 'production'
                ? fallbackMessage
                : error?.message || fallbackMessage;
        return res.status(401).json({ error: errorMessage });
    }
};