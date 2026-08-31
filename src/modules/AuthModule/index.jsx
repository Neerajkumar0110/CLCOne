import useLanguage from '@/locale/useLanguage';

import AuthLayout from '@/layout/AuthLayout';
// Transparent PNG with a light wordmark — sits on the dark liquid-glass
// card with no white box behind it.
import logo from '@/style/images/Horizontal-1-transparent.png';

// AUTH_TITLE is a short phrase like "Sign in" or "Enter your code" — split
// on the first word so it renders two-tone like the reference design
// ("Login" in accent, "Your Account" in dark), without every caller having
// to pass pre-split text.
function AuthTitle({ text }) {
  const [first, ...rest] = text.split(' ');
  return (
    <h2 className="auth-title">
      <span className="auth-title-accent">{first}</span>
      {rest.length > 0 && ` ${rest.join(' ')}`}
    </h2>
  );
}

const AuthModule = ({ authContent, AUTH_TITLE }) => {
  const translate = useLanguage();
  return (
    <AuthLayout>
      <div className="auth-form-panel">
        <img src={logo} alt="Career Lab Consulting" className="auth-logo" />
        <AuthTitle text={translate(AUTH_TITLE)} />

        <div className="site-layout-content">{authContent}</div>
      </div>
    </AuthLayout>
  );
};

export default AuthModule;
