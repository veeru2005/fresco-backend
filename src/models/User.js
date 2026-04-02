const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String },
        googleId: { type: String, unique: true, sparse: true },
        role: { type: String, enum: ['user', 'admin', 'super-admin'], default: 'user' },
        fullName: { type: String },
        mobileNumber: { type: String },
        address: { type: String },
        city: { type: String },
        state: { type: String },
        pincode: { type: String },
        gender: { type: String },
        country: { type: String },
        lastLoginAt: { type: Date },
        lastLoginIp: { type: String },
        lastLoginUserAgent: { type: String },
    },
    { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);