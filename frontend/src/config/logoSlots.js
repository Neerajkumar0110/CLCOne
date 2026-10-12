import horizontalLogo from '@/style/images/Horizontal-1-transparent.png';
import verticalLogo from '@/style/images/Vertical-1-transparent.png';

// Every place this app shows the company logo, as one list.
//
// Each slot is its own Setting row, so the same picture does not have to work
// everywhere at once — a wide wordmark reads well in an expanded sidebar and
// is unreadable squeezed into a collapsed one, which is why those are two
// slots rather than one. Settings > Logo renders this list and uploads to
// whichever slot you pick.
//
// `fallback` is the image bundled with the build. It is what renders until
// someone uploads their own, so a fresh install still looks right and a
// failed upload never leaves a blank header.
export const LOGO_SLOTS = [
  {
    key: 'logo_sidebar_expanded',
    label: 'Sidebar — expanded',
    description: 'The wide wordmark in the main navigation when the sidebar is open.',
    fallback: horizontalLogo,
    shape: 'wide',
  },
  {
    key: 'logo_sidebar_collapsed',
    label: 'Sidebar — collapsed',
    description: 'The small mark shown once the sidebar is collapsed to icons.',
    fallback: verticalLogo,
    shape: 'square',
  },
  {
    key: 'logo_login',
    label: 'Login page',
    description: 'Shown above the sign-in form.',
    fallback: horizontalLogo,
    shape: 'wide',
  },
  {
    key: 'logo_public',
    label: 'Public pages',
    description: 'Pages a candidate sees without signing in, such as the KYC form.',
    fallback: horizontalLogo,
    shape: 'wide',
  },
  {
    key: 'company_logo',
    label: 'Invoices & PDFs',
    description: 'Printed on invoices, offers and payment receipts.',
    fallback: horizontalLogo,
    shape: 'wide',
  },
];

export const LOGO_SLOT_KEYS = LOGO_SLOTS.map((s) => s.key);

export const logoSlot = (key) => LOGO_SLOTS.find((s) => s.key === key) || null;
