const MAX_PRICING_OPTIONS = 3;
const DEFAULT_UNIT = '1 kg';

const CANONICAL_UNITS = ['1 kg', 'half kg', '1 dozen', 'half dozen', '1 litre', '500 ml', '250 ml'];
const UNIT_GROUPS = {
    kg: ['1 kg', 'half kg'],
    dozen: ['1 dozen', 'half dozen'],
    liquid: ['1 litre', '500 ml', '250 ml'],
};
const UNIT_TO_GROUP = {
    '1 kg': 'kg',
    'half kg': 'kg',
    '1 dozen': 'dozen',
    'half dozen': 'dozen',
    '1 litre': 'liquid',
    '500 ml': 'liquid',
    '250 ml': 'liquid',
};
const UNIT_ALIASES = {
    kg: '1 kg',
    '1kg': '1 kg',
    'halfkg': 'half kg',
    dozen: '1 dozen',
    '1dozen': '1 dozen',
    'halfdozen': 'half dozen',
    liter: '1 litre',
    litre: '1 litre',
    '1 liter': '1 litre',
    '1 litre': '1 litre',
    gm: 'half kg',
    ml: '500 ml',
    '500ml': '500 ml',
    '250ml': '250 ml',
};

const LEGACY_PRODUCT_UNIT_ENUM = ['kg', 'dozen', 'liter', 'litre', 'gm', 'ml'];
const PRODUCT_UNIT_ENUM = [...CANONICAL_UNITS, ...LEGACY_PRODUCT_UNIT_ENUM];

const normalizeUnitLabel = (value, fallback = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;

    const mapped = UNIT_ALIASES[normalized] || normalized;
    const canonical = CANONICAL_UNITS.find((unit) => unit.toLowerCase() === mapped.toLowerCase());
    if (canonical) return canonical;

    return fallback;
};

const getUnitGroup = (unit) => {
    const normalized = normalizeUnitLabel(unit);
    if (!normalized) return '';
    return UNIT_TO_GROUP[normalized] || '';
};

const getAllowedUnitsForUnits = (units = []) => {
    if (!Array.isArray(units) || !units.length) return [...CANONICAL_UNITS];

    const normalized = units.map((unit) => normalizeUnitLabel(unit)).filter(Boolean);
    if (!normalized.length) return [...CANONICAL_UNITS];

    const groups = [...new Set(normalized.map((unit) => UNIT_TO_GROUP[unit]).filter(Boolean))];
    if (groups.length !== 1) return [];

    const activeGroup = groups[0];
    return [...(UNIT_GROUPS[activeGroup] || [])];
};

const hasMixedUnitGroups = (units = []) => {
    const normalized = units.map((unit) => normalizeUnitLabel(unit)).filter(Boolean);
    if (!normalized.length) return false;

    const groups = new Set(normalized.map((unit) => UNIT_TO_GROUP[unit]).filter(Boolean));
    return groups.size > 1;
};

const toPositivePrice = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return parsed > 0 ? parsed : 0;
};

const parsePricingOptionsInput = (raw) => {
    if (Array.isArray(raw)) return raw;

    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    if (raw && typeof raw === 'object') {
        return Object.values(raw);
    }

    return [];
};

const sanitizePricingOptions = (rawOptions, fallback = {}) => {
    const source = parsePricingOptionsInput(rawOptions);
    const result = [];
    const seenUnits = new Set();

    source.forEach((item) => {
        if (result.length >= MAX_PRICING_OPTIONS) return;

        const unit = normalizeUnitLabel(item?.unit || item?.label || item?.name || '');
        const price = toPositivePrice(item?.price);
        if (!unit || !price || seenUnits.has(unit)) return;

        result.push({ unit, price });
        seenUnits.add(unit);
    });

    if (!result.length) {
        const fallbackUnit = normalizeUnitLabel(fallback.unit, DEFAULT_UNIT) || DEFAULT_UNIT;
        const fallbackPrice = toPositivePrice(fallback.price);
        if (fallbackPrice > 0) {
            result.push({ unit: fallbackUnit, price: fallbackPrice });
        }
    }

    return result;
};

const getProductPricingOptions = (productDoc = {}) =>
    sanitizePricingOptions(productDoc?.pricingOptions, {
        unit: productDoc?.unit || DEFAULT_UNIT,
        price: productDoc?.price,
    });

const getMaxAllowedPricingOptions = (units = []) => {
    if (!Array.isArray(units) || !units.length) return 2;
    const normalized = units.map((unit) => normalizeUnitLabel(unit)).filter(Boolean);
    if (!normalized.length) return 2;

    if (hasMixedUnitGroups(normalized)) return 0;

    const activeGroup = getUnitGroup(normalized[0]);
    if (!activeGroup) return 2;
    return (UNIT_GROUPS[activeGroup] || []).length;
};

const resolvePricingOptionsFromBody = ({ body = {}, existingProduct = null }) => {
    const hasBodyPricingOptions = body.pricingOptions !== undefined && body.pricingOptions !== null && body.pricingOptions !== '';

    if (hasBodyPricingOptions) {
        return sanitizePricingOptions(body.pricingOptions, {
            unit: body.unit || existingProduct?.unit || DEFAULT_UNIT,
            price: body.price || existingProduct?.price,
        });
    }

    const existingOptions = getProductPricingOptions(existingProduct || {});
    if (existingOptions.length) return existingOptions;

    return sanitizePricingOptions([], {
        unit: body.unit || DEFAULT_UNIT,
        price: body.price,
    });
};

const getSelectedPricingOption = (productDoc = {}, requestedUnit) => {
    const options = getProductPricingOptions(productDoc);
    if (!options.length) return null;

    const normalizedUnit = normalizeUnitLabel(requestedUnit);
    if (normalizedUnit) {
        const matched = options.find((option) => option.unit === normalizedUnit);
        if (matched) return matched;
    }

    return options[0];
};

module.exports = {
    MAX_PRICING_OPTIONS,
    DEFAULT_UNIT,
    CANONICAL_UNITS,
    PRODUCT_UNIT_ENUM,
    normalizeUnitLabel,
    toPositivePrice,
    parsePricingOptionsInput,
    sanitizePricingOptions,
    getProductPricingOptions,
    resolvePricingOptionsFromBody,
    getSelectedPricingOption,
    getMaxAllowedPricingOptions,
    getAllowedUnitsForUnits,
};
