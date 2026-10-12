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
    requestCreated: (data) => {
        const reqNum = escapeHtml(data.requestNumber);
        const orderNum = escapeHtml(data.orderNumber || "");
        const orgName = escapeHtml(data.organizationName || "");
        const buyerName = escapeHtml(data.buyerName || "");
        const firstParty = escapeHtml(data.firstParty || "");
        const secondParty = escapeHtml(data.secondParty || "");
        const amount = escapeHtml(data.amount ? `₹${data.amount}` : "");
        const stateCode = escapeHtml(data.stateCode || "");
        const desc = escapeHtml(data.descriptionOfDocument || "");

        return {
            subject: `E-Stamp Request ${reqNum} Created - LauncherDesk`,
            html: layout(`
              <h2 style="margin-top:0; color:#0f172a;">New E-Stamp Request Placed</h2>
              <p style="color:#475569;">E-Stamp request <b>${reqNum}</b>${orderNum ? ` (Order: <b>${orderNum}</b>)` : ""} has been created and is in the 20-minute modification and review window.</p>
              ${orgName ? `<p style="color:#475569; font-size:13px; margin: 4px 0;"><b>Organization:</b> ${orgName}${buyerName ? ` (${buyerName})` : ""}</p>` : ""}
              ${firstParty && secondParty ? `<p style="color:#475569; font-size:13px; margin: 4px 0;"><b>Parties:</b> ${firstParty} & ${secondParty}</p>` : ""}
              ${stateCode ? `<p style="color:#475569; font-size:13px; margin: 4px 0;"><b>State:</b> ${stateCode}</p>` : ""}
              ${desc ? `<p style="color:#475569; font-size:13px; margin: 4px 0;"><b>Document Description:</b> ${desc}</p>` : ""}
              ${amount ? `<p style="color:#0f172a; font-size:14px; font-weight:600; margin: 8px 0;"><b>Total Amount:</b> ${amount}</p>` : ""}
              <div style="background-color:#f1f5f9; padding:12px; border-radius:8px; margin-top:14px; font-size:12px; color:#475569;">
                <b>Note:</b> You can modify details within 20 minutes. After 20 minutes of review and verification, the reserved wallet balance will automatically be charged and processing completed.
              </div>
            `),
        };
    },
    orderPlaced: (data) => {
        const orderNum = escapeHtml(data.orderNumber || "");
        const reqNum = escapeHtml(data.requestNumber || "");
        const orgName = escapeHtml(data.organizationName || "");
        const buyerName = escapeHtml(data.buyerName || "");
        const firstParty = escapeHtml(data.firstParty || "");
        const secondParty = escapeHtml(data.secondParty || "");
        const amount = escapeHtml(data.amount ? `₹${data.amount}` : "");
        const stateCode = escapeHtml(data.stateCode || "");
        const desc = escapeHtml(data.descriptionOfDocument || "");

        return {
            subject: `New E-Stamp Order ${orderNum || reqNum} Placed - ${orgName}`,
            html: layout(`
              <h2 style="margin-top:0; color:#0f172a;">E-Stamp Order Notification</h2>
              <p style="color:#475569;">A new E-Stamp order has been placed on LauncherDesk.</p>
              <table style="width:100%; border-collapse:collapse; margin-top:12px; font-size:13px;">
                <tr><td style="padding:6px 0; color:#64748b; width:40%;">Order Number:</td><td style="padding:6px 0; font-weight:600; color:#0f172a;">${orderNum || "N/A"}</td></tr>
                <tr><td style="padding:6px 0; color:#64748b;">Request Number:</td><td style="padding:6px 0; font-weight:600; color:#0f172a;">${reqNum}</td></tr>
                <tr><td style="padding:6px 0; color:#64748b;">Organization:</td><td style="padding:6px 0; font-weight:600; color:#0f172a;">${orgName}</td></tr>
                <tr><td style="padding:6px 0; color:#64748b;">Ordered By:</td><td style="padding:6px 0; font-weight:600; color:#0f172a;">${buyerName}</td></tr>
                <tr><td style="padding:6px 0; color:#64748b;">Parties:</td><td style="padding:6px 0; color:#0f172a;">${firstParty} & ${secondParty}</td></tr>
                <tr><td style="padding:6px 0; color:#64748b;">State:</td><td style="padding:6px 0; color:#0f172a;">${stateCode}</td></tr>
                <tr><td style="padding:6px 0; color:#64748b;">Document:</td><td style="padding:6px 0; color:#0f172a;">${desc}</td></tr>
                <tr><td style="padding:6px 0; color:#64748b;">Total Amount:</td><td style="padding:6px 0; font-weight:bold; color:#0f172a;">${amount}</td></tr>
              </table>
              <div style="background-color:#eff6ff; border:1px solid #bfdbfe; padding:12px; border-radius:8px; margin-top:16px; font-size:12px; color:#1e40af;">
                <b>Admin Action:</b> You can view this order and verify the documents to ensure all details and attachments are correct.
              </div>
            `),
        };
    },
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
    paymentSuccess: (data) => {
        const orgName = escapeHtml(data.organizationName || "Your Organization");
        const customerName = escapeHtml(data.customerName || "Valued Customer");
        const plan = escapeHtml(data.plan || "E-Stamp Package / Balance Top-up");
        const amount = escapeHtml(data.amount);
        const txId = escapeHtml(data.transactionId || "N/A");
        const invoiceNum = escapeHtml(data.invoiceNumber || "N/A");
        const date = escapeHtml(data.purchaseDate || new Date().toLocaleDateString("en-IN"));
        const resetPasswordUrl = escapeHtml(data.resetPasswordUrl || "#");
        const portalUrl = escapeHtml(data.portalUrl || "#");

        return {
            subject: `Purchase Confirmation: ${plan} - LauncherDesk E-Stamp`,
            html: layout(`
                <div style="padding: 4px 0;">
                  <h2 style="margin-top:0; color:#0f172a; font-size:20px;">Thank You for Your Purchase!</h2>
                  <p style="font-size:14px; color:#475569; line-height:1.5;">
                    Dear <b>${customerName}</b>, we have successfully received your payment for <b>${orgName}</b>. Your package is active and ready in your portal.
                  </p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; margin: 18px 0; font-size:13px;">
                    <tr>
                      <td style="padding:10px 14px; color:#64748b; border-bottom:1px solid #f1f5f9;">Organization:</td>
                      <td style="padding:10px 14px; font-weight:600; color:#0f172a; text-align:right; border-bottom:1px solid #f1f5f9;">${orgName}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px; color:#64748b; border-bottom:1px solid #f1f5f9;">Plan / Package:</td>
                      <td style="padding:10px 14px; font-weight:600; color:#0f172a; text-align:right; border-bottom:1px solid #f1f5f9;">${plan}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px; color:#64748b; border-bottom:1px solid #f1f5f9;">Amount Paid:</td>
                      <td style="padding:10px 14px; font-weight:700; color:#15803d; text-align:right; border-bottom:1px solid #f1f5f9;">&#8377;${amount}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px; color:#64748b; border-bottom:1px solid #f1f5f9;">Transaction ID:</td>
                      <td style="padding:10px 14px; font-family:monospace; color:#334155; text-align:right; border-bottom:1px solid #f1f5f9;">${txId}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px; color:#64748b; border-bottom:1px solid #f1f5f9;">Invoice Number:</td>
                      <td style="padding:10px 14px; font-family:monospace; font-weight:600; color:#2563eb; text-align:right; border-bottom:1px solid #f1f5f9;">${invoiceNum}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px; color:#64748b;">Purchase Date:</td>
                      <td style="padding:10px 14px; color:#334155; text-align:right;">${date}</td>
                    </tr>
                  </table>

                  <div style="margin: 20px 0; text-align:center;">
                    <a href="${portalUrl}" style="display:block; padding:12px 18px; margin-bottom:10px; background-color:#2563eb; color:#ffffff; text-decoration:none; font-size:14px; font-weight:600; border-radius:8px; text-align:center;">
                      🚀 Open E-Stamp Portal
                    </a>
                    <a href="${resetPasswordUrl}" style="display:block; padding:10px 18px; background-color:#f1f5f9; color:#334155; text-decoration:none; font-size:13px; font-weight:600; border-radius:8px; border:1px solid #cbd5e1; text-align:center;">
                      🔒 Reset Password
                    </a>
                  </div>

                  <p style="font-size:11px; color:#94a3b8; text-align:center; margin-bottom:16px;">
                    The password reset link is time-limited and valid for single use.
                  </p>

                  <div style="border-top:1px solid #f1f5f9; padding-top:12px; font-size:12px; color:#64748b;">
                    Need help? Contact support at <a href="mailto:support@launcherdesk.com" style="color:#2563eb;">support@launcherdesk.com</a>.
                  </div>
                </div>
            `),
        };
    },
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
    // Vendor account welcome. Never contains a password: the vendor sets one
    // through "Forgot password" with this email address.
    vendorWelcome: (data) => ({
        subject: "Your LauncherDesk vendor account",
        html: layout(`
      <h2 style="margin-top:0;">Welcome${data.name ? `, ${escapeHtml(data.name)}` : ""}</h2>
      <p>A LauncherDesk vendor account has been created for this email address.</p>
      <p>To sign in, open the LauncherDesk login page, choose <b>Forgot password</b> and enter this email address to set your password. You will then sign in with a one-time code sent to this email.</p>
    `),
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
