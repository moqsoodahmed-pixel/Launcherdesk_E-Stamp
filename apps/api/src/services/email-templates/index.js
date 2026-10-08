"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplate = renderTemplate;
// Centralized email templates - the ONLY place HTML for outbound email is
// authored. Controllers/services never build HTML strings themselves; they
// call EmailService.send<X> (see email.service.js), which renders one of
// these and hands it to the provider abstraction.
//
// Dynamic values are always escaped before interpolation - nothing here
// ever unsafely inlines untrusted content (a party name, a description, an
// organization name, etc. could otherwise inject markup into the email).
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function layout(bodyHtml) {
    return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
      <div style="padding: 24px 0 8px;">
        <span style="font-size: 18px; font-weight: 600; color: #0f172a;">LauncherDesk</span>
        <span style="font-size: 13px; color: #64748b;"> &nbsp;E-Stamping Platform</span>
      </div>
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:24px;">
        ${bodyHtml}
      </div>
      <p style="font-size:12px; color:#94a3b8; margin-top:16px;">
        This is an automated message from LauncherDesk E-Stamping. If you did not expect this email, you can safely ignore it.
      </p>
    </div>
  `;
}
const TEMPLATES = {
    otp: (data) => ({
        subject: `Your LauncherDesk ${escapeHtml(data.purpose || "login")} OTP`,
        html: layout(`
      <h2 style="margin-top:0;">Verification code</h2>
      <p>Your ${escapeHtml(data.purpose || "login")} verification code is:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color:#0f172a;">${escapeHtml(data.code)}</p>
      <p>This code expires shortly and can only be used once. Do not share it with anyone.</p>
    `),
    }),
    requestCreated: (data) => ({
        subject: `E-Stamp request ${data.requestNumber} created`,
        html: layout(`
      <h2 style="margin-top:0;">Request created</h2>
      <p>Your E-Stamp request <b>${escapeHtml(data.requestNumber)}</b> has been created and is in the 20-minute modification window.</p>
    `),
    }),
    requestStatus: (data) => ({
        subject: `E-Stamp request ${data.requestNumber} status update`,
        html: layout(`<p>Your request <b>${escapeHtml(data.requestNumber)}</b> status changed to <b>${escapeHtml(data.status)}</b>.</p>`),
    }),
    orderIssued: (data) => ({
        subject: `E-Stamp issued for order ${data.orderNumber}`,
        html: layout(`
      <h2 style="margin-top:0;">E-Stamp issued</h2>
      <p>Your E-Stamp for order <b>${escapeHtml(data.orderNumber)}</b> has been issued by the provider.</p>
      <p>You will be notified separately once the certificate document is available to download.</p>
    `),
    }),
    orderFailed: (data) => ({
        subject: `E-Stamp processing failed for order ${data.orderNumber}`,
        html: layout(`
      <h2 style="margin-top:0;">Processing failed</h2>
      <p>E-Stamp processing for order <b>${escapeHtml(data.orderNumber)}</b> could not be completed.</p>
      ${data.reason ? `<p style="color:#b91c1c;">Reason: ${escapeHtml(data.reason)}</p>` : ""}
      <p>Please contact support if you need assistance.</p>
    `),
    }),
    certificateAvailable: (data) => ({
        subject: `E-Stamp ready for order ${data.orderNumber}`,
        html: layout(`<p>Your E-Stamp certificate for order <b>${escapeHtml(data.orderNumber)}</b> is ready to download.</p>`),
    }),
    certificateDownloaded: (data) => ({
        subject: `E-Stamp downloaded: ${data.orderNumber}`,
        html: layout(`<p>Your E-Stamp for order <b>${escapeHtml(data.orderNumber)}</b> was downloaded.</p>`),
    }),
    paymentSuccess: (data) => ({
        subject: "Payment successful",
        html: layout(`
      <h2 style="margin-top:0;">Payment successful</h2>
      <p>Your payment of <b>&#8377;${escapeHtml(data.amount)}</b> was successful and your wallet has been credited.</p>
    `),
    }),
    paymentFailed: (data) => ({
        subject: "Payment failed",
        html: layout(`
      <h2 style="margin-top:0;">Payment failed</h2>
      <p>Your payment attempt of <b>&#8377;${escapeHtml(data.amount)}</b> could not be completed. Your wallet has not been charged.</p>
    `),
    }),
    securityAlert: (data) => ({
        subject: "Security alert - LauncherDesk",
        html: layout(`<p>${escapeHtml(data.message)}</p>`),
    }),
    assistantActivity: (data) => ({
        subject: "Assistant Master Admin activity",
        html: layout(`<p>${escapeHtml(data.message)}</p>`),
    }),
};
function renderTemplate(name, data) {
    const template = TEMPLATES[name];
    if (!template)
        throw new Error(`Unknown email template: ${name}`);
    return template(data || {});
}
