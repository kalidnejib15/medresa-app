import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { Text, Surface, Avatar, ActivityIndicator, Divider, Portal, Modal, TextInput, Button, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useTeacherAttendanceStore, TeacherAttendanceStatus } from '../../src/store/useTeacherAttendanceStore';
import { COLORS } from '../../src/constants';
import { getDatabase } from '../../src/lib/database';
import { getLocalDateString } from '../../src/lib/dateUtils';
import DateTimePicker from '@react-native-community/datetimepicker';

const STATUS_CONFIG: Record<string, { label: string; am: string; icon: any; color: string; bg: string }> = {
  present: { label: 'Present', am: 'ተገኝቷል', icon: 'check-circle', color: '#16a34a', bg: '#f0fdf4' },
  late: { label: 'Late', am: 'ዘግይቷል', icon: 'clock-alert', color: '#d97706', bg: '#fffbeb' },
  absent: { label: 'Absent', am: 'ቀርቷል', icon: 'close-circle', color: '#dc2626', bg: '#fef2f2' },
  excused: { label: 'Excused', am: 'ፈቃድ', icon: 'account-clock', color: '#0284c7', bg: '#f0f9ff' },
  unmarked: { label: 'Unmarked', am: 'ያልተሞላ', icon: 'help-circle', color: '#64748b', bg: '#f1f5f9' }
};

export default function TeacherAttendanceScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user, getUstazs } = useAuthStore();
  const { records, fetchDailyAttendance, markTeacherAttendance } = useTeacherAttendanceStore();

  const [ustazs, setUstazs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string | null>(null);
  const [selectedTeacher, setSelectedTeacher] = useState<any>(null);
  const [showLateModal, setShowLateModal] = useState(false);
  const [arrivalTime, setArrivalTime] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      // 🛡️ ULTRA-STRICT ROSTER: Directly query the source of truth
      const activeUstazs = (await db.getAllAsync('SELECT * FROM users WHERE role = "ustaz" AND is_active = 1')) as any[];
      setUstazs(activeUstazs || []);

      const dateStr = getLocalDateString(selectedDate);
      await fetchDailyAttendance(dateStr);
    } catch (e) {
      console.error('Teacher Attendance Load Error:', e);
      Alert.alert('Error', 'Failed to load staff roster.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickMark = async (teacherId: string, status: TeacherAttendanceStatus) => {
    if (status === 'late') {
      const tc = ustazs.find(u => u.id === teacherId);
      setSelectedTeacher(tc);
      const now = new Date();
      setArrivalTime(`${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`);
      setShowLateModal(true);
      return;
    }

    setMarking(teacherId);
    const dateStr = getLocalDateString(selectedDate);
    await markTeacherAttendance(teacherId, status, user?.id || 'admin', undefined, undefined, dateStr);
    await fetchDailyAttendance(dateStr);
    setMarking(null);
  };

  const generatePDFReport = async () => {
    const { printToFileAsync } = await import('expo-print');
    const { shareAsync } = await import('expo-sharing');
    const { LOGO_BASE64 } = require('../../src/constants/logoBase64');

    const dateStr = selectedDate.toDateString();

    const tableRows = ustazs.map(ustaz => {
      const record = records.find(r => r.teacher_id === ustaz.id);
      const status = record?.status || 'unmarked';
      const statusLabel = i18n.language === 'am' ? (STATUS_CONFIG[status]?.am || 'ያልተሞላ') : (STATUS_CONFIG[status]?.label || 'Unmarked');
      const arrival = record?.arrival_time || '-';
      return `
        <tr>
          <td>${ustaz.name}</td>
          <td>${ustaz.phone}</td>
          <td style="color: ${STATUS_CONFIG[status]?.color || '#64748b'}; font-weight: bold;">
            ${statusLabel}
          </td>
          <td>${arrival}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <html>
        <head>
          <style>
            body { font-family: sans-serif; padding: 20px; color: #1e293b; }
            .header { text-align: center; border-bottom: 3px solid #1a6b3c; padding-bottom: 15px; margin-bottom: 25px; }
            .logo { width: 90px; height: 90px; margin-bottom: 12px; border-radius: 15px; }
            .title { font-size: 26px; font-weight: bold; color: #1a6b3c; margin: 0; }
            .subtitle { font-size: 15px; color: #64748b; margin-top: 6px; }
            table { width: 100%; border-collapse: collapse; margin-top: 25px; }
            th { background-color: #f1f5f9; color: #475569; padding: 14px; text-align: left; border-bottom: 2px solid #e2e8f0; font-size: 12px; text-transform: uppercase; }
            td { padding: 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
            .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 15px; }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="${LOGO_BASE64}" class="logo" />
            <div class="title">Abubeker Medresa (አቡበከር መድረሳ)</div>
            <div class="subtitle">Official Staff Attendance Report | የዑስታዞች የአቴንዳንስ ሪፖርት</div>
            <div class="subtitle">Date: ${dateStr}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Teacher Name (ስም)</th>
                <th>Phone (ስልክ)</th>
                <th>Status (ሁኔታ)</th>
                <th>Arrival (ሰዓት)</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
          <div class="footer">Generated by Medresa Management System © ${new Date().getFullYear()}</div>
        </body>
      </html>
    `;

    const { uri } = await printToFileAsync({ html });
    await shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
  };

  const submitLate = async () => {
    if (!selectedTeacher) return;
    setMarking(selectedTeacher.id);
    const dateStr = getLocalDateString(selectedDate);
    await markTeacherAttendance(selectedTeacher.id, 'late', user?.id || 'admin', arrivalTime, notes, dateStr);
    await fetchDailyAttendance(dateStr);
    setShowLateModal(false);
    setMarking(null);
    setNotes('');
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Surface style={styles.header} elevation={4}>
        <View style={styles.headerRow}>
          <IconButton icon="arrow-left" iconColor="white" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{i18n.language === 'am' ? 'የዑስታዞች አቴንዳንስ' : 'Staff Attendance'}</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateSelector}>
              <MaterialCommunityIcons name="calendar-month" size={14} color="rgba(255,255,255,0.7)" />
              <Text style={styles.subtitle}>{selectedDate.toDateString()}</Text>
              <MaterialCommunityIcons name="chevron-down" size={14} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={generatePDFReport} style={styles.headerExportBtn}>
            <MaterialCommunityIcons name="printer" size={20} color="white" />
          </TouchableOpacity>
        </View>
      </Surface>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, date) => {
            setShowDatePicker(false);
            if (date) setSelectedDate(date);
          }}
        />
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 15 }}>
        {ustazs.length === 0 ? (
          <Surface style={styles.emptyCard} elevation={1}>
            <MaterialCommunityIcons name="account-off-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>{i18n.language === 'am' ? 'ምንም ንቁ አስተማሪ አልተገኘም' : 'No active staff members found.'}</Text>
          </Surface>
        ) : (
          ustazs.map((ustaz) => {
            const record = records.find((r: { teacher_id: any; }) => r.teacher_id === ustaz.id);
            const currentStatus = record?.status;
            const isMarking = marking === ustaz.id;

            return (
              <Surface key={ustaz.id} style={styles.teacherCard} elevation={1}>
                <View style={styles.cardInfo}>
                  <Avatar.Text size={40} label={ustaz.name[0]} style={{ backgroundColor: COLORS.primaryFaded }} color={COLORS.primary} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.teacherName}>{ustaz.name}</Text>
                    <Text selectable={true} style={styles.teacherPhone}>{ustaz.phone}</Text>
                    {record?.arrival_time && (
                      <Text style={styles.lateTxt}>🕒 {i18n.language === 'am' ? 'የመጣበት ሰዓት' : 'Arrival'}: {record.arrival_time}</Text>
                    )}
                  </View>
                  {currentStatus && !isMarking && (
                    <View style={[styles.statusIndicator, { backgroundColor: STATUS_CONFIG[currentStatus].bg }]}>
                      <MaterialCommunityIcons name={STATUS_CONFIG[currentStatus].icon} size={16} color={STATUS_CONFIG[currentStatus].color} />
                      <Text style={[styles.statusIndicatorTxt, { color: STATUS_CONFIG[currentStatus].color }]}>
                        {i18n.language === 'am' ? STATUS_CONFIG[currentStatus].am : STATUS_CONFIG[currentStatus].label}
                      </Text>
                    </View>
                  )}
                  {isMarking && <ActivityIndicator size="small" color={COLORS.primary} />}
                </View>

                <View style={styles.actionRow}>
                    {(['present', 'late', 'absent', 'excused'] as TeacherAttendanceStatus[]).map((st) => {
                      const canEdit = user?.role === 'admin';
                      return (
                        <TouchableOpacity
                          key={st}
                          disabled={!canEdit}
                          style={[
                            styles.statusBtn,
                            currentStatus === st && { backgroundColor: STATUS_CONFIG[st].color, borderColor: STATUS_CONFIG[st].color },
                            !canEdit && { opacity: 0.5 }
                          ]}
                          onPress={() => handleQuickMark(ustaz.id, st)}
                        >
                          <MaterialCommunityIcons
                            name={STATUS_CONFIG[st].icon}
                            size={18}
                            color={currentStatus === st ? 'white' : STATUS_CONFIG[st].color}
                          />
                          <Text style={[styles.statusBtnTxt, { color: currentStatus === st ? 'white' : '#64748b' }]}>
                            {i18n.language === 'am' ? STATUS_CONFIG[st].am : STATUS_CONFIG[st].label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                </View>
              </Surface>
            );
          })
        )}
      </ScrollView>

      <Portal>
        <Modal visible={showLateModal} onDismiss={() => setShowLateModal(false)} contentContainerStyle={styles.modal}>
          <Text style={styles.modalTitle}>{i18n.language === 'am' ? 'የመዘግየት መረጃ' : 'Late Arrival Details'}</Text>
          <Text style={styles.modalTeacher}>{selectedTeacher?.name}</Text>
          <TextInput
            label={i18n.language === 'am' ? 'የመጣበት ሰዓት' : 'Arrival Time (HH:MM)'}
            value={arrivalTime}
            onChangeText={setArrivalTime}
            mode="outlined"
            style={styles.input}
          />
          <TextInput
            label={i18n.language === 'am' ? 'ማስታወሻ' : 'Notes / Reason'}
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
          />
          <View style={styles.modalActions}>
            <Button onPress={() => setShowLateModal(false)}>{i18n.language === 'am' ? 'ሰርዝ' : 'Cancel'}</Button>
            <Button mode="contained" onPress={submitLate} style={{ backgroundColor: COLORS.primary }}>
              {i18n.language === 'am' ? 'መዝግብ' : 'SAVE'}
            </Button>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: COLORS.primaryDark, paddingBottom: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 50 : 20 },
  title: { color: 'white', fontSize: 22, fontWeight: '900' },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  dateSelector: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  headerExportBtn: { backgroundColor: 'rgba(255,255,255,0.15)', padding: 10, borderRadius: 12, marginRight: 15 },
  scroll: { flex: 1 },
  teacherCard: { backgroundColor: 'white', borderRadius: 20, marginBottom: 15, padding: 15 },
  cardInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  teacherName: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  teacherPhone: { fontSize: 12, color: '#64748b' },
  statusIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusIndicatorTxt: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  lateTxt: { fontSize: 11, color: '#d97706', fontWeight: '700', marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  statusBtn: { flex: 1, minWidth: '22%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  statusBtnTxt: { fontSize: 10, fontWeight: '800' },
  emptyCard: { margin: 20, padding: 40, alignItems: 'center', borderRadius: 20, backgroundColor: 'white' },
  emptyTxt: { marginTop: 10, color: '#64748b', fontWeight: 'bold' },
  modal: { backgroundColor: 'white', padding: 25, margin: 20, borderRadius: 24 },
  modalTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  modalTeacher: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 20 },
  input: { marginBottom: 15, backgroundColor: 'white' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
});