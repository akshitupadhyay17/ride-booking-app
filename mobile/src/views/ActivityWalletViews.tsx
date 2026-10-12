import React, { useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HistoryPresenter } from '../presenters/HistoryPresenter';
import type { WalletPresenter } from '../presenters/WalletPresenter';
import { km, rupees, shortDate, txnLabel } from '../model/format';
import { Button, Card, ErrorText, Pill, VehicleIcon } from './components';
import { colors, font, radius } from './theme';
import { usePresenterState } from './usePresenter';

export function ActivityView({ presenter: p, mode }: { presenter: HistoryPresenter; mode: 'rider' | 'driver' }) {
  const s = usePresenterState(p);
  const isDriver = mode === 'driver';
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={[font.h1, { paddingHorizontal: 20, paddingTop: 8 }]}>{isDriver ? 'Earnings' : 'Your rides'}</Text>
      <FlatList
        data={s.items} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 12 }}
        refreshControl={<RefreshControl refreshing={s.loading && s.items.length === 0} tintColor={colors.cyan} onRefresh={() => p.load(mode)} />}
        onEndReached={() => p.more()}
        ListHeaderComponent={isDriver && s.earnings ? (
          <LinearGradient colors={['#7C5CFF', '#22D3EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>TODAY</Text>
            <Text style={{ color: '#fff', fontSize: 38, fontWeight: '800' }}>{rupees(s.earnings.today.earnings_paise)}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              <Text style={{ color: '#fff' }}>{s.earnings.today.trips} trips</Text>
              <Text style={{ color: '#fff' }}>This week {rupees(s.earnings.week.earnings_paise)} · {s.earnings.week.trips} trips</Text>
            </View>
          </LinearGradient>
        ) : null}
        ListEmptyComponent={!s.loading ? (
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Ionicons name="time-outline" size={46} color={colors.faint} />
            <Text style={[font.small, { marginTop: 10 }]}>{isDriver ? 'No trips yet. Go online to start earning.' : 'No rides yet. Book your first ride!'}</Text>
          </View>
        ) : null}
        ListFooterComponent={s.loading && s.items.length > 0 ? <ActivityIndicator color={colors.cyan} /> : null}
        renderItem={({ item: r }) => {
          const ok = r.status === 'COMPLETED';
          return (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <VehicleIcon type="bike" size={20} color={colors.cyan} />
                  <Text style={font.small}>{shortDate(r.requested_at)}</Text>
                </View>
                <Pill text={r.status.replace('_', ' ')} color={ok ? colors.success : r.status === 'CANCELLED' ? colors.danger : colors.warn} />
              </View>
              <View style={{ marginTop: 12, gap: 8 }}>
                <View style={styles.leg}><View style={[styles.dot, { backgroundColor: colors.success }]} /><Text style={[font.body, { flex: 1 }]} numberOfLines={1}>{r.pickup.address}</Text></View>
                <View style={styles.leg}><View style={[styles.dot, { backgroundColor: colors.danger }]} /><Text style={[font.body, { flex: 1 }]} numberOfLines={1}>{r.drop.address}</Text></View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={font.small}>{km(r.distance_m)} · {r.payment_method === 'cash' ? 'Cash' : 'Wallet'}{r.driver && !isDriver ? ` · ${r.driver.name}` : ''}</Text>
                <Text style={font.h3}>{ok ? rupees(isDriver ? r.driver_payout_paise : r.fare_paise) : r.cancel_fee_paise ? rupees(r.cancel_fee_paise) : '—'}</Text>
              </View>
            </Card>
          );
        }}
      />
    </SafeAreaView>
  );
}

const AMOUNTS = [100, 200, 500, 1000];

export function WalletView({ presenter: p }: { presenter: WalletPresenter }) {
  const s = usePresenterState(p);
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={s.loading} tintColor={colors.cyan} onRefresh={() => p.load()} />}>
        <Text style={font.h1}>Wallet</Text>
        <LinearGradient colors={['#2B1F7A', '#4F46E5', '#0EA5C9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.walletCard}>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, letterSpacing: 1 }}>BALANCE</Text>
          <Text testID="wallet-balance" style={{ color: '#fff', fontSize: 44, fontWeight: '800', marginTop: 4 }}>{rupees(s.balance)}</Text>
          <Ionicons name="wallet" size={90} color="rgba(255,255,255,0.12)" style={{ position: 'absolute', right: 14, bottom: 10 }} />
        </LinearGradient>
        <Text style={[font.tiny, { marginTop: 22, marginBottom: 10 }]}>ADD MONEY</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {AMOUNTS.map((a) => (
            <Pressable key={a} disabled={s.toppingUp} onPress={() => p.topup(a)} style={styles.amount}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>+₹{a}</Text>
            </Pressable>
          ))}
        </View>
        {s.toppingUp && <ActivityIndicator color={colors.cyan} style={{ marginTop: 12 }} />}
        <ErrorText text={s.error} />
        <Text style={[font.tiny, { marginTop: 24, marginBottom: 10 }]}>TRANSACTIONS</Text>
        {s.items.map((t) => (
          <View key={t.id} style={styles.txn}>
            <View style={[styles.txnIcon, { backgroundColor: t.amount_paise >= 0 ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)' }]}>
              <Ionicons name={t.amount_paise >= 0 ? 'arrow-down' : 'arrow-up'} size={16} color={t.amount_paise >= 0 ? colors.success : colors.danger} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[font.body, { fontWeight: '600' }]}>{txnLabel[t.kind] ?? t.kind}</Text>
              <Text style={font.small}>{shortDate(t.created_at)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[font.body, { fontWeight: '800', color: t.amount_paise >= 0 ? colors.success : colors.text }]}>{t.amount_paise >= 0 ? '+' : '−'}{rupees(Math.abs(t.amount_paise))}</Text>
              <Text style={font.tiny}>Bal {rupees(t.balance_after)}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { borderRadius: radius.xl, padding: 22, marginBottom: 6 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  walletCard: { borderRadius: radius.xl, padding: 24, marginTop: 16, overflow: 'hidden' },
  amount: { flex: 1, height: 48, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  txn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  txnIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
