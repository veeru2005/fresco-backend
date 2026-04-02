const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const OfferSettings = require('../models/OfferSettings');

const GLOBAL_KEY = 'global';

const clampDiscount = (discount, subtotal) => {
    const safeDiscount = Number(discount || 0);
    const safeSubtotal = Number(subtotal || 0);
    return Math.max(0, Math.min(safeDiscount, safeSubtotal));
};

const getOfferSettings = async () => {
    let settings = await OfferSettings.findOne({ key: GLOBAL_KEY });
    if (!settings) {
        settings = await OfferSettings.create({ key: GLOBAL_KEY });
    }
    return settings;
};

const getDeliveredOrderCount = async (userId) => {
    return Order.countDocuments({ user: userId, status: 'delivered' });
};

const getNonCancelledOrderCount = async (userId) => {
    return Order.countDocuments({ user: userId, status: { $ne: 'cancelled' } });
};

const getCouponUsageCountByUser = async (userId, couponCode) => {
    return Order.countDocuments({
        user: userId,
        appliedCouponCode: String(couponCode || '').toUpperCase(),
        status: { $ne: 'cancelled' },
    });
};

const evaluateCoupon = async ({ couponCode, userId, subtotal }) => {
    const normalizedCode = String(couponCode || '').trim().toUpperCase();
    if (!normalizedCode) {
        return { coupon: null, result: null };
    }

    if (normalizedCode === 'WELCOME30') {
        const settings = await getOfferSettings();
        const nonCancelledOrderCount = await getNonCancelledOrderCount(userId);

        if (!settings.welcome?.enabled) {
            return {
                coupon: null,
                result: {
                    code: normalizedCode,
                    status: 'invalid',
                    reason: 'Welcome offer is currently disabled',
                    discountAmount: 0,
                },
            };
        }

        if (nonCancelledOrderCount > 0) {
            return {
                coupon: null,
                result: {
                    code: normalizedCode,
                    status: 'invalid',
                    reason: 'Welcome coupon is only for first order',
                    discountAmount: 0,
                },
            };
        }

        const minPurchase = Number(settings.welcome.minPurchase || 0);
        if (Number(subtotal || 0) < minPurchase) {
            return {
                coupon: null,
                result: {
                    code: normalizedCode,
                    status: 'invalid',
                    reason: `Minimum purchase is Rs ${minPurchase}`,
                    discountAmount: 0,
                },
            };
        }

        return {
            coupon: null,
            result: {
                code: normalizedCode,
                name: 'Welcome Coupon',
                status: 'valid',
                reason: 'Coupon applied',
                discountAmount: clampDiscount(settings.welcome.discountAmount, subtotal),
                minPurchase,
            },
        };
    }

    const coupon = await Coupon.findOne({ code: normalizedCode });
    if (!coupon) {
        return {
            coupon: null,
            result: {
                code: normalizedCode,
                status: 'invalid',
                reason: 'Coupon does not exist',
                discountAmount: 0,
            },
        };
    }

    // For public coupons, visibility controls whether users can see/apply in cart.
    // Keep active check only for hidden/exclusive coupons.
    if (!coupon.active && coupon.isPublic !== true) {
        return {
            coupon,
            result: {
                code: normalizedCode,
                status: 'invalid',
                reason: 'Coupon is inactive',
                discountAmount: 0,
            },
        };
    }

    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
        return {
            coupon,
            result: {
                code: normalizedCode,
                status: 'invalid',
                reason: 'Coupon has expired',
                discountAmount: 0,
            },
        };
    }

    if (Number(subtotal || 0) < Number(coupon.minPurchase || 0)) {
        return {
            coupon,
            result: {
                code: normalizedCode,
                status: 'invalid',
                reason: `Minimum purchase is Rs ${coupon.minPurchase}`,
                discountAmount: 0,
            },
        };
    }

    if (Number(coupon.maxUses || 0) > 0 && Number(coupon.usedCount || 0) >= Number(coupon.maxUses || 0)) {
        return {
            coupon,
            result: {
                code: normalizedCode,
                status: 'invalid',
                reason: 'Coupon usage limit reached',
                discountAmount: 0,
            },
        };
    }

    const userUsageCount = await getCouponUsageCountByUser(userId, normalizedCode);
    if (Number(userUsageCount || 0) >= Number(coupon.perUserLimit || 1)) {
        return {
            coupon,
            result: {
                code: normalizedCode,
                status: 'invalid',
                reason: 'You already used this coupon',
                discountAmount: 0,
            },
        };
    }

    const discountAmount = clampDiscount(coupon.discountAmount, subtotal);
    return {
        coupon,
        result: {
            code: normalizedCode,
            name: coupon.name || normalizedCode,
            status: 'valid',
            reason: 'Coupon applied',
            discountAmount,
            minPurchase: Number(coupon.minPurchase || 0),
        },
    };
};

