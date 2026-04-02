const express = require('express');
const router = express.Router();
const {
	createOrder,
	getMyOrders,
	getAllOrders,
	getOrderById,
	updateOrderStatus,
	deleteOrder,
	cancelOrder,
} = require('../controllers/orderController');
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');


router.post('/', authMiddleware, createOrder);
router.get('/myorders', authMiddleware, getMyOrders);
router.get('/my-orders', authMiddleware, getMyOrders);
router.get('/', authMiddleware, adminMiddleware, getAllOrders);
router.get('/admin/orders', authMiddleware, adminMiddleware, getAllOrders);
router.put('/admin/orders/:id', authMiddleware, adminMiddleware, updateOrderStatus);
router.delete('/admin/orders/:id', authMiddleware, superAdminMiddleware, deleteOrder);
router.get('/:id', authMiddleware, getOrderById);
router.put('/:id/status', authMiddleware, adminMiddleware, updateOrderStatus);
router.put('/:id/cancel', authMiddleware, cancelOrder);

module.exports = router;