const express = require('express');
const router = express.Router();
const { getAllProducts, getProductById, createProduct, updateProduct, deleteProduct } = require('../controllers/productController');
const multer = require('multer');
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

router.get('/', getAllProducts);
router.get('/:id', getProductById);
router.post('/', authMiddleware, superAdminMiddleware, upload.single('imageFile'), createProduct);
router.put('/:id', authMiddleware, superAdminMiddleware, upload.single('imageFile'), updateProduct);
router.delete('/:id', authMiddleware, superAdminMiddleware, deleteProduct);

module.exports = router;