const evaluateOrderPricing = async ({ userId, subtotal, deliveryCharge, couponCode }) => {
    const settings = await getOfferSettings();
    const safeSubtotal = Math.max(0, Number(subtotal || 0));
    const safeDelivery = Math.max(0, Number(deliveryCharge || 0));

    const [deliveredCount, nonCancelledOrderCount, couponEval, activeDbCoupons] = await Promise.all([
        getDeliveredOrderCount(userId),
        getNonCancelledOrderCount(userId),
        evaluateCoupon({ couponCode, userId, subtotal: safeSubtotal }),
        Coupon.find({ isPublic: true, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] })
    ]);

    const offers = [];

    // Add active database coupons to the offers array
    for (const coupon of activeDbCoupons) {
        if (coupon.code === 'WELCOME30') continue; // Avoid duplicate welcome if somehow added

        const minPurchase = Number(coupon.minPurchase || 0);
        const subtotalMeetsMin = safeSubtotal >= minPurchase;
        
        let eligible = subtotalMeetsMin;
        let reason = eligible ? 'Eligible now on this order' : `Add Rs ${Math.max(0, minPurchase - safeSubtotal)} more`;
        
        if (Number(coupon.maxUses || 0) > 0 && Number(coupon.usedCount || 0) >= Number(coupon.maxUses || 0)) {
            eligible = false;
            reason = 'Usage limit reached';
        }
        
        offers.push({
            type: 'COUPON',
            title: coupon.name || coupon.code,
            code: coupon.code,
            eligible,
            minPurchase,
            discountAmount: eligible ? clampDiscount(coupon.discountAmount, safeSubtotal) : 0,
            reason,
        });
    }

    if (settings.welcome?.enabled) {
        const minPurchase = Number(settings.welcome.minPurchase || 0);
        let eligible = safeSubtotal >= minPurchase;
        let reason = eligible ? 'Eligible for first order discount' : `Add Rs ${Math.max(0, minPurchase - safeSubtotal)} more`;
        
        if (nonCancelledOrderCount > 0) {
            eligible = false;
            reason = 'Only for first order';
        }

        offers.push({
            type: 'WELCOME',
            title: 'Welcome Offer',
            eligible,
            minPurchase,
            discountAmount: eligible ? clampDiscount(settings.welcome.discountAmount, safeSubtotal) : 0,
            reason,
            originalDiscount: settings.welcome.discountAmount,
        });
    }

    if (settings.deliveredMilestone?.enabled) {
        const everyN = Math.max(1, Number(settings.deliveredMilestone.everyNDeliveredOrders || 5));
        const nextDeliveredCount = Number(deliveredCount || 0) + 1;
        const isMilestoneOrder = nextDeliveredCount % everyN === 0;
        const minPurchase = Number(settings.deliveredMilestone.minPurchase || 0);
        const meetsMin = safeSubtotal >= minPurchase;
        let eligible = isMilestoneOrder && meetsMin;

        let reason = isMilestoneOrder
            ? meetsMin
                ? 'Eligible for milestone discount'
                : `Add Rs ${Math.max(0, minPurchase - safeSubtotal)} more`
            : `${Math.max(0, everyN - ((deliveredCount || 0) % everyN))} delivered order(s) to unlock`;

        offers.push({
            type: 'EVERY_5_DELIVERED',
            title: `Every ${everyN} Delivered Orders`,
            eligible,
            minPurchase,
            discountAmount: eligible ? clampDiscount(settings.deliveredMilestone.discountAmount, safeSubtotal) : 0,
            reason,
            deliveredOrdersCompleted: Number(deliveredCount || 0),
            originalDiscount: settings.deliveredMilestone.discountAmount,
        });
    }

    let autoSelectedOffer = null;
    const eligibleAutoOffers = offers.filter((offer) => offer.eligible && offer.discountAmount > 0);
    if (eligibleAutoOffers.length) {
        autoSelectedOffer = eligibleAutoOffers.sort((a, b) => b.discountAmount - a.discountAmount)[0];
    }

    const couponResult = couponEval.result;
    let applied = null;

    if (couponResult?.status === 'valid') {
        applied = {
            source: 'COUPON',
            type: 'COUPON',
            code: couponResult.code,
            title: couponResult.name || couponResult.code,
            discountAmount: clampDiscount(couponResult.discountAmount, safeSubtotal),
        };
    } else if (autoSelectedOffer) {
        applied = {
            source: 'AUTO',
            type: autoSelectedOffer.type,
            title: autoSelectedOffer.title,
            discountAmount: clampDiscount(autoSelectedOffer.discountAmount, safeSubtotal),
        };
    }

    const discountAmount = applied ? clampDiscount(applied.discountAmount, safeSubtotal) : 0;
    const payableAmount = Math.max(0, safeSubtotal - discountAmount + safeDelivery);

    return {
        settings,
        deliveredOrderCount: Number(deliveredCount || 0),
        nonCancelledOrderCount: Number(nonCancelledOrderCount || 0),
        subtotal: safeSubtotal,
        deliveryCharge: safeDelivery,
        offers,
        coupon: couponResult,
        applied,
        discountAmount,
        payableAmount,
        couponDoc: couponEval.coupon,
    };
};

module.exports = {
    getOfferSettings,
    evaluateOrderPricing,
};
