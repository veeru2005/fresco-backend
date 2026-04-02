const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        type: { type: String, required: true, enum: ['fruit', 'vegetable', 'herb'] },
        price: { type: Number, required: true }, // price per unit (e.g. per kg)
        quantity: { type: Number, required: true, default: 1 },
        unit: { type: String, required: true, default: 'kg' },
        image: { type: String, required: true },
        description: { type: String, required: true },
        available: { type: Boolean, default: true },
        origin: { type: String, required: true },
        organic_status: { type: Boolean, default: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);