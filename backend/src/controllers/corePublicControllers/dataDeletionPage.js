// Public "User Data Deletion" instructions page. Meta requires one (App
// Settings -> Basic -> Data Deletion Instructions URL) before a Facebook app
// can be switched to Live. Static on purpose — no data is read or written.

const CONTACT_EMAIL = 'info@careerlabconsulting.com';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data Deletion — Career Lab Consulting</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #f6f7f9; color: #1c2430; }
  main { max-width: 720px; margin: 0 auto; padding: 40px 16px 64px; }
  .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 12px; padding: 28px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h2 { font-size: 18px; margin: 28px 0 8px; }
  p, li { color: #3a4552; }
  a { color: #1a5fd0; }
  .muted { color: #6b7684; font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f141a; color: #e6eaef; }
    .card { background: #161d25; border-color: #26303b; }
    p, li { color: #c3cbd4; }
    a { color: #7fb0ff; }
  }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>User Data Deletion</h1>
    <p class="muted">Career Lab Consulting · CLC One</p>

    <p>CLC One uses Facebook Login and Facebook Lead Ads only to receive the details you submit in our lead forms (such as name, email and phone number) so our team can contact you. You can ask us to delete this data at any time.</p>

    <h2>How to request deletion</h2>
    <ol>
      <li>Email <a href="mailto:${CONTACT_EMAIL}?subject=Data%20Deletion%20Request">${CONTACT_EMAIL}</a> with the subject <strong>“Data Deletion Request”</strong>.</li>
      <li>Include the name, email address and/or phone number you used in the form, so we can find your record.</li>
      <li>We will delete your data from our systems within 30 days and confirm by email.</li>
    </ol>

    <h2>Remove the app from Facebook</h2>
    <p>You can also remove our app’s access yourself: on Facebook go to <strong>Settings &amp; privacy → Settings → Apps and websites</strong>, find <strong>CLC One</strong> and choose <strong>Remove</strong>.</p>

    <p class="muted" style="margin-top:28px">Privacy policy: <a href="https://www.careerlabconsulting.com/privacy-policy">careerlabconsulting.com/privacy-policy</a></p>
  </div>
</main>
</body>
</html>`;

function renderDataDeletionPage(req, res) {
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
}

module.exports = { renderDataDeletionPage };
