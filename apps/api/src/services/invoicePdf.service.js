"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateInvoicePdfBuffer = generateInvoicePdfBuffer;
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

/**
 * pdfkit's built-in core-14 fonts (Helvetica etc.) are AFM/WinAnsi-encoded
 * and do NOT include U+20B9 (Rupee sign) - it silently renders a mismatched
 * glyph rather than failing loudly, which would corrupt every amount on the
 * invoice. No open-licensed Unicode font with this glyph ships with this
 * project, so this tries known-good system font locations at runtime
 * (present on this Windows dev machine, and on Linux servers with
 * fontconfig's dejavu/noto packages installed) and falls back to the
 * ASCII-safe "Rs." if none exist - correct on every platform, degrading
 * gracefully rather than corrupting.
 */
const UNICODE_REGULAR_CANDIDATES = [
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/noto/NotoSans-Regular.ttf",
];
const UNICODE_BOLD_CANDIDATES = [
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/noto/NotoSans-Bold.ttf",
];
const UNICODE_REGULAR_PATH = UNICODE_REGULAR_CANDIDATES.find((p) => fs.existsSync(p)) || null;
const UNICODE_BOLD_PATH = UNICODE_BOLD_CANDIDATES.find((p) => fs.existsSync(p)) || null;
const HAS_UNICODE_FONT = Boolean(UNICODE_REGULAR_PATH);

const RUPEE = HAS_UNICODE_FONT ? "\u20b9" : "Rs. ";
const FONT_REGULAR = HAS_UNICODE_FONT ? "Unicode" : "Helvetica";
const FONT_BOLD = HAS_UNICODE_FONT && UNICODE_BOLD_PATH ? "Unicode-Bold" : (HAS_UNICODE_FONT ? "Unicode" : "Helvetica-Bold");
const FONT_ITALIC = "Helvetica-Oblique"; // footer note only, never carries a rupee sign

// Page size matches the canonical letterhead exactly: 595.32 x 841.92 pt
// (~A4). pdfkit's y-axis is measured from the TOP of the page.
const PAGE_WIDTH = 595.32;
const PAGE_HEIGHT = 841.92;

const ASSETS_DIR = path.join(__dirname, "../assets/invoice");
const LETTERHEAD_PNG = path.join(ASSETS_DIR, "letterhead.png");
const SEAL_PNG = path.join(ASSETS_DIR, "seal.png");
const SIGNATURE_PNG = path.join(ASSETS_DIR, "signature.png");

// Seal/signature placement in the signature block, sized to sit together
// just above the "Authorized Signatory" line.
// Anchored near the very bottom of the page, just above the letterhead's
// own footer band. Measured directly off the letterhead's pixels (not
// guessed): its contact-info row starts at y=2960px of a 3508px-tall
// image, i.e. ~710pt down a 841.92pt page - so this block must clear
// well above that, not float mid-page with empty space beneath it.
const SEAL_BOX = { x: 390, y: 572, width: 80, height: 82 };
const SIGNATURE_BOX = { x: 478, y: 575, width: 70, height: 76 };

const SELLER_NAME = "LauncherDesk (DutyLaunch Solutions Private Limited)";
const PAYEE_NAME = "DutyLaunch Solutions Private Limited";

