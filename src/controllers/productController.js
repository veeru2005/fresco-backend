const Product = require('../models/Product');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

const ALLOWED_TYPES = ['fruit', 'vegetable', 'herb'];
const DEFAULT_IMAGE =
    'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=800&auto=format&fit=crop';

const normalizeType = (value) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();

    if (ALLOWED_TYPES.includes(normalized)) {
        return normalized;
    }

    if (normalized === 'leafy green' || normalized === 'leafy greens') {
        return 'vegetable';
    }

    return 'vegetable';
};

const parseBoolean = (value, fallback = true) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
};

const uploadBufferToCloudinary = (buffer) =>
    new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'fresco/products',
                resource_type: 'image',
            },
            (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(result.secure_url);
            }
        );

        uploadStream.end(buffer);
    });

const toClientProduct = (productDoc) => {
    const product = productDoc.toObject ? productDoc.toObject() : productDoc;
    const quantityValue = Number(product.quantity || 1);
    return {
        ...product,
        id: String(product._id),
        type: product.type ? product.type.charAt(0).toUpperCase() + product.type.slice(1) : 'Vegetable',
        quantity: quantityValue,
        capacity: quantityValue,
        features: [],
    };
};

const buildProductPayload = async (req, existingProduct) => {
    const body = req.body || {};
    let imageUrl = existingProduct?.image || '';

    if (req.file) {
        if (!isCloudinaryConfigured) {
            const err = new Error('Cloudinary is not configured on server');
            err.statusCode = 500;
            throw err;
        }
        imageUrl = await uploadBufferToCloudinary(req.file.buffer);
    }

    const fallbackName = existingProduct?.name || 'Organic Produce';
    const quantity = Number(body.quantity || body.capacity || existingProduct?.quantity || 1);

    const payload = {
        name: String(body.name || existingProduct?.name || '').trim() || fallbackName,
        type: normalizeType(existingProduct?.type || 'vegetable'),
        price:
            Number(body.price) > 0
                ? Number(body.price)
                : existingProduct?.price || 0,
        quantity: quantity > 0 ? quantity : 1,
        unit: String(body.unit || existingProduct?.unit || 'kg').trim() || 'kg',
        image: imageUrl || existingProduct?.image || DEFAULT_IMAGE,
        description:
            String(body.description || existingProduct?.description || '').trim() ||
            `${fallbackName} fresh organic produce.`,
        available: parseBoolean(body.available, existingProduct?.available ?? true),
        origin: String(body.origin || existingProduct?.origin || 'Local Farm').trim() || 'Local Farm',
        organic_status: parseBoolean(body.organic_status, existingProduct?.organic_status ?? true),
    };

    return payload;
};

// Get all products
exports.getAllProducts = async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.status(200).json(products.map(toClientProduct));
    } catch (error) {
        res.status(500).json({ error: 'Error fetching products' });
    }
};

// Admin: Get all products (including unavailable)
exports.getAdminProducts = async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.status(200).json(products.map(toClientProduct));
    } catch (error) {
        res.status(500).json({ error: 'Error fetching products' });
    }
};

// Get single product
exports.getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        res.status(200).json(toClientProduct(product));
    } catch (error) {
        res.status(500).json({ error: 'Error fetching product' });
    }
};

// Admin: Create product
exports.createProduct = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Product image file is required' });
        }

        const payload = await buildProductPayload(req);
        if (!payload.price || payload.price <= 0) {
            return res.status(400).json({ error: 'A valid product price is required' });
        }

        const product = new Product(payload);
        await product.save();
        res.status(201).json(toClientProduct(product));
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Error creating product' });
    }
};

// Admin: Update product
exports.updateProduct = async (req, res) => {
    try {
        const existingProduct = await Product.findById(req.params.id);
        if (!existingProduct) return res.status(404).json({ error: 'Product not found' });

        const payload = await buildProductPayload(req, existingProduct);
        const product = await Product.findByIdAndUpdate(req.params.id, payload, { new: true });
        if (!product) return res.status(404).json({ error: 'Product not found' });
        res.status(200).json(toClientProduct(product));
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Error updating product' });
    }
};

// Admin: Delete product
exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        res.status(200).json({ message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Error deleting product' });
    }
};