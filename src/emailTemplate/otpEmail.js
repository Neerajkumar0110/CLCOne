// Branded HTML for the login-OTP email. Table-based layout + inline styles
// throughout on purpose — that's what actually renders consistently across
// Gmail/Outlook/Apple Mail, unlike flexbox/grid or a linked stylesheet.
exports.otpEmail = ({ name = '', otp, brand = 'Career Lab Consulting', minutes = 10 }) => {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your login code</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your ${brand} login code — expires in ${minutes} minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 18px rgba(16,24,40,0.07);">
            <tr>
              <td style="background:linear-gradient(135deg,#2563eb,#4f8cff);padding:28px 32px;">
                <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.2px;">${brand}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px;">
                <p style="margin:0 0 4px;font-size:14px;color:#667085;">Hi${name ? ' ' + name : ''},</p>
                <h1 style="margin:0 0 20px;font-size:20px;line-height:1.4;color:#101828;font-weight:700;">Here's your login code</h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#344054;">
                  Enter this code to finish signing in to your ${brand} CRM account.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="background-color:#eef4ff;border:1.5px solid #dbe4f3;border-radius:12px;padding:18px 0;">
                      <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#2563eb;font-family:'Courier New',Courier,monospace;">${otp}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 8px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#667085;">
                  This code expires in <strong style="color:#344054;">${minutes} minutes</strong>. Don't share it with anyone — ${brand} will never ask you for it.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px;">
                <p style="margin:0;font-size:12.5px;line-height:1.6;color:#98a2b3;">
                  If you didn't try to sign in, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background-color:#f8f9fc;border-top:1px solid #e7eaf0;">
                <p style="margin:0;font-size:11.5px;color:#98a2b3;">© ${new Date().getFullYear()} ${brand}. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `;
};
