const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const mongoose = require('mongoose');
const { isAdminRole } = require('../middleware/auth');
const { evaluateOrderPricing } = require('../services/offers');
const { sendOrderCreatedEmailNotifications } = require('../services/brevoEmail');

const statusMap = {
    pending: 'BOOKING_CONFIRMED',
    processing: 'VEHICLE_PREPARED',
    shipped: 'ON_THE_WAY',
    delivered: 'DELIVERED',
    cancelled: 'CANCELLED',
};

const reverseStatusMap = {
    BOOKING_CONFIRMED: 'pending',
    VEHICLE_PREPARED: 'processing',
    ON_THE_WAY: 'shipped',
    DELIVERED: 'delivered',
    CANCELED: 'cancelled',
    CANCELLED: 'cancelled',
};

const normalizePaymentStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return undefined;
    if (['completed', 'success', 'paid'].includes(normalized)) return 'completed';
    if (['failed', 'failure'].includes(normalized)) return 'failed';
    if (['pending', 'initiated'].includes(normalized)) return 'pending';
    return undefined;
};

const normalizeOrderStatus = (status, orderStatus) => {
    const direct = String(status || '').trim().toLowerCase();
    if (direct && ['pending', 'processing', 'shipped', 'delivered', 'cancelled'].includes(direct)) {
        return direct;
    }

    const legacy = reverseStatusMap[String(orderStatus || '').trim().toUpperCase()];
    return legacy || undefined;
};

const toLegacyOrder = (orderDoc) => {
    const orderedItems = Array.isArray(orderDoc.products)
        ? orderDoc.products
            .map((item) => ({
                productId: item?.product?._id || item?.product || null,
                name: item?.product?.name || 'Product',
                image: item?.product?.image || '',
                quantity: Number(item?.quantity || 1),
                unitPrice: Number(item?.product?.price || 0),
                itemAmount: Number(item?.product?.price || 0) * Math.max(1, Number(item?.quantity || 1)),
            }))
            .filter((item) => item.productId)
        : [];

    const totalItems = orderedItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0);

    return {
        id: orderDoc._id,
        orderId: orderDoc.orderId || orderDoc._id,
        productName: orderDoc.productName || orderedItems?.[0]?.name || 'Product',
        productImage: orderDoc.productImage || orderedItems?.[0]?.image || '',
        username: orderDoc.username || orderDoc.user?.name || 'user',
        mobileNumber: orderDoc.mobileNumber || '',
        gender: orderDoc.gender || '',
        country: orderDoc.country || '',
        paymentAmount: orderDoc.totalAmount,
        subtotalAmount: Number(orderDoc.subtotalAmount || 0),
        deliveryCharge: Number(orderDoc.deliveryCharge || 0),
        discountAmount: Number(orderDoc.discountAmount || 0),
        appliedOfferType: orderDoc.appliedOfferType || null,
        appliedOfferTitle: orderDoc.appliedOfferTitle || null,
        appliedCouponCode: orderDoc.appliedCouponCode || null,
        bookingDate: orderDoc.createdAt,
        orderStatus: statusMap[orderDoc.status] || 'BOOKING_CONFIRMED',
        status: orderDoc.status,
        paymentStatus: orderDoc.status === 'delivered' ? 'COMPLETED' : 'PENDING',
        paymentMethod: orderDoc.paymentMethod || '',
        totalAmount: orderDoc.totalAmount,
        totalItems,
        orderedItems,
        address: orderDoc.deliveryAddress,
        deliveryAddress: orderDoc.deliveryAddress,
        startDate: orderDoc.startDate || orderDoc.createdAt,
        endDate: orderDoc.endDate || orderDoc.createdAt,
        deliveredDate: orderDoc.deliveredDate || null,
    };
};

const clampQuantity = (quantity) => {
    const q = Number(quantity || 0);
    if (!Number.isFinite(q)) return 1;
    return Math.max(1, Math.floor(q));
};

const computeSubtotalFromProducts = async (products) => {
    const normalizedProducts = Array.isArray(products) ? products : [];
    const productIds = normalizedProducts
        .map((item) => String(item?.product || '').trim())
        .filter(Boolean);

    if (!productIds.length) {
        return { subtotal: 0, normalizedItems: [] };
    }

    const productDocs = await Product.find({ _id: { $in: productIds } }).select('_id price');
    const productMap = new Map(productDocs.map((doc) => [String(doc._id), Number(doc.price || 0)]));

    const normalizedItems = normalizedProducts
        .map((item) => {
            const productId = String(item?.product || '').trim();
            if (!productMap.has(productId)) return null;
            return {
                product: productId,
                quantity: clampQuantity(item?.quantity),
            };
        })
        .filter(Boolean);

    const subtotal = normalizedItems.reduce((sum, item) => {
        const unitPrice = Number(productMap.get(String(item.product)) || 0);
        return sum + unitPrice * Number(item.quantity || 1);
    }, 0);

    return { subtotal, normalizedItems };
};

const getOrderLookupQuery = (rawIdentifier) => {
    const identifier = String(rawIdentifier || '').trim();
    if (!identifier) return null;

    const normalizedOrderId = identifier.toUpperCase();
    if (mongoose.Types.ObjectId.isValid(identifier)) {
        return {
            $or: [{ _id: identifier }, { orderId: normalizedOrderId }],
        };
    }

    return { orderId: normalizedOrderId };
};

const ensurePublicOrderId = async (orderDoc) => {
    if (!orderDoc || orderDoc.orderId) return orderDoc;
    await orderDoc.save();
    return orderDoc;
};

const ensurePublicOrderIds = async (orderDocs) => {
    await Promise.all((Array.isArray(orderDocs) ? orderDocs : []).map((doc) => ensurePublicOrderId(doc)));
    return orderDocs;
};

// User: Create new order
exports.createOrder = async (req, res) => {
    try {
        const {
            products,
            deliveryAddress,
            productName,
            productImage,
            username,
            mobileNumber,
            gender,
            country,
            paymentMethod,
            paymentStatus,
            address,
            paymentAmount,
            couponCode,
            subtotalAmount,
            deliveryCharge,
            startDate,
            endDate,
        } = req.body;
        const userId = req.user.userId;
        const userProfile = await User.findById(userId).select('name email mobileNumber').lean();

        const { subtotal: calculatedSubtotal, normalizedItems } = await computeSubtotalFromProducts(products);
        const clientSubtotal = Math.max(0, Number(subtotalAmount || 0));
        const safeSubtotal = calculatedSubtotal > 0 ? calculatedSubtotal : clientSubtotal;
        const safeDeliveryCharge = Math.max(0, Number(deliveryCharge || 0));

        const pricing = await evaluateOrderPricing({
            userId,
            subtotal: safeSubtotal,
            deliveryCharge: safeDeliveryCharge,
            couponCode,
        });

        const normalizedAmount = Number(pricing.payableAmount || paymentAmount || 0);
        const normalizedAddress = String(deliveryAddress || address || '').trim();

        if (normalizedAmount <= 0 || !normalizedAddress) {
            return res.status(400).json({ error: 'Valid amount and delivery address are required' });
        }

        const orderPayload = {
            user: userId,
            products: normalizedItems,
            subtotalAmount: pricing.subtotal,
            deliveryCharge: pricing.deliveryCharge,
            discountAmount: pricing.discountAmount,
            totalAmount: normalizedAmount,
            appliedOfferType: pricing.applied?.type || null,
            appliedOfferTitle: pricing.applied?.title || null,
            appliedCouponCode: pricing.applied?.source === 'COUPON' ? pricing.applied.code : null,
            deliveryAddress: normalizedAddress,
            productName: productName ? String(productName).trim() : undefined,
            productImage: productImage ? String(productImage).trim() : undefined,
            username: username ? String(username).trim() : userProfile?.name ? String(userProfile.name).trim() : undefined,
            mobileNumber: mobileNumber
                ? String(mobileNumber).trim()
                : userProfile?.mobileNumber
                    ? String(userProfile.mobileNumber).trim()
                    : undefined,
            gender: gender ? String(gender).trim() : undefined,
            country: country ? String(country).trim() : undefined,
            paymentMethod: paymentMethod ? String(paymentMethod).trim() : undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            paymentStatus: 'pending',
        };

        let order = null;
        const maxSaveAttempts = 3;

        for (let attempt = 0; attempt < maxSaveAttempts; attempt += 1) {
            try {
                order = new Order(orderPayload);
                await order.save();
                break;
            } catch (saveError) {
                const isDuplicateOrderId =
                    saveError?.code === 11000 &&
                    (saveError?.keyPattern?.orderId || String(saveError?.message || '').includes('orderId'));

                if (!isDuplicateOrderId || attempt === maxSaveAttempts - 1) {
                    throw saveError;
                }
            }
        }

        if (pricing.applied?.source === 'COUPON' && pricing.couponDoc) {
            await Coupon.updateOne({ _id: pricing.couponDoc._id }, { $inc: { usedCount: 1 } });
        }

        const totalItems = normalizedItems.reduce(
            (sum, item) => sum + Math.max(1, Number(item?.quantity || 1)),
            0
        );

        try {
            await sendOrderCreatedEmailNotifications({
                order,
                customerName: order.username || userProfile?.name || 'Customer',
                customerEmail: userProfile?.email || '',
                customerPhone: order.mobileNumber || userProfile?.mobileNumber || '',
                totalItems,
            });
        } catch (emailError) {
            console.error('sendOrderCreatedEmailNotifications failed:', emailError?.message || emailError);
        }

        res.status(201).json(toLegacyOrder(order));
    } catch (error) {
        console.error('createOrder failed:', error);
        res.status(500).json({
            error: 'Error creating order',
            details: process.env.NODE_ENV === 'production' ? undefined : error.message,
        });
    }
};

