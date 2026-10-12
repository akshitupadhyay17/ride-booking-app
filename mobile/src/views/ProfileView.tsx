import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppPresenter } from '../presenters/AppPresenter';
import type { NotificationsPresenter } from '../presenters/NotificationsPresenter';
import { shortDate } from '../model/format';
import { Avatar, Button, Card, Input, Pill } from './components';
import { colors, font, radius } from './theme';
import { usePresenterState } from './usePresenter';

export function ProfileView({ app, notifications }: { app: AppPresenter; notifications: NotificationsPresenter }) {
  const a = usePresenterState(app);
  const n = usePresenterState(notifications);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.user?.name ?? '');
  const u = a.user!;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        <Text style={font.h1}>Profile</Text>
        <Card style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={u.name || u.phone} size={60} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={font.h2}>{u.name || 'Add your name'}</Text>
            <Text style={font.small}>{u.phone}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Ionicons name="star" size={13} color={colors.warn} />
              <Text style={[font.small, { marginLeft: 4 }]}>{u.rating_avg.toFixed(2)} ({u.rating_count})</Text>
            </View>
          </View>
          <Pressable onPress={() => setEditing(!editing)}><Ionicons name="create-outline" size={22} color={colors.cyan} /></Pressable>
        </Card>
        {editing && (
          <View style={{ marginTop: 12, gap: 10 }}>
            <Input testID="name-input" icon="person-outline" placeholder="Your name" value={name} onChangeText={setName} />
            <Button title="Save" onPress={async () => { await app.saveName(name); setEditing(false); }} />
          </View>
        )}

        <Text style={[font.tiny, { marginTop: 24, marginBottom: 10 }]}>MODE</Text>
        <View style={styles.seg}>
          {(['rider', 'driver'] as const).map((m) => (
            <Pressable key={m} testID={`mode-${m}`} onPress={() => app.setMode(m)} style={[styles.segItem, a.mode === m && styles.segSel]}>
              <Ionicons name={m === 'rider' ? 'person' : 'speedometer'} size={16} color={a.mode === m ? '#fff' : colors.muted} />
              <Text style={{ color: a.mode === m ? '#fff' : colors.muted, fontWeight: '700', marginLeft: 8 }}>{m === 'rider' ? 'Rider' : 'Rider partner'}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 }}>
          <Text style={font.tiny}>NOTIFICATIONS {n.unread > 0 ? `(${n.unread} new)` : ''}</Text>
          {n.unread > 0 && <Pressable onPress={() => notifications.markRead()}><Text style={{ color: colors.cyan, fontSize: 12 }}>Mark all read</Text></Pressable>}
        </View>
        {n.items.length === 0 && <Text style={font.small}>Nothing here yet.</Text>}
        {n.items.slice(0, 15).map((x) => (
          <View key={x.id} style={styles.notif}>
            <View style={[styles.nDot, { backgroundColor: x.read ? 'transparent' : colors.cyan }]} />
            <View style={{ flex: 1 }}>
              <Text style={[font.body, { fontWeight: '700' }]}>{x.title}</Text>
              <Text style={font.small}>{x.body}</Text>
              <Text style={[font.tiny, { marginTop: 2 }]}>{shortDate(x.created_at)}</Text>
            </View>
          </View>
        ))}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.connected ? colors.success : colors.danger }} />
          <Text style={font.small}>{a.connected ? 'Live connection active' : 'Reconnecting…'}</Text>
        </View>
        <Button title="Log out" variant="ghost" onPress={() => Alert.alert('Log out?', '', [{ text: 'Cancel' }, { text: 'Log out', style: 'destructive', onPress: () => app.logout() }])} style={{ marginTop: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: colors.border },
  segItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 12 },
  segSel: { backgroundColor: colors.primary },
  notif: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  nDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
