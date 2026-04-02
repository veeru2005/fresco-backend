const express = require('express');
const multer = require('multer');
const {
    getAdminProducts,
    createProduct,
    updateProduct,
    deleteProduct,
} = require('../controllers/productController');
const { authMiddleware, adminMiddleware, superAdminMiddleware } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', authMiddleware, adminMiddleware, getAdminProducts);
router.post('/', authMiddleware, superAdminMiddleware, upload.single('imageFile'), createProduct);
router.put('/:id', authMiddleware, superAdminMiddleware, upload.single('imageFile'), updateProduct);
router.delete('/:id', authMiddleware, superAdminMiddleware, deleteProduct);

module.exports = router;
