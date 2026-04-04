const mongoose = require('mongoose');
const { randomInt } = require('crypto');

const ORDER_ID_PREFIX = '#OD';
const ORDER_ID_DIGITS = 16;
const ORDER_ID_PATTERN = /^#OD\d{16}$/;

const buildRandomOrderId = () => {
    let numericPart = '';
    for (let i = 0; i < ORDER_ID_DIGITS; i += 1) {
        numericPart += String(randomInt(0, 10));
    }
    return `${ORDER_ID_PREFIX}${numericPart}`;
};

const orderSchema = new mongoose.Schema(
    {
        orderId: {
            type: String,
            trim: true,
            uppercase: true,
            sparse: true,
            unique: true,
            index: true,
            match: ORDER_ID_PATTERN,
        },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        products: [
            {
                product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
                quantity: { type: Number, required: true },
                unit: { type: String, default: '1 kg' },
                unitPrice: { type: Number, default: 0 },
            },
        ],
        subtotalAmount: { type: Number, default: 0 },
        deliveryCharge: { type: Number, default: 0 },
        discountAmount: { type: Number, default: 0 },
        totalAmount: { type: Number, required: true },
        appliedOfferType: { type: String, default: null },
        appliedOfferTitle: { type: String, default: null },
        appliedCouponCode: { type: String, default: null },
        productName: { type: String },
        productImage: { type: String },
        username: { type: String },
        mobileNumber: { type: String },
        gender: { type: String },
        country: { type: String },
        paymentMethod: { type: String },
        status: { type: String, enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
        deliveryAddress: { type: String, required: true },
        paymentStatus: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
        startDate: { type: Date },
        endDate: { type: Date },
        deliveredDate: { type: Date },
    },
    { timestamps: true }
);

orderSchema.pre('validate', async function assignPublicOrderId() {
    if (this.orderId) {
        this.orderId = String(this.orderId).trim().toUpperCase();
        return;
    }

    const OrderModel = this.constructor;
    const maxAttempts = 8;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const candidate = buildRandomOrderId();
        const exists = await OrderModel.exists({ orderId: candidate });
        if (!exists) {
            this.orderId = candidate;
            return;
        }
    }

    throw new Error('Could not generate a unique order ID');
});

module.exports = mongoose.model('Order', orderSchema);