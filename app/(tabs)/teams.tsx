import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import {
  Text, Surface, Avatar, IconButton,
  Portal, Modal, TextInput, ActivityIndicator, Button, Chip
} from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useTeamStore, TeamWithMembers, TeamType, TEAM_EMOJI_OPTIONS, getTeamColor, MAX_TEAM_SIZE, MIN_TEAM_SIZE } from '../../src/store/useTeamStore';
import { useAttendanceStore } from '../../src/store/useAttendanceStore';
import { useProgressStore } from '../../src/store/useProgressStore';
import { usePDFStore } from '../../src/store/usePDFStore';
import { getLocalDateString } from '../../src/lib/dateUtils';
import { COLORS } from '../../src/constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type Status = 'present' | 'late' | 'excused' | 'absent' | 'none';

// 🛡️ Kept identical to app/(tabs)/attendance.tsx so a team mark looks and behaves
// exactly like the normal Attendance screen (same colors/icons/labels).
const STATUS_UI: Record<string, { bg: string; border: string; text: string; label: string; icon: string }> = {
  present: { bg: '#dcfce7', border: '#16a34a', text: '#16a34a', label: 'Present', icon: 'check-circle' },
  late: { bg: '#fef3c7', border: '#d97706', text: '#d97706', label: 'Late', icon: 'clock-alert-outline' },
  excused: { bg: '#e0f2fe', border: '#0284c7', text: '#0284c7', label: 'Excused', icon: 'shield-check-outline' },
  absent: { bg: '#fee2e2', border: '#dc2626', text: '#dc2626', label: 'Absent', icon: 'close-circle' },
  none: { bg: '#f1f5f9', border: '#e2e8f0', text: '#94a3b8', label: '—', icon: 'minus' },
};

