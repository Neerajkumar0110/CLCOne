import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectCurrentSettings } from '@/redux/settings/selectors';
import { BASE_URL } from '@/config/serverApiConfig';
import { logoSlot } from '@/config/logoSlots';
import { request } from '@/request';

// The sidebar logo uploaded in Settings > Logo, for every panel.
//
// The CRM shell loads all settings into redux (ErpApp), so there the value is
// read from the store, same as useBrandLogo. The LMS panel (Student /
// Project Manager) never loads settings, so there the two sidebar slots are
// fetched once — only those keys, nothing else from settings — and shared by
// every caller. Until an upload exists (or while it loads) the bundled logo
// renders, so the sidebar is never blank.

const KEYS = ['logo_sidebar_expanded', 'logo_sidebar_collapsed'];
let fetched = null; // { key: value }
let pending = null;

const toUrl = (v) => (!v ? null : /^https?:\/\//i.test(v) ? v : BASE_URL + v);

function fetchSlots() {
  if (fetched) return Promise.resolve(fetched);
  if (!pending) {
    pending = request
      .get({ entity: `setting/listBySettingKey?settingKeyArray=${KEYS.join(',')}` })
      .then((r) => {
        const out = {};
        ((r && r.result) || []).forEach((row) => {
          if (row && row.settingKey) out[row.settingKey] = row.settingValue;
        });
        fetched = out;
        return out;
      })
      .catch(() => {
        pending = null;
        return {};
      });
  }
  return pending;
}

export default function useSidebarLogo(slotKey = 'logo_sidebar_expanded') {
  const settings = useSelector(selectCurrentSettings) || {};
  let fromStore = null;
  for (const group of Object.values(settings)) {
    if (group && typeof group === 'object' && group[slotKey]) {
      fromStore = group[slotKey];
      break;
    }
  }
  const [value, setValue] = useState(fetched ? fetched[slotKey] : null);
  useEffect(() => {
    if (fromStore) return undefined;
    let alive = true;
    fetchSlots().then((m) => alive && setValue(m[slotKey] || null));
    return () => {
      alive = false;
    };
  }, [fromStore, slotKey]);
  const slot = logoSlot(slotKey);
  return toUrl(fromStore || value) || (slot ? slot.fallback : null);
}
