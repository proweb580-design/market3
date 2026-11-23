/** A post office the buyer collects the parcel from. `index` goes into the order's postal code. */
export type PickupPoint = { id: string; name: string; district: string; index: string };

export const PICKUP_CITY = 'Ташкент';

/**
 * Tashkent post offices offered as pickup points (Uzbekistan Post).
 * shortcut: hand-written demo list, one office per district; check names and indices against pochta.uz
 * (or move it into the store's settings) before taking real orders.
 */
export const PICKUP_POINTS: PickupPoint[] = [
  { id: 'tash-100000', name: 'Главпочтамт', district: 'Мирабадский район', index: '100000' },
  { id: 'tash-100084', name: 'Почтовое отделение 100084', district: 'Юнусабадский район', index: '100084' },
  { id: 'tash-100170', name: 'Почтовое отделение 100170', district: 'Мирзо-Улугбекский район', index: '100170' },
  { id: 'tash-100115', name: 'Почтовое отделение 100115', district: 'Чиланзарский район', index: '100115' },
  { id: 'tash-100100', name: 'Почтовое отделение 100100', district: 'Яккасарайский район', index: '100100' },
  { id: 'tash-100011', name: 'Почтовое отделение 100011', district: 'Шайхантахурский район', index: '100011' },
  { id: 'tash-100140', name: 'Почтовое отделение 100140', district: 'Алмазарский район', index: '100140' },
  { id: 'tash-100022', name: 'Почтовое отделение 100022', district: 'Яшнабадский район', index: '100022' },
  { id: 'tash-100124', name: 'Почтовое отделение 100124', district: 'Учтепинский район', index: '100124' },
  { id: 'tash-100109', name: 'Почтовое отделение 100109', district: 'Сергелийский район', index: '100109' },
];
