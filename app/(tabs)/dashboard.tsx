import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { Text, Avatar, Surface, Divider, Portal, Modal, TextInput, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useAttendanceStore } from '../../src/store/useAttendanceStore';
import { useSyncStatusStore } from '../../src/store/useSyncStatusStore';
import { useStudentStore } from '../../src/store/useStudentStore';
import { useAnnouncementStore } from '../../src/store/useAnnouncementStore';
import { useFeeStore } from '../../src/store/useFeeStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { COLORS } from '../../src/constants';
import { useRouter, useFocusEffect } from 'expo-router';

/* ── POST MODAL COMPONENT (UNCONTROLLED REFS FOR MAX PERFORMANCE) ── */
const PostAnnouncementModal = React.memo(({ visible, onDismiss, onPostSuccess }: { visible: boolean, onDismiss: () => void, onPostSuccess: () => Promise<void> }) => {
  const { i18n } = useTranslation();
  const { user } = useAuthStore();
  const { addAnnouncement } = useAnnouncementStore();

  const titleRef = useRef('');
  const contentRef = useRef('');
  const [loading, setLoading] = useState(false);

  // Sync refs if modal closes and reopens (if needed) but usually announcements are one-off
  useEffect(() => {
    if (!visible) {
      titleRef.current = '';
      contentRef.current = '';
    }
  }, [visible]);

  const handlePostSubmit = async () => {
    const title = titleRef.current;
    const content = contentRef.current;
    if (!title || !content || !user) return;
    setLoading(true);
    try {
      const success = await addAnnouncement(title, content, 'general', user.id);
      if (success) {
        titleRef.current = '';
        contentRef.current = '';
        await onPostSuccess();
        onDismiss();
      } else {
        Alert.alert('Error', 'Failed to post announcement');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <Text style={styles.modalHeader}>{i18n.language === 'am' ? 'ማስታወቂያ ይልቀቁ' : 'Post Announcement'}</Text>
        <TextInput
          placeholder={i18n.language === 'am' ? 'ርዕስ' : 'Title'}
          defaultValue={titleRef.current}
          onChangeText={(v) => { titleRef.current = v; }}
          mode="outlined"
          style={styles.mInput}
          outlineStyle={{ borderRadius: 12 }}
        />
        <TextInput
          placeholder={i18n.language === 'am' ? 'መልእክት' : 'Content'}
          defaultValue={contentRef.current}
          onChangeText={(v) => { contentRef.current = v; }}
          mode="outlined"
          multiline
          numberOfLines={4}
          style={[styles.mInput, { height: 120 }]}
          outlineStyle={{ borderRadius: 12 }}
        />
        <Button
          mode="contained"
          onPress={handlePostSubmit}
          loading={loading}
          style={styles.pBtn}
        >
          {i18n.language === 'am' ? 'አሁን ልቀቅ' : 'PUBLISH'}
        </Button>
        <Button onPress={onDismiss} textColor="#64748b">Cancel</Button>
      </Modal>
    </Portal>
  );
});

/* ── SETTINGS MODAL ───────────────────────────────────────────────────────── */
const SettingsModal = React.memo(({ visible, onDismiss }: { visible: boolean, onDismiss: () => void }) => {
  const { i18n } = useTranslation();
  const { defaultFee, updateDefaultFee } = useSettingsStore();
  const [feeInput, setFeeInput] = useState(defaultFee.toString());

  useEffect(() => {
    setFeeInput(defaultFee.toString());
  }, [defaultFee, visible]);

  const handleSave = async () => {
    const val = parseInt(feeInput);
    if (!isNaN(val)) {
      await updateDefaultFee(val);
      onDismiss();
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <Text style={styles.modalHeader}>{i18n.language === 'am' ? 'የተቋሙ ቅንብሮች' : 'Institute Settings'}</Text>
        <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 15, textAlign: 'center' }}>
          {i18n.language === 'am' ? 'መደበኛ የወር ክፍያ (ለአዲስ ተማሪዎች እና ለወር ሂሳብ)' : 'Standard Monthly Fee (For new students and billing)'}
        </Text>
        <TextInput
          label={i18n.language === 'am' ? 'መደበኛ ክፍያ' : 'Default Fee'}
          value={feeInput}
          onChangeText={setFeeInput}
          mode="outlined"
          keyboardType="numeric"
          style={styles.mInput}
          outlineStyle={{ borderRadius: 12 }}
          left={<TextInput.Affix text="ETB " />}
        />
        <Button
          mode="contained"
          onPress={handleSave}
          style={styles.pBtn}
        >
          {i18n.language === 'am' ? 'ለውጦችን አስቀምጥ' : 'SAVE CHANGES'}
        </Button>
        <Button onPress={onDismiss} textColor="#64748b">Cancel</Button>
      </Modal>
    </Portal>
  );
});

export default function Dashboard() {
  const { i18n, t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  const { pendingCount, isSyncing, checkPending } = useSyncStatusStore();
  const { getTotalCount } = useStudentStore();
  const { getDailyAttendance } = useAttendanceStore();
  const { announcements, fetchAnnouncements } = useAnnouncementStore();
  const { fetchFees } = useFeeStore();
  const { fetchSettings } = useSettingsStore();

  const [totalStudents, setTotalStudents] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [stats, setStats] = useState({ present: 0, total: 0 });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const loadDashboardData = async () => {
    setIsRefreshing(true);
    try {
      await fetchSettings();
      const count = await getTotalCount();
      setTotalStudents(count);

      await fetchFees();
      const revenue = useFeeStore.getState().fees.reduce((acc, f) => acc + f.amount_paid, 0);
      setTotalRevenue(revenue);

      const dateStr = new Date().toISOString().split('T')[0];
      const attendance = await getDailyAttendance(dateStr, 'tb_morning');
      const present = attendance.filter((a: any) => a.status === 'present').length;
      setStats({ present, total: count });
      await checkPending();
      await fetchAnnouncements();
    } catch (e) { }
    setIsRefreshing(false);
  };

  const handleSystemReset = async () => {
    const title = i18n.language === 'am' ? 'ስርዓቱን ዳግም ያስጀምሩ?' : 'Reset System?';
    const msg = i18n.language === 'am' 
      ? 'ይህ የተማሪዎችን መረጃ በሙሉ ያጠፋል። ሰራተኞች ግን አይጠፉም። እርግጠኛ ነዎት?' 
      : 'This will delete ALL student data. Staff accounts will be kept. Are you sure?';

    Alert.alert(title, msg, [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'YES, DELETE ALL DATA', 
        style: 'destructive',
        onPress: async () => {
          const { wipeAllData } = require('../../src/lib/database');
          const success = await wipeAllData();
          if (success) {
            Alert.alert('Success', 'System reset for Production.');
            loadDashboardData();
          }
        }
      }
    ]);
  };

  useFocusEffect(useCallback(() => { loadDashboardData(); }, []));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={loadDashboardData} colors={[COLORS.primary]} />}
      >
        {/* UPPER HEADER */}
        <Surface style={[styles.header, { paddingTop: insets.top + 20 }]} elevation={4}>
          <View style={styles.headerContent}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                <MaterialCommunityIcons name="hand-wave" size={16} color="rgba(255,255,255,0.8)" style={{ marginRight: 6 }} />
                <Text style={styles.headerTitle}>{i18n.language === 'am' ? 'ሰላምታ' : 'Welcome back'},</Text>
              </View>
              <Text style={styles.headerUser} numberOfLines={1}>{user?.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                  <Text style={{ color: 'white', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {user?.role === 'admin' ? (i18n.language === 'am' ? 'አስተዳዳሪ' : 'Admin') : 
                     (user?.role === 'finance' ? (i18n.language === 'am' ? 'ፋይናንስ' : 'Finance') : 
                     (user?.role === 'committee' ? (i18n.language === 'am' ? 'ኮሚቴ' : 'Committee') : 
                     (i18n.language === 'am' ? 'ኡስታዝ' : 'Ustaz')))}
                  </Text>
                </View>
              </View>
            </View>
            <TouchableOpacity 
              style={styles.syncHeaderBtn} 
              onPress={async () => {
                const { syncAll } = await import('../../src/lib/sync');
                syncAll(true);
                Alert.alert(
                  i18n.language === 'am' ? 'ዳታው እየተመሳሰለ ነው' : 'Syncing...',
                  i18n.language === 'am' ? 'እባክዎን ትንሽ ይጠብቁ' : 'Please wait while we reconcile with the cloud ledger.'
                );
              }}
            >
              <MaterialCommunityIcons name="sync" size={24} color="white" />
              {isSyncing && (
                <View style={styles.syncPulse} />
              )}
            </TouchableOpacity>
            <Avatar.Text
              size={55}
              label={(user?.name || 'M')[0]}
              style={{ backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' }}
              labelStyle={{ color: COLORS.primaryDark, fontWeight: '900', fontSize: 24 }}
            />
          </View>
        </Surface>

        {/* 📣 NEWS REEL */}
        {announcements.length > 0 && (
          <View style={styles.announcementSection}>
            <View style={styles.announcementHeader}>
              <View style={styles.annHeaderIcon}>
                <MaterialCommunityIcons name="bullhorn-variant" size={16} color="white" />
              </View>
              <Text style={styles.announcementHeaderText}>
                {i18n.language === 'am' ? 'የቅርብ ጊዜ ማስታወቂያዎች' : 'Latest Updates'}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {announcements.filter(msg => msg && msg.id && msg.title).map((msg) => (
                <Surface key={msg.id} style={[styles.announcementCard, msg.type === 'important' && styles.announcementCardImportant]} elevation={3}>
                  <View style={styles.annCardTop}>
                    <View style={[styles.annTypeBadge, (msg.type || 'general') === 'important' && { backgroundColor: '#fef2f2' }]}>
                      <Text style={[styles.annTypeTxt, (msg.type || 'general') === 'important' && { color: '#ef4444' }]}>
                        {(msg.type || 'general').toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.annDate}>{new Date(msg.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
                  </View>

                  <Text style={styles.annTitle} numberOfLines={1}>{msg.title}</Text>
                  <Text style={styles.annBody} numberOfLines={2}>{msg.message}</Text>

                  <View style={styles.annFooter}>
                    <View style={styles.annAuthor}>
                      <MaterialCommunityIcons name="account-circle-outline" size={12} color="#94a3b8" />
                      <Text style={styles.annAuthorTxt}>{msg.sender || 'Medresa Admin'}</Text>
                    </View>
                    <MaterialCommunityIcons name="arrow-right" size={16} color={COLORS.primary} />
                  </View>
                </Surface>
              ))}
            </ScrollView>
          </View>
        )}

        {/* 🛡️ CLOUD SYNC CONTROL CENTER */}
        <Surface style={styles.syncPanel} elevation={1}>
          <View style={styles.syncHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.onlineDot, { backgroundColor: pendingCount === 0 ? '#10b981' : '#f59e0b' }]} />
              <Text style={styles.syncTitle}>
                {pendingCount === 0 
                  ? (i18n.language === 'am' ? 'ዳታው ተመሳስሏል' : 'All Data Protected') 
                  : (i18n.language === 'am' ? `${pendingCount} መረጃዎች አልተላኩም` : `${pendingCount} Local Updates Pending`)}
              </Text>
            </View>
            <View style={[styles.connBadge, { backgroundColor: isSyncing ? '#eff6ff' : '#f8fafc' }]}>
              <MaterialCommunityIcons 
                name={isSyncing ? "refresh" : "shield-check-outline"} 
                size={14} 
                color={isSyncing ? "#2563eb" : "#64748b"} 
                style={isSyncing ? { transform: [{ rotate: '0deg' }] } : {}} // Animation would need a ref, keeping it simple
              />
              <Text style={[styles.connTxt, { color: isSyncing ? "#2563eb" : "#64748b" }]}>
                {isSyncing ? 'SYNCING...' : 'CLOUD SECURE'}
              </Text>
            </View>
          </View>
          {pendingCount > 0 && (
            <View style={styles.syncActions}>
              <Text style={styles.syncHelp}>
                {i18n.language === 'am' 
                  ? 'ለውጦችን ለማስቀመጥ ኢንተርኔት ያገናኙ' 
                  : 'Connect to internet to secure your local changes.'}
              </Text>
              <TouchableOpacity 
                style={styles.syncBtn} 
                onPress={() => {
                  const { syncAll } = require('../../src/lib/sync');
                  syncAll();
                }}
              >
                <Text style={styles.syncBtnTxt}>{i18n.language === 'am' ? 'አሁን ላክ' : 'PULL UPDATES'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </Surface>

        <View style={styles.content}>
          {/* STATS TILES */}
          <View style={styles.statsRow}>
            <Surface style={styles.statBox} elevation={1}>
              <MaterialCommunityIcons name="account-group" size={24} color={COLORS.primary} />
              <Text style={styles.statValue}>{totalStudents}</Text>
              <Text style={styles.statLabel}>{i18n.language === 'am' ? 'ተማሪ' : 'Students'}</Text>
            </Surface>
            {user?.role !== 'finance' && (
              <Surface style={styles.statBox} elevation={1}>
                <MaterialCommunityIcons name="shield-check" size={24} color="#16a34a" />
                <Text style={styles.statValue}>{stats.present}</Text>
                <Text style={styles.statLabel}>{i18n.language === 'am' ? 'የተገኙ' : 'Present'}</Text>
              </Surface>
            )}
            <Surface style={styles.statBox} elevation={1}>
              <MaterialCommunityIcons name="wallet-outline" size={24} color="#0d9488" />
              <Text style={[styles.statValue, { color: '#0d9488' }]}>{totalRevenue}</Text>
              <Text style={styles.statLabel}>{i18n.language === 'am' ? 'ክፍያ' : 'Collected'}</Text>
            </Surface>
          </View>
{/* MASTER ACTION GRID */}
          <Text style={styles.gridTitle}>{i18n.language === 'am' ? 'ዋና ተግባራት' : 'Main Actions'}</Text>
          <View style={styles.grid}>
             {/* EVERYONE: Attendance */}
             {user?.role !== 'finance' && (
               <TouchableOpacity style={[styles.tile, { backgroundColor: '#f0fdf4', borderColor: '#dcfce7' }]} onPress={() => router.push('/(tabs)/attendance')}>
                  <MaterialCommunityIcons name="clipboard-check" size={32} color="#16a34a" />
                  <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'አቴንዳንስ' : 'Attendance'}</Text>
               </TouchableOpacity>
             )}

             {/* USTAZ ACTIONS — their day-to-day work: grading/marking students and
                 running their Kitab/Quran teams. Previously the grid only showed the
                 Attendance tile above for this role, leaving everything else to be
                 found via the bottom tab bar with no dashboard shortcut at all. */}
             {user?.role === 'ustaz' && (
               <>
                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#f0f9ff', borderColor: '#e0f2fe' }]} onPress={() => router.push('/(tabs)/students')}>
                    <MaterialCommunityIcons name="account-group" size={32} color="#0369a1" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ተማሪዎቼ' : 'My Students'}</Text>
                 </TouchableOpacity>

                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#fdf4ff', borderColor: '#fae8ff' }]} onPress={() => router.push('/(tabs)/teams')}>
                    <MaterialCommunityIcons name="account-multiple-outline" size={32} color="#a21caf" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ቡድኖቼ' : 'My Teams'}</Text>
                 </TouchableOpacity>

                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#f5f3ff', borderColor: '#ede9fe' }]} onPress={() => router.push('/(tabs)/notifications')}>
                    <MaterialCommunityIcons name="bell-outline" size={32} color="#7c3aed" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ማስታወቂያዎች' : 'Updates'}</Text>
                 </TouchableOpacity>
               </>
             )}

             {/* FINANCE ONLY ACTIONS */}
             {user?.role === 'finance' && (
               <>
                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#f0f9ff', borderColor: '#e0f2fe' }]} onPress={() => router.push('/(tabs)/students')}>
                    <MaterialCommunityIcons name="account-multiple-plus" size={32} color="#0369a1" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ተማሪዎች' : 'Students'}</Text>
                 </TouchableOpacity>
                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#f0fdfa', borderColor: '#ccfbf1' }]} onPress={() => router.push('/(tabs)/fees')}>
                    <MaterialCommunityIcons name="wallet-outline" size={32} color="#0d9488" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ክፍያ' : 'Finance'}</Text>
                 </TouchableOpacity>
               </>
             )}

             {/* ADMIN & COMMITTEE ACTIONS */}
             {(user?.role === 'admin' || user?.role === 'committee') && (
               <>
                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#f0f9ff', borderColor: '#e0f2fe' }]} onPress={() => router.push('/(tabs)/students')}>
                    <MaterialCommunityIcons name="account-multiple-plus" size={32} color="#0369a1" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ተማሪዎች' : 'Students'}</Text>
                 </TouchableOpacity>
                 
                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#fdf4ff', borderColor: '#fae8ff' }]} onPress={() => router.push('/(admin)/teachers')}>
                    <MaterialCommunityIcons name="account-tie" size={32} color="#a21caf" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ኡስታዞች' : 'Teachers'}</Text>
                 </TouchableOpacity>

                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#fef2f2', borderColor: '#fee2e2' }]} onPress={() => router.push('/(admin)/reports')}>
                    <MaterialCommunityIcons name="chart-box" size={32} color="#dc2626" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ሪፖርቶች' : 'Reports'}</Text>
                 </TouchableOpacity>

                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#fff7ed', borderColor: '#ffedd5' }]} onPress={() => router.push('/(admin)/students/bulk-assign')}>
                    <MaterialCommunityIcons name="folder-account" size={32} color="#ea580c" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'የቡድን ምደባ' : 'Groups'}</Text>
                 </TouchableOpacity>

                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#f5f3ff', borderColor: '#ede9fe' }]} onPress={() => setShowPostModal(true)}>
                    <MaterialCommunityIcons name="bullhorn-variant" size={32} color="#7c3aed" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ማስታወቂያ' : 'Post News'}</Text>
                 </TouchableOpacity>

                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#f0fdfa', borderColor: '#ccfbf1' }]} onPress={() => router.push('/(tabs)/fees')}>
                    <MaterialCommunityIcons name="wallet-outline" size={32} color="#0d9488" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ክፍያ' : 'Finance'}</Text>
                 </TouchableOpacity>

                 <TouchableOpacity style={[styles.tile, { backgroundColor: '#fff1f2', borderColor: '#ffe4e6' }]} onPress={() => router.push('/(admin)/manage-subjects')}>
                    <MaterialCommunityIcons name="book-open-variant" size={32} color="#e11d48" />
                    <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ኪታቦች' : 'Kitabs'}</Text>
                 </TouchableOpacity>
                  <TouchableOpacity style={[styles.tile, { backgroundColor: '#fef3c7', borderColor: '#fde68a' }]} onPress={() => router.push('/(admin)/teacher-attendance')}>
                     <MaterialCommunityIcons name="account-clock" size={32} color="#d97706" />
                     <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'የዑስታዝ አቴንዳንስ' : 'Staff Attendance'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.tile, { backgroundColor: '#f1f5f9', borderColor: '#e2e8f0' }]} onPress={() => setShowSettingsModal(true)}>
                     <MaterialCommunityIcons name="cog-outline" size={32} color="#64748b" />
                     <Text style={styles.tileTxt}>{i18n.language === 'am' ? 'ቅንብሮች' : 'Settings'}</Text>
                  </TouchableOpacity>
               </>
             )}
          </View>

          {user?.role === 'admin' && (
            <TouchableOpacity 
              style={styles.resetBtn} 
              onPress={handleSystemReset}
            >
              <MaterialCommunityIcons name="database-remove" size={20} color="#ef4444" />
              <Text style={styles.resetBtnTxt}>
                {i18n.language === 'am' ? 'የተማሪዎችን ዳታ አጥፋ (ለንፁህ ጅምር)' : 'CLEAN START (REMOVE SAMPLES)'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <PostAnnouncementModal
        visible={showPostModal}
        onDismiss={() => setShowPostModal(false)}
        onPostSuccess={fetchAnnouncements}
      />

      <SettingsModal
        visible={showSettingsModal}
        onDismiss={() => setShowSettingsModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: COLORS.primaryDark, paddingBottom: 40, borderBottomLeftRadius: 36, borderBottomRightRadius: 36, paddingHorizontal: 25 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700' },
  headerUser: { color: 'white', fontSize: 26, fontWeight: '900', marginTop: 4 },
  syncHeaderBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 15 },
  syncPulse: { position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' },

  content: { padding: 20 },

  announcementSection: { marginTop: 25, marginBottom: 5 },
  announcementHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 15 },
  annHeaderIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  announcementHeaderText: { fontSize: 13, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 },

  announcementCard: { width: 280, backgroundColor: 'white', borderRadius: 28, padding: 22, marginRight: 15, borderWidth: 1, borderColor: '#f1f5f9' },
  announcementCardImportant: { borderLeftWidth: 6, borderLeftColor: '#ef4444', backgroundColor: '#fffcfc' },
  annCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  annTypeBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  annTypeTxt: { fontSize: 9, fontWeight: '900', color: '#64748b', letterSpacing: 0.5 },
  annDate: { fontSize: 11, color: '#94a3b8', fontWeight: '700' },

  annTitle: { fontSize: 18, fontWeight: '900', color: '#1e293b', marginBottom: 8, letterSpacing: -0.5 },
  annBody: { fontSize: 13, color: '#64748b', lineHeight: 20, marginBottom: 18 },

  annFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f8fafc' },
  annAuthor: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  annAuthorTxt: { fontSize: 10, fontWeight: '800', color: '#cbd5e1', textTransform: 'uppercase' },

  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 30 },
  statBox: { flex: 1, backgroundColor: 'white', borderRadius: 24, padding: 18, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '900', color: '#1e293b', marginTop: 8 },
  statLabel: { fontSize: 11, fontWeight: '800', color: '#94a3b8', marginTop: 2 },

  gridTitle: { fontSize: 18, fontWeight: '900', color: '#1e293b', marginBottom: 15, marginLeft: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '48%', padding: 22, borderRadius: 28, borderWidth: 1.5, minHeight: 130, justifyContent: 'center' },
  tileTxt: { fontSize: 15, fontWeight: '900', color: '#1e293b', marginTop: 12 },

  modal: { backgroundColor: 'white', padding: 30, margin: 20, borderRadius: 32 },
  modalHeader: { fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 20 },
  mInput: { marginBottom: 15, backgroundColor: 'white' },
  pBtn: { marginTop: 10, paddingVertical: 8, borderRadius: 15, backgroundColor: COLORS.primaryDark },

  syncPanel: { marginHorizontal: 20, marginTop: 15, backgroundColor: 'white', borderRadius: 28, padding: 20, borderStyle: 'dashed', borderWidth: 1, borderColor: '#e2e8f0' },
  syncHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  onlineDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  syncTitle: { fontSize: 13, fontWeight: '800', color: '#1e293b' },
  connBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  connTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  syncActions: { marginTop: 15, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#f1f5f9', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  syncHelp: { fontSize: 11, color: '#64748b', flex: 1, paddingRight: 15 },
  syncBtn: { backgroundColor: COLORS.primaryDark, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  syncBtnTxt: { color: 'white', fontSize: 11, fontWeight: '900' },

  resetBtn: { 
    marginTop: 40, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: '#fee2e2',
    borderRadius: 15,
    backgroundColor: '#fffcfc'
  },
  resetBtnTxt: { color: '#ef4444', fontSize: 13, fontWeight: '800' }
});
