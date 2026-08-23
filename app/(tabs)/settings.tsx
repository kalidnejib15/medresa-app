import React, { useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, Platform } from 'react-native';
import { Text, List, Surface, Divider, Avatar, ActivityIndicator, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useSyncStatusStore } from '../../src/store/useSyncStatusStore';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/constants';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const { pendingCount, isSyncing, checkPending, lastError } = useSyncStatusStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    checkPending();
  }, []);

  const handleLogout = async () => {
    if (pendingCount > 0) {
      Alert.alert(
        i18n.language === 'am' ? 'ያልተላኩ መረጃዎች አሉ' : 'Unsynced Data Detected',
        i18n.language === 'am' 
          ? `በደመናው (Cloud) ላይ ያልተቀመጡ ${pendingCount} መረጃዎች አሉ። ካሁኑ ከወጡ እነዚህ መረጃዎች ሊጠፉ ይችላሉ።` 
          : `You have ${pendingCount} records that are not saved in the cloud. If you logout now, you might lose them.`,
        [
          { text: i18n.language === 'am' ? 'ቆይ' : 'Wait & Sync', style: 'cancel' },
          { 
            text: i18n.language === 'am' ? 'ለማንኛውም ውጣ' : 'Logout Anyway', 
            style: 'destructive', 
            onPress: async () => {
              await logout();
              router.replace('/');
            } 
          }
        ]
      );
      return;
    }

    await logout();
    router.replace('/');
  };

  const toggleLang = () => {
    const next = i18n.language === 'am' ? 'en' : 'am';
    i18n.changeLanguage(next);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
    >
      {/* ── PROFILE SECTION ── */}
      <View style={styles.profileArea}>
        <IconButton 
          icon="arrow-left" 
          iconColor={COLORS.primary} 
          size={24} 
          onPress={() => router.replace('/(tabs)/dashboard')}
          style={{ position: 'absolute', top: 5, left: 5, zIndex: 10 }}
        />
        <Avatar.Text 
          size={70} 
          label={(user?.name || 'A').substring(0, 1)} 
          style={{ backgroundColor: COLORS.primaryDark }}
          labelStyle={{ fontWeight: '900' }}
        />
        <Text style={styles.userName}>{user?.name}</Text>
        <View style={styles.roleBadge}>
           <Text style={styles.roleTxt}>
             {user?.role === 'admin' ? (i18n.language === 'am' ? 'አስተዳዳሪ' : 'Admin') : 
              user?.role === 'finance' ? (i18n.language === 'am' ? 'ፋይናንስ' : 'Finance') :
              user?.role === 'committee' ? (i18n.language === 'am' ? 'ኮሚቴ' : 'Committee') :
              (i18n.language === 'am' ? 'ኡስታዝ' : 'Ustaz')}
           </Text>
        </View>
      </View>

      <Surface style={styles.sectionCard} elevation={2}>
        <Text style={styles.sectionTitle}>{t('settings')}</Text>
        
        {/* Language Toggle */}
        <List.Item
          title={t('language')}
          description={i18n.language === 'am' ? 'የአሁኑ: አማርኛ' : 'Current: English'}
          left={p => <List.Icon {...p} icon="translate" color={COLORS.primary} />}
          right={p => (
            <View style={styles.langPill}>
              <Text style={styles.langPillTxt}>{i18n.language === 'am' ? 'English' : 'አማርኛ'}</Text>
            </View>
          )}
          onPress={toggleLang}
          style={styles.listItem}
        />
        
        <Divider style={styles.divider} />

        {/* Bylaws Link */}
        <List.Item
          title={i18n.language === 'am' ? 'መተዳደሪያ ደንብ' : 'Bylaws & Rules'}
          left={p => <List.Icon {...p} icon="book-open-outline" color={COLORS.primary} />}
          onPress={() => router.push('/(tabs)/bylaws')}
          style={styles.listItem}
        />
        
        <Divider style={styles.divider} />

        {/* Manual Sync Trigger */}
        <List.Item
          title={i18n.language === 'am' ? 'መረጃውን አሁኑኑ ላክ' : 'Sync All Now'}
          description={isSyncing ? (i18n.language === 'am' ? 'በመላክ ላይ...' : 'Uploading data...') : (i18n.language === 'am' ? 'ሁሉንም መረጃ ወደ Cloud ላክ' : 'Push all local edits to the cloud')}
          left={p => <List.Icon {...p} icon="rocket-launch" color={COLORS.primary} />}
          right={p => isSyncing && <ActivityIndicator size="small" color={COLORS.primary} />}
          onPress={async () => {
            const Network = require('expo-network');
            const state = await Network.getNetworkStateAsync();
            
            if (!state.isConnected) {
              Alert.alert(
                i18n.language === 'am' ? 'ከመስመር ውጭ ነዎት' : 'Device Offline',
                i18n.language === 'am' 
                  ? 'እባክዎ ዳታ ለመላክ ኢንተርኔት ያገናኙ።' 
                  : 'Please connect to the internet to upload your changes to the cloud.'
              );
              return;
            }

            const { syncAll } = require('../../src/lib/sync');
            try {
              await syncAll(true); // 🛰️ FORCE HEARTBEAT
              await checkPending();
              const { lastError: errAfter, pendingCount: pendingAfter } = useSyncStatusStore.getState();
              if (errAfter) {
                Alert.alert('Sync Error', errAfter);
              } else if (pendingAfter > 0) {
                Alert.alert(
                  i18n.language === 'am' ? 'በከፊል ተጠናቋል' : 'Partially Synced',
                  i18n.language === 'am'
                    ? `${pendingAfter} መረጃዎች አሁንም ወደ ደመናው አልተላኩም።`
                    : `${pendingAfter} item(s) could not be sent yet. Will retry automatically.`
                );
              } else {
                Alert.alert(
                  i18n.language === 'am' ? 'ተጠናቋል' : 'Sync Complete',
                  i18n.language === 'am' ? 'መረጃዎች በሙሉ ወደ ደመናው ተልከዋል' : 'All local changes have been successfully pushed to Supabase.'
                );
              }
            } catch (err) {
              Alert.alert('Sync Error', 'An unexpected error occurred during sync.');
            }
          }}
          disabled={isSyncing}
          style={styles.listItem}
        />
        
        <Divider style={styles.divider} />

        {/* Force Global Sync (Repair Tool) */}
        {user?.role === 'admin' && (
          <>
            <List.Item
              title={i18n.language === 'am' ? 'ሙሉ ለሙሉ በድጋሚ ላክ (Repair)' : 'Global Re-Sync (Repair)'}
              description={i18n.language === 'am' ? 'ሁሉንም መረጃዎች በድጋሚ ወደ Cloud ላክ' : 'Re-push every record to fix cloud matches'}
              left={p => <List.Icon {...p} icon="database-sync-outline" color="#b45309" />}
              onPress={() => {
                Alert.alert(
                  i18n.language === 'am' ? 'ሙሉ መረጃ ይላክ?' : 'Initiate Global Repair?',
                  i18n.language === 'am' 
                    ? 'ይህ ሁሉንም የአሁኑን መረጃዎች በድጋሚ ወደ Cloud ይልካል። ለጥገና (Maintenance) ብቻ ይጠቀሙ። መቀጠል ይፈልጋሉ?' 
                    : 'This will re-push all 16+ columns for every student and assignment. Use ONLY for maintenance. Proceed?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { 
                      text: 'Proceed', 
                      onPress: async () => {
                        const Network = require('expo-network');
                        const state = await Network.getNetworkStateAsync();
                        if (!state.isConnected) {
                          Alert.alert(
                            i18n.language === 'am' ? 'ከመስመር ውጭ ነዎት' : 'Device Offline',
                            i18n.language === 'am' 
                              ? 'እባክዎ ዳታ ለመላክ ኢንተርኔት ያገናኙ።' 
                              : 'Please connect to the internet before running a Repair.'
                          );
                          return;
                        }
                        const { useStudentStore } = require('../../src/store/useStudentStore');
                        await useStudentStore.getState().forceGlobalSync();
                        await checkPending();
                        const { lastError: errAfter, pendingCount: pendingAfter } = useSyncStatusStore.getState();
                        if (errAfter) {
                          Alert.alert('Repair Failed', errAfter);
                        } else if (pendingAfter > 0) {
                          Alert.alert(
                            'Repair Incomplete',
                            `${pendingAfter} item(s) still could not be sent to the cloud. Check your connection and try again.`
                          );
                        } else {
                          Alert.alert('Repair Complete', 'All institutional records have been re-pushed and confirmed in the cloud.');
                        }
                      } 
                    }
                  ]
                );
              }}
              style={styles.listItem}
            />
            <Divider style={styles.divider} />
          </>
        )}

        {/* Sync Status Info */}
        <List.Item
          title={i18n.language === 'am' ? 'የመረጃ ግንኙነት ሁኔታ' : 'Cloud Connectivity'}
          description={pendingCount > 0 
            ? `${pendingCount} ${i18n.language === 'am' ? 'ያልተላኩ መረጃዎች' : 'items waiting'}` 
            : (i18n.language === 'am' ? 'ሁሉም መረጃዎች ደህንነታቸው የተጠበቀ ነው' : 'All data is safe in cloud')}
          left={p => (
            <List.Icon 
              {...p} 
              icon={pendingCount > 0 ? "cloud-alert" : "cloud-check"} 
              color={pendingCount > 0 ? "#b45309" : "#16a34a"} 
            />
          )}
          style={styles.listItem}
        />
      </Surface>

      {/* ── LOGOUT ── */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <MaterialCommunityIcons name="logout" size={20} color="#dc2626" />
        <Text style={styles.logoutTxt}>{t('logout')}</Text>
      </TouchableOpacity>
      
      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  profileArea: { alignItems: 'center', paddingVertical: 40, backgroundColor: 'white', borderBottomLeftRadius: 36, borderBottomRightRadius: 36, elevation: 3, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  userName: { fontSize: 22, fontWeight: '900', color: '#1e293b', marginTop: 12 },
  roleBadge: { backgroundColor: COLORS.primaryFaded, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginTop: 6 },
  roleTxt: { fontSize: 11, fontWeight: '800', color: COLORS.primary, textTransform: 'uppercase' },

  sectionCard: { margin: 16, borderRadius: 20, backgroundColor: 'white', overflow: 'hidden' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#94a3b8', margin: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  listItem: { paddingVertical: 8 },
  divider: { marginHorizontal: 16 },

  langPill: { backgroundColor: COLORS.primaryDark, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignSelf: 'center' },
  langPillTxt: { color: 'white', fontSize: 11, fontWeight: '800' },

  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'center' },
  statusTxt: { fontSize: 10, fontWeight: '800' },

  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fef2f2', margin: 16, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: '#fee2e2' },
  logoutTxt: { marginLeft: 8, fontSize: 15, fontWeight: '800', color: '#dc2626' }
});
