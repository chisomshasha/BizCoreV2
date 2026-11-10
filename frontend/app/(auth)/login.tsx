import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Animated,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../src/components/ThemedComponents';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/utils/api';

const { width, height } = Dimensions.get('window');

const HEX_R    = 110;
const HEX_CX   = 150;
const HEX_CY   = 150;
const HEX_SIZE = 300;
const CHIP_W   = 88;
const CHIP_H   = 28;

const toRad = (d: number) => (d * Math.PI) / 180;

const ANGLES = [90, 30, 330, 270, 210, 150];
const VERTICES = ANGLES.map(deg => ({
  x: HEX_CX + HEX_R * Math.cos(toRad(deg)),
  y: HEX_CY - HEX_R * Math.sin(toRad(deg)),
}));

const FEATURES = [
  { label: 'Inventory',   color: '#6366F1', icon: 'cube-outline' },
  { label: 'Orders',      color: '#22C55E', icon: 'cart-outline' },
  { label: 'Partners',    color: '#F59E0B', icon: 'people-outline' },
  { label: 'Finance',     color: '#EC4899', icon: 'wallet-outline' },
  { label: 'Reports',     color: '#06B6D4', icon: 'stats-chart-outline' },
  { label: 'Procurement', color: '#8B5CF6', icon: 'receipt-outline' },
];

const EDGES = [
  { left: 142.65, top: 66.5,  angle: '30deg' },
  { left: 190.3,  top: 149.0, angle: '90deg' },
  { left: 142.65, top: 231.5, angle: '150deg' },
  { left: 47.35,  top: 231.5, angle: '210deg' },
  { left: -0.3,   top: 149.0, angle: '-90deg' },
  { left: 47.35,  top: 66.5,  angle: '-30deg' },
];

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://bizcorev2-production.up.railway.app';

