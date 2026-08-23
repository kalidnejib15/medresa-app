import React from 'react';
import { Tabs } from 'expo-router';
import { IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/useAuthStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants';

export default function TabLayout() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        height: 60 + insets.bottom,
        paddingBottom: 8 + insets.bottom,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
      },
      tabBarActiveTintColor: COLORS.primary,
      tabBarInactiveTintColor: '#9e9e9e',
      tabBarLabelStyle: {
        fontWeight: '600',
        fontSize: 11,
      }
    }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('dashboard') || 'Dashboard',
          tabBarIcon: ({ color }) => <IconButton icon="view-dashboard" iconColor={color} size={24} style={{ margin: 0 }} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: t('students') || 'Students',
          tabBarIcon: ({ color }) => <IconButton icon="account-group" iconColor={color} size={24} style={{ margin: 0 }} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: t('attendance') || 'Attendance',
          href: user?.role === 'finance' ? null : '/(tabs)/attendance',
          tabBarIcon: ({ color }) => <IconButton icon="calendar-check" iconColor={color} size={24} style={{ margin: 0 }} />,
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: t('teams') || 'Teams',
          href: (user?.role === 'finance' || user?.role === 'committee') ? null : '/(tabs)/teams',
          tabBarIcon: ({ color }) => <IconButton icon="account-multiple-outline" iconColor={color} size={24} style={{ margin: 0 }} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: i18n.language === 'am' ? 'መልዕክቶች' : 'Updates',
          tabBarIcon: ({ color }) => <IconButton icon="bell" iconColor={color} size={24} style={{ margin: 0 }} />,
        }}
      />
      {/* ── FINANCE TAB (Admin/Finance Only) ── */}
      <Tabs.Screen
        name="fees"
        options={{
          title: t('fees'),
          href: user?.role === 'ustaz' ? null : '/(tabs)/fees',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="wallet-membership" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings') || 'Settings',
          tabBarIcon: ({ color }) => <IconButton icon="cog" iconColor={color} size={24} style={{ margin: 0 }} />,
        }}
      />
      <Tabs.Screen
        name="bylaws"
        options={{
          title: i18n.language === 'am' ? 'መመሪያ' : 'Bylaws',
          tabBarIcon: ({ color }) => <IconButton icon="gavel" iconColor={color} size={24} style={{ margin: 0 }} />,
        }}
      />
    </Tabs>
  );
}
