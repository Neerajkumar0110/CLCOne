import { useSelector } from 'react-redux';
import { selectCurrentSettings } from '@/redux/settings/selectors';
import { logoSlot, resolveLogoUrl } from '@/config/logoSlots';
import { useTheme } from '@/context/themeContext';

// The image URL for one logo slot (see config/logoSlots.js).
//
// Falls back to the bundled image whenever there is no uploaded one — on a
// fresh install, before settings have loaded, and if the setting row is
// missing. A header with no logo looks broken, so there is always something
// to render.
//
// Settings store a server-relative path ("public/uploads/setting/..."), which
// is why BASE_URL goes in front; an absolute URL someone pasted in is passed
// through untouched.
export default function useBrandLogo(slotKey) {
  const settings = useSelector(selectCurrentSettings) || {};
  const { isDark } = useTheme();
  const slot = logoSlot(slotKey);

  // The bundled fallbacks are LIGHT-toned wordmarks (silver text) — they read
  // well on the dark sidebar and dark hero panels but vanish on white surfaces
  // like the login card. Slots that can land on a light surface therefore also
  // carry a `fallbackOnLight` (the dark-text variant), picked by theme here.
  const fallback = slot ? (isDark || !slot.fallbackOnLight ? slot.fallback : slot.fallbackOnLight) : null;

  // Settings arrive grouped by category (company_settings, app_settings, …),
  // and which category a slot lands in is a seeding detail this hook should
  // not have to know — so look through them all for the key.
  let value = null;
  for (const group of Object.values(settings)) {
    if (group && typeof group === 'object' && group[slotKey] && typeof group[slotKey] === 'string' && group[slotKey].trim() !== '') {
      value = group[slotKey];
      break;
    }
  }

  return resolveLogoUrl(value, fallback);
}
