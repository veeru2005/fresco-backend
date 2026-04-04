const mongoose = require('mongoose');
const { CANONICAL_UNITS, PRODUCT_UNIT_ENUM, MAX_PRICING_OPTIONS, DEFAULT_UNIT } = require('../services/pricing');

const pricingOptionSchema = new mongoose.Schema(
    {
        unit: { type: String, required: true, enum: CANONICAL_UNITS },
        price: { type: Number, required: true, min: 0 },
    },
    { _id: false }
);

const productSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        type: { type: String, required: true, enum: ['fruit', 'vegetable', 'herb'] },
        price: { type: Number, required: true }, // price per unit (e.g. per kg)
        quantity: { type: Number, required: true, default: 1 },
        unit: {
            type: String,
            required: true,
            default: DEFAULT_UNIT,
            enum: PRODUCT_UNIT_ENUM,
        },
        pricingOptions: {
            type: [pricingOptionSchema],
            default: undefined,
            validate: {
                validator: (value) => !value || (Array.isArray(value) && value.length >= 1 && value.length <= MAX_PRICING_OPTIONS),
                message: `Pricing options must contain between 1 and ${MAX_PRICING_OPTIONS} entries`,
            },
        },
        image: { type: String, required: true },
        description: { type: String, required: true },
        available: { type: Boolean, default: true },
        displayOrder: { type: Number, required: true, default: 0, min: 0, index: true },
        origin: { type: String, required: true },
        organic_status: { type: Boolean, default: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);