export default function LoginScreen() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuthStore();
  const { resetToken: incomingResetToken } = useLocalSearchParams<{ resetToken?: string }>();

  // Only fields the login form needs. No register-mode state.
  const [username, setUsername]         = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // Forgot password / username modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotMode, setForgotMode]           = useState<'password' | 'username'>('password');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotStatus, setForgotStatus]       = useState<{ kind: 'idle' | 'sending' | 'sent' | 'error'; message?: string; username?: string; email_masked?: string; name?: string }>({ kind: 'idle' });

  // Reset password (after receiving a token) state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetToken, setResetToken]         = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetting, setResetting]           = useState(false);

  // Open the reset-password modal automatically if we arrived here via a
  // bizcorev2://reset-password?token=... deep link.
  useEffect(() => {
    if (incomingResetToken) {
      setResetToken(String(incomingResetToken));
      setShowResetModal(true);
    }
  }, [incomingResetToken]);

  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // ── Animations (kept from the original screen for visual continuity) ──
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const orb1Anim  = useRef(new Animated.Value(0)).current;
  const orb2Anim  = useRef(new Animated.Value(0)).current;
  const glowAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.06, duration: 2000, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 2000, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 1, duration: 2500, useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: 0, duration: 2500, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(orb1Anim, { toValue: 1, duration: 4000, useNativeDriver: true }),
      Animated.timing(orb1Anim, { toValue: 0, duration: 4000, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(orb2Anim, { toValue: 1, duration: 5500, useNativeDriver: true }),
      Animated.timing(orb2Anim, { toValue: 0, duration: 5500, useNativeDriver: true }),
    ])).start();
  }, []);

  // Bounce out of login if we're already authed.
  useEffect(() => {
    if (isAuthenticated) router.replace('/(tabs)');
  }, [isAuthenticated, router]);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        username: username.trim(),
        password,
      });
      // Backend returns: { user, session_token, expires_at }
      const { user, session_token, expires_at } = data;
      await login(session_token, user, expires_at);
      router.replace('/(tabs)');
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        err?.message ||
        'Login failed. Please try again.';
      setError(detail);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Animated background pieces ────────────────────────────────────────
  const orb1Y       = orb1Anim.interpolate({ inputRange: [0, 1], outputRange: [0, -28] });
  const orb2Y       = orb2Anim.interpolate({ inputRange: [0, 1], outputRange: [0,  22] });
  const edgeOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#06060E', '#0D0D1C', '#06060E']} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.orb1, { transform: [{ translateY: orb1Y }] }]}>
        <LinearGradient colors={['#6366F155', '#6366F100']} style={styles.orbFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      </Animated.View>
      <Animated.View style={[styles.orb2, { transform: [{ translateY: orb2Y }] }]}>
        <LinearGradient colors={['#06B6D433', '#06B6D400']} style={styles.orbFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      </Animated.View>

      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              style={[
                styles.content,
                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
              ]}
            >
              <View style={styles.taglineRow}>
                <View style={styles.taglineLine} />
                <Text style={styles.tagline}>Enterprise Resource Planning</Text>
                <View style={styles.taglineLine} />
              </View>

              {/* Hex brand mark */}
              <View style={styles.hexContainer}>
                {EDGES.map((e, i) => (
                  <Animated.View
                    key={`edge-${i}`}
                    style={[
                      styles.hexEdge,
                      { left: e.left, top: e.top, opacity: edgeOpacity, transform: [{ rotate: e.angle }] },
                    ]}
                  />
                ))}
                {VERTICES.map((v, i) => {
                  const dx    = v.x - HEX_CX;
                  const dy    = v.y - HEX_CY;
                  const spoke = Math.sqrt(dx * dx + dy * dy) * 0.42;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                  const midX  = HEX_CX + dx * 0.21;
                  const midY  = HEX_CY + dy * 0.21;
                  return (
                    <Animated.View
                      key={`spoke-${i}`}
                      style={[
                        styles.spoke,
                        { left: midX - spoke / 2, top: midY - 0.5, width: spoke, opacity: edgeOpacity, transform: [{ rotate: `${angle}deg` }] },
                      ]}
                    />
                  );
                })}
                {FEATURES.map((f, i) => {
                  const v = VERTICES[i];
                  return (
                    <View
                      key={f.label}
                      style={[
                        styles.chip,
                        { left: v.x - CHIP_W / 2, top: v.y - CHIP_H / 2, borderColor: `${f.color}55`, backgroundColor: `${f.color}15` },
                      ]}
                    >
                      <Ionicons name={f.icon as any} size={11} color={f.color} />
                      <Text style={[styles.chipLabel, { color: f.color }]}>{f.label}</Text>
                    </View>
                  );
                })}
                <Animated.View style={[styles.logoWrapper, { transform: [{ scale: pulseAnim }] }]}>
                  <Animated.View style={[styles.glowRing, { opacity: edgeOpacity }]} />
                  <Image
                    source={require('../../assets/images/bizcore_logo.png')}
                    style={styles.logoImage}
                    resizeMode="contain"
                  />
                </Animated.View>
              </View>

              {/* ── Direct account login panel ──────────────────────── */}
              <View style={styles.signIn}>
                {error && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <View style={styles.fieldGroup}>
                  <View style={styles.field}>
                    <Ionicons name="at-outline" size={18} color={Colors.textMuted} style={styles.fieldIcon} />
                    <TextInput
                      ref={usernameRef}
                      style={styles.input}
                      placeholder="Username or email"
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={username}
                      onChangeText={setUsername}
                      editable={!isLoading}
                      returnKeyType="next"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                    />
                  </View>

                  <View style={styles.field}>
                    <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} style={styles.fieldIcon} />
                    <TextInput
                      ref={passwordRef}
                      style={[styles.input, { paddingRight: 44 }]}
                      placeholder="Password"
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!showPassword}
                      value={password}
                      onChangeText={setPassword}
                      editable={!isLoading}
                      returnKeyType="go"
                      onSubmitEditing={handleLogin}
                    />
                    <TouchableOpacity
                      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                      onPress={() => setShowPassword(v => !v)}
                      style={styles.eyeBtn}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      disabled={isLoading}
                    >
                      <Ionicons
                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                        size={20}
                        color={Colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, isLoading && { opacity: 0.7 }]}
                  onPress={handleLogin}
                  disabled={isLoading}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={['#6366F1', '#4F46E5']}
                    style={styles.submitInner}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <Text style={styles.submitText}>Sign in</Text>
                        <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                <View style={styles.forgotRow}>
                  <TouchableOpacity onPress={() => setShowForgotModal(true)}>
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowForgotModal(true)}>
                    <Text style={styles.forgotText}>Forgot username?</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.adminNote}>
                  <Ionicons name="information-circle-outline" size={14} color={Colors.textMuted} />
                  <Text style={styles.adminNoteText}>
                    Don't have an account? Ask your administrator (Super Admin or General Manager) to create one for you.
                  </Text>
                </View>

                <LinearGradient
                  colors={['transparent', '#6366F155', 'transparent']}
                  style={styles.accentLine}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                />
                <Text style={styles.disclaimer}>
                  Secure sign-in · {BACKEND_URL.replace(/^https?:\/\//, '')}
                </Text>
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Forgot password / username modal */}
      <Modal
        visible={showForgotModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowForgotModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {forgotMode === 'password' ? 'Reset password' : 'Recover username'}
              </Text>
              <TouchableOpacity onPress={() => setShowForgotModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.forgotTabRow}>
              <TouchableOpacity
                style={[styles.forgotTab, forgotMode === 'password' && styles.forgotTabActive]}
                onPress={() => { setForgotMode('password'); setForgotStatus({ kind: 'idle' }); }}
              >
                <Text style={[styles.forgotTabText, forgotMode === 'password' && styles.forgotTabTextActive]}>
                  Forgot password
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.forgotTab, forgotMode === 'username' && styles.forgotTabActive]}
                onPress={() => { setForgotMode('username'); setForgotStatus({ kind: 'idle' }); }}
              >
                <Text style={[styles.forgotTabText, forgotMode === 'username' && styles.forgotTabTextActive]}>
                  Forgot username
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.forgotHelp}>
              {forgotMode === 'password'
                ? 'Enter the email or phone number on your account. We will send a reset link.'
                : 'Enter the email or phone number on your account and we will remind you of your username.'}
            </Text>

            <TextInput
              style={styles.forgotInput}
              placeholder="Email or phone"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={forgotIdentifier}
              onChangeText={setForgotIdentifier}
            />

            {forgotStatus.kind === 'error' && (
              <Text style={styles.forgotError}>{forgotStatus.message}</Text>
            )}

            {forgotStatus.kind === 'sent' && forgotMode === 'username' && forgotStatus.username && (
              <View style={styles.forgotSuccess}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                <Text style={styles.forgotSuccessText}>
                  Account found{'\n'}
                  Name: {forgotStatus.name}{'\n'}
                  Username: {forgotStatus.username}{'\n'}
                  Email: {forgotStatus.email_masked}
                </Text>
              </View>
            )}

            {forgotStatus.kind === 'sent' && forgotMode === 'password' && (
              <View style={styles.forgotSuccess}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                <Text style={styles.forgotSuccessText}>
                  {forgotStatus.message ||
                    'If we found your account, a reset link has been sent. Check the audit log on the server or your email/SMS for the token.'}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.forgotSubmit, forgotStatus.kind === 'sending' && { opacity: 0.6 }]}
              disabled={forgotStatus.kind === 'sending'}
              onPress={async () => {
                if (!forgotIdentifier.trim()) {
                  setForgotStatus({ kind: 'error', message: 'Please enter your email or phone.' });
                  return;
                }
                setForgotStatus({ kind: 'sending' });
                try {
                  if (forgotMode === 'password') {
                    await api.post('/auth/forgot-password', { email_or_phone: forgotIdentifier.trim() });
                    setForgotStatus({
                      kind: 'sent',
                      message: 'Reset link sent. In dev mode the token is logged to the backend console.',
                    });
                  } else {
                    const response = await api.post('/auth/forgot-username', { email_or_phone: forgotIdentifier.trim() });
                    setForgotStatus({
                      kind: 'sent',
                      username: response.data?.username,
                      email_masked: response.data?.email_masked,
                      name: response.data?.name,
                    });
                  }
                } catch (err: any) {
                  setForgotStatus({
                    kind: 'error',
                    message: err.response?.data?.detail || 'Something went wrong. Try again.',
                  });
                }
              }}
            >
              <Text style={styles.forgotSubmitText}>
                {forgotStatus.kind === 'sending' ? 'Sending…' : forgotMode === 'password' ? 'Send reset link' : 'Look up account'}
              </Text>
            </TouchableOpacity>

            {forgotMode === 'password' && (
              <TouchableOpacity onPress={() => { setShowForgotModal(false); setShowResetModal(true); }}>
                <Text style={styles.forgotSecondaryLink}>
                  I already have a reset token
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Reset password with token modal */}
      <Modal
        visible={showResetModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowResetModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Set a new password</Text>
              <TouchableOpacity onPress={() => setShowResetModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.forgotHelp}>
              Paste the reset token you received and choose a new password.
            </Text>
            <TextInput
              style={styles.forgotInput}
              placeholder="Reset token"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={resetToken}
              onChangeText={setResetToken}
            />
            <TextInput
              style={styles.forgotInput}
              placeholder="New password (min 6 characters)"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              value={resetNewPassword}
              onChangeText={setResetNewPassword}
            />
            {forgotStatus.kind === 'error' && (
              <Text style={styles.forgotError}>{forgotStatus.message}</Text>
            )}
            <TouchableOpacity
              style={[styles.forgotSubmit, resetting && { opacity: 0.6 }]}
              disabled={resetting}
              onPress={async () => {
                if (!resetToken || resetNewPassword.length < 6) {
                  setForgotStatus({ kind: 'error', message: 'Enter a valid token and a password of at least 6 characters.' });
                  return;
                }
                setResetting(true);
                try {
                  const response = await api.post('/auth/reset-password', {
                    token: resetToken.trim(),
                    new_password: resetNewPassword,
                  });
                  const sessionToken = response.data?.session_token;
                  if (sessionToken) {
                    // Auto-login by storing the token and triggering a refresh.
                    // The simplest path: close the modal and let the user sign in.
                    Alert.alert(
                      'Password reset',
                      'Your password has been updated. Please sign in with your new password.',
                      [{ text: 'OK', onPress: () => { setShowResetModal(false); } }],
                    );
                  } else {
                    Alert.alert('Password reset', response.data?.message || 'Password updated.');
                    setShowResetModal(false);
                  }
                  setResetToken('');
                  setResetNewPassword('');
                } catch (err: any) {
                  setForgotStatus({
                    kind: 'error',
                    message: err.response?.data?.detail || 'Could not reset password.',
                  });
                } finally {
                  setResetting(false);
                }
              }}
            >
              <Text style={styles.forgotSubmitText}>
                {resetting ? 'Resetting…' : 'Reset password'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: '#06060E' },
  safe:           { flex: 1 },
  content:        { flex: 1, paddingHorizontal: 20, justifyContent: 'space-between', paddingVertical: 20 },
  orb1:           { position: 'absolute', top: -80, right: -80, width: 280, height: 280, borderRadius: 140, overflow: 'hidden' },
  orb2:           { position: 'absolute', bottom: 60, left: -100, width: 260, height: 260, borderRadius: 130, overflow: 'hidden' },
  orbFill:        { flex: 1 },
  taglineRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  taglineLine:    { flex: 1, height: 1, backgroundColor: '#2A2A3E' },
  tagline:        { fontSize: 12, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  hexContainer:   { width: HEX_SIZE, height: HEX_SIZE, alignSelf: 'center', position: 'relative' },
  hexEdge:        { position: 'absolute', width: HEX_R, height: 1.5, backgroundColor: '#6366F1', borderRadius: 1 },
  spoke:          { position: 'absolute', height: 1, backgroundColor: '#6366F144', borderRadius: 1 },
  chip:           { position: 'absolute', width: CHIP_W, height: CHIP_H, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  chipLabel:      { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  logoWrapper:    { position: 'absolute', left: HEX_CX - 58, top: HEX_CY - 58, width: 116, height: 116, alignItems: 'center', justifyContent: 'center' },
  glowRing:       { position: 'absolute', width: 116, height: 116, borderRadius: 58, borderWidth: 1, borderColor: '#6366F166', backgroundColor: '#6366F108' },
  logoImage:      { width: 90, height: 90 },
  signIn:         { gap: 12 },
  errorBox:       { flexDirection: 'row', alignItems: 'center', backgroundColor: `${Colors.danger}15`, borderWidth: 1, borderColor: `${Colors.danger}40`, padding: 12, borderRadius: 12, gap: 8 },
  errorText:      { color: Colors.danger, fontSize: 13, flex: 1 },
  fieldGroup:     { gap: 10 },
  field:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141426', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A3E', paddingHorizontal: 12, height: 50 },
  fieldIcon:      { marginRight: 10 },
  input:          { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 0 },
  eyeBtn:         { position: 'absolute', right: 6, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10 },
  submitBtn:      { borderRadius: 14, overflow: 'hidden' },
  submitInner:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 8 },
  submitText:     { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  adminNote:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  adminNoteText:  { color: Colors.textMuted, fontSize: 12, textAlign: 'center', flexShrink: 1 },
  accentLine:     { height: 1, marginHorizontal: 32 },
  disclaimer:     { fontSize: 12, color: Colors.textMuted, textAlign: 'center', letterSpacing: 0.2, paddingBottom: 4 },
  // Forgot password / username
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 4,
  },
  forgotText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  forgotTabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.cardAlt,
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
  },
  forgotTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  forgotTabActive: {
    backgroundColor: Colors.primary,
  },
  forgotTabText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  forgotTabTextActive: {
    color: Colors.text,
    fontWeight: '600',
  },
  forgotHelp: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  forgotInput: {
    backgroundColor: Colors.cardAlt,
    borderRadius: 10,
    padding: 12,
    color: Colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  forgotError: {
    color: Colors.danger,
    fontSize: 13,
    marginBottom: 10,
  },
  forgotSuccess: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: `${Colors.success}15`,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  forgotSuccessText: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  forgotSubmit: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  forgotSubmitText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  forgotSecondaryLink: {
    color: Colors.primary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 14,
  },
});
