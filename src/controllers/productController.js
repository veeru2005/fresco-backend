const Product = require('../models/Product');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');
const {
    DEFAULT_UNIT,
    getAllowedUnitsForUnits,
    getProductPricingOptions,
    resolvePricingOptionsFromBody,
    normalizeUnitLabel,
    getMaxAllowedPricingOptions,
} = require('../services/pricing');

const ALLOWED_TYPES = ['fruit', 'vegetable', 'herb'];
const DEFAULT_IMAGE =
    'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=800&auto=format&fit=crop';
const PRODUCT_SORT = { displayOrder: 1, createdAt: -1, _id: 1 };

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

const normalizeDisplayOrderValue = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 1) {
        return null;
    }

    return Math.trunc(numericValue);
};

const ensureDisplayOrderSequence = async () => {
    const products = await Product.find().sort(PRODUCT_SORT).select('_id displayOrder');
    if (!products.length) {
        return;
    }

    const updates = [];
    products.forEach((product, index) => {
        const targetOrder = index + 1;
        if (Number(product.displayOrder) !== targetOrder) {
            updates.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: { $set: { displayOrder: targetOrder } },
                },
            });
        }
    });

    if (updates.length) {
        await Product.bulkWrite(updates);
    }
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
    const pricingOptions = getProductPricingOptions(product);
    const primaryPricing = pricingOptions[0] || {
        unit: normalizeUnitLabel(product.unit, DEFAULT_UNIT) || DEFAULT_UNIT,
        price: Number(product.price || 0),
    };

    return {
        ...product,
        id: String(product._id),
        type: product.type ? product.type.charAt(0).toUpperCase() + product.type.slice(1) : 'Vegetable',
        price: Number(primaryPricing.price || 0),
        unit: primaryPricing.unit,
        pricingOptions,
        quantity: quantityValue,
        capacity: quantityValue,
        features: [],
    };
};

const buildProductPayload = async (req, existingProduct) => {
    const body = req.body || {};
    let imageUrl = existingProduct?.image || '';
    const requestedDisplayOrder = normalizeDisplayOrderValue(body.displayOrder);

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

    const pricingOptions = resolvePricingOptionsFromBody({ body, existingProduct });
    const primaryPricing = pricingOptions[0] || null;

    const payload = {
        name: String(body.name || existingProduct?.name || '').trim() || fallbackName,
        type: normalizeType(existingProduct?.type || 'vegetable'),
        price: Number(primaryPricing?.price || 0),
        quantity: quantity > 0 ? quantity : 1,
        unit: primaryPricing?.unit || normalizeUnitLabel(existingProduct?.unit, DEFAULT_UNIT) || DEFAULT_UNIT,
        pricingOptions,
        image: imageUrl || existingProduct?.image || DEFAULT_IMAGE,
        description:
            String(body.description || existingProduct?.description || '').trim() ||
            `${fallbackName} fresh organic produce.`,
        available: parseBoolean(body.available, existingProduct?.available ?? true),
        displayOrder:
            requestedDisplayOrder ?? normalizeDisplayOrderValue(existingProduct?.displayOrder) ?? 0,
        origin: String(body.origin || existingProduct?.origin || 'Local Farm').trim() || 'Local Farm',
        organic_status: parseBoolean(body.organic_status, existingProduct?.organic_status ?? true),
    };

    return payload;
};

const getPricingValidationError = (pricingOptions = []) => {
    if (!Array.isArray(pricingOptions) || pricingOptions.length < 1) {
        return 'At least one valid pricing option is required';
    }

    const normalizedUnits = pricingOptions
        .map((option) => normalizeUnitLabel(option?.unit || ''))
        .filter(Boolean);

    const allowedUnits = getAllowedUnitsForUnits(normalizedUnits);
    if (!allowedUnits.length) {
        return 'Please keep one product in a single unit family only: kg pair, dozen pair, or litre/ml set';
    }

    const maxAllowedOptions = getMaxAllowedPricingOptions(normalizedUnits);
    if (!maxAllowedOptions || pricingOptions.length > maxAllowedOptions) {
        return maxAllowedOptions === 3
            ? 'Liquid products support up to 3 pricing options'
            : 'Kg or dozen products support up to 2 pricing options';
    }

    return null;
};

// Get all products
exports.getAllProducts = async (req, res) => {
    try {
        await ensureDisplayOrderSequence();
        const products = await Product.find().sort(PRODUCT_SORT);
        res.status(200).json(products.map(toClientProduct));
    } catch (error) {
        res.status(500).json({ error: 'Error fetching products' });
    }
};

// Admin: Get all products (including unavailable)
exports.getAdminProducts = async (req, res) => {
    try {
        await ensureDisplayOrderSequence();
        const products = await Product.find().sort(PRODUCT_SORT);
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
        const pricingError = getPricingValidationError(payload.pricingOptions);
        if (pricingError) {
            return res.status(400).json({ error: pricingError });
        }

        await ensureDisplayOrderSequence();
        const lastProduct = await Product.findOne().sort({ displayOrder: -1 }).select('displayOrder');
        const nextDisplayOrder = Number(lastProduct?.displayOrder || 0) + 1;

        const product = new Product({ ...payload, displayOrder: nextDisplayOrder });
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
        if (!payload.price || payload.price <= 0) {
            return res.status(400).json({ error: 'A valid product price is required' });
        }
        const pricingError = getPricingValidationError(payload.pricingOptions);
        if (pricingError) {
            return res.status(400).json({ error: pricingError });
        }

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
        await ensureDisplayOrderSequence();
        res.status(200).json({ message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Error deleting product' });
    }
};

// Admin: Reorder products
exports.reorderProducts = async (req, res) => {
    try {
        const productIds = Array.isArray(req.body?.productIds)
            ? req.body.productIds.map((id) => String(id || '').trim()).filter(Boolean)
            : [];

        if (!productIds.length) {
            return res.status(400).json({ error: 'productIds array is required' });
        }

        const uniqueProductIds = [...new Set(productIds)];
        if (uniqueProductIds.length !== productIds.length) {
            return res.status(400).json({ error: 'Duplicate product IDs are not allowed' });
        }

        const totalProducts = await Product.countDocuments();
        if (uniqueProductIds.length !== totalProducts) {
            return res.status(400).json({ error: 'Please send the complete product order list' });
        }

        const matchedProducts = await Product.countDocuments({ _id: { $in: uniqueProductIds } });
        if (matchedProducts !== uniqueProductIds.length) {
            return res.status(400).json({ error: 'One or more product IDs are invalid' });
        }

        const updates = uniqueProductIds.map((productId, index) => ({
            updateOne: {
                filter: { _id: productId },
                update: { $set: { displayOrder: index + 1 } },
            },
        }));

        if (updates.length) {
            await Product.bulkWrite(updates);
        }

        const products = await Product.find().sort(PRODUCT_SORT);
        return res.status(200).json(products.map(toClientProduct));
    } catch (error) {
        const isInvalidObjectId = error?.name === 'CastError' || error?.name === 'BSONError';
        if (isInvalidObjectId) {
            return res.status(400).json({ error: 'One or more product IDs are invalid' });
        }

        return res.status(500).json({ error: 'Error reordering products' });
    }
};