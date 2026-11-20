import site from '../config/site.json' with { type: 'json' };

export function defaultCartOptions(overrides = {}) {
  return {
    locale: site.defaultLocale,
    currency: site.defaultCurrency,
    taxRate: site.taxRate,
    shipping: { ...site.shipping },
    ...overrides
  };
}
