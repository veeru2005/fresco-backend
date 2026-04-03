require('dotenv').config();

const BREVO_EMAIL_API_URL = 'https://api.brevo.com/v3/smtp/email';

const isTruthy = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const normalizeEmail = (value) =>
    String(value || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .toLowerCase();

const isValidEmail = (value) => {
    const email = normalizeEmail(value);
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const parseAdminAlertEmails = () => {
    const configured = String(process.env.BREVO_EMAIL_ADMIN_ALERTS || '').trim();
    const fallback = String(process.env.SUPER_ADMIN_EMAILS || '').trim();
    const raw = configured || fallback;
    if (!raw) return [];

    const unique = new Set();
    for (const value of raw.split(',')) {
        const normalized = normalizeEmail(value);
        if (isValidEmail(normalized)) unique.add(normalized);
    }

    return Array.from(unique);
};

const formatAmount = (value) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 'Rs 0.00';
    return `Rs ${amount.toFixed(2)}`;
};

const safeText = (value) => String(value || '').replace(/\s+/g, ' ').trim() || 'N/A';

const escapeHtml = (value) =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const getPaymentStatusMeta = (value) => {
    const normalized = safeText(value).toLowerCase();

    if (normalized === 'completed' || normalized === 'paid' || normalized === 'success') {
        return {
            label: 'Paid',
            emoji: '✅',
            textColor: '#1f7a44',
            bgColor: '#e6f6ee',
            borderColor: '#b9e3ca',
        };
    }

    if (normalized === 'failed' || normalized === 'failure') {
        return {
            label: 'Failed',
            emoji: '⚠️',
            textColor: '#9b1c1c',
            bgColor: '#fde8e8',
            borderColor: '#f8b4b4',
        };
    }

    return {
        label: 'Pending',
        emoji: '🟡',
        textColor: '#825d00',
        bgColor: '#fff8db',
        borderColor: '#f2dc8b',
    };
};

const renderStatusBadge = (statusMeta) =>
    `<span style="display:inline-block;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;color:${statusMeta.textColor};background:${statusMeta.bgColor};border:1px solid ${statusMeta.borderColor};">${statusMeta.emoji} ${escapeHtml(statusMeta.label)}</span>`;

const renderDetailRow = (label, value) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #e7efe9;font-weight:600;color:#2b4738;width:170px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #e7efe9;color:#1f2d24;">${value}</td></tr>`;

const buildEmailShell = ({
    previewText,
    headerEmoji,
    title,
    subtitle,
    badgeHtml,
    detailsRows,
    footerText,
}) =>
    [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        `<title>${escapeHtml(title)}</title>`,
        '</head>',
        '<body style="margin:0;padding:0;background:#f4f8f4;">',
        `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText)}</div>`,
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f4;padding:24px 12px;">',
        '<tr><td align="center">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #dbe8df;border-radius:20px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif;">',
        '<tr><td style="padding:28px;background:linear-gradient(125deg,#255c45 0%,#2f7657 60%,#f2c94c 100%);">',
        `<div style="font-size:30px;line-height:1;">${headerEmoji}</div>`,
        `<h1 style="margin:12px 0 8px;color:#ffffff;font-size:26px;line-height:1.2;">${escapeHtml(title)}</h1>`,
        `<p style="margin:0;color:#ecfff3;font-size:14px;line-height:1.5;">${escapeHtml(subtitle)}</p>`,
        '</td></tr>',
        '<tr><td style="padding:24px 24px 8px;">',
        badgeHtml,
        '</td></tr>',
        '<tr><td style="padding:12px 24px 20px;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fbfefb;border:1px solid #e3efe6;border-radius:12px;">',
        `<tbody>${detailsRows}</tbody>`,
        '</table>',
        '</td></tr>',
        '<tr><td style="padding:0 24px 24px;">',
        `<p style="margin:0;color:#3e5b4d;font-size:13px;line-height:1.6;">${escapeHtml(footerText)}</p>`,
        '</td></tr>',
        '</table>',
        '</td></tr>',
        '</table>',
        '</body>',
        '</html>',
    ].join('');

const buildCustomerOrderEmail = ({ order, customerName, totalItems }) => {
    const orderId = safeText(order?.orderId || order?._id);
    const name = safeText(customerName || order?.username || 'Customer');
    const paymentMethod = safeText(order?.paymentMethod || 'N/A');
    const paymentStatus = safeText(order?.paymentStatus || 'pending');
    const deliveryAddress = safeText(order?.deliveryAddress || 'N/A');
    const itemCount = Math.max(1, Number(totalItems || 1));
    const totalAmount = formatAmount(order?.totalAmount);
    const statusMeta = getPaymentStatusMeta(paymentStatus);

    const detailsRows = [
        renderDetailRow('Order ID', `<strong style="color:#214835;">${escapeHtml(orderId)}</strong>`),
        renderDetailRow('Items', `<strong>${itemCount}</strong>`),
        renderDetailRow('Total Payment', `<strong style="color:#255c45;">${escapeHtml(totalAmount)}</strong>`),
        renderDetailRow('Payment Method', escapeHtml(paymentMethod)),
        renderDetailRow('Payment Status', renderStatusBadge(statusMeta)),
        renderDetailRow('Delivery Address', escapeHtml(deliveryAddress)),
    ].join('');

    const confirmationBadge = [
        '<div style="display:inline-block;background:#e8f8ef;border:1px solid #bce3c9;color:#1f7a44;padding:10px 14px;border-radius:12px;font-size:14px;font-weight:700;">',
        '✅ Order Confirmed',
        '</div>',
    ].join('');

    return {
        subject: `✅ Order Confirmed - ${orderId}`,
        text: [
            `Hi ${name},`,
            '',
            `Your Fresco order ${orderId} is confirmed.`,
            `Items: ${itemCount}`,
            `Total payment: ${totalAmount}`,
            `Payment method: ${paymentMethod}`,
            `Payment status: ${paymentStatus}`,
            `Delivery address: ${deliveryAddress}`,
            '',
            'Thank you for ordering with Fresco Organics.',
        ].join('\n'),
        html: buildEmailShell({
            previewText: `Order ${orderId} confirmed with total ${totalAmount}`,
            headerEmoji: '🛍️',
            title: `Hi ${name}, your order is confirmed`,
            subtitle: 'Fresco Organics has received your order successfully.',
            badgeHtml: confirmationBadge,
            detailsRows,
            footerText: 'Thank you for ordering with Fresco Organics. We will keep you updated with the next steps.',
        }),
    };
};

const buildAdminOrderEmail = ({ order, customerName, customerEmail, customerPhone, totalItems }) => {
    const orderId = safeText(order?.orderId || order?._id);
    const name = safeText(customerName || order?.username || 'Customer');
    const email = safeText(customerEmail || 'N/A');
    const phone = safeText(customerPhone || order?.mobileNumber || 'N/A');
    const paymentMethod = safeText(order?.paymentMethod || 'N/A');
    const paymentStatus = safeText(order?.paymentStatus || 'pending');
    const itemCount = Math.max(1, Number(totalItems || 1));
    const totalAmount = formatAmount(order?.totalAmount);
    const statusMeta = getPaymentStatusMeta(paymentStatus);

    const detailsRows = [
        renderDetailRow('Order ID', `<strong style="color:#214835;">${escapeHtml(orderId)}</strong>`),
        renderDetailRow('Customer', escapeHtml(name)),
        renderDetailRow('Customer Email', escapeHtml(email)),
        renderDetailRow('Customer Phone', escapeHtml(phone)),
        renderDetailRow('Items', `<strong>${itemCount}</strong>`),
        renderDetailRow('Total Payment', `<strong style="color:#255c45;">${escapeHtml(totalAmount)}</strong>`),
        renderDetailRow('Payment Method', escapeHtml(paymentMethod)),
        renderDetailRow('Payment Status', renderStatusBadge(statusMeta)),
    ].join('');

    const alertBadge = [
        '<div style="display:inline-block;background:#fff7dd;border:1px solid #efd37a;color:#7f5d00;padding:10px 14px;border-radius:12px;font-size:14px;font-weight:700;">',
        '🚨 New Order Alert',
        '</div>',
    ].join('');

    return {
        subject: `🚨 New Order Alert - ${orderId}`,
        text: [
            'New order created in Fresco Organics.',
            '',
            `Order ID: ${orderId}`,
            `Customer: ${name}`,
            `Customer email: ${email}`,
            `Customer phone: ${phone}`,
            `Items: ${itemCount}`,
            `Total payment: ${totalAmount}`,
            `Payment method: ${paymentMethod}`,
            `Payment status: ${paymentStatus}`,
        ].join('\n'),
        html: buildEmailShell({
            previewText: `New order ${orderId} from ${name}`,
            headerEmoji: '📣',
            title: 'New Order Received',
            subtitle: 'A new order was placed and needs team visibility.',
            badgeHtml: alertBadge,
            detailsRows,
            footerText: 'Fresco admin alert: this is an automated transactional update from your order system.',
        }),
    };
};

const sendEmail = async ({ recipientEmail, recipientName, subject, textContent, htmlContent }) => {
    const apiKey = String(process.env.BREVO_API_KEY || '').trim();
    const senderEmail = normalizeEmail(process.env.BREVO_EMAIL_SENDER_EMAIL);
    const senderName = String(process.env.BREVO_EMAIL_SENDER_NAME || 'Fresco Organics').trim();

    if (!apiKey || !senderEmail || !isValidEmail(senderEmail)) {
        return { skipped: true, reason: 'Brevo email is not configured' };
    }

    const toEmail = normalizeEmail(recipientEmail);
    if (!isValidEmail(toEmail)) {
        return { skipped: true, reason: 'Invalid recipient email' };
    }

    const response = await fetch(BREVO_EMAIL_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
        },
        body: JSON.stringify({
            sender: {
                name: senderName,
                email: senderEmail,
            },
            to: [
                {
                    email: toEmail,
                    name: String(recipientName || '').trim() || undefined,
                },
            ],
            subject,
            textContent,
            htmlContent,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Brevo email API ${response.status}: ${body || 'Unknown error'}`);
    }

    const data = await response.json().catch(() => ({}));
    return { skipped: false, recipient: toEmail, data };
};

const sendOrderCreatedEmailNotifications = async ({
    order,
    customerName,
    customerEmail,
    customerPhone,
    totalItems,
}) => {
    if (!isTruthy(process.env.BREVO_EMAIL_ENABLED)) {
        return { skipped: true, reason: 'Brevo email notifications are disabled' };
    }

    const normalizedCustomerEmail = normalizeEmail(customerEmail);
    const adminEmails = parseAdminAlertEmails().filter((email) => email !== normalizedCustomerEmail);
    const tasks = [];

    if (isValidEmail(normalizedCustomerEmail)) {
        const customerTemplate = buildCustomerOrderEmail({ order, customerName, totalItems });
        tasks.push(
            sendEmail({
                recipientEmail: normalizedCustomerEmail,
                recipientName: customerName,
                subject: customerTemplate.subject,
                textContent: customerTemplate.text,
                htmlContent: customerTemplate.html,
            }).catch((error) => ({ error, target: 'customer', recipient: normalizedCustomerEmail }))
        );
    }

    const adminTemplate = buildAdminOrderEmail({
        order,
        customerName,
        customerEmail: normalizedCustomerEmail,
        customerPhone,
        totalItems,
    });

    for (const adminEmail of adminEmails) {
        tasks.push(
            sendEmail({
                recipientEmail: adminEmail,
                subject: adminTemplate.subject,
                textContent: adminTemplate.text,
                htmlContent: adminTemplate.html,
            }).catch((error) => ({ error, target: 'admin', recipient: adminEmail }))
        );
    }

    if (!tasks.length) {
        return { skipped: true, reason: 'No valid email recipients found' };
    }

    const results = await Promise.all(tasks);
    const failures = results.filter((result) => Boolean(result?.error));

    if (failures.length > 0) {
        console.error(
            'Brevo email notification failures:',
            failures.map((item) => ({
                target: item.target,
                recipient: item.recipient,
                error: item.error?.message || 'Unknown email error',
            }))
        );
    }

    return {
        skipped: false,
        sentCount: results.length - failures.length,
        failedCount: failures.length,
    };
};

module.exports = {
    sendOrderCreatedEmailNotifications,
};
