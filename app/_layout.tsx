import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../src/store/useAuthStore';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as SplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator } from 'react-native';
import '../src/i18n';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { registerBackgroundSyncTask } from '../src/lib/backgroundTasks';

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1a6b3c',
    secondary: '#2e8c56',
    tertiary: '#fcc419',
    background: '#ffffff',
    surface: '#ffffff',
    onSurface: '#000000',
    onSurfaceVariant: '#333333',
    outline: '#E0E0E0',
    placeholder: '#666666',
    elevation: {
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#FFFFFF',
      level3: '#FFFFFF',
      level4: '#FFFFFF',
      level5: '#FFFFFF',
    },
  },
};

SplashScreen.preventAutoHideAsync();

let syncInterval: any = null;

export default function RootLayout() {
  const { user, isLoading, restoreSession } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => {
    const { useAuthStore } = require('../src/store/useAuthStore');

    async function prepare() {
      setIsMounted(true);

      // Step 1: DB init — isolated, never blocks login even if it fails
      try {
        const { initDatabase } = require('../src/lib/database');
        await initDatabase();
      } catch (e) {
        console.warn('[Boot] DB init warning (non-fatal):', e);
      }

      // Step 2: Restore session — always runs regardless of step 1
      try {
        await restoreSession();
      } catch (e) {
        console.warn('[Boot] Session restore warning (non-fatal):', e);
        // Safety: force isLoading to false so auth guard doesn't get stuck
        useAuthStore.getState().clearError?.();
      }

      // Step 3: Mark app ready (always)
      setAppIsReady(true);

      // Step 4: Fire sync after everything is ready (non-blocking)
      setTimeout(() => {
        try {
          const { syncAll } = require('../src/lib/sync');
          syncAll().catch(() => {});
        } catch (_) {}
      }, 1000);
    }

    // 🛡️ EMERGENCY: If isLoading stays stuck after 5s, force-clear it
    const emergencyTimer = setTimeout(() => {
      const state = useAuthStore.getState();
      if (state.isLoading) {
        console.warn('[Boot] Emergency: forcing isLoading=false after timeout');
        state.clearError?.();
        // Directly force the state
        useAuthStore.setState({ isLoading: false });
      }
    }, 5000);

    prepare().finally(() => clearTimeout(emergencyTimer));

    const { requestNotificationPermissions } = require('../src/lib/notifications');
    const Notifications = require('expo-notifications');
    const { useNoticeStore } = require('../src/store/useNoticeStore');
    
    requestNotificationPermissions();
    registerBackgroundSyncTask();

    // 🔔 NOTIFICATION TAP LISTENER
    const subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response.notification.request.content.data;
      if (data?.title) {
        useNoticeStore.getState().addNotice({
          id: data.id || Date.now().toString(),
          title: data.title,
          message: data.message || response.notification.request.content.body,
          sender: data.sender || 'Admin',
          created_at: new Date().toISOString()
        });
        router.push('/(tabs)/notifications');
      }
    });

    // 30s background sync pulse
    syncInterval = setInterval(() => {
      const { syncAll } = require('../src/lib/sync');
      syncAll().catch((e: any) => console.warn('Background Sync Tick Error:', e));
    }, 30000);

    return () => {
      if (syncInterval) clearInterval(syncInterval);
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (appIsReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appIsReady]);

  useEffect(() => {
    if (isLoading || !isMounted || !appIsReady) return;

    const route = segments[0] as string;
    const inTabs = route === '(tabs)';
    const inAdmin = route === '(admin)';
    
    // Auth Guard with Safety
    if (!user && (inTabs || inAdmin)) {
      router.replace('/');
    } else if (user && route !== '(tabs)' && route !== '(admin)') {
      if (user.role === 'finance') {
        router.replace('/(tabs)/fees');
      } else {
        router.replace('/(tabs)/dashboard');
      }
    }
  }, [user, isLoading, segments, isMounted, appIsReady]);

  if (!appIsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1a6b3c', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  return (
    <PaperProvider theme={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(admin)" options={{ presentation: 'modal' }} />
      </Stack>
    </PaperProvider>
  );
}
