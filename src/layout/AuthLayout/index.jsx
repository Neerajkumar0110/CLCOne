import React from 'react';

// Centered floating card on a gradient page background — see
// frontend/src/style/partials/login.css (.auth-page-bg / .auth-card / ...)
// for the visual design. sideContent is the gradient/blob left panel
// (modules/AuthModule/SideContent.jsx); children is the actual page content
// (the login/OTP/forgot-password form, from AuthModule).
export default function AuthLayout({ sideContent, children }) {
  return (
    <div className="auth-page-bg">
      <div className="auth-page-blob auth-page-blob-1" />
      <div className="auth-page-blob auth-page-blob-2" />
      <div className="auth-page-blob auth-page-blob-3" />
      <div className="auth-card">
        <div className="auth-card-side">{sideContent}</div>
        <div className="auth-card-main">{children}</div>
      </div>
    </div>
  );
}
