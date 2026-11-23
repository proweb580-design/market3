import offices from './tashkent-post-offices.json';

/** A post office the buyer collects the parcel from. `index` goes into the order's postal code. */
export type PickupPoint = { id: string; name: string; address: string; index: string; lat: number; lon: number };

export const PICKUP_CITY = 'Ташкент';

/**
 * Uzbekistan Post offices in Tashkent, from OpenStreetMap (amenity=post_office inside Tashkent, couriers like
 * EMS/BTS/CDEK dropped; where an office has no postcode tag it is derived from its number: №76 → 100076).
 * shortcut: a snapshot taken in Nov 2026 — refresh it (or load points from the store's settings) when offices change.
 */
export const PICKUP_POINTS: PickupPoint[] = offices;
