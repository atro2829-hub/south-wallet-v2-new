// =====================================================================
// static-sections.ts — Shared section definitions for South Wallet
// =====================================================================

export interface StaticSection {
  id: string;
  label: string;
  iconKey: string;
  screenType: string;
  isUtility?: boolean;
}

export const STATIC_SECTIONS: StaticSection[] = [
  // ─── Wallet utilities (direct-action, not catalog sections) ───
  { id: 'transfer', label: 'تحويل الاموال', iconKey: 'transfer', screenType: 'wallet-transfer', isUtility: true },
  { id: 'deposit', label: 'إيداع', iconKey: 'deposit', screenType: 'deposit', isUtility: true },
  { id: 'support', label: 'الدعم', iconKey: 'support', screenType: 'support', isUtility: true },
  // ─── Main catalog sections ───
  { id: 'recharge', label: 'شحن رصيد', iconKey: 'recharge', screenType: 'recharge' },
  { id: 'entertainment', label: 'الخدمات الترفيهية', iconKey: 'entertainment', screenType: 'entertainment' },
  { id: 'usdt', label: 'USDT', iconKey: 'usdt', screenType: 'deposit' },
  { id: 'escrow', label: 'وسيط وضمان', iconKey: 'escrow', screenType: 'escrow' },
  { id: 'investment', label: 'استثمار', iconKey: 'investment', screenType: 'investment' },
  { id: 'exchange', label: 'صرافة', iconKey: 'exchange', screenType: 'exchange' },
];

// Map screenType to section type
function sectionTypeForScreen(screenType: string): string {
  const map: Record<string, string> = {
    'wallet-transfer': 'manual',
    'deposit': 'manual',
    'support': 'manual',
    'recharge': 'manual',
    'entertainment': 'entertainment',
    'exchange': 'exchange',
    'escrow': 'escrow',
    'investment': 'investment',
  };
  return map[screenType] || 'manual';
}

/**
 * Build the `fbSections` store map from STATIC_SECTIONS.
 */
export function buildFbSectionsFromStatic(): Record<string, any> {
  const result: Record<string, any> = {};
  STATIC_SECTIONS.forEach((s, i) => {
    result[s.id] = {
      id: s.id,
      name: s.label,
      name_en: s.id,
      description: '',
      icon: s.iconKey,
      color: '#5C1A1B',
      image_url: '',
      sort_order: i,
      is_active: true,
      is_visible: true,
      type: sectionTypeForScreen(s.screenType),
      screen_type: s.screenType,
      api_provider_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
  return result;
}

// Entertainment sub-sections
export const ENTERTAINMENT_SUB_SECTIONS = [
  { id: 'games', label: 'الألعاب', iconKey: 'games', screenType: 'games' },
  { id: 'gift-cards', label: 'بطاقات وأكواد', iconKey: 'gift-cards', screenType: 'gift-cards' },
  { id: 'favorites', label: 'المفضلة', iconKey: 'favorites', screenType: 'favorites' },
];
