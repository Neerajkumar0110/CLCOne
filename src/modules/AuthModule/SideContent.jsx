import logo from '@/style/images/Horizontal-1-transparent.png';

// Left panel of the auth card — dark gradient + blob decorations, modeled
// on the reference login design the user asked to match. The wavy divider
// is an inline SVG bulging into the white form panel. This logo variant is
// already a light/embossed wordmark made for dark backgrounds (the same
// one the sidebar uses), so unlike career-lab-logo.png it needs no white
// chip behind it to stay legible here.
export default function SideContent() {
  return (
    <div className="auth-side">
      <div className="auth-side-glow" />
      <div className="auth-side-blob auth-side-blob-1" />
      <div className="auth-side-blob auth-side-blob-2" />
      <div className="auth-side-blob auth-side-blob-3" />
      <div className="auth-side-blob auth-side-blob-gold" />

      <svg className="auth-side-wave" viewBox="0 0 120 600" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0,0 L60,0 C110,90 10,160 70,260 C130,360 20,420 60,600 L0,600 Z" fill="currentColor" />
      </svg>

      <img src={logo} alt="Career Lab Consulting" className="auth-side-logo" />

      <div className="auth-side-copy">
        <h1>Career Lab Consulting All-in-One AI System</h1>
        <p>Leads, calls, invoicing, tickets, ad campaigns, team chat and performance — one AI-powered platform for everything your business runs on.</p>
      </div>

      <div className="auth-side-footer">CAREERLABCONSULTING.COM</div>
    </div>
  );
}