// User: Get my orders
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user.userId })
            .sort({ createdAt: -1 })
            .populate('products.product');

        await ensurePublicOrderIds(orders);
        res.status(200).json(orders.map(toLegacyOrder));
    } catch (error) {
        res.status(500).json({ error: 'Error fetching orders' });
    }
};

// User/Admin: Get one order by id
exports.getOrderById = async (req, res) => {
    try {
        const lookupQuery = getOrderLookupQuery(req.params.id);
        if (!lookupQuery) {
            return res.status(400).json({ error: 'Order ID is required' });
        }

        const order = await Order.findOne(lookupQuery)
            .populate('products.product')
            .populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const isOwner = String(order.user?._id) === String(req.user.userId);
        const isAdmin = isAdminRole(req.user.role);
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await ensurePublicOrderId(order);

        res.status(200).json(toLegacyOrder(order));
    } catch (error) {
        res.status(500).json({ error: 'Error fetching order' });
    }
};

// Admin: Get all orders
exports.getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find()
            .sort({ createdAt: -1 })
            .populate('user', 'name email')
            .populate('products.product');

        await ensurePublicOrderIds(orders);
        res.status(200).json(orders.map(toLegacyOrder));
    } catch (error) {
        res.status(500).json({ error: 'Error fetching all orders' });
    }
};

// Admin: Update order status
exports.updateOrderStatus = async (req, res) => {
    try {
        const { status, paymentStatus, orderStatus } = req.body;
        const updateData = {};
        const normalizedStatus = normalizeOrderStatus(status, orderStatus);
        const normalizedPaymentStatus = normalizePaymentStatus(paymentStatus);

        if (normalizedStatus) updateData.status = normalizedStatus;

        if (normalizedStatus === 'delivered') {
            updateData.deliveredDate = new Date();
            updateData.paymentStatus = 'completed';
        } else if (normalizedStatus) {
            updateData.deliveredDate = null;
            updateData.paymentStatus = 'pending';
        }

        if (normalizedPaymentStatus && normalizedPaymentStatus !== 'completed') {
            updateData.paymentStatus = normalizedPaymentStatus;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No valid fields provided to update' });
        }

        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });

        const wasCancelled = order.status === 'cancelled';
        Object.assign(order, updateData);
        await order.save();

        if (!wasCancelled && order.status === 'cancelled' && order.appliedCouponCode) {
            await Coupon.updateOne(
                { code: String(order.appliedCouponCode).toUpperCase(), usedCount: { $gt: 0 } },
                { $inc: { usedCount: -1 } }
            );
        }
        
        res.status(200).json(toLegacyOrder(order));
    } catch (error) {
        res.status(500).json({ error: 'Error updating order' });
    }
};

// Super Admin: Delete order
exports.deleteOrder = async (req, res) => {
    try {
        const order = await Order.findByIdAndDelete(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });

        res.status(200).json({ message: 'Order deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Error deleting order' });
    }
};
// User: Cancel an order
exports.cancelOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        // Ensure the user owns this order
        if (order.user.toString() !== req.user.userId) {
            return res.status(403).json({ error: 'Not authorized to cancel this order' });
        }
        
        if (order.status === 'delivered' || order.status === 'cancelled') {
            return res.status(400).json({ error: 'Cannot cancel an order that is already delivered or cancelled' });
        }
        
        order.status = 'cancelled';
        const couponToRevert = order.appliedCouponCode;
        await order.save();

        if (couponToRevert) {
            await Coupon.updateOne(
                { code: String(couponToRevert).toUpperCase(), usedCount: { $gt: 0 } },
                { $inc: { usedCount: -1 } }
            );
        }

        res.status(200).json(toLegacyOrder(order));
    } catch (error) {
        res.status(500).json({ error: 'Error cancelling order' });
    }
};
