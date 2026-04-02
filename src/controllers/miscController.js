const User = require('../models/User');
const Feedback = require('../models/Feedback');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { isAdminRole } = require('../middleware/auth');

const normalizeEmail = (email) =>
    String(email || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .toLowerCase();

const normalizeMobileNumber = (value) => String(value || '').trim().replace(/\D/g, '');

const customerOnlyFilter = {
    $and: [
        {
            $or: [{ role: 'user' }, { role: { $exists: false } }, { role: null }],
        },
        { isAdmin: { $ne: true } },
        { isSuperAdmin: { $ne: true } },
    ],
};

exports.getUserProfile = async (req, res) => {
    try {
        const requestedUsername = String(req.params.username || '').trim();
        const isMe = requestedUsername.toLowerCase() === 'me';

        let targetUser = null;

        if (isMe) {
            targetUser = await User.findById(req.user.userId).select(
                'name email role fullName mobileNumber address city state pincode gender country'
            );
        } else {
            targetUser = await User.findOne({ name: requestedUsername }).select(
                'name email role fullName mobileNumber address city state pincode gender country'
            );

            // For regular users, fall back to their own profile when username lookup misses.
            if (!targetUser && !isAdminRole(req.user.role)) {
                targetUser = await User.findById(req.user.userId).select(
                    'name email role fullName mobileNumber address city state pincode gender country'
                );
            }
        }

        if (!targetUser) {
            return res.status(404).json({ error: 'User profile not found' });
        }

        const isOwner = String(targetUser._id) === String(req.user.userId);
        const isAdmin = isAdminRole(req.user.role);
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        return res.status(200).json(targetUser);
    } catch (error) {
        return res.status(500).json({ error: 'Error loading user profile' });
    }
};

exports.upsertUserProfile = async (req, res) => {
    try {
        const { fullName, email, mobileNumber, address, city, state, pincode, gender, country } = req.body;
        const isSuperAdmin = req.user.role === 'super-admin';

        const currentUser = await User.findById(req.user.userId).select('email mobileNumber');
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const normalizedEmail = normalizeEmail(email);
        const normalizedMobileNumber = normalizeMobileNumber(mobileNumber);

        if (isSuperAdmin && normalizedEmail && normalizedEmail !== currentUser.email) {
            const existingEmailUser = await User.findOne({
                email: normalizedEmail,
                _id: { $ne: req.user.userId },
            }).select('_id');
            if (existingEmailUser) {
                return res.status(409).json({ error: 'Email is already linked to another account' });
            }
        }

        if (normalizedMobileNumber && normalizedMobileNumber !== (currentUser.mobileNumber || '')) {
            const existingMobileUser = await User.findOne({
                mobileNumber: normalizedMobileNumber,
                _id: { $ne: req.user.userId },
            }).select('_id');
            if (existingMobileUser) {
                return res.status(409).json({ error: 'Mobile number is already linked to another account' });
            }
        }

        const updatePayload = {
            fullName: (fullName || '').trim(),
            mobileNumber: normalizedMobileNumber,
            address: (address || '').trim(),
            city: (city || '').trim(),
            state: (state || '').trim(),
            pincode: (pincode || '').trim(),
            gender: (gender || '').trim(),
            country: (country || '').trim(),
        };

        if (isSuperAdmin && normalizedEmail) {
            updatePayload.email = normalizedEmail;
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user.userId,
            updatePayload,
            {
                new: true,
                runValidators: true,
                fields: 'name email role fullName mobileNumber address city state pincode gender country',
            }
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.status(200).json(updatedUser);
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
        return res.status(500).json({ error: 'Error saving user profile' });
    }
};

exports.submitFeedback = async (req, res) => {
    try {
        const { name, email, subject, description, message } = req.body;
        const safeMessage = (message || description || '').trim();

        if (!name || !email || !subject || !safeMessage) {
            return res.status(400).json({ error: 'name, email, subject and message are required' });
        }

        const feedback = await Feedback.create({
            user: req.user.userId,
            name: String(name).trim(),
            email: String(email).trim(),
            subject: String(subject).trim(),
            message: safeMessage,
        });

        return res.status(201).json({ id: feedback._id, createdAt: feedback.createdAt });
    } catch (error) {
        return res.status(500).json({ error: 'Error saving feedback' });
    }
};

exports.getAdminFeedback = async (req, res) => {
    try {
        const unreadOnly = String(req.query.unreadOnly || 'false').toLowerCase() === 'true';
        const query = unreadOnly ? { isRead: false } : {};

        const feedbacks = await Feedback.find(query)
            .sort({ createdAt: -1 })
            .limit(500)
            .select('name email subject message createdAt isRead readAt')
            .lean();

        return res.status(200).json(
            feedbacks.map((item) => ({
                id: item._id,
                name: item.name,
                email: item.email,
                subject: item.subject,
                message: item.message,
                createdAt: item.createdAt,
                isRead: Boolean(item.isRead),
                readAt: item.readAt || null,
            }))
        );
    } catch (error) {
        return res.status(500).json({ error: 'Error loading feedback' });
    }
};

exports.markFeedbackAsRead = async (req, res) => {
    try {
        const feedback = await Feedback.findByIdAndUpdate(
            req.params.id,
            { isRead: true, readAt: new Date() },
            { new: true }
        )
            .select('name email subject message createdAt isRead readAt')
            .lean();

        if (!feedback) {
            return res.status(404).json({ error: 'Feedback not found' });
        }

        return res.status(200).json({
            id: feedback._id,
            name: feedback.name,
            email: feedback.email,
            subject: feedback.subject,
            message: feedback.message,
            createdAt: feedback.createdAt,
            isRead: Boolean(feedback.isRead),
            readAt: feedback.readAt || null,
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error updating feedback status' });
    }
};

exports.getAdminDashboardStats = async (req, res) => {
    try {
        const [productsCount, ordersCount, customersCount, adminsCount, unreadFeedbackCount, latestUnreadFeedback] =
            await Promise.all([
                Product.countDocuments({}),
                Order.countDocuments({}),
                User.countDocuments(customerOnlyFilter),
                User.countDocuments({ role: 'admin' }),
                Feedback.countDocuments({ isRead: false }),
                Feedback.find({ isRead: false })
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .select('name email subject message createdAt isRead readAt')
                    .lean(),
            ]);

        return res.status(200).json({
            productsCount,
            ordersCount,
            customersCount,
            adminsCount,
            feedbackCount: unreadFeedbackCount,
            latestUnreadFeedback: latestUnreadFeedback.map((item) => ({
                id: item._id,
                name: item.name,
                email: item.email,
                subject: item.subject,
                message: item.message,
                createdAt: item.createdAt,
                isRead: Boolean(item.isRead),
                readAt: item.readAt || null,
            })),
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error loading dashboard stats' });
    }
};

exports.getAdminCustomers = async (req, res) => {
    try {
        const customers = await User.find(customerOnlyFilter, 'name email createdAt role isAdmin isSuperAdmin')
            .sort({ createdAt: -1 })
            .limit(1000)
            .lean();
        return res.status(200).json(
            customers.map((item) => ({
                id: item._id,
                username: item.name,
                email: item.email,
                createdAt: item.createdAt,
            }))
        );
    } catch (error) {
        return res.status(500).json({ error: 'Error loading customers' });
    }
};

exports.createAdminUser = async (req, res) => {
    try {
        const { name, email } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail) {
            return res.status(400).json({ error: 'Admin email is required' });
        }

        let user = await User.findOne({ email: normalizedEmail });

        if (user) {
            if (user.role === 'super-admin') {
                return res.status(409).json({ error: 'This user is already a super admin' });
            }

            user.role = 'admin';
            if (name && String(name).trim()) {
                user.name = String(name).trim();
            }
            await user.save();

            return res.status(200).json({
                message: 'Admin role assigned successfully',
                admin: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    lastLoginAt: user.lastLoginAt || null,
                    lastLoginIp: user.lastLoginIp || null,
                    createdAt: user.createdAt,
                },
            });
        }

        const safeName = String(name || normalizedEmail.split('@')[0] || 'admin').trim();
        user = await User.create({
            name: safeName,
            email: normalizedEmail,
            role: 'admin',
        });

        return res.status(201).json({
            message: 'Admin created successfully',
            admin: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                lastLoginAt: user.lastLoginAt || null,
                lastLoginIp: user.lastLoginIp || null,
                createdAt: user.createdAt,
            },
        });
    } catch (error) {
        if (error?.code === 11000) {
            const duplicateField = Object.keys(error.keyPattern || {})[0];
            if (duplicateField === 'email') {
                return res.status(409).json({ error: 'Email is already linked to another account' });
            }
        }
        return res.status(500).json({ error: 'Error creating admin user' });
    }
};

exports.getAdminUsersActivity = async (req, res) => {
    try {
        const admins = await User.find(
            { role: { $in: ['admin', 'super-admin'] } },
            'name email role fullName mobileNumber address city state pincode gender country lastLoginAt createdAt updatedAt'
        )
            .sort({ lastLoginAt: -1, createdAt: -1 })
            .limit(500)
            .lean();

        return res.status(200).json(
            admins.map((item) => ({
                id: item._id,
                name: item.name,
                email: item.email,
                role: item.role,
                fullName: item.fullName || '',
                mobileNumber: item.mobileNumber || '',
                address: item.address || '',
                city: item.city || '',
                state: item.state || '',
                pincode: item.pincode || '',
                gender: item.gender || '',
                country: item.country || '',
                lastLoginAt: item.lastLoginAt || null,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
            }))
        );
    } catch (error) {
        return res.status(500).json({ error: 'Error loading admin activity' });
    }
};

exports.deleteCustomerById = async (req, res) => {
    try {
        const customer = await User.findOneAndDelete({ _id: req.params.id, role: 'user' });
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        return res.status(200).json({ message: 'Customer deleted successfully' });
    } catch (error) {
        return res.status(500).json({ error: 'Error deleting customer' });
    }
};

exports.deleteFeedbackById = async (req, res) => {
    try {
        const feedback = await Feedback.findByIdAndDelete(req.params.id);
        if (!feedback) {
            return res.status(404).json({ error: 'Feedback not found' });
        }
        return res.status(200).json({ message: 'Feedback deleted successfully' });
    } catch (error) {
        return res.status(500).json({ error: 'Error deleting feedback' });
    }
};

exports.deleteAdminById = async (req, res) => {
    try {
        const target = await User.findById(req.params.id);
        if (!target) {
            return res.status(404).json({ error: 'Admin user not found' });
        }

        if (target.role !== 'admin') {
            return res.status(400).json({ error: 'Only admin users can be deleted' });
        }

        if (String(target._id) === String(req.user.userId)) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        await User.findByIdAndDelete(target._id);
        return res.status(200).json({ message: 'Admin deleted successfully' });
    } catch (error) {
        return res.status(500).json({ error: 'Error deleting admin user' });
    }
};
