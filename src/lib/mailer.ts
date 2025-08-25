import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST as string | undefined;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER as string | undefined;
const SMTP_PASS = process.env.SMTP_PASS as string | undefined;
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Ledgr';
const MAIL_FROM_EMAIL = process.env.MAIL_FROM_EMAIL || 'no-reply@example.com';

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  // eslint-disable-next-line no-console
  console.warn('Warning: SMTP env vars not fully set. Emails will fail until SMTP_HOST, SMTP_USER, and SMTP_PASS are provided.');
}

export const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE, // true for 465, false for other ports
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

export function renderEmail(opts: {
  title: string;
  previewText?: string;
  heading?: string;
  bodyHtml: string; // inner HTML content
  footerHtml?: string;
  brandName?: string;
}) {
  const brand = opts.brandName || MAIL_FROM_NAME || 'Ledgr';
  const preview = opts.previewText ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${opts.previewText}</span>` : '';
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${opts.title}</title>
      <style>
        body{margin:0;padding:0;background:#f6f7f9;color:#0f172a}
        .container{max-width:560px;margin:0 auto;padding:24px}
        .card{background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
        .header{padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between}
        .brand{font-size:16px;font-weight:600;color:#111827}
        .content{padding:20px}
        h1{font-size:18px;margin:0 0 8px 0;color:#111827}
        p{margin:0 0 12px 0;line-height:1.6;color:#374151}
        .btn{display:inline-block;background:#2563eb;color:#fff !important;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:600}
        .muted{color:#6b7280;font-size:12px}
        .footer{padding:14px 20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px}
        a{color:#2563eb}
      </style>
    </head>
    <body>
      ${preview}
      <div class="container">
        <div class="card">
          <div class="header">
            <div class="brand">${brand}</div>
          </div>
          <div class="content">
            ${opts.heading ? `<h1>${opts.heading}</h1>` : ''}
            ${opts.bodyHtml}
          </div>
          <div class="footer">
            ${opts.footerHtml || 'This message was sent to you by ' + brand + '.'}
          </div>
        </div>
        <div class="muted" style="text-align:center;margin-top:10px;">© ${new Date().getFullYear()} ${brand}</div>
      </div>
    </body>
  </html>`;
}

export function plainTextFromHtml(html: string): string {
  // Very basic HTML to text fallback
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sendMail(opts: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  fromName?: string;
  fromEmail?: string;
}) {
  const from = `${opts.fromName || MAIL_FROM_NAME} <${opts.fromEmail || MAIL_FROM_EMAIL}>`;
  return transporter.sendMail({
    from,
    to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
