const express = require('express');
const router = express.Router();
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');
const {
    previewOffers,
    getPublicCoupons,
    getOfferSettingsForAdmin,
    updateOfferSettingsForAdmin,
    generateCouponForAdmin,
    getCouponsForAdmin,
    updateCouponForAdmin,
    deleteCouponForAdmin,
} = require('../controllers/offersController');

router.post('/preview', authMiddleware, previewOffers);
router.get('/available-coupons', authMiddleware, getPublicCoupons);

router.get('/super-admin/settings', authMiddleware, superAdminMiddleware, getOfferSettingsForAdmin);
router.put('/super-admin/settings', authMiddleware, superAdminMiddleware, updateOfferSettingsForAdmin);
router.get('/super-admin/coupons', authMiddleware, superAdminMiddleware, getCouponsForAdmin);
router.post('/super-admin/coupons', authMiddleware, superAdminMiddleware, generateCouponForAdmin);
router.put('/super-admin/coupons/:id', authMiddleware, superAdminMiddleware, updateCouponForAdmin);
router.delete('/super-admin/coupons/:id', authMiddleware, superAdminMiddleware, deleteCouponForAdmin);

module.exports = router;
