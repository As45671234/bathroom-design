/**
 * The one physical salon.
 *
 * These values were previously duplicated as string literals across the
 * footer, the header, the homepage and the admin defaults — and drifted:
 * several of them defaulted to "г. Алматы" and "ПН – СБ, 09:00 – 18:00",
 * describing a branch that does not exist. Once the owner entered the real
 * Astana phone and city in the admin, the footer rendered the same number
 * twice under two different city headings.
 *
 * Search engines read a site's name/address/phone as one signal and treat
 * inconsistency between pages (and against the 2GIS / Yandex listings) as a
 * reason to trust it less, so these must agree everywhere.
 *
 * Phone, e-mail and address remain admin-editable through SiteSettings;
 * what follows is only what the site falls back to before those load, and
 * the hours/address that are not in the admin at all.
 */
export const SALON = {
  city: 'Астана',
  address: 'ЖК Sezim Qala, Baqyt, ул. Розы Баглановой, 2',
  phone: '+7 702 377 83 31',
  email: 'info@bathroomdesign.kz',
  hoursShort: 'Ежедневно, 10:00 – 18:00',
  hoursFull: 'Ежедневно, 10:00 – 18:00 (обед 13:00 – 14:00)',
} as const;
