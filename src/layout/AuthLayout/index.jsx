import React from 'react';

import StarField from '@/modules/AuthModule/StarField';

// Single centered card floating on an animated dark-blue star-field — see
// frontend/src/style/partials/login.css (.auth-page-bg / .auth-star-canvas
// / .auth-card). children is the actual page content (the login/OTP form,
// from AuthModule).
export default function AuthLayout({ children }) {
  return (
    <div className="auth-page-bg">
      <StarField />
      <div className="auth-card">{children}</div>
    </div>
  );
}
