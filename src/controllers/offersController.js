const Coupon = require('../models/Coupon');
const { evaluateOrderPricing, getOfferSettings } = require('../services/offers');

const randomCode = (length = 8) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i += 1) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const toCouponPayload = (coupon) => ({
    id: coupon._id,
    code: coupon.code,
    name: coupon.name || coupon.code,
    discountType: coupon.discountType,
    discountAmount: Number(coupon.discountAmount || 0),
    minPurchase: Number(coupon.minPurchase || 0),
    maxUses: Number(coupon.maxUses || 0),
    usedCount: Number(coupon.usedCount || 0),
    perUserLimit: Number(coupon.perUserLimit || 1),
    active: Boolean(coupon.active),
    isPublic: coupon.isPublic !== false,
    expiresAt: coupon.expiresAt || null,
    createdAt: coupon.createdAt,
});

exports.previewOffers = async (req, res) => {
    try {
        const subtotal = Number(req.body?.subtotal || 0);
        const deliveryCharge = Number(req.body?.deliveryCharge || 0);
        const couponCode = String(req.body?.couponCode || '').trim();

        if (subtotal <= 0) {
            return res.status(400).json({ error: 'Subtotal must be greater than 0' });
        }

        const pricing = await evaluateOrderPricing({
            userId: req.user.userId,
            subtotal,
            deliveryCharge,
            couponCode,
        });

        return res.status(200).json({
            subtotal: pricing.subtotal,
            deliveryCharge: pricing.deliveryCharge,
            deliveredOrderCount: pricing.deliveredOrderCount,
            offers: pricing.offers,
            coupon: pricing.coupon,
            applied: pricing.applied,
            discountAmount: pricing.discountAmount,
            payableAmount: pricing.payableAmount,
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error previewing offers' });
    }
};

exports.getPublicCoupons = async (req, res) => {
    try {
        const now = new Date();
        const coupons = await Coupon.find({
            isPublic: true,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        })
            .sort({ createdAt: -1 })
            .limit(50);

        return res.status(200).json(coupons.map(toCouponPayload));
    } catch (error) {
        return res.status(500).json({ error: 'Error loading coupons' });
    }
};

exports.getOfferSettingsForAdmin = async (req, res) => {
    try {
        const settings = await getOfferSettings();
        return res.status(200).json({
            welcome: settings.welcome,
            deliveredMilestone: settings.deliveredMilestone,
            updatedAt: settings.updatedAt,
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error loading offer settings' });
    }
};

exports.updateOfferSettingsForAdmin = async (req, res) => {
    try {
        const settings = await getOfferSettings();
        const { welcome, deliveredMilestone } = req.body || {};

        if (welcome && typeof welcome === 'object') {
            if (typeof welcome.enabled === 'boolean') settings.welcome.enabled = welcome.enabled;
            if (welcome.discountAmount !== undefined) settings.welcome.discountAmount = Math.max(0, Number(welcome.discountAmount));
            if (welcome.minPurchase !== undefined) settings.welcome.minPurchase = Math.max(0, Number(welcome.minPurchase));
        }

        if (deliveredMilestone && typeof deliveredMilestone === 'object') {
            if (typeof deliveredMilestone.enabled === 'boolean') {
                settings.deliveredMilestone.enabled = deliveredMilestone.enabled;
            }
            if (deliveredMilestone.everyNDeliveredOrders !== undefined) {
                settings.deliveredMilestone.everyNDeliveredOrders = Math.max(1, Number(deliveredMilestone.everyNDeliveredOrders));
            }
            if (deliveredMilestone.discountAmount !== undefined) {
                settings.deliveredMilestone.discountAmount = Math.max(0, Number(deliveredMilestone.discountAmount));
            }
            if (deliveredMilestone.minPurchase !== undefined) {
                settings.deliveredMilestone.minPurchase = Math.max(0, Number(deliveredMilestone.minPurchase));
            }
        }

        await settings.save();

        return res.status(200).json({
            message: 'Offer settings updated',
            welcome: settings.welcome,
            deliveredMilestone: settings.deliveredMilestone,
            updatedAt: settings.updatedAt,
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error updating offer settings' });
    }
};

exports.generateCouponForAdmin = async (req, res) => {
    try {
        const {
            name,
            code,
            discountAmount,
            minPurchase,
            maxUses,
            perUserLimit,
            expiresAt,
        } = req.body || {};

        const safeDiscount = Math.max(1, Number(discountAmount || 0));
        const safeMinPurchase = Math.max(0, Number(minPurchase || 0));

        if (safeDiscount <= 0) {
            return res.status(400).json({ error: 'discountAmount must be greater than 0' });
        }

        let couponCode = String(code || '').trim().toUpperCase();
        if (!couponCode) {
            for (let i = 0; i < 5; i += 1) {
                const candidate = `FRESCO${randomCode(6)}`;
                const exists = await Coupon.findOne({ code: candidate }).select('_id').lean();
                if (!exists) {
                    couponCode = candidate;
                    break;
                }
            }
            if (!couponCode) {
                couponCode = `FRESCO${Date.now().toString(36).toUpperCase()}`;
            }
        }

        const exists = await Coupon.findOne({ code: couponCode }).select('_id').lean();
        if (exists) {
            return res.status(409).json({ error: 'Coupon code already exists' });
        }

        const coupon = await Coupon.create({
            code: couponCode,
            name: String(name || couponCode).trim(),
            discountType: 'flat',
            discountAmount: safeDiscount,
            minPurchase: safeMinPurchase,
            maxUses: Math.max(0, Number(maxUses || 0)),
            perUserLimit: Math.max(1, Number(perUserLimit || 1)),
            active: true,
            isPublic: req.body.isPublic !== undefined ? Boolean(req.body.isPublic) : true,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdBy: req.user.userId,
        });

        return res.status(201).json({
            message: 'Coupon created',
            coupon: toCouponPayload(coupon),
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error generating coupon' });
    }
};

exports.getCouponsForAdmin = async (req, res) => {
    try {
        const coupons = await Coupon.find().sort({ createdAt: -1 }).limit(300);
        return res.status(200).json(coupons.map(toCouponPayload));
    } catch (error) {
        return res.status(500).json({ error: 'Error loading coupons' });
    }
};

exports.updateCouponForAdmin = async (req, res) => {
    try {
        const coupon = await Coupon.findById(req.params.id);
        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        const { active, maxUses, perUserLimit, expiresAt, minPurchase, discountAmount, isPublic } = req.body || {};
        if (typeof active === 'boolean') coupon.active = active;
        if (typeof isPublic === 'boolean') coupon.isPublic = isPublic;
        if (maxUses !== undefined) coupon.maxUses = Math.max(0, Number(maxUses));
        if (perUserLimit !== undefined) coupon.perUserLimit = Math.max(1, Number(perUserLimit));
        if (minPurchase !== undefined) coupon.minPurchase = Math.max(0, Number(minPurchase));
        if (discountAmount !== undefined) coupon.discountAmount = Math.max(1, Number(discountAmount));
        if (expiresAt !== undefined) {
            coupon.expiresAt = expiresAt ? new Date(expiresAt) : null;
        }

        await coupon.save();
        return res.status(200).json({ message: 'Coupon updated', coupon: toCouponPayload(coupon) });
    } catch (error) {
        return res.status(500).json({ error: 'Error updating coupon' });
    }
};

exports.deleteCouponForAdmin = async (req, res) => {
    try {
        const coupon = await Coupon.findByIdAndDelete(req.params.id);
        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found.' });
        }
        res.json({ message: 'Coupon deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete coupon' });
    }
};
