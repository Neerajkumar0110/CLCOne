import useLanguage from '@/locale/useLanguage';

import AuthLayout from '@/layout/AuthLayout';
import SideContent from './SideContent';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

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
    <AuthLayout sideContent={<SideContent />}>
      <div className="auth-form-panel">
        <div className="auth-greeting">Hello !</div>
        <div className="auth-greeting-time">{getGreeting()}</div>
        <AuthTitle text={translate(AUTH_TITLE)} />

        <div className="site-layout-content">{authContent}</div>
      </div>
    </AuthLayout>
  );
};

export default AuthModule;
