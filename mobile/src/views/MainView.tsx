import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppPresenter, Tab } from '../presenters/AppPresenter';
import { ActivityView, WalletView } from './ActivityWalletViews';
import { DriverHomeView } from './DriverHomeView';
import { ProfileView } from './ProfileView';
import { RiderHomeView } from './RiderHomeView';
import { colors, font, radius } from './theme';
import { usePresenterState } from './usePresenter';

const TABS: { id: Tab; icon: keyof typeof Ionicons.glyphMap; rider: string; driver: string }[] = [
  { id: 'home', icon: 'navigate', rider: 'Ride', driver: 'Drive' },
  { id: 'activity', icon: 'time', rider: 'Rides', driver: 'Earnings' },
  { id: 'wallet', icon: 'wallet', rider: 'Wallet', driver: 'Wallet' },
  { id: 'profile', icon: 'person', rider: 'Profile', driver: 'Profile' },
];

export function MainView({ app }: { app: AppPresenter }) {
  const s = usePresenterState(app);
  const insets = useSafeAreaInsets();
  const c = app.container!;
  const banner = usePresenterState(c.notifications).banner;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {s.tab === 'home' && (s.mode === 'rider' ? <RiderHomeView presenter={c.rider} onSwitchMode={(m) => app.setMode(m)} /> : <DriverHomeView presenter={c.driver} onSwitchMode={(m) => app.setMode(m)} />)}
        {s.tab === 'activity' && <ActivityView presenter={c.history} mode={s.mode} />}
        {s.tab === 'wallet' && <WalletView presenter={c.wallet} />}
        {s.tab === 'profile' && <ProfileView app={app} notifications={c.notifications} />}
      </View>

      {banner && (
        <Pressable onPress={() => c.notifications.dismissBanner()} style={[styles.banner, { top: insets.top + 6 }]}>
          <View style={styles.bannerIcon}><Ionicons name="notifications" size={16} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{banner.title}</Text>
            <Text style={font.small} numberOfLines={2}>{banner.body}</Text>
          </View>
        </Pressable>
      )}

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {TABS.map((t) => {
          const on = s.tab === t.id;
          return (
            <Pressable key={t.id} testID={`tab-${t.id}`} onPress={() => app.setTab(t.id)} style={styles.tab}>
              <Ionicons name={t.icon} size={22} color={on ? colors.cyan : colors.faint} />
              <Text style={{ color: on ? colors.cyan : colors.faint, fontSize: 11, fontWeight: '700', marginTop: 3 }}>{s.mode === 'rider' ? t.rider : t.driver}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center' },
  banner: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.cardAlt, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, zIndex: 50 },
  bannerIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
