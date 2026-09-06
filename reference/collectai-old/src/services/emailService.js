// ============================================
// CollectAI — Email Service (Nodemailer)
// ============================================

const nodemailer = require('nodemailer');

let transporter;

/**
 * Initialize the email transporter.
 * Uses SMTP credentials from environment variables.
 * For MVP/testing, use Ethereal (https://ethereal.email).
 */
function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('⚠️  SMTP credentials not configured. Email sending will be simulated.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  console.log(`✅ Email transporter initialized (${host}:${port})`);
  return transporter;
}

/**
 * Send a follow-up email to a client about an overdue invoice.
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Email body (plain text)
 * @param {string} options.htmlBody - Email body (HTML, optional)
 * @returns {Object} { success: boolean, messageId?: string, error?: string, previewUrl?: string }
 */
async function sendFollowUpEmail({ to, subject, body, htmlBody }) {
  const transport = getTransporter();

  if (!transport) {
    // Simulate sending when SMTP is not configured
    console.log(`📧 [SIMULATED] Email to ${to}: ${subject}`);
    console.log(`   Body: ${body.substring(0, 100)}...`);
    return {
      success: true,
      messageId: `simulated-${Date.now()}`,
      simulated: true
    };
  }

  try {
    const fromName = process.env.SMTP_FROM_NAME || 'CollectAI';
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

    const info = await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text: body,
      html: htmlBody || body.replace(/\n/g, '<br>')
    });

    console.log(`✅ Email sent to ${to} — Message ID: ${info.messageId}`);

    // If using Ethereal, provide the preview URL
    let previewUrl;
    if (process.env.SMTP_HOST === 'smtp.ethereal.email') {
      previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`   Preview: ${previewUrl}`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl
    };
  } catch (error) {
    console.error(`❌ Email send failed to ${to}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send an escalation alert to the business owner.
 * @param {Object} options
 * @param {string} options.ownerEmail - Business owner's email
 * @param {string} options.invoiceId - Invoice ID
 * @param {string} options.clientName - Client name
 * @param {number} options.amount - Invoice amount
 * @param {string} options.currency - Currency code
 * @param {number} options.daysOverdue - Days overdue
 * @param {string} options.reasoning - AI reasoning for escalation
 */
async function sendOwnerEscalation({ ownerEmail, invoiceId, clientName, amount, currency, daysOverdue, reasoning }) {
  const subject = `⚠️ CollectAI Alert: Invoice ${invoiceId} requires your attention`;
  const body = `Hi,

CollectAI has escalated the following invoice to you because automated follow-ups have not resulted in payment:

📄 Invoice: ${invoiceId}
👤 Client: ${clientName}
💰 Amount: ${currency} ${amount.toLocaleString('en-IN')}
📅 Days Overdue: ${daysOverdue}

🤖 AI Reasoning:
${reasoning}

We recommend reaching out to the client directly or considering alternative collection methods.

— CollectAI Agent`;

  return sendFollowUpEmail({
    to: ownerEmail,
    subject,
    body
  });
}

module.exports = { sendFollowUpEmail, sendOwnerEscalation, getTransporter };
