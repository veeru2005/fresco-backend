const mongoose = require('mongoose');

const offerSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, default: 'global' },
        welcome: {
            enabled: { type: Boolean, default: true },
            discountAmount: { type: Number, default: 30, min: 0 },
            minPurchase: { type: Number, default: 250, min: 0 },
        },
        deliveredMilestone: {
            enabled: { type: Boolean, default: true },
            everyNDeliveredOrders: { type: Number, default: 5, min: 1 },
            discountAmount: { type: Number, default: 50, min: 0 },
            minPurchase: { type: Number, default: 300, min: 0 },
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('OfferSettings', offerSettingsSchema);
