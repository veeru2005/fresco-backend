const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');
const { getAllOrders, updateOrderStatus } = require('../controllers/orderController');
const {
    getUserProfile,
    upsertUserProfile,
    submitFeedback,
    getAdminFeedback,
    getAdminCustomers,
    getAdminDashboardStats,
    markFeedbackAsRead,
    createAdminUser,
    getAdminUsersActivity,
    deleteCustomerById,
    deleteFeedbackById,
    deleteAdminById,
} = require('../controllers/miscController');

router.get('/user-profile/:username', authMiddleware, getUserProfile);
router.post('/user-profile', authMiddleware, upsertUserProfile);

router.post('/feedback', authMiddleware, submitFeedback);
router.get('/admin/dashboard-stats', authMiddleware, adminMiddleware, getAdminDashboardStats);
router.get('/admin/feedback', authMiddleware, adminMiddleware, getAdminFeedback);
router.patch('/admin/feedback/:id/read', authMiddleware, adminMiddleware, markFeedbackAsRead);
router.get('/admin/customers', authMiddleware, adminMiddleware, getAdminCustomers);
router.get('/admin/orders', authMiddleware, adminMiddleware, getAllOrders);
router.put('/admin/orders/:id', authMiddleware, adminMiddleware, updateOrderStatus);

router.get('/super-admin/admins', authMiddleware, superAdminMiddleware, getAdminUsersActivity);
router.post('/super-admin/admins', authMiddleware, superAdminMiddleware, createAdminUser);
router.delete('/super-admin/admins/:id', authMiddleware, superAdminMiddleware, deleteAdminById);
router.delete('/super-admin/customers/:id', authMiddleware, superAdminMiddleware, deleteCustomerById);
router.delete('/super-admin/feedback/:id', authMiddleware, superAdminMiddleware, deleteFeedbackById);

module.exports = router;
