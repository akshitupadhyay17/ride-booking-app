import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppPresenter } from '../presenters/AppPresenter';
import { Button, ErrorText, Input } from './components';
import { colors, font } from './theme';
import { usePresenterState } from './usePresenter';

export function LoginView({ presenter: p }: { presenter: AppPresenter }) {
  const s = usePresenterState(p);

  const handleCodeChange = (text: string) => {
    p.setCode(text);
    if (text.length === 6) {
      Keyboard.dismiss();
    }
  };

  const handleDevAutofill = () => {
    if (s.devOtp) {
      p.setCode(s.devOtp);
      Keyboard.dismiss();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={['#1B1450', '#0A1230', colors.bg]} style={StyleSheet.absoluteFill} />
      <View style={styles.glow} />
      <SafeAreaView style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
            style={{ flex: 1 }}
          >
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={s.otpSent ? styles.headerCompact : styles.header}>
                <LinearGradient colors={['#7C5CFF', '#22D3EE']} style={styles.logo}>
                  <Ionicons name="flash" size={s.otpSent ? 26 : 34} color="#fff" />
                </LinearGradient>
                <Text style={[font.h1, { fontSize: s.otpSent ? 30 : 38, marginTop: s.otpSent ? 14 : 24 }]}>Zip.</Text>
                <Text style={[font.h1, { fontSize: s.otpSent ? 30 : 38, color: colors.cyan }]}>Bengaluru, faster.</Text>
                {!s.otpSent && (
                  <Text style={[font.body, { color: colors.muted, marginTop: 12, lineHeight: 22 }]}>
                    Two-wheeler rides that cut through traffic. Book in seconds, track live, pay your way.
                  </Text>
                )}
              </View>

              <View style={styles.formContainer}>
                {!s.otpSent ? (
                  <>
                    <Text style={font.small}>Enter your mobile number</Text>
                    <Input
                      testID="phone-input"
                      icon="call-outline"
                      placeholder="98765 43210"
                      keyboardType="number-pad"
                      value={s.phone}
                      onChangeText={(t) => {
                        p.setPhone(t);
                        if (t.length === 10) Keyboard.dismiss();
                      }}
                      maxLength={10}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        Keyboard.dismiss();
                        p.sendOtp();
                      }}
                    />
                    <ErrorText text={s.error} />
                    <Button
                      title="Continue"
                      onPress={() => {
                        Keyboard.dismiss();
                        p.sendOtp();
                      }}
                      loading={s.busy}
                      disabled={s.phone.length !== 10}
                    />
                  </>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Pressable onPress={() => { Keyboard.dismiss(); p.backToPhone(); }}>
                        <Text style={{ color: colors.cyan, fontWeight: '600' }}>← +91 {s.phone}</Text>
                      </Pressable>
                      <Pressable onPress={() => Keyboard.dismiss()} style={styles.hideKeypad}>
                        <Ionicons name="chevron-down" size={16} color={colors.muted} />
                        <Text style={{ color: colors.muted, fontSize: 12, marginLeft: 4 }}>Done</Text>
                      </Pressable>
                    </View>
                    <Text style={font.small}>Enter the 6-digit code we sent</Text>
                    <Input
                      testID="otp-input"
                      icon="keypad-outline"
                      placeholder="••••••"
                      keyboardType="number-pad"
                      value={s.code}
                      onChangeText={handleCodeChange}
                      maxLength={6}
                      autoFocus
                      onSubmitEditing={() => {
                        Keyboard.dismiss();
                        p.verifyOtp();
                      }}
                    />
                    {s.devOtp && (
                      <Pressable onPress={handleDevAutofill} style={styles.dev}>
                        <Ionicons name="bug-outline" size={16} color={colors.warn} />
                        <Text style={{ color: colors.warn, marginLeft: 8, fontSize: 13, flex: 1 }}>
                          Dev mode: tap to autofill code {s.devOtp}
                        </Text>
                        <Ionicons name="flash-outline" size={14} color={colors.warn} />
                      </Pressable>
                    )}
                    <ErrorText text={s.error} />
                    <Button
                      title="Verify & Continue"
                      onPress={() => {
                        Keyboard.dismiss();
                        p.verifyOtp();
                      }}
                      loading={s.busy}
                      disabled={s.code.length !== 6}
                    />
                  </>
                )}
                <Text style={[font.tiny, { textAlign: 'center', marginTop: 6 }]}>
                  By continuing you agree to our Terms & Privacy Policy
                </Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    padding: 24,
    paddingBottom: 28,
  },
  header: {
    marginTop: 24,
  },
  headerCompact: {
    marginTop: 10,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(124,92,255,0.25)',
  },
  formContainer: {
    gap: 12,
    marginTop: 20,
  },
  dev: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
    padding: 12,
    borderRadius: 12,
  },
  hideKeypad: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
