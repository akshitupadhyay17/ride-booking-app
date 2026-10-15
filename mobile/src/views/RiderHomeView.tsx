import React from 'react';
import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RiderHomePresenter } from '../presenters/RiderHomePresenter';
import { km, mins, rupees, statusText } from '../model/format';
import {
  Avatar, Button, Card, ErrorText, IconButton, MapCanvas, NoticeText, PinMarker, Pill, Pulse, Row, Sheet, Stars,
  VehicleIcon, VehicleMarker, route,
} from './components';
import { colors, font, radius } from './theme';
import { usePresenterState } from './usePresenter';

const TAGS = ['Polite', 'Safe riding', 'On time', 'Clean vehicle'];

interface Props {
  presenter: RiderHomePresenter;
  onSwitchMode?: (mode: 'rider' | 'driver') => void;
}

export function RiderHomeView({ presenter: p, onSwitchMode }: Props) {
  const s = usePresenterState(p);
  const insets = useSafeAreaInsets();

  if (s.stage === 'search') return <SearchOverlay p={p} s={s} />;

  const quoteRoute = s.stage === 'quote' ? s.quote?.polyline : s.ride?.polyline;
  const fit = (() => {
    if (s.stage === 'quote' && s.quote?.polyline?.length)
      return s.quote.polyline.map(([latitude, longitude]) => ({ latitude, longitude }));
    if (s.stage === 'active' && s.ride) {
      const pts = [{ latitude: s.ride.pickup.lat, longitude: s.ride.pickup.lng }, { latitude: s.ride.drop.lat, longitude: s.ride.drop.lng }];
      if (s.driverPos) pts.push({ latitude: s.driverPos.lat, longitude: s.driverPos.lng });
      return pts;
    }
    return undefined;
  })();

  return (
    <View style={{ flex: 1 }}>
      <MapCanvas center={s.focus} fit={fit} bottomPad={s.stage === 'quote' ? 460 : 340}>
        {route(quoteRoute)}
        {(s.stage === 'idle' || s.stage === 'matching' || s.stage === 'quote') &&
          s.nearby.map((d) => <VehicleMarker key={d.id + d.lat} lat={d.lat} lng={d.lng} type={d.vehicle_type} />)}
        {s.pickup && s.stage !== 'completed' && <PinMarker lat={s.pickup.lat} lng={s.pickup.lng} color={colors.success} icon="radio-button-on" />}
        {s.stage === 'quote' && s.drop && <PinMarker lat={s.drop.lat} lng={s.drop.lng} color={colors.danger} icon="flag" />}
        {s.stage === 'active' && s.ride && <PinMarker lat={s.ride.drop.lat} lng={s.ride.drop.lng} color={colors.danger} icon="flag" />}
        {s.stage === 'active' && s.driverPos && (
          <VehicleMarker lat={s.driverPos.lat} lng={s.driverPos.lng} type={s.ride?.vehicle_type ?? 'bike'} highlight />
        )}
      </MapCanvas>

      {/* top bar */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        {s.stage === 'quote' ? <IconButton name="arrow-back" onPress={() => p.back()} /> : (
          <View style={styles.chip}><Ionicons name="location" size={14} color={colors.cyan} /><Text style={styles.chipText}>Bengaluru</Text></View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {onSwitchMode && s.stage === 'idle' && (
            <Pressable testID="switch-to-driver" onPress={() => onSwitchMode('driver')} style={styles.chip}>
              <Ionicons name="speedometer-outline" size={14} color={colors.cyan} />
              <Text style={styles.chipText}>Drive Mode</Text>
            </Pressable>
          )}
          <View style={styles.chip}><Ionicons name="wallet-outline" size={14} color={colors.success} /><Text style={styles.chipText}>{rupees(s.balance)}</Text></View>
        </View>
      </View>

      {s.stage === 'idle' && <IdleSheet p={p} s={s} />}
      {s.stage === 'quote' && <QuoteSheet p={p} s={s} />}
      {s.stage === 'matching' && <MatchingSheet p={p} s={s} />}
      {s.stage === 'active' && s.ride && <ActiveSheet p={p} s={s} />}
      {s.stage === 'completed' && s.ride && <CompletedSheet p={p} s={s} />}
    </View>
  );
}

type SP = { p: RiderHomePresenter; s: ReturnType<RiderHomePresenter['getState']> };

function IdleSheet({ p, s }: SP) {
  return (
    <Sheet>
      <Text style={font.h2}>Where to?</Text>
      <Pressable testID="where-to" onPress={() => p.openSearch('drop')} style={styles.search}>
        <Ionicons name="search" size={20} color={colors.cyan} />
        <Text style={{ color: colors.muted, fontSize: 16, marginLeft: 12 }}>Search destination in Bengaluru</Text>
      </Pressable>
      <Pressable onPress={() => p.openSearch('pickup')} style={styles.pickupRow}>
        <View style={styles.dot} />
        <View style={{ flex: 1 }}>
          <Text style={font.tiny}>PICKUP</Text>
          <Text style={[font.body, { fontWeight: '600' }]} numberOfLines={1}>{s.pickup?.name ?? 'Locating…'}</Text>
          <Text style={font.small} numberOfLines={1}>{s.pickup?.address}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.faint} />
      </Pressable>
      <NoticeText text={s.notice} onClose={() => p.clearMessages()} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} contentContainerStyle={{ gap: 10 }}>
        {['Indiranagar', 'Koramangala', 'MG Road Metro', 'Whitefield (ITPL)', 'Kempegowda Airport'].map((n) => (
          <Pressable key={n} style={styles.quick} onPress={() => { p.openSearch('drop'); p.setQuery(n); }}>
            <Ionicons name="time-outline" size={14} color={colors.muted} /><Text style={styles.quickText}>{n}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
        <VehicleIcon type="bike" size={18} color={colors.success} />
        <Text style={[font.small, { marginLeft: 8 }]}>{s.nearby.length ? `${s.nearby.length} bikes nearby` : 'Bikes are on the way. Check back shortly'}</Text>
      </View>
    </Sheet>
  );
}

function QuoteSheet({ p, s }: SP) {
  const q = s.quote;
  const chosen = q?.options.find((o) => o.id === s.vehicle);
  return (
    <Sheet>
      {s.loading && !q ? (
        <View style={{ paddingVertical: 50, alignItems: 'center' }}>
          <ActivityIndicator color={colors.cyan} size="large" />
          <Text style={[font.small, { marginTop: 14 }]}>Calculating fares…</Text>
        </View>
      ) : q ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={font.h3} numberOfLines={1}>{s.drop?.name}</Text>
              <Text style={font.small}>{km(q.distance_m)} · {mins(q.duration_s)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {chosen && <Pill text={`${chosen.label} ${rupees(chosen.fare_paise)}`} color={colors.cyan} />}
              {q.surge > 1 && <Pill text={`${q.surge}× demand`} color={colors.warn} />}
            </View>
          </View>
          <ScrollView style={{ maxHeight: 250 }} showsVerticalScrollIndicator={false}>
            {q.options.map((o) => {
              const sel = o.id === s.vehicle;
              return (
                <Pressable key={o.id} testID={`vehicle-${o.id}`} onPress={() => p.selectVehicle(o.id)}
                  style={[styles.option, sel && styles.optionSel, !o.enabled && { opacity: 0.45 }]}>
                  <View style={styles.optIcon}><VehicleIcon type={o.icon} size={30} /></View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={font.h3}>{o.label}</Text>
                      <Ionicons name="person" size={11} color={colors.muted} /><Text style={font.tiny}>{o.capacity}</Text>
                      {!o.enabled && <Pill text="COMING SOON" color={colors.warn} />}
                    </View>
                    <Text style={font.small}>
                      {o.enabled ? (o.eta_pickup_min ? `${o.eta_pickup_min} min away · ${o.tagline}` : `No ${o.label.toLowerCase()}s nearby yet · ${o.tagline}`) : o.tagline}
                    </Text>
                  </View>
                  <Text style={[font.h3, { fontSize: 18 }]}>{rupees(o.fare_paise)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            {(['wallet', 'cash'] as const).map((m) => (
              <Pressable key={m} onPress={() => p.setPayment(m)} style={[styles.pay, s.payment === m && styles.paySel]}>
                <Ionicons name={m === 'wallet' ? 'wallet' : 'cash'} size={18} color={s.payment === m ? colors.cyan : colors.muted} />
                <Text style={{ color: colors.text, marginLeft: 8, fontWeight: '600' }}>{m === 'wallet' ? `Wallet ${rupees(s.balance)}` : 'Cash'}</Text>
              </Pressable>
            ))}
          </View>
          <NoticeText text={s.notice} onClose={() => p.clearMessages()} />
          <ErrorText text={s.error} />
          <Button style={{ marginTop: 10 }} testID="book-button" title={chosen ? `Book ${chosen.label} · ${rupees(chosen.fare_paise)}` : 'Select a ride'}
            onPress={() => p.book()} loading={s.loading} disabled={!chosen} />
        </>
      ) : (
        <View style={{ paddingVertical: 20 }}>
          <ErrorText text={s.error ?? 'Could not load fares'} />
          <Button title="Try again" onPress={() => p.fetchQuote()} variant="dark" />
        </View>
      )}
    </Sheet>
  );
}

function MatchingSheet({ p, s }: SP) {
  return (
    <Sheet>
      <View style={{ alignItems: 'center', paddingVertical: 8 }}>
        <Pulse size={130}><VehicleIcon type="bike" size={34} color="#fff" /></Pulse>
        <Text style={[font.h2, { marginTop: 10 }]}>Finding your rider…</Text>
        <Text style={[font.small, { marginTop: 6, textAlign: 'center' }]}>
          Contacting the closest riders near {s.ride?.pickup.address?.split(',')[0] ?? 'you'}
        </Text>
        <Text style={[font.h3, { marginTop: 14 }]}>{rupees(s.ride?.fare_paise)} · {s.ride?.payment_method === 'cash' ? 'Cash' : 'Wallet'}</Text>
      </View>
      <Button title="Cancel request" variant="ghost" onPress={() => p.cancelRide()} loading={s.loading} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

function ActiveSheet({ p, s }: SP) {
  const r = s.ride!;
  const d = r.driver;
  const pre = r.status !== 'IN_PROGRESS';
  const eta = s.etaSec != null ? `${mins(s.etaSec)} ${pre ? 'to pickup' : 'to destination'}` : '';
  return (
    <Sheet>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={font.h2}>{statusText[r.status]}</Text>
          {!!eta && <Text style={[font.small, { color: colors.cyan, marginTop: 2 }]}>{eta}</Text>}
        </View>
        {pre && r.start_otp && (
          <View style={styles.otp}>
            <Text style={font.tiny}>START OTP</Text>
            <Text testID="ride-otp" style={styles.otpText}>{r.start_otp}</Text>
          </View>
        )}
      </View>
      {d && (
        <Card style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={d.name} />
          <View style={{ flex: 1, marginLeft: 12, marginRight: 10, justifyContent: 'center' }}>
            <Text style={font.h3} numberOfLines={1}>{d.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
              <Ionicons name="star" size={13} color={colors.warn} />
              <Text style={[font.small, { marginLeft: 4, fontWeight: '700' }]}>{(d.rating ?? 5.0).toFixed(1)}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
            <Text style={[font.small, { fontWeight: '700', color: colors.text, marginBottom: 4 }]} numberOfLines={1}>
              {d.vehicle_model}
            </Text>
            <View style={styles.plate}>
              <Text style={styles.plateText}>{d.vehicle_number}</Text>
            </View>
          </View>
        </Card>
      )}
      <View style={{ marginTop: 10 }}>
        <Row left="To" right={r.drop.address?.split(',')[0] ?? ''} />
        <Row left={`Fare · ${r.payment_method === 'cash' ? 'Pay cash' : 'Wallet'}`} right={rupees(r.fare_paise)} bold />
      </View>
      <ErrorText text={s.error} />
      {pre && <Button title="Cancel ride" variant="ghost" onPress={() => p.cancelRide()} loading={s.loading} style={{ marginTop: 8 }} />}
    </Sheet>
  );
}

function CompletedSheet({ p, s }: SP) {
  const r = s.ride!;
  const b = r.fare_breakdown;
  return (
    <Sheet style={{ paddingBottom: 28 }}>
      <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginBottom: 10 }}>
          <View style={styles.check}><Ionicons name="checkmark" size={30} color="#fff" /></View>
          <Text style={[font.h2, { marginTop: 10 }]}>You've arrived</Text>
          <Text style={[font.h1, { marginTop: 4 }]}>{rupees(r.fare_paise)}</Text>
          <Text style={font.small}>Paid by {r.payment_method === 'cash' ? 'cash' : 'wallet'}</Text>
        </View>
        <Card>
          <Row left="Base fare" right={rupees(b.base)} />
          <Row left={`Distance (${km(r.distance_m)})`} right={rupees(b.distance)} />
          <Row left="Time" right={rupees(b.time)} />
          {b.min_fare_adjustment > 0 && <Row left="Minimum fare adjustment" right={rupees(b.min_fare_adjustment)} />}
          {b.surge > 0 && <Row left="High demand" right={rupees(b.surge)} color={colors.warn} />}
          <Row left="Booking fee" right={rupees(b.booking_fee)} />
          <Row left="GST" right={rupees(b.gst)} />
          {b.rounding > 0 && <Row left="Rounding" right={rupees(b.rounding)} />}
          <Row left="Total" right={rupees(b.total)} bold />
        </Card>
        {!s.ratingSubmitted ? (
          <View style={{ marginTop: 16 }}>
            <Text style={[font.h3, { textAlign: 'center', marginBottom: 10 }]}>Rate {r.driver?.name ?? 'your rider'}</Text>
            <Stars value={s.stars} onChange={(n) => p.setStars(n)} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 14 }}>
              {TAGS.map((t) => (
                <Pressable key={t} onPress={() => p.toggleTag(t)} style={[styles.tag, s.tags.includes(t) && styles.tagSel]}>
                  <Text style={{ color: s.tags.includes(t) ? colors.text : colors.muted, fontSize: 13 }}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <ErrorText text={s.error} />
            <Button title="Submit rating" onPress={() => p.submitRating()} loading={s.loading} style={{ marginTop: 14 }} />
            <Pressable onPress={() => p.done()} style={{ alignItems: 'center', padding: 14 }}><Text style={font.small}>Skip</Text></Pressable>
          </View>
        ) : (
          <View style={{ marginTop: 16 }}>
            <Text style={[font.small, { textAlign: 'center', marginBottom: 10 }]}>Thanks for your feedback!</Text>
            <Button title="Done" onPress={() => p.done()} />
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

function SearchOverlay({ p, s }: SP) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconButton name="arrow-back" onPress={() => p.closeSearch()} />
          <Text style={font.h2}>{s.searchTarget === 'drop' ? 'Choose destination' : 'Choose pickup'}</Text>
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.cyan} />
          <TextInput testID="search-input" autoFocus value={s.query} onChangeText={(t) => p.setQuery(t)} placeholder="Search area, landmark, address"
            placeholderTextColor={colors.faint} selectionColor={colors.primary} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()}
            style={{ flex: 1, color: colors.text, fontSize: 16, marginLeft: 10 }} />
          {s.query.length > 0 && (
            <Pressable onPress={() => p.setQuery('')} style={{ padding: 4, marginRight: 4 }}>
              <Ionicons name="close-circle" size={18} color={colors.faint} />
            </Pressable>
          )}
          {s.searching && <ActivityIndicator color={colors.cyan} />}
        </View>
        {s.searchTarget === 'pickup' && (
          <Pressable onPress={() => p.useCurrentLocation()} style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: 'rgba(52,211,153,0.15)' }]}><Ionicons name="locate" size={18} color={colors.success} /></View>
            <Text style={[font.body, { fontWeight: '600' }]}>Use current location</Text>
          </Pressable>
        )}
      </View>
      <FlatList
        data={s.results} keyboardShouldPersistTaps="handled" keyExtractor={(i, idx) => `${i.lat}-${i.lng}-${idx}`}
        ListHeaderComponent={s.searchTarget === 'drop' && s.query.length < 2 ? <Text style={[font.tiny, { paddingHorizontal: 18, marginBottom: 6 }]}>POPULAR IN BENGALURU</Text> : null}
        ListEmptyComponent={s.query.length >= 2 && !s.searching ? <Text style={[font.small, { textAlign: 'center', marginTop: 40 }]}>No places found in Bengaluru</Text> : null}
        renderItem={({ item }) => (
          <Pressable testID="search-result" onPress={() => p.selectPlace(item)} style={[styles.row, { paddingHorizontal: 18 }]}>
            <View style={styles.rowIcon}><Ionicons name="location-outline" size={18} color={colors.text} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[font.body, { fontWeight: '600' }]} numberOfLines={1}>{item.name}</Text>
              <Text style={font.small} numberOfLines={1}>{item.address}</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, paddingHorizontal: 14, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, height: 58, borderRadius: radius.md, paddingHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: colors.border },
  pickupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, marginRight: 14, borderWidth: 3, borderColor: 'rgba(52,211,153,0.3)' },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  quickText: { color: colors.text, fontSize: 13 },
  option: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', marginBottom: 6 },
  optionSel: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  pay: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  paySel: { borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.08)' },
  otp: { backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.primary },
  otpText: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: 6, marginTop: 2 },
  plate: { backgroundColor: '#FBBF24', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  plateText: { color: '#111', fontWeight: '800', letterSpacing: 1, fontSize: 13 },
  check: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tagSel: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, height: 54, borderRadius: radius.md, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 14 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
