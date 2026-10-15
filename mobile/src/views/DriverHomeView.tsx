import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DriverHomePresenter } from '../presenters/DriverHomePresenter';
import { km, mins, rupees, statusText } from '../model/format';
import {
  Avatar, Button, Card, ErrorText, Input, MapCanvas, PinMarker, Pill, Row, Sheet, Stars, VehicleIcon, VehicleMarker, route,
} from './components';
import { colors, font, radius } from './theme';
import { usePresenterState } from './usePresenter';

interface Props {
  presenter: DriverHomePresenter;
  onSwitchMode?: (mode: 'rider' | 'driver') => void;
}

export function DriverHomeView({ presenter: p, onSwitchMode }: Props) {
  const s = usePresenterState(p);
  const insets = useSafeAreaInsets();

  if (s.loading) return <View style={styles.center}><ActivityIndicator color={colors.cyan} size="large" /></View>;
  if (!s.isDriver) return <Registration p={p} s={s} onSwitchMode={onSwitchMode} />;

  const r = s.ride;
  const target = r ? (r.status === 'IN_PROGRESS' ? r.drop : r.pickup) : null;
  const fit = r && s.pos && target ? [{ latitude: s.pos.lat, longitude: s.pos.lng }, { latitude: target.lat, longitude: target.lng }] : undefined;

  const fitKey = r ? `driver-ride-${r.id}-${r.status}` : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MapCanvas center={s.pos} fit={fit} fitKey={fitKey} bottomPad={380}>
        {r && route(r.polyline)}
        {r && <PinMarker lat={r.pickup.lat} lng={r.pickup.lng} color={colors.success} icon="radio-button-on" />}
        {r && <PinMarker lat={r.drop.lat} lng={r.drop.lng} color={colors.danger} icon="flag" />}
        {s.pos && <VehicleMarker lat={s.pos.lat} lng={s.pos.lng} type="bike" highlight />}
      </MapCanvas>

      {/* Top status & control bar */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16 }}>
        <View style={styles.statusBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <View style={[styles.statusDot, { backgroundColor: s.status === 'offline' ? colors.faint : s.status === 'busy' ? colors.warn : colors.success }]} />
            <View style={{ flex: 1 }}>
              <Text style={font.h3}>{s.status === 'offline' ? "You're offline" : s.status === 'busy' ? 'On a trip' : "You're online"}</Text>
              <Text style={font.small} numberOfLines={1}>{s.vehicleLabel || 'Bike'} · {s.vehicleNumber || 'Partner'}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {onSwitchMode && !r && (
              <Pressable
                testID="switch-to-rider"
                onPress={() => onSwitchMode('rider')}
                style={styles.switchModePill}
              >
                <Ionicons name="person" size={13} color={colors.cyan} />
                <Text style={styles.switchModeText}>Rider Mode</Text>
              </Pressable>
            )}
            <Switch
              testID="online-switch"
              value={s.status !== 'offline'}
              disabled={s.busy || s.status === 'busy'}
              onValueChange={() => p.toggleOnline()}
              trackColor={{ true: colors.success, false: colors.border }}
            />
          </View>
        </View>

        {s.status !== 'offline' && (
          <View style={[styles.statusBar, { marginTop: 8, paddingVertical: 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="navigate-circle" size={18} color={colors.cyan} />
              <Text style={font.small}>Simulate GPS movement (demo)</Text>
            </View>
            <Switch
              value={s.simulate}
              onValueChange={(v) => p.setSimulate(v)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        )}
      </View>

      {!r && (
        <Sheet>
          {s.status === 'offline' ? (
            <>
              <Text style={font.h2}>Ready to earn?</Text>
              <Text style={[font.small, { marginVertical: 8 }]}>Go online to start receiving two-wheeler ride requests in Bengaluru.</Text>
              <ErrorText text={s.error} />
              <Button title="Go online" variant="success" icon="power" onPress={() => p.toggleOnline()} loading={s.busy} />
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator color={colors.cyan} />
              <Text style={[font.h3, { marginTop: 12 }]}>Waiting for ride requests…</Text>
              <Text style={[font.small, { marginTop: 4 }]}>Stay near high-demand areas like Koramangala or Indiranagar</Text>
              <ErrorText text={s.error} />
            </View>
          )}
        </Sheet>
      )}

      {r && <TripSheet p={p} s={s} />}
      {s.offer && <OfferModal p={p} s={s} />}
      <SummaryModal p={p} s={s} />
    </View>
  );
}

type SP = { p: DriverHomePresenter; s: ReturnType<DriverHomePresenter['getState']> };

function TripSheet({ p, s }: SP) {
  const r = s.ride!;
  return (
    <Sheet>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={font.h2}>
            {statusText[r.status]
              ?.replace('Rider is on the way', 'Head to pickup')
              .replace('Rider is arriving', 'Almost at pickup')
              .replace('Rider has arrived', 'At pickup') ?? r.status}
          </Text>
          <Pill text={r.payment_method === 'cash' ? 'COLLECT CASH' : 'PAID BY WALLET'} color={r.payment_method === 'cash' ? colors.warn : colors.success} />
        </View>

        <Card style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={r.rider?.name ?? 'Rider'} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={font.h3}>{r.rider?.name || 'Customer'}</Text>
            <Text style={font.small}>★ {(r.rider?.rating ?? 5.0).toFixed(1)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={font.h3}>{rupees(r.fare_paise)}</Text>
            <Text style={[font.small, { color: colors.success }]}>
              You earn {rupees(r.fare_paise - Math.floor(r.fare_paise * 0.2))}
            </Text>
          </View>
        </Card>

        <View style={{ marginTop: 10 }}>
          <Text style={font.tiny}>{r.status === 'IN_PROGRESS' ? 'DROP-OFF' : 'PICKUP'}</Text>
          <Text style={[font.body, { fontWeight: '600' }]} numberOfLines={2}>
            {(r.status === 'IN_PROGRESS' ? r.drop : r.pickup).address}
          </Text>
        </View>

        {r.status === 'ARRIVED' && (
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={font.small}>Ask the rider for their 4-digit OTP</Text>
              <Pressable onPress={() => Keyboard.dismiss()} style={{ paddingVertical: 2, paddingHorizontal: 6 }}>
                <Text style={{ color: colors.cyan, fontWeight: '700', fontSize: 13 }}>Done</Text>
              </Pressable>
            </View>
            <Input
              testID="driver-otp"
              icon="keypad-outline"
              placeholder="• • • •"
              keyboardType="number-pad"
              value={s.otp}
              onChangeText={(t) => {
                p.setOtp(t);
                if (t.replace(/[^0-9]/g, '').length === 4) {
                  Keyboard.dismiss();
                }
              }}
              maxLength={4}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              style={{ letterSpacing: 8, fontSize: 22, fontWeight: '800' }}
            />
          </View>
        )}

        <ErrorText text={s.error} />

        <View style={{ marginTop: 12, gap: 8, paddingBottom: 6 }}>
          {(r.status === 'ACCEPTED' || r.status === 'ARRIVING') && (
            <Button
              testID="arrived-button"
              title="I've arrived at pickup"
              icon="location"
              onPress={() => {
                Keyboard.dismiss();
                p.arrived();
              }}
              loading={s.busy}
            />
          )}
          {r.status === 'ARRIVED' && (
            <Button
              testID="start-button"
              title="Start trip"
              icon="play"
              variant="success"
              onPress={() => {
                Keyboard.dismiss();
                p.startTrip();
              }}
              loading={s.busy}
              disabled={s.otp.length !== 4}
            />
          )}
          {r.status === 'IN_PROGRESS' && (
            <Button
              testID="complete-button"
              title={`Complete trip${r.payment_method === 'cash' ? ` · collect ${rupees(r.fare_paise)}` : ''}`}
              icon="flag"
              variant="success"
              onPress={() => {
                Keyboard.dismiss();
                p.complete();
              }}
              loading={s.busy}
            />
          )}
          {r.status !== 'IN_PROGRESS' && (
            <Button
              title="Cancel trip"
              variant="ghost"
              onPress={() => {
                Keyboard.dismiss();
                p.cancel();
              }}
              disabled={s.busy}
            />
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

function OfferModal({ p, s }: SP) {
  const o = s.offer!;
  const insets = useSafeAreaInsets();
  const pct = Math.max(0, Math.min(1, s.offerLeft / o.timeout_s));
  return (
    <Modal transparent animationType="slide" visible>
      <View style={styles.modalBg}>
        <View style={[styles.offer, { paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={font.h2}>New ride request</Text>
            <View style={styles.timer}><Text style={{ color: '#fff', fontWeight: '800' }}>{s.offerLeft}s</Text></View>
          </View>
          <View style={styles.progressTrack}>
            <LinearGradient colors={['#7C5CFF', '#22D3EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4, width: `${pct * 100}%`, borderRadius: 2 }} />
          </View>
          <Text style={[font.h1, { marginTop: 14, color: colors.success }]}>{rupees(o.earning_paise)}</Text>
          <Text style={font.small}>
            est. earnings · {o.payment_method === 'cash' ? 'cash trip' : 'wallet'} · {o.rider_name || 'Rider'} ★{(o.rider_rating ?? 5.0).toFixed(1)}
          </Text>
          <View style={{ marginTop: 14, gap: 10 }}>
            <View style={styles.leg}>
              <View style={[styles.legDot, { backgroundColor: colors.success }]} />
              <View style={{ flex: 1 }}>
                <Text style={font.tiny}>PICKUP · {km(o.pickup_distance_m)} away</Text>
                <Text style={font.body} numberOfLines={1}>{o.pickup.address}</Text>
              </View>
            </View>
            <View style={styles.leg}>
              <View style={[styles.legDot, { backgroundColor: colors.danger }]} />
              <View style={{ flex: 1 }}>
                <Text style={font.tiny}>DROP · {km(o.trip_distance_m)} · {mins(o.trip_duration_s)}</Text>
                <Text style={font.body} numberOfLines={1}>{o.drop.address}</Text>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Button title="Decline" variant="dark" onPress={() => p.reject()} style={{ flex: 1 }} />
            <Button testID="accept-button" title="Accept" variant="success" onPress={() => p.accept()} loading={s.busy} style={{ flex: 2 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SummaryModal({ p, s }: SP) {
  const c = s.completedRide;
  const insets = useSafeAreaInsets();
  if (!c) return null;
  return (
    <Modal transparent animationType="fade" visible>
      <View style={[styles.modalBg, { justifyContent: 'center', padding: 24 }]}>
        <View style={[styles.offer, { borderRadius: radius.xl, paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
          <View style={{ alignItems: 'center' }}>
            <View style={styles.check}><Ionicons name="checkmark" size={30} color="#fff" /></View>
            <Text style={[font.h2, { marginTop: 10 }]}>Trip complete</Text>
            <Text style={[font.h1, { color: colors.success, marginTop: 4 }]}>{rupees(c.driver_payout_paise)}</Text>
            <Text style={font.small}>earned · fare {rupees(c.fare_paise)} · {km(c.distance_m)}</Text>
          </View>
          {!s.ratingSubmitted ? (
            <View style={{ marginTop: 18 }}>
              <Text style={[font.small, { textAlign: 'center', marginBottom: 8 }]}>Rate {c.rider?.name ?? 'the rider'}</Text>
              <Stars value={s.stars} onChange={(n) => p.setStars(n)} />
              <Button title="Submit rating" onPress={() => p.submitRating()} style={{ marginTop: 16 }} />
              <Pressable onPress={() => p.doneSummary()} style={{ alignItems: 'center', padding: 12 }}><Text style={font.small}>Skip</Text></Pressable>
            </View>
          ) : <Button title="Back to map" onPress={() => p.doneSummary()} style={{ marginTop: 18 }} />}
        </View>
      </View>
    </Modal>
  );
}

function Registration({ p, s, onSwitchMode }: SP & { onSwitchMode?: (mode: 'rider' | 'driver') => void }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {onSwitchMode && (
              <Pressable
                onPress={() => onSwitchMode('rider')}
                style={styles.backToRide}
              >
                <Ionicons name="arrow-back" size={18} color={colors.cyan} />
                <Text style={{ color: colors.cyan, fontWeight: '700', marginLeft: 6 }}>Back to Rider Mode</Text>
              </Pressable>
            )}

            <Text style={font.h1}>Become a rider partner</Text>
            <Text style={[font.small, { marginTop: 8, marginBottom: 20 }]}>
              Earn on your schedule. Add your vehicle to start accepting bike rides in Bengaluru.
            </Text>

            <Text style={[font.tiny, { marginBottom: 8 }]}>VEHICLE TYPE</Text>
            <View style={{ gap: 8, marginBottom: 18 }}>
              {s.vehicleTypes.map((v) => {
                const sel = s.formType === v.id;
                return (
                  <Pressable
                    key={v.id}
                    disabled={!v.enabled}
                    onPress={() => p.setForm({ formType: v.id })}
                    style={[styles.typeRow, sel && { borderColor: colors.primary, backgroundColor: colors.primarySoft }, !v.enabled && { opacity: 0.4 }]}
                  >
                    <VehicleIcon type={v.icon} size={26} />
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <Text style={font.h3}>{v.label}</Text>
                      <Text style={font.small}>{v.tagline}</Text>
                    </View>
                    {!v.enabled ? <Pill text="COMING SOON" color={colors.warn} /> : sel ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <Text style={[font.tiny, { marginBottom: 8 }]}>REGISTRATION NUMBER</Text>
            <Input
              testID="vehicle-number"
              icon="card-outline"
              placeholder="KA01AB1234"
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              value={s.formNumber}
              onChangeText={(t) => p.setForm({ formNumber: t })}
            />

            <Text style={[font.tiny, { marginTop: 14, marginBottom: 8 }]}>VEHICLE MODEL</Text>
            <Input
              icon="bicycle-outline"
              placeholder="Honda Activa 6G"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              value={s.formModel}
              onChangeText={(t) => p.setForm({ formModel: t })}
            />

            <ErrorText text={s.error} />

            <Button
              testID="register-driver"
              title="Register & continue"
              onPress={() => {
                Keyboard.dismiss();
                p.register();
              }}
              loading={s.busy}
              style={{ marginTop: 20 }}
              disabled={s.formNumber.length < 6}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  statusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: colors.border },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  switchModePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.cardAlt, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  switchModeText: { color: colors.cyan, fontSize: 12, fontWeight: '700' },
  backToRide: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 16, paddingVertical: 6 },
  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  offer: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 22, borderWidth: 1, borderColor: colors.border },
  timer: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 12 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  legDot: { width: 12, height: 12, borderRadius: 6 },
  check: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  typeRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
});