export default function TeamsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const lang = i18n.language;
  const user = useAuthStore(s => s.user);

  const { teams, isLoading, fetchTeams, createTeam, deleteTeam, getUnassignedStudents, getTeamStreak } = useTeamStore();
  const { markAttendance, fetchAttendance, clearAttendance } = useAttendanceStore();
  const { saveProgress, getDailyProgress, getLastProgress } = useProgressStore();
  const { generateTeamReport, isGenerating: pdfGenerating } = usePDFStore();

  const [streaks, setStreaks] = useState<Record<string, number>>({});

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  // 🌓 Quran vs Kitab tab — mirrors attendance.tsx's morning/afternoon session toggle.
  const [teamType, setTeamType] = useState<TeamType>('quran');
  const timeBlock = useMemo<'tb_morning' | 'tb_afternoon'>(
    () => teamType === 'kitab' ? 'tb_afternoon' : 'tb_morning',
    [teamType]
  );
  const [attendanceMap, setAttendanceMap] = useState<Record<string, Status | null>>({});
  const [progressMap, setProgressMap] = useState<Record<string, any>>({});
  // 🆕 "Brought Kitab" flags — same storage convention as attendance.tsx: encoded as
  // 'Kitab: Yes' / 'Kitab: No' inside the attendance record's notes field, so a value
  // set here reads back correctly on the main Attendance tab's Kitab session and vice versa.
  const [kitabMap, setKitabMap] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // 🛡️ EDIT LOCK: rows load in "locked" (view-only) mode so a stray tap while
  // scrolling can't silently flip a student's attendance or overwrite their
  // qirat progress. The ustaz must explicitly tap "Edit" to unlock — same
  // pattern as the main Attendance tab — before any status/progress button
  // actually does anything.
  const [isEditing, setIsEditing] = useState(false);

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  const [createVisible, setCreateVisible] = useState(false);
  const [candidateStudents, setCandidateStudents] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  const [progressModal, setProgressModal] = useState<{ visible: boolean; student: any | null }>({ visible: false, student: null });
  const [savingProgress, setSavingProgress] = useState(false);
  // 🆕 "Where they left off" pre-fill — same feature as the main Attendance tab's
  // Qirat modal: when a student has no progress record for today yet, we look up
  // their last recorded page/ayah range and hand it to the modal as a prop so it can
  // pre-fill the fields (still fully editable), plus show a small hint where it came from.
  const [lastProgress, setLastProgress] = useState<{ page_number: string; ayah_from: string; ayah_to: string; date: string } | null>(null);
  // 🛡️ Guards the async last-progress lookup in openProgress: if the ustaz taps Qirat on
  // a different student before the lookup resolves, the stale result is discarded instead
  // of landing on the wrong student's modal.
  const progressStudentRef = useRef<string | null>(null);

  if ((user?.role as any) === 'finance' || (user?.role as any) === 'committee') {
    return (
      <View style={[styles.container, styles.center]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={80} color="#cbd5e1" />
        <Text style={{ marginTop: 15, fontSize: 18, fontWeight: '900', color: '#1e293b' }}>
          {lang === 'am' ? 'ይህ ክፍል አልተፈቀደም' : 'Access Restricted'}
        </Text>
      </View>
    );
  }

  const loadAllRequestRef = useRef(0);

  const loadAll = useCallback(async () => {
    if (!user) return;
    // 🛡️ STALE-RESPONSE GUARD: loadAll can be triggered twice close together
    // (plain useEffect + useFocusEffect both fire on focus/dependency change). If an
    // older call's fetch resolves after a newer one, it would overwrite attendanceMap
    // with out-of-date data — including data from before a mark you just tapped and
    // saved, making it look like the app "forgot" what you just set. Only the most
    // recently-started call is allowed to apply its results.
    const requestId = ++loadAllRequestRef.current;
    await fetchTeams(user.id, teamType);

    const dateStr = getLocalDateString(selectedDate);
    try {
      const attRows = await fetchAttendance(dateStr, timeBlock, user.id);
      if (requestId === loadAllRequestRef.current) {
        const amap: Record<string, Status | null> = {};
        const kmap: Record<string, boolean> = {};
        (attRows || []).forEach((r: any) => {
          if (r?.student_id) {
            amap[r.student_id] = r.status;
            kmap[r.student_id] = r.notes?.includes('Kitab: Yes') ? true : false;
          }
        });
        setAttendanceMap(amap);
        setKitabMap(kmap);
      }
    } catch { }

    try {
      const rows = await getDailyProgress(dateStr, undefined, user.id, teamType);
      if (requestId === loadAllRequestRef.current) {
        const pmap: Record<string, any> = {};
        (rows || []).forEach((p: any) => { if (p?.student_id) pmap[p.student_id] = p; });
        setProgressMap(pmap);
      }
    } catch { }
  }, [user, selectedDate, timeBlock, teamType]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => { setExpandedTeamId(null); }, [teamType]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: Record<string, number> = {};
      for (const team of teams) {
        entries[team.id] = await getTeamStreak(team.members.map(m => m.id));
      }
      if (!cancelled) setStreaks(entries);
    })();
    return () => { cancelled = true; };
  }, [teams]);

  const { useFocusEffect } = require('expo-router');
  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const markStatus = useCallback(async (student: any, st: Status) => {
    if (!user || !isEditing) return;
    const current = attendanceMap[student.id] ?? null;
    const next: Status | null = current === st ? null : st;
    setAttendanceMap(prev => ({ ...prev, [student.id]: next }));
    setSaving(student.id);
    try {
      const dateStr = getLocalDateString(selectedDate);
      if (next !== null) {
        const notes = teamType === 'kitab' ? (kitabMap[student.id] ? 'Kitab: Yes' : 'Kitab: No') : undefined;
        await markAttendance([{ studentId: student.id, status: next as any, notes }], dateStr, timeBlock, user.id);
      } else {
        // Un-marking: must delete the saved row too, or it comes back on next reload
        await clearAttendance(student.id, dateStr, timeBlock, user.id);
      }
    } catch {
      setAttendanceMap(prev => ({ ...prev, [student.id]: current }));
    } finally {
      setSaving(null);
    }
  }, [attendanceMap, kitabMap, user, selectedDate, timeBlock, isEditing, teamType, clearAttendance]);

  const markTeamAll = useCallback(async (team: TeamWithMembers, st: Status) => {
    if (!user || !isEditing) return;
    setSaving(team.id);
    const dateStr = getLocalDateString(selectedDate);
    const records = team.members.map(s => ({
      studentId: s.id,
      status: st as any,
      notes: teamType === 'kitab' ? (kitabMap[s.id] ? 'Kitab: Yes' : 'Kitab: No') : undefined,
    }));
    try {
      await markAttendance(records, dateStr, timeBlock, user.id);
      setAttendanceMap(prev => {
        const next = { ...prev };
        records.forEach(r => { next[r.studentId] = st; });
        return next;
      });
    } finally {
      setSaving(null);
    }
  }, [user, selectedDate, timeBlock, isEditing, kitabMap, teamType]);

  // 🆕 "Brought Kitab" toggle — mirrors attendance.tsx's toggleKitab exactly: same
  // 'Kitab: Yes'/'Kitab: No' notes convention on the same attendance table, so this
  // reads/writes the identical record the Attendance tab's Kitab session shows.
  const toggleKitab = useCallback(async (student: any) => {
    const current = kitabMap[student.id] || false;
    const next = !current;
    setKitabMap(prev => ({ ...prev, [student.id]: next }));

    const status = attendanceMap[student.id];
    if (status && user) {
      const dateStr = getLocalDateString(selectedDate);
      const notes = next ? 'Kitab: Yes' : 'Kitab: No';
      await markAttendance([{ studentId: student.id, status: status as any, notes }], dateStr, timeBlock, user.id);
    }
  }, [kitabMap, attendanceMap, user, selectedDate, timeBlock]);

  const openCreate = async () => {
    if (!user) return;
    const list = await getUnassignedStudents(user.id, teamType);
    setCandidateStudents(list);
    setCreateVisible(true);
  };

  const handleCreateSubmit = async (name: string, pickedIds: string[], emoji: string) => {
    if (!user) return;
    if (!name.trim()) {
      Alert.alert(lang === 'am' ? 'ስህተት' : 'Error', lang === 'am' ? 'የቡድን ስም ያስፈልጋል' : 'Please enter a team name.');
      return;
    }
    if (pickedIds.length < MIN_TEAM_SIZE) {
      Alert.alert(lang === 'am' ? 'ስህተት' : 'Error', lang === 'am' ? 'ቢያንስ 2 ተማሪዎች ይምረጡ' : 'Pick at least 2 students.');
      return;
    }
    setCreating(true);
    const res = await createTeam(name.trim(), user.id, pickedIds, teamType, undefined, emoji);
    setCreating(false);
    if (!res.ok) {
      Alert.alert(lang === 'am' ? 'ስህተት' : 'Error', res.error || 'Failed to create team.');
      return;
    }
    setCreateVisible(false);
  };

  const onExport = (team: TeamWithMembers) => {
    generateTeamReport({ name: team.name, emoji: team.emoji }, team.members);
  };

  const confirmDeleteTeam = (team: TeamWithMembers) => {
    Alert.alert(
      lang === 'am' ? 'ቡድን አጥፋ' : 'Delete Team',
      lang === 'am' ? `"${team.name}" የተባለውን ቡድን ማጥፋት ይፈልጋሉ?` : `Delete "${team.name}"? Students' attendance history stays intact.`,
      [
        { text: t('cancel') || 'Cancel', style: 'cancel' },
        { text: t('delete') || 'Delete', style: 'destructive', onPress: () => deleteTeam(team.id) },
      ]
    );
  };

  const openProgress = async (student: any) => {
    if (!isEditing) return;
    progressStudentRef.current = student.id;
    setLastProgress(null);
    setProgressModal({ visible: true, student });

    const existing = progressMap[student.id];
    const hasTodayRecord = !!(existing?.page_number || existing?.ayah_from);
    if (hasTodayRecord) return; // today's record takes priority — TeamProgressModal reads it via initialData

    // 🆕 No record for today yet — look up the student's last Qirat session so
    // TeamProgressModal can pre-fill "where they left off" (still fully editable).
    const dateStr = getLocalDateString(selectedDate);
    try {
      const last = await getLastProgress(student.id, dateStr, teamType);
      if (progressStudentRef.current !== student.id) return; // stale — student changed while awaiting
      setLastProgress(last);
    } catch (e) {
      console.warn('Failed to load last Qirat progress', e);
    }
  };

  const submitProgress = async (data: { pageNumber: string; ayahFrom: string; ayahTo: string; lessonDetails: string; rating: number }) => {
    if (!progressModal.student || !user) return;
    setSavingProgress(true);
    const dateStr = getLocalDateString(selectedDate);
    await saveProgress({
      student_id: progressModal.student.id,
      date: dateStr,
      page_number: data.pageNumber,
      ayah_from: data.ayahFrom,
      ayah_to: data.ayahTo,
      lesson_details: data.lessonDetails,
      rating: data.rating,
      ustaz_id: user.id,
      level_id: progressModal.student.level_id || '',
      ustaz_notes: '',
      session_type: teamType,
    });
    setSavingProgress(false);
    progressStudentRef.current = null;
    setProgressModal({ visible: false, student: null });
    await loadAll();
  };

  const allMembers = teams.flatMap(tm => tm.members);
  const totalMembers = allMembers.length;
  const markedTotal = allMembers.filter(m => !!attendanceMap[m.id]).length;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <Surface style={styles.header} elevation={4}>
        <View style={styles.headerTop}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <IconButton
              icon="arrow-left"
              iconColor="white"
              size={24}
              onPress={() => require('expo-router').router.replace('/(tabs)/dashboard')}
              style={{ marginLeft: -12 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {teamType === 'kitab'
                  ? (lang === 'am' ? 'የኪታብ ቡድን' : 'Kitab Teams')
                  : (lang === 'am' ? 'የቡድን ንባብ' : 'Recitation Teams')}
              </Text>
              <Text style={styles.subTitle}>
                {totalMembers > 0
                  ? `${markedTotal}/${totalMembers} ${lang === 'am' ? 'ተመዝግቧል' : 'Marked Today'}`
                  : (lang === 'am' ? `${MIN_TEAM_SIZE}-${MAX_TEAM_SIZE} ተማሪዎችን በአንድ ቡድን ውስጥ አንድ ላይ ይመዝግቡ` : `Record attendance for ${MIN_TEAM_SIZE}-${MAX_TEAM_SIZE} students at once`)}
              </Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={[styles.headerIconBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <MaterialCommunityIcons name="calendar-month" size={20} color="white" />
              <Text style={{ color: 'white', fontWeight: '800', marginLeft: 4 }}>{selectedDate.getDate()}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 🌓 Team Type Toggle: Quran vs Kitab — mirrors attendance.tsx's session toggle */}
        <View style={styles.sessionToggleRow}>
          <TouchableOpacity
            onPress={() => setTeamType('quran')}
            style={[styles.sessionTab, teamType === 'quran' && styles.sessionTabActive]}
          >
            <MaterialCommunityIcons name="weather-sunny" size={20} color={teamType === 'quran' ? COLORS.primaryDark : 'rgba(255,255,255,0.6)'} />
            <Text style={[styles.sessionTabTxt, teamType === 'quran' && styles.sessionTabTxtActive]}>
              {lang === 'am' ? 'ቁርአን' : 'Quran'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTeamType('kitab')}
            style={[styles.sessionTab, teamType === 'kitab' && styles.sessionTabActive]}
          >
            <MaterialCommunityIcons name="book-open-variant" size={20} color={teamType === 'kitab' ? COLORS.primaryDark : 'rgba(255,255,255,0.6)'} />
            <Text style={[styles.sessionTabTxt, teamType === 'kitab' && styles.sessionTabTxtActive]}>
              {lang === 'am' ? 'ኪታብ' : 'Kitab'}
            </Text>
          </TouchableOpacity>
        </View>
      </Surface>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display="default"
          onChange={(event, date) => {
            setShowDatePicker(false);
            if (date) setSelectedDate(date);
          }}
        />
      )}

      {isLoading && teams.length === 0 ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          data={teams}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 90 }}
          ListEmptyComponent={
            <View style={[styles.center, { marginTop: 60 }]}>
              <MaterialCommunityIcons name="account-group-outline" size={64} color="#cbd5e1" />
              <Text style={{ color: '#94a3b8', marginTop: 10, textAlign: 'center', paddingHorizontal: 30 }}>
                {teamType === 'kitab'
                  ? (lang === 'am' ? 'ገና የኪታብ ቡድን የለም። ከታች ያለውን + ተጭነው ይፍጠሩ' : 'No Kitab teams yet. Tap + below to create one.')
                  : (lang === 'am' ? 'ገና ቡድን የለም። ከታች ያለውን + ተጭነው ይፍጠሩ' : 'No teams yet. Tap + below to create one.')}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const expanded = expandedTeamId === item.id;
            const tagColor = getTeamColor(item.emoji);
            const total = item.members.length;
            const markedCount = item.members.filter(m => !!attendanceMap[m.id]).length;
            const goodCount = item.members.filter(m => attendanceMap[m.id] === 'present' || attendanceMap[m.id] === 'late').length;
            // 🛡️ Sync check: some of the team recited today but not the whole group —
            // worth a glance since this team is meant to recite together.
            const mismatch = goodCount > 0 && goodCount < total;
            const streak = streaks[item.id] || 0;

            return (
              <Surface style={[styles.teamCard, { borderLeftWidth: 4, borderLeftColor: tagColor }]} elevation={1}>
                <TouchableOpacity
                  style={styles.teamHeader}
                  onPress={() => setExpandedTeamId(expanded ? null : item.id)}
                >
                  <View style={[styles.emojiBadge, { backgroundColor: tagColor + '18' }]}>
                    <Text style={{ fontSize: 20 }}>{item.emoji || '👥'}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.teamName}>{item.name}</Text>
                      {streak >= 2 && (
                        <View style={styles.streakChip}>
                          <MaterialCommunityIcons name="fire" size={12} color="#ea580c" />
                          <Text style={styles.streakChipTxt}>{streak}</Text>
                        </View>
                      )}
                      {mismatch && (
                        <MaterialCommunityIcons name="alert-circle" size={16} color="#d97706" />
                      )}
                    </View>
                    <Text style={styles.teamSub}>
                      {item.members.map(m => lang === 'am' ? m.name_am : m.name_en).join(' • ')}
                    </Text>
                  </View>
                  <View style={[styles.ringBadge, { borderColor: markedCount === total ? '#16a34a' : '#e2e8f0' }]}>
                    <Text style={[styles.ringBadgeTxt, { color: markedCount === total ? '#16a34a' : '#64748b' }]}>
                      {markedCount}/{total}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={24} color="#94a3b8" style={{ marginLeft: 6 }} />
                </TouchableOpacity>

                {expanded && (
                  <View style={styles.teamBody}>
                    {mismatch && (
                      <View style={styles.mismatchBanner}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#b45309" />
                        <Text style={styles.mismatchTxt}>
                          {lang === 'am'
                            ? 'ዛሬ ሙሉ ቡድኑ አብሮ አልተመዘገበም'
                            : "Not everyone on this team is marked present today — they're meant to recite together."}
                        </Text>
                      </View>
                    )}

                    <View style={styles.quickRow}>
                      <Text style={styles.quickLabel}>{lang === 'am' ? 'ሁሉንም ምልክት አድርግ፦' : 'Mark whole team:'}</Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {(['present', 'absent'] as Status[]).map(st => (
                          <TouchableOpacity
                            key={st}
                            onPress={() => isEditing && markTeamAll(item, st)}
                            style={[styles.quickBtn, { borderColor: STATUS_UI[st].border }, !isEditing && styles.lockedBtn]}
                          >
                            <MaterialCommunityIcons name={STATUS_UI[st].icon as any} size={14} color={STATUS_UI[st].border} />
                            <Text style={{ fontSize: 11, fontWeight: '700', color: STATUS_UI[st].border }}>
                              {lang === 'am' ? (st === 'present' ? 'ሁሉም አለ' : 'ሁሉም የለም') : (st === 'present' ? 'All Present' : 'All Absent')}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {item.members.map(student => (
                      <TeamStudentRow
                        key={student.id}
                        student={student}
                        status={attendanceMap[student.id] ?? null}
                        progress={progressMap[student.id]}
                        hasKitab={kitabMap[student.id]}
                        saving={saving === student.id}
                        isEditing={isEditing}
                        mode={teamType}
                        onMark={(st: Status) => isEditing && markStatus(student, st)}
                        onQirat={() => isEditing && openProgress(student)}
                        onKitabToggle={() => isEditing && toggleKitab(student)}
                        lang={lang}
                        user={user}
                      />
                    ))}

                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      <TouchableOpacity style={styles.exportBtn} onPress={() => onExport(item)} disabled={pdfGenerating}>
                        {pdfGenerating ? (
                          <ActivityIndicator size={14} color={COLORS.primary} />
                        ) : (
                          <MaterialCommunityIcons name="file-pdf-box" size={16} color={COLORS.primary} />
                        )}
                        <Text style={{ color: COLORS.primary, fontWeight: '700', fontSize: 12 }}>
                          {lang === 'am' ? 'ሪፖርት ላክ' : 'Export Report'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.deleteTeamBtn} onPress={() => confirmDeleteTeam(item)}>
                        <MaterialCommunityIcons name="trash-can-outline" size={16} color="#dc2626" />
                        <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 12 }}>
                          {lang === 'am' ? 'ቡድን አጥፋ' : 'Delete Team'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </Surface>
            );
          }}
        />
      )}

      <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + (user?.role === 'admin' || user?.role === 'ustaz' ? 100 : 20) }]} onPress={openCreate}>
        <MaterialCommunityIcons name="plus" size={28} color="#fff" />
      </TouchableOpacity>

      {(user?.role === 'admin' || user?.role === 'ustaz') && (
        <Surface style={[styles.tabFooter, { paddingBottom: 15 + insets.bottom }]} elevation={4}>
          <Button
            mode="contained"
            onPress={() => setIsEditing(!isEditing)}
            style={[styles.editBtn, isEditing && { backgroundColor: COLORS.primary }]}
            icon={isEditing ? 'check' : 'pencil-outline'}
          >
            {isEditing
              ? (lang === 'am' ? 'ጨርስ (Finish)' : 'Done Editing')
              : (lang === 'am' ? 'ማስተካከያ (Edit)' : 'Edit Attendance')}
          </Button>
        </Surface>
      )}

      {/* ── CREATE TEAM MODAL ── */}
      <Portal>
        <CreateTeamModal
          visible={createVisible}
          candidateStudents={candidateStudents}
          onDismiss={() => setCreateVisible(false)}
          onSubmit={handleCreateSubmit}
          submitting={creating}
          lang={lang}
          t={t}
        />
      </Portal>

      {/* ── PROGRESS MODAL (same fields + last-session pre-fill/stepper as main Attendance tab) ── */}
      <Portal>
        <TeamProgressModal
          visible={progressModal.visible}
          student={progressModal.student}
          initialData={progressModal.student ? progressMap[progressModal.student.id] : null}
          lastProgress={lastProgress}
          isKitabPhase={teamType === 'kitab'}
          onDismiss={() => { progressStudentRef.current = null; setProgressModal({ visible: false, student: null }); }}
          onSave={submitProgress}
          isSaving={savingProgress}
          lang={lang}
          t={t}
        />
      </Portal>
    </KeyboardAvoidingView>
  );
}

