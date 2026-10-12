export const rupees = (paise: number | null | undefined) => {
  const v = (paise ?? 0) / 100;
  return '₹' + (Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(2));
};

export const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

export const mins = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const txnLabel: Record<string, string> = {
  topup: 'Added to wallet', ride_charge: 'Ride payment', ride_payout: 'Ride earnings', commission: 'Platform fee (cash trip)',
  refund: 'Refund', bonus: 'Welcome bonus', cancel_fee: 'Cancellation fee',
};

export const statusText: Record<string, string> = {
  MATCHING: 'Finding your rider', ACCEPTED: 'Rider is on the way', ARRIVING: 'Rider is arriving',
  ARRIVED: 'Rider has arrived', IN_PROGRESS: 'On trip', COMPLETED: 'Trip completed',
  CANCELLED: 'Cancelled', NO_DRIVERS: 'No riders found',
};
