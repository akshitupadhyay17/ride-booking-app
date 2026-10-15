import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, PanResponder, Pressable, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { colors, font, gradient, radius, shadow } from './theme';

// ---------- buttons ----------
export function Button({ title, onPress, loading, disabled, variant = 'primary', icon, style, testID }: {
  title: string; onPress: () => void; loading?: boolean; disabled?: boolean; testID?: string;
  variant?: 'primary' | 'success' | 'danger' | 'ghost' | 'dark'; icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const inner = (
    <View style={styles.btnInner}>
      {loading ? <ActivityIndicator color="#fff" /> : (<>
        {icon && <Ionicons name={icon} size={18} color="#fff" style={{ marginRight: 8 }} />}
        <Text style={[styles.btnText, variant === 'ghost' && { color: colors.text }]}>{title}</Text>
      </>)}
    </View>
  );
  return (
    <Pressable testID={testID} onPress={off ? undefined : onPress} style={({ pressed }) => [{ opacity: off ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, style]}>
      {variant === 'ghost' || variant === 'dark' ? (
        <View style={[styles.btn, { backgroundColor: variant === 'dark' ? colors.cardAlt : 'transparent', borderWidth: 1, borderColor: colors.border }]}>{inner}</View>
      ) : (
        <LinearGradient colors={[...gradient[variant]] as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btn}>{inner}</LinearGradient>
      )}
    </Pressable>
  );
}

export function IconButton({ name, onPress, size = 22, style }: { name: keyof typeof Ionicons.glyphMap; onPress: () => void; size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }, style]}>
      <Ionicons name={name} size={size} color={colors.text} />
    </Pressable>
  );
}

// ---------- surfaces ----------
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Sheet({
  children,
  style,
  collapsible = true,
  peekHeight = 88,
  hint = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  collapsible?: boolean;
  peekHeight?: number;
  hint?: boolean;
}) {
  const [sheetHeight, setSheetHeight] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const isCollapsedRef = useRef(false);
  const sheetHeightRef = useRef(0);

  isCollapsedRef.current = isCollapsed;
  sheetHeightRef.current = sheetHeight;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }, []);

  const getMaxTranslate = () => Math.max(120, (sheetHeightRef.current || 420) - peekHeight);

  const snapTo = (toCollapsed: boolean) => {
    const toVal = toCollapsed ? getMaxTranslate() : 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(translateY, {
      toValue: toVal,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start(() => {
      setIsCollapsed(toCollapsed);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => collapsible,
      onMoveShouldSetPanResponder: (_, g) => collapsible && Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        translateY.stopAnimation();
      },
      onPanResponderMove: (_, g) => {
        if (!collapsible) return;
        const max = getMaxTranslate();
        const base = isCollapsedRef.current ? max : 0;
        let next = base + g.dy;
        if (next < 0) next = next * 0.2;
        if (next > max + 20) next = max + (next - max) * 0.2;
        translateY.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        if (!collapsible) return;
        const max = getMaxTranslate();
        const dist = g.dy;
        const vel = g.vy;

        // Tap toggle (minimal drag movement)
        if (Math.abs(dist) < 7 && Math.abs(g.dx) < 7) {
          snapTo(!isCollapsedRef.current);
          return;
        }

        // Swipe down -> collapse to see map
        if (vel > 0.35 || dist > 35) {
          snapTo(true);
        } else if (vel < -0.35 || dist < -35) {
          // Swipe up -> expand to see fares
          snapTo(false);
        } else {
          // Snap based on position
          const currentPos = (isCollapsedRef.current ? max : 0) + dist;
          snapTo(currentPos > max * 0.45);
        }
      },
    })
  ).current;

  return (
    <Animated.View
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h && Math.abs(h - sheetHeightRef.current) > 2) {
          setSheetHeight(h);
          sheetHeightRef.current = h;
          if (isCollapsedRef.current) {
            translateY.setValue(Math.max(120, h - peekHeight));
          }
        }
      }}
      style={[styles.sheet, shadow, { opacity, transform: [{ translateY }] }, style]}
    >
      <View {...(collapsible ? panResponder.panHandlers : {})} style={styles.grabberArea}>
        <View style={styles.grabber} />
        {collapsible && hint && (
          <View style={styles.hintRow}>
            <Ionicons name={isCollapsed ? 'chevron-up' : 'chevron-down'} size={12} color={colors.muted} />
            <Text style={styles.hintText}>{isCollapsed ? 'Swipe up for fares' : 'Swipe down for map'}</Text>
          </View>
        )}
      </View>
      {isCollapsed && (
        <Pressable
          {...panResponder.panHandlers}
          onPress={() => snapTo(false)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: peekHeight + 20, zIndex: 10 }}
        />
      )}
      {children}
    </Animated.View>
  );
}

export function Input(props: TextInputProps & { icon?: keyof typeof Ionicons.glyphMap }) {
  const { icon, style, ...rest } = props;
  return (
    <View style={styles.input}>
      {icon && <Ionicons name={icon} size={18} color={colors.muted} style={{ marginRight: 10 }} />}
      <TextInput placeholderTextColor={colors.faint} selectionColor={colors.primary} style={[{ flex: 1, color: colors.text, fontSize: 16 }, style]} {...rest} />
    </View>
  );
}

