import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments, Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { useAuthStore } from '../src/store/authStore';
import { Colors } from '../src/components/ThemedComponents';

export default function RootLayout() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  // Deep link handler: bizcorev2://reset-password?token=...
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = Linking.parse(url);
        if (parsed.path === 'reset-password' && parsed.queryParams?.token) {
          // Route to login with the token pre-filled.
          router.replace({
            pathname: '/(auth)/login',
            params: { resetToken: String(parsed.queryParams.token) },
          });
        }
      } catch (err) {
        console.warn('deep link parse failed', err);
      }
    };
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    Linking.getInitialURL().then(handleUrl);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to login
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect to main app
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
