import * as Location from 'expo-location';
import { CITY_CENTER, inServiceArea } from './config';

export interface Fix { lat: number; lng: number; real: boolean }

/** MODEL: device location. Falls back to central Bengaluru when GPS is denied or outside the service area
 *  (e.g. the iOS Simulator defaults to San Francisco). */
export async function getCurrentFix(): Promise<Fix> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status === 'granted') {
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (inServiceArea(p.coords.latitude, p.coords.longitude)) {
        return { lat: p.coords.latitude, lng: p.coords.longitude, real: true };
      }
    }
  } catch {}
  return { ...CITY_CENTER, real: false };
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