export function Pill({ text, color = colors.primary, bg }: { text: string; color?: string; bg?: string }) {
  return (
    <View style={{ backgroundColor: bg ?? color + '26', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 }}>
      <Text style={{ color, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>{text}</Text>
    </View>
  );
}

export function Avatar({ name, size = 46 }: { name: string; size?: number }) {
  return (
    <LinearGradient colors={['#7C5CFF', '#22D3EE']} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }}>{(name || '?').trim().charAt(0).toUpperCase()}</Text>
    </LinearGradient>
  );
}

export function Stars({ value, onChange, size = 34 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange?.(n)}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? colors.warn : colors.faint} />
        </Pressable>
      ))}
    </View>
  );
}

export function Row({ left, right, bold, color }: { left: string; right: string; bold?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
      <Text style={[font.small, bold && { color: colors.text, fontWeight: '700', fontSize: 15 }]}>{left}</Text>
      <Text style={[font.body, bold && { fontWeight: '800', fontSize: 16 }, color ? { color } : null]}>{right}</Text>
    </View>
  );
}

export function ErrorText({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.err}>
      <Ionicons name="alert-circle" size={16} color={colors.danger} />
      <Text style={{ color: colors.danger, marginLeft: 8, flex: 1, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

export function NoticeText({ text, onClose }: { text?: string | null; onClose?: () => void }) {
  if (!text) return null;
  return (
    <Pressable onPress={onClose} style={[styles.err, { backgroundColor: colors.primarySoft }]}>
      <Ionicons name="information-circle" size={16} color={colors.cyan} />
      <Text style={{ color: colors.text, marginLeft: 8, flex: 1, fontSize: 13 }}>{text}</Text>
    </Pressable>
  );
}

// ---------- vehicles & map ----------
const ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  bike: 'moped', auto: 'rickshaw', car: 'car', suv: 'car-estate',
};
export function VehicleIcon({ type, size = 28, color = colors.text }: { type: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={ICONS[type] ?? 'moped'} size={size} color={color} />;
}

export function Pulse({ size = 120, children }: { size?: number; children?: React.ReactNode }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(a, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true })).start();
  }, []);
  const ring = (delay: number) => {
    const p = Animated.modulo(Animated.add(a, delay), 1);
    return { opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) }] };
  };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 0.5].map((d) => (
        <Animated.View key={d} style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary }, ring(d)]} />
      ))}
      <LinearGradient colors={['#7C5CFF', '#22D3EE']} style={{ width: size * 0.55, height: size * 0.55, borderRadius: size, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </LinearGradient>
    </View>
  );
}

type LL = { latitude: number; longitude: number };
export function MapCanvas({ center, fit, bottomPad = 320, topPad = 140, children }: {
  center: { lat: number; lng: number } | null; fit?: LL[]; bottomPad?: number; topPad?: number; children?: React.ReactNode;
}) {
  const ref = useRef<MapView>(null);
  const fitKey = fit ? fit.map((c) => `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`).join('|') : '';
  useEffect(() => {
    if (fit && fit.length > 1) {
      ref.current?.fitToCoordinates(fit, { edgePadding: { top: topPad, bottom: bottomPad, left: 50, right: 50 }, animated: true });
    } else if (center) {
      ref.current?.animateToRegion({ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 500);
    }
  }, [fitKey, center?.lat, center?.lng]);
  return (
    <MapView
      ref={ref} style={StyleSheet.absoluteFill} userInterfaceStyle="dark" showsCompass={false} showsPointsOfInterests={false}
      initialRegion={{ latitude: center?.lat ?? 12.9716, longitude: center?.lng ?? 77.5946, latitudeDelta: 0.04, longitudeDelta: 0.04 }}
    >
      {children}
    </MapView>
  );
}

export const route = (pts?: [number, number][]) =>
  pts && pts.length > 1 ? (
    <>
      <Polyline coordinates={pts.map(([latitude, longitude]) => ({ latitude, longitude }))} strokeColor="#0A0F1C" strokeWidth={9} />
      <Polyline coordinates={pts.map(([latitude, longitude]) => ({ latitude, longitude }))} strokeColor={colors.cyan} strokeWidth={5} />
    </>
  ) : null;

export function PinMarker({ lat, lng, color, icon }: { lat: number; lng: number; color: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <Marker coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={[styles.pin, { backgroundColor: color }]}><Ionicons name={icon} size={14} color="#fff" /></View>
    </Marker>
  );
}

export function VehicleMarker({ lat, lng, type, highlight }: { lat: number; lng: number; type: string; highlight?: boolean }) {
  return (
    <Marker coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={[styles.car, highlight && { borderColor: colors.cyan, backgroundColor: colors.primary, transform: [{ scale: 1.25 }] }]}>
        <VehicleIcon type={type === 'bike' ? 'bike' : type} size={18} color="#fff" />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  btn: { height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 0.2 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 34, borderTopWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  grabberArea: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingTop: 4, paddingBottom: 8, minHeight: 34 },
  grabber: { width: 44, height: 5, borderRadius: 2.5, backgroundColor: colors.faint },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  hintText: { color: colors.muted, fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
  input: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: 14, height: 54, borderWidth: 1, borderColor: colors.border },
  err: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(248,113,113,0.12)', padding: 10, borderRadius: radius.sm, marginVertical: 6 },
  pin: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  car: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1B2540', borderWidth: 2, borderColor: '#7C5CFF', alignItems: 'center', justifyContent: 'center' },
});