// Indian digit grouping (2,199.00 not 2199.00).
function formatAmount(amount) {
    return Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatInvoiceDate(d) {
    const dt = d ? new Date(d) : new Date();
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    return `${dd}-${mm}-${dt.getFullYear()}`;
}

function drawHeader(doc, { invoiceNumber }) {
    doc.font(FONT_BOLD).fontSize(16).fillColor("#1a1a1a");
    doc.text("Payment Invoice", 0, 130, { width: PAGE_WIDTH, align: "center" });

    doc.font(FONT_BOLD).fontSize(9.5);
    doc.text(`Sold By: ${SELLER_NAME}`, 40, 162, { width: 320 });

    // Dashed box around the invoice number.
    doc.save();
    doc.dash(1.5, { space: 1.5 }).lineWidth(0.72).rect(371.1, 155, 184, 24).stroke("#000000");
    doc.undash();
    doc.restore();
    doc.font(FONT_BOLD).fontSize(9).text("Invoice Number # ", 380, 163, { continued: true });
    doc.font(FONT_REGULAR).text(invoiceNumber, { continued: false });

    doc.rect(40, 200, PAGE_WIDTH - 80, 1.0).fill("#000000");
}

function drawBillTo(doc, { invoiceDate, organizationName, payerName, payerRole }) {
    doc.font(FONT_BOLD).fontSize(9).fillColor("#1a1a1a");
    doc.text("Invoice Date: ", 40, 215, { continued: true });
    doc.font(FONT_REGULAR).text(invoiceDate, { continued: false });

    doc.font(FONT_BOLD).text("Bill To", 320, 215);
    doc.font(FONT_BOLD).fontSize(9.5).text(organizationName, 320, 228, { width: 235 });
    if (payerName) {
        doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#444444");
        doc.text(`Paid by: ${payerName}${payerRole ? ` (${payerRole.replace(/_/g, " ")})` : ""}`, 320, 244, { width: 235 });
        doc.fillColor("#1a1a1a");
    }
}

const COLS = { description: 40, qty: 330, amountLabel: 400, amountValueRight: 555 };

function drawTableHeader(doc) {
    doc.font(FONT_BOLD).fontSize(9).fillColor("#1a1a1a");
    doc.text("Description", COLS.description, 300);
    doc.text("Qty", COLS.qty, 300);
    doc.text(`Amount (${RUPEE})`, COLS.amountLabel, 300);
    doc.rect(40, 316, PAGE_WIDTH - 80, 1.0).fill("#000000");
}

function rightText(doc, text, rightEdge, y) {
    doc.text(text, rightEdge - 150, y, { width: 150, align: "right" });
}

function drawLineItem(doc, { description, amount }, y) {
    doc.font(FONT_REGULAR).fontSize(9.5).fillColor("#1a1a1a");
    doc.text(description, COLS.description, y, { width: 270 });
    doc.text("1", COLS.qty, y);
    rightText(doc, formatAmount(amount), COLS.amountValueRight, y);
}

function drawGrandTotal(doc, amount, y) {
    doc.rect(40, y - 8, PAGE_WIDTH - 80, 1.0).fill("#000000");
    doc.font(FONT_BOLD).fontSize(11).fillColor("#1a1a1a");
    doc.text("Total Paid", COLS.qty, y + 6);
    doc.text(`${RUPEE} ${formatAmount(amount)}`, COLS.amountValueRight - 150, y + 5, { width: 150, align: "right" });
}

function drawPaymentDetails(doc, { transactionId, paymentMethod }, y) {
    doc.font(FONT_REGULAR).fontSize(8.5).fillColor("#444444");
    doc.text(`Payment Method: ${paymentMethod || "Razorpay Secure Gateway"}`, 40, y);
    doc.text(`Transaction ID: ${transactionId || "N/A"}`, 40, y + 13);
    doc.fillColor("#1a1a1a");
}

function drawSignatureBlock(doc) {
    if (fs.existsSync(SEAL_PNG)) {
        doc.image(SEAL_PNG, SEAL_BOX.x, SEAL_BOX.y, { width: SEAL_BOX.width, height: SEAL_BOX.height });
    }
    if (fs.existsSync(SIGNATURE_PNG)) {
        doc.image(SIGNATURE_PNG, SIGNATURE_BOX.x, SIGNATURE_BOX.y, { width: SIGNATURE_BOX.width, height: SIGNATURE_BOX.height });
    }
    doc.font(FONT_BOLD).fontSize(8.5).fillColor("#1a1a1a");
    doc.text(PAYEE_NAME, 390, 560, { width: 165, align: "right" });
    doc.font(FONT_REGULAR).fontSize(9);
    doc.text("Authorized Signatory", 478, 660);
}

function drawFooterNote(doc) {
    // Positioned between the payment details and the signature block -
    // the letterhead's own footer band (logo-free contact row + blue
    // banner) starts further down the page and must never be covered. A
    // generous gap is left below this note before the signature block, to
    // match the vertical rhythm of the canonical tax-invoice layout rather
    // than crowding everything into the top half of the page.
    doc.font(FONT_ITALIC).fontSize(7.5).fillColor("#444444");
    doc.text("Thank you for your business with LauncherDesk. This is a system-generated invoice for a wallet top-up / E-Stamping balance purchase - no GST is levied on this transaction.", 40, 450, { width: PAGE_WIDTH - 80 });
    doc.fillColor("#1a1a1a");
}

/**
 * Builds the invoice PDF as a Buffer, rendered on top of the exact
 * letterhead the company provided (logo, watermark, footer banner) - the
 * letterhead is drawn as the full-page background first, matching how the
 * original canonical document does it.
 *
 * `data` shape: { invoiceNumber, invoiceDate, organizationName, payerName,
 * payerRole, description, amount, transactionId, paymentMethod }
 */
function generateInvoicePdfBuffer(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
            if (HAS_UNICODE_FONT) {
                doc.registerFont("Unicode", UNICODE_REGULAR_PATH);
                if (UNICODE_BOLD_PATH)
                    doc.registerFont("Unicode-Bold", UNICODE_BOLD_PATH);
            }
            const chunks = [];
            doc.on("data", (c) => chunks.push(c));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            if (fs.existsSync(LETTERHEAD_PNG)) {
                doc.image(LETTERHEAD_PNG, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });
            }

            drawHeader(doc, data);
            drawBillTo(doc, { invoiceDate: data.invoiceDate || formatInvoiceDate(), organizationName: data.organizationName || "Client Organization", payerName: data.payerName, payerRole: data.payerRole });
            drawTableHeader(doc);
            drawLineItem(doc, { description: data.description || "Wallet Top-up & E-Stamping Balance", amount: data.amount }, 332);
            drawGrandTotal(doc, data.amount, 370);
            drawPaymentDetails(doc, { transactionId: data.transactionId, paymentMethod: data.paymentMethod }, 410);
            drawFooterNote(doc);
            drawSignatureBlock(doc);

            doc.end();
        }
        catch (err) {
            reject(err);
        }
    });
}
