const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
    {
        code: { type: String, required: true, unique: true, uppercase: true, trim: true },
        name: { type: String, trim: true },
        discountType: { type: String, enum: ['flat'], default: 'flat' },
        discountAmount: { type: Number, required: true, min: 1 },
        minPurchase: { type: Number, required: true, min: 0 },
        maxUses: { type: Number, default: 0, min: 0 },
        usedCount: { type: Number, default: 0, min: 0 },
        perUserLimit: { type: Number, default: 1, min: 1 },
        active: { type: Boolean, default: true },
        isPublic: { type: Boolean, default: true },
        expiresAt: { type: Date, default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Coupon', couponSchema);
