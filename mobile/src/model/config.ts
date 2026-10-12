import Constants from 'expo-constants';

// On a physical iPhone the API must be reachable on the Mac's LAN IP. Expo's dev server host is exactly that,
// so we reuse it. Override with EXPO_PUBLIC_API_URL when needed.
function devHost(): string {
  const uri = Constants.expoConfig?.hostUri;
  return uri ? uri.split(':')[0] : 'localhost';
}

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost()}:8000`;
export const WS_URL: string = API_URL.replace(/^http/, 'ws') + '/ws';

// Bengaluru service area: [minLat, minLng, maxLat, maxLng]
export const SERVICE_AREA = { minLat: 12.7, minLng: 77.3, maxLat: 13.3, maxLng: 77.9 };
export const CITY_CENTER = { lat: 12.9716, lng: 77.5946 };

export const inServiceArea = (lat: number, lng: number) =>
  lat >= SERVICE_AREA.minLat && lat <= SERVICE_AREA.maxLat && lng >= SERVICE_AREA.minLng && lng <= SERVICE_AREA.maxLng;

export const POPULAR_PLACES = [
  { name: 'Indiranagar', address: 'Indiranagar, Bengaluru', lat: 12.9784, lng: 77.6408 },
  { name: 'Koramangala', address: 'Koramangala 5th Block, Bengaluru', lat: 12.9352, lng: 77.6245 },
  { name: 'MG Road Metro', address: 'MG Road Metro Station, Bengaluru', lat: 12.9756, lng: 77.6068 },
  { name: 'Whitefield (ITPL)', address: 'ITPL, Whitefield, Bengaluru', lat: 12.9858, lng: 77.737 },
  { name: 'Kempegowda Airport', address: 'Kempegowda International Airport', lat: 13.1986, lng: 77.7066 },
  { name: 'Electronic City', address: 'Electronic City Phase 1, Bengaluru', lat: 12.8452, lng: 77.6602 },
];