// 🛡️ FLICKER FIX: this used to be inline JSX inside TeamsScreen's return, with the
// text-field state (teamName/pickedIds/pickedEmoji) living in the parent. Every
// keystroke updated parent state, which re-rendered the *entire* screen (team list,
// all expanded rows, etc.) — same cost as a full screen re-render on every character,
// which is what caused the visible flicker. Pulling the modal out into its own
// React.memo'd component means typing only re-renders this small subtree; the parent
// only learns the final values when "Save" is pressed (onSubmit).
const CreateTeamModal = React.memo(({ visible, candidateStudents, onDismiss, onSubmit, submitting, lang, t }: any) => {
  const [localName, setLocalName] = useState('');
  const [localPickedIds, setLocalPickedIds] = useState<string[]>([]);
  const [localEmoji, setLocalEmoji] = useState(TEAM_EMOJI_OPTIONS[0]);

  // 🛡️ Only reset fields on a fresh open (visible flips false → true). candidateStudents
  // can refresh in the background while this modal is open (focus refetch etc.) — that's
  // a new array reference each time, but it must never wipe what the ustaz already
  // typed/picked. Same "don't stomp an in-progress edit" idea as attendance.tsx's dirty ref.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setLocalName('');
      setLocalPickedIds([]);
      setLocalEmoji(TEAM_EMOJI_OPTIONS[0]);
    }
    wasVisible.current = visible;
  }, [visible]);

  const togglePick = (id: string) => {
    setLocalPickedIds(prev => {
      if (prev.includes(id)) return prev.filter(p => p !== id);
      if (prev.length >= MAX_TEAM_SIZE) return prev;
      return [...prev, id];
    });
  };

  const handleSave = () => onSubmit(localName, localPickedIds, localEmoji);

  return (
    <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
      <Text style={styles.modalTitle}>{lang === 'am' ? 'አዲስ ቡድን ፍጠር' : 'Create Team'}</Text>
      <TextInput
        label={lang === 'am' ? 'የቡድን ስም' : 'Team name'}
        value={localName}
        onChangeText={setLocalName}
        mode="outlined"
        style={{ marginBottom: 12 }}
        placeholder={lang === 'am' ? 'ለምሳሌ: ቡድን 1' : 'e.g. Team 1'}
      />
      <Text style={{ fontWeight: '700', color: '#334155', marginBottom: 6 }}>
        {lang === 'am' ? 'የቡድን ምልክት' : 'Team tag'}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {TEAM_EMOJI_OPTIONS.map((e: string) => {
          const picked = localEmoji === e;
          const c = getTeamColor(e);
          return (
            <TouchableOpacity
              key={e}
              onPress={() => setLocalEmoji(e)}
              style={[
                styles.emojiOption,
                { backgroundColor: picked ? c + '22' : '#f8fafc', borderColor: picked ? c : '#e2e8f0' },
              ]}
            >
              <Text style={{ fontSize: 18 }}>{e}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={{ fontWeight: '700', color: '#334155', marginBottom: 6 }}>
        {lang === 'am'
          ? `ተማሪዎችን ይምረጡ (${MIN_TEAM_SIZE}-${MAX_TEAM_SIZE}) — ${localPickedIds.length} ተመርጧል`
          : `Pick students (${MIN_TEAM_SIZE}-${MAX_TEAM_SIZE}) — ${localPickedIds.length} selected`}
      </Text>
      <ScrollView style={{ maxHeight: 320 }}>
        {candidateStudents.length === 0 ? (
          <Text style={{ color: '#94a3b8', padding: 10 }}>
            {lang === 'am' ? 'ሁሉም ተማሪዎችዎ አስቀድሞ በቡድን ውስጥ ናቸው' : 'All your students are already on a team.'}
          </Text>
        ) : candidateStudents.map((s: any) => {
          const picked = localPickedIds.includes(s.id);
          return (
            <TouchableOpacity
              key={s.id}
              onPress={() => togglePick(s.id)}
              style={[styles.pickRow, picked && { backgroundColor: COLORS.primaryFaded, borderColor: COLORS.primary }]}
            >
              <Avatar.Text size={30} label={s.name_am.substring(0, 1)} style={{ backgroundColor: '#e2e8f0' }} />
              <Text style={{ marginLeft: 10, flex: 1, fontWeight: '600' }}>{lang === 'am' ? s.name_am : s.name_en}</Text>
              <MaterialCommunityIcons
                name={picked ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                size={22}
                color={picked ? COLORS.primary : '#cbd5e1'}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <Button mode="outlined" onPress={onDismiss} style={{ flex: 1 }}>{t('cancel') || 'Cancel'}</Button>
        <Button mode="contained" loading={submitting} onPress={handleSave} style={{ flex: 1, backgroundColor: COLORS.primaryDark }}>
          {t('save') || 'Save'}
        </Button>
      </View>
    </Modal>
  );
});

// 🛡️ FLICKER FIX + no-data-loss: extracted for the same reason as CreateTeamModal above,
// and ported directly from attendance.tsx's ProgressModal, including its `dirty`/`lastId`
// ref pattern. The parent (TeamsScreen) re-fetches attendance/progress on every focus and
// right after each save — `initialData`/`lastProgress` arrive as new object references
// each time. Without the dirty guard, that re-triggers the pre-fill effect below mid-edit
// and wipes whatever the ustaz just typed. `dirty` marks "editing has started for this
// student"; once set, later prop refreshes are ignored until the modal reopens — either
// for a new student (isNewOpen) or the same student re-opened fresh.
const TeamProgressModal = React.memo(({ visible, student, initialData, lastProgress, isKitabPhase, onDismiss, onSave, isSaving, lang, t }: any) => {
  const [localPage, setLocalPage] = useState('');
  const [localAyahFrom, setLocalAyahFrom] = useState('');
  const [localAyahTo, setLocalAyahTo] = useState('');
  const [localDetails, setLocalDetails] = useState('');
  const [localRating, setLocalRating] = useState(0);
  const [usedLastProgress, setUsedLastProgress] = useState(false);

  const lastId = useRef<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!visible || !student) {
      dirty.current = false;
      lastId.current = null;
      return;
    }

    const isNewOpen = lastId.current !== student.id;
    if (isNewOpen) dirty.current = false;
    lastId.current = student.id;
    if (dirty.current) return; // ustaz already editing this entry — don't overwrite

    const hasTodayRecord = !!(initialData?.page_number || initialData?.ayah_from);

    // 🛡️ Kitab bonus entries don't have a Page/Ayah concept at all — pre-filling
    // them from a *Quran* last-session record made no sense here (that's exactly
    // what showed Quran progress inside the Kitab tab's Bonus modal).
    if (!hasTodayRecord && !isKitabPhase && lastProgress) {
      setLocalPage(lastProgress.page_number?.toString() || '');
      setLocalAyahFrom(lastProgress.ayah_from?.toString() || '');
      setLocalAyahTo(lastProgress.ayah_to?.toString() || '');
      setUsedLastProgress(true);
    } else {
      setLocalPage(initialData?.page_number?.toString() || '');
      setLocalAyahFrom(initialData?.ayah_from || '');
      setLocalAyahTo(initialData?.ayah_to || '');
      setUsedLastProgress(false);
    }
    setLocalDetails(initialData?.lesson_details || '');
    setLocalRating(initialData?.rating || 0);
  }, [visible, student, initialData, lastProgress, isKitabPhase]);

  // 🆕 +/- page stepper — identical behavior to attendance.tsx's ProgressModal.
  const stepPage = (delta: number) => {
    dirty.current = true;
    setLocalPage(prev => {
      const n = parseInt(prev, 10);
      if (isNaN(n)) return delta > 0 ? '1' : prev;
      const next = n + delta;
      return next < 0 ? '0' : next.toString();
    });
    setUsedLastProgress(false);
  };

  const handleSave = () => {
    onSave({
      pageNumber: localPage,
      ayahFrom: localAyahFrom,
      ayahTo: localAyahTo,
      lessonDetails: localDetails,
      rating: localRating,
    });
  };

  return (
    <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
      <Text style={styles.modalTitle}>
        {isKitabPhase ? '📗 ' : '📖 '}{student ? (lang === 'am' ? student.name_am : student.name_en) : ''}
      </Text>
      {isKitabPhase ? (
        // 🛡️ Kitab bonus entry — same shape as attendance.tsx's isKitabPhase branch:
        // just a note and a 1-5 star bonus mark, no Page/Ayah fields.
        <View style={{ gap: 10 }}>
          <TextInput
            label={lang === 'am' ? 'ማስታወሻ / ጉርሻ ምክንያት' : 'Note / Reason for bonus'}
            value={localDetails}
            onChangeText={(v: string) => { setLocalDetails(v); dirty.current = true; }}
            mode="outlined"
            multiline
            style={{ marginBottom: 4 }}
            autoCorrect={false}
          />
          <Text style={{ fontSize: 12.5, color: '#64748b', fontWeight: '700', textAlign: 'center', marginTop: 2 }}>
            {lang === 'am' ? 'የጉርሻ ውጤት' : 'Bonus mark'}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
            {[1, 2, 3, 4, 5].map(star => (
              <TouchableOpacity key={star} onPress={() => { setLocalRating(star); dirty.current = true; }}>
                <MaterialCommunityIcons name={localRating >= star ? 'star' : 'star-outline'} size={32} color={localRating >= star ? '#eab308' : '#cbd5e1'} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <TextInput
              label={lang === 'am' ? 'ገጽ' : 'Page'}
              value={localPage}
              onChangeText={(v: string) => { setLocalPage(v); setUsedLastProgress(false); dirty.current = true; }}
              mode="outlined"
              style={{ flex: 1 }}
              keyboardType="default"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => stepPage(-1)} style={{ width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="minus" size={20} color={COLORS.primaryDark} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => stepPage(1)} style={{ width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="plus" size={20} color={COLORS.primaryDark} />
            </TouchableOpacity>
          </View>
          {usedLastProgress && lastProgress && (
            <Text style={{ fontSize: 11.5, color: '#94a3b8', fontStyle: 'italic', marginBottom: 10 }}>
              {lang === 'am'
                ? `ካለፈው ክፍለ ጊዜ (${lastProgress.date}) ተሞልቷል — መቀየር ይችላሉ`
                : `Pre-filled from last session (${lastProgress.date}) — edit if needed`}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10, marginTop: usedLastProgress && lastProgress ? 0 : 10 }}>
            <TextInput label={lang === 'am' ? 'ከአያህ' : 'Ayah from'} value={localAyahFrom} onChangeText={(v: string) => { setLocalAyahFrom(v); setUsedLastProgress(false); dirty.current = true; }} mode="outlined" style={{ flex: 1 }} keyboardType="numeric" />
            <TextInput label={lang === 'am' ? 'እስከ አያህ' : 'Ayah to'} value={localAyahTo} onChangeText={(v: string) => { setLocalAyahTo(v); setUsedLastProgress(false); dirty.current = true; }} mode="outlined" style={{ flex: 1 }} keyboardType="numeric" />
          </View>
          <TextInput label={lang === 'am' ? 'ዝርዝር' : 'Lesson details'} value={localDetails} onChangeText={(v: string) => { setLocalDetails(v); dirty.current = true; }} mode="outlined" multiline style={{ marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
            {[1, 2, 3, 4, 5].map(star => (
              <TouchableOpacity key={star} onPress={() => { setLocalRating(star); dirty.current = true; }}>
                <MaterialCommunityIcons name={localRating >= star ? 'star' : 'star-outline'} size={32} color={localRating >= star ? '#eab308' : '#cbd5e1'} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button mode="outlined" onPress={onDismiss} style={{ flex: 1 }}>{t('cancel') || 'Cancel'}</Button>
        <Button mode="contained" loading={isSaving} onPress={handleSave} style={{ flex: 1, backgroundColor: COLORS.primaryDark }}>{t('save') || 'Save'}</Button>
      </View>
    </Modal>
  );
});

function TeamStudentRow({ student, status, progress, hasKitab, saving, isEditing, mode, onMark, onQirat, onKitabToggle, lang, user }: any) {
  const ui = STATUS_UI[status ?? 'none'];
  const canAct = status === 'present' || status === 'late';
  const genderColor = student.gender === 'male' ? '#3b82f6' : '#ec4899';
  const isKitab = mode === 'kitab';

  return (
    <Surface style={styles.studentRow} elevation={0}>
      <View style={styles.studentInfo}>
        <Avatar.Text size={38} label={student.name_am.substring(0, 1)} style={{ backgroundColor: genderColor + '15' }} color={genderColor} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.studentName}>{lang === 'am' ? student.name_am : student.name_en}</Text>
          {isKitab ? (
            progress ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                {!!progress.lesson_details && (
                  <Text style={styles.progressTxt} numberOfLines={1}>{progress.lesson_details}</Text>
                )}
                <View style={{ flexDirection: 'row', marginLeft: 4 }}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <MaterialCommunityIcons key={s} name="star" size={10} color={progress.rating >= s ? '#eab308' : '#e2e8f0'} />
                  ))}
                </View>
              </View>
            ) : (
              <Text style={[styles.progressTxt, { color: '#cbd5e1' }]}>— {lang === 'am' ? 'ገና ጉርሻ የለም' : 'No bonus yet'} —</Text>
            )
          ) : (
            progress ? (
              <Text style={styles.progressTxt}>{lang === 'am' ? 'ገጽ' : 'Page'} {progress.page_number}</Text>
            ) : (
              <Text style={[styles.progressTxt, { color: '#cbd5e1' }]}>— {lang === 'am' ? 'ገና የለም' : 'No progress yet'} —</Text>
            )
          )}
        </View>
        {saving && <ActivityIndicator size="small" color={COLORS.primary} />}
        {!isEditing && !saving && (
          <MaterialCommunityIcons name="lock-outline" size={16} color="#cbd5e1" />
        )}
      </View>
      <View style={[styles.actionRow, !isEditing && { opacity: 0.5 }]}>
        {(['present', 'late', 'absent', 'excused'] as Status[]).map(st => (
          <TouchableOpacity
            key={st}
            disabled={!isEditing}
            style={[styles.statusBtn, status === st && { backgroundColor: STATUS_UI[st].border, borderColor: STATUS_UI[st].border }]}
            onPress={() => onMark(st)}
          >
            <MaterialCommunityIcons name={STATUS_UI[st].icon as any} size={16} color={status === st ? '#fff' : STATUS_UI[st].border} />
          </TouchableOpacity>
        ))}
        {!isKitab && canAct && (
          <TouchableOpacity disabled={!isEditing} onPress={onQirat} style={styles.qiratBtn}>
            <MaterialCommunityIcons name="book-edit-outline" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* 🆕 Kitab-only row — same pattern as attendance.tsx's StudentCard: "Brought Kitab"
          toggle writes the same 'Kitab: Yes'/'Kitab: No' notes flag the Attendance tab's
          Kitab session reads, and the Bonus button opens the same star-rating + notes
          modal (session_type: 'kitab'), so anything recorded here shows up there too. */}
      {isKitab && (
        <View style={[styles.kitabRow, !isEditing && { opacity: 0.5 }]}>
          <TouchableOpacity
            disabled={!isEditing}
            onPress={onKitabToggle}
            style={[styles.kitabToggle, { flex: 1 }, hasKitab && { backgroundColor: '#10b981' }]}
          >
            <MaterialCommunityIcons
              name={hasKitab ? 'book-check' : 'book-outline'}
              size={18}
              color={hasKitab ? 'white' : '#64748b'}
            />
            <Text style={[styles.kitabToggleTxt, hasKitab && { color: 'white' }]}>
              {lang === 'am' ? 'ኪታብ አምጥቷል' : 'Brought Kitab'}
            </Text>
          </TouchableOpacity>

          {canAct && user?.role !== 'committee' && (
            <TouchableOpacity disabled={!isEditing} onPress={onQirat} style={[styles.kitabBonusBtn, progress && { backgroundColor: COLORS.primary + '15' }]}>
              <MaterialCommunityIcons name="star-plus-outline" size={18} color={COLORS.primary} />
              <Text style={styles.kitabBonusBtnTxt}>
                {lang === 'am' ? 'ጉርሻ' : 'Bonus'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: COLORS.primaryDark, paddingTop: 50, paddingBottom: 16, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  title: { color: 'white', fontSize: 20, fontWeight: '900' },
  subTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  headerIconBtn: { paddingHorizontal: 10, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },

  sessionToggleRow: { flexDirection: 'row', paddingHorizontal: 20, marginTop: 15, gap: 10 },
  sessionTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
  sessionTabActive: { backgroundColor: 'white' },
  sessionTabTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '800' },
  sessionTabTxtActive: { color: COLORS.primaryDark },

  teamCard: { borderRadius: 16, marginBottom: 12, backgroundColor: '#fff', overflow: 'hidden' },
  teamHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  teamAvatarStack: { flexDirection: 'row' },
  teamName: { fontSize: 15.5, fontWeight: '800', color: '#1e293b' },
  teamSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  emojiBadge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#fff7ed', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  streakChipTxt: { fontSize: 11, fontWeight: '800', color: '#ea580c' },
  ringBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, borderWidth: 1.5 },
  ringBadgeTxt: { fontSize: 12, fontWeight: '800' },
  mismatchBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fffbeb', borderRadius: 8, padding: 8, marginTop: 10, marginBottom: 4 },
  mismatchTxt: { fontSize: 11.5, color: '#92400e', flex: 1 },
  exportBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.primaryFaded },
  emojiOption: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },

  teamBody: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  quickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  quickLabel: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  quickBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5 },

  studentRow: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 10, marginBottom: 8 },
  studentInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  studentName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  progressTxt: { fontSize: 11, color: '#64748b', marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  statusBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  qiratBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.primaryFaded },

  kitabRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  kitabToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 10, gap: 6 },
  kitabToggleTxt: { fontSize: 12, fontWeight: '800', color: '#64748b' },
  kitabBonusBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f9ff', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 10, gap: 6 },
  kitabBonusBtnTxt: { fontSize: 12, fontWeight: '800', color: COLORS.primary },

  deleteTeamBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, paddingVertical: 8 },

  fab: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primaryDark, alignItems: 'center', justifyContent: 'center', elevation: 4 },

  tabFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'white', padding: 15, borderTopLeftRadius: 25, borderTopRightRadius: 25 },
  editBtn: { height: 50, borderRadius: 15, backgroundColor: '#64748b' },
  lockedBtn: { opacity: 0.5 },

  modal: { backgroundColor: '#fff', margin: 20, borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1e293b', marginBottom: 14 },
  pickRow: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8 },
});
