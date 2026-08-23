import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, Alert, Animated, KeyboardAvoidingView, Platform
} from 'react-native';
import {
  Text, Surface, Avatar, IconButton,
  Portal, Modal, TextInput, ActivityIndicator, Divider, Button, Chip, Searchbar, List
} from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useStudentStore } from '../../src/store/useStudentStore';
import { useAttendanceStore } from '../../src/store/useAttendanceStore';
import { useLevelStore } from '../../src/store/useLevelStore';
import { useProgressStore } from '../../src/store/useProgressStore';
import { useAuthStore } from '../../src/store/useAuthStore';
import { getDatabase } from '../../src/lib/database';
import { getLocalDateString } from '../../src/lib/dateUtils';
import { useReportStore } from '../../src/store/useReportStore';
import { usePDFStore } from '../../src/store/usePDFStore';
import { useNuraniyahStore, NuraniyahRating } from '../../src/store/useNuraniyahStore';
import { COLORS } from '../../src/constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type Status = 'present' | 'late' | 'excused' | 'absent' | 'none';

const STATUS_CYCLE: (Status | null)[] = [null, 'present', 'late', 'excused', 'absent'];

const STATUS_UI: Record<string, { bg: string; border: string; text: string; label: string; icon: string }> = {
  present: { bg: '#dcfce7', border: '#16a34a', text: '#16a34a', label: 'Present', icon: 'check-circle' },
  late: { bg: '#fef3c7', border: '#d97706', text: '#d97706', label: 'Late', icon: 'clock-alert-outline' },
  excused: { bg: '#e0f2fe', border: '#0284c7', text: '#0284c7', label: 'Excused', icon: 'shield-check-outline' },
  absent: { bg: '#fee2e2', border: '#dc2626', text: '#dc2626', label: 'Absent', icon: 'close-circle' },
  none: { bg: '#f1f5f9', border: '#e2e8f0', text: '#94a3b8', label: '—', icon: 'minus' },
};

const isNuraniyahStudent = (student: any) => student?.level_id === 'l1m' || student?.level_id === 'l1f';

export default function AttendanceScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();

  const { levels, fetchLevels } = useLevelStore();
  const { students, fetchStudents, isLoading: studentsLoading, assignedGroups, fetchAssignedGroups } = useStudentStore();
  const { attendance: attendanceStoreList, fetchAttendance, getDailyAttendance, markAttendance, clearAttendance } = useAttendanceStore();
  const { getDailyProgress, saveProgress, getLastProgress } = useProgressStore();
  const user = useAuthStore(s => s.user);

  if ((user?.role as any) === 'finance') {
    return (
      <View style={[styles.container, styles.center]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={80} color="#cbd5e1" />
        <Text style={{ marginTop: 15, fontSize: 18, fontWeight: '900', color: '#1e293b' }}>
          {i18n.language === 'am' ? 'ይህ ክፍል ለፋይናንስ አልተፈቀደም' : 'Access Restricted'}
        </Text>
        <Text style={{ color: '#64748b', textAlign: 'center', paddingHorizontal: 40, marginTop: 5 }}>
          {i18n.language === 'am' ? 'የተማሪዎችን አቴንዳንስ ለማየት ለዚህ አካውንት ፈቃድ የሎትም' : 'Your finance account does not have permission to view or manage attendance records.'}
        </Text>
        <Button
          mode="contained"
          onPress={() => require('expo-router').router.replace('/(tabs)/dashboard')}
          style={{ marginTop: 25, backgroundColor: COLORS.primaryDark }}
        >
          {i18n.language === 'am' ? 'ወደ ዳሽቦርድ ተመለስ' : 'Return to Dashboard'}
        </Button>
      </View>
    );
  }

  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [selectedKitabTeam, setSelectedKitabTeam] = useState<string | null>(null);
  const [timeBlock, setTimeBlock] = useState<'tb_morning' | 'tb_afternoon'>('tb_morning');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [ustazList, setUstazList] = useState<any[]>([]);
  const [selectedUstazId, setSelectedUstazId] = useState<string | null>(null);
  const [validLevelIds, setValidLevelIds] = useState<string[]>([]);

  const getTeamForLevel = (levelName: string) => {
    const n = levelName.toLowerCase();
    if (n.includes('nuraniya')) return 'Team Nuraniya';
    if (n.includes('quran 1')) return 'Team Quran 1';
    if (n.includes('quran 2') || n.includes('hifz')) return 'Team Hifz';
    return null;
  };

  const KITAB_TEAMS = ['Nuraniya', 'Quran 1', 'Quran 2', 'Hifz'];
  const { generateOverallPDFReport, generateWeeklyReport, generateMonthlyReport, isGenerating } = usePDFStore();
  const { categories, ratingConfig, getAssessments, saveAssessment } = useNuraniyahStore();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, Status | null>>({});
  const [kitabMap, setKitabMap] = useState<Record<string, boolean>>({});
  const [progressMap, setProgressMap] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [currentStudent, setCurrentStudent] = useState<any>(null);
  const [currentNuraniyah, setCurrentNuraniyah] = useState<Record<string, NuraniyahRating>>({});
  const [lastQirat, setLastQirat] = useState<{ page_number: string; ayah_from: string; ayah_to: string; date: string } | null>(null);

  const [historyVisible, setHistoryVisible] = useState(false);
  const [studentHistory, setStudentHistory] = useState<any>({ attendance: [], progress: [] });

  const [searchQuery, setSearchQuery] = useState('');

  const sessionType = useMemo(() => timeBlock === 'tb_morning' ? 'quran' : 'kitab', [timeBlock]);

  useEffect(() => {
    fetchLevels();
    fetchAssignedGroups();
  }, []);

  const loadDataRequestRef = useRef(0);

  const loadData = useCallback(async () => {
    // 🛡️ STALE-RESPONSE GUARD: loadData can be triggered twice close together
    // (plain useEffect + useFocusEffect both fire on focus/dependency change). If an
    // older call's fetch resolves after a newer one, it would overwrite attendanceMap
    // with out-of-date data — including data from before a mark you just tapped and
    // saved, making it look like the app "forgot" what you just set. Only the most
    // recently-started call is allowed to apply its results.
    const requestId = ++loadDataRequestRef.current;
    const dateStr = getLocalDateString(selectedDate);

    // 🛡️ Categorical Support: Find all level IDs matching this category name
    const finalLevelIds = selectedLevelId ? (
      levels.filter(l => (i18n.language === 'am' ? l.name_am : l.name) === selectedLevelId).map(l => l.id)
    ) : (validLevelIds.length > 0 ? validLevelIds : undefined);

    const firstLevelId = (finalLevelIds && finalLevelIds.length === 1) ? finalLevelIds[0] : undefined;

    try {
      // 🛡️ MONITORING ALIGNMENT: Fetch progress from the selected teacher (for Admin view)
      // Scoped to the active session (Quran/qirat in the morning, Kitab notes in the afternoon)
      // so the two never overwrite each other in progressMap.
      const rows = await getDailyProgress(dateStr, undefined, selectedUstazId || undefined, sessionType);
      if (requestId === loadDataRequestRef.current) {
        const pmap: Record<string, any> = {};
        (rows || []).forEach((p: any) => { if (p?.student_id) pmap[p.student_id] = p; });
        setProgressMap(pmap);
      }
    } catch { if (requestId === loadDataRequestRef.current) setProgressMap({}); }

    try {
      // 🛡️ MONITORING ALIGNMENT: Fetch core attendance records for selected teacher
      const attRows = await fetchAttendance(dateStr, timeBlock, selectedUstazId || undefined);
      if (requestId === loadDataRequestRef.current) {
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

    // 🛡️ MONITORING ALIGNMENT: Fetch students linked to the selected teacher
    await fetchStudents(
      firstLevelId,
      sessionType,
      selectedKitabTeam || undefined,
      selectedUstazId || undefined
    );
  }, [selectedDate, selectedLevelId, validLevelIds, timeBlock, selectedKitabTeam, selectedUstazId, fetchStudents, sessionType, levels, i18n.language]);

  useEffect(() => {
    if ((['admin', 'finance'] as any[]).includes(user?.role)) {
      const { useAuthStore } = require('../../src/store/useAuthStore');
      useAuthStore.getState().getUstazs().then((list: any[]) => {
        const onlyTeachers = (list || []).filter((u: any) => u.role === 'ustaz');
        setUstazList(onlyTeachers);
      });
    }
  }, [user]);

  // 🛡️ SMART FILTERING: Identify which levels the teacher actually manages
  useEffect(() => {
    const findValidLevels = async () => {
      if (!selectedUstazId) {
        setValidLevelIds([]);
        return;
      }
      const db = await getDatabase();
      // Find levels where this teacher has explicitly linked students
      const rows = await db.getAllAsync<{ level_id: string }>(`
        SELECT DISTINCT s.level_id 
        FROM students s
        JOIN teacher_student_links tsl ON s.id = tsl.student_id
        WHERE tsl.teacher_id = ? AND s.is_active = 1
      `, [selectedUstazId]);

      setValidLevelIds(rows.map(r => r.level_id));
    };
    findValidLevels();
  }, [selectedUstazId]);

  // 🛡️ Tab Persistence: Re-fetch data whenever this tab is focused
  const { useFocusEffect } = require('expo-router');
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => { loadData(); }, [loadData]);

  const sortedLevels = useMemo(() => {
    let list = [...(levels || [])];
    // 🛡️ MONITORING FILTER: If Admin selected a teacher, only show THEIR levels
    if (selectedUstazId && validLevelIds.length > 0) {
      list = list.filter(l => validLevelIds.includes(l.id));
    }
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }, [levels, selectedUstazId, validLevelIds]);

  const stats = useMemo(() => {
    const counts = { present: 0, late: 0, excused: 0, absent: 0, unmarked: 0 };
    Object.values(attendanceMap).forEach(s => {
      if (s && (counts as any)[s] !== undefined) (counts as any)[s]++;
      else counts.unmarked++;
    });
    return counts;
  }, [attendanceMap]);

  const cycleStatus = useCallback(async (student: any) => {
    const current = attendanceMap[student.id] ?? null;
    const idx = STATUS_CYCLE.indexOf(current);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];

    setAttendanceMap(prev => ({ ...prev, [student.id]: next }));
    setSaving(student.id);

    try {
      if (user) {
        const dateStr = getLocalDateString(selectedDate);
        if (next !== null) {
          const notes = kitabMap[student.id] ? 'Kitab: Yes' : 'Kitab: No';
          await markAttendance(
            [{ studentId: student.id, status: next as any, notes }],
            dateStr, timeBlock, user.id, selectedUstazId || undefined
          );
        } else {
          // Cycled back to unmarked: must delete the saved row too, or it comes back on next reload
          await clearAttendance(student.id, dateStr, timeBlock, user.id, selectedUstazId || undefined);
        }
      }
    } catch (e) {
      setAttendanceMap(prev => ({ ...prev, [student.id]: current }));
    } finally {
      setSaving(null);
    }
  }, [attendanceMap, kitabMap, user, selectedDate, timeBlock, clearAttendance, selectedUstazId]);

  const markStatus = useCallback(async (student: any, st: Status) => {
    const current = attendanceMap[student.id] ?? null;
    // Toggle off if same status tapped again
    const next: Status | null = current === st ? null : st;

    setAttendanceMap(prev => ({ ...prev, [student.id]: next }));
    setSaving(student.id);

    try {
      if (user) {
        const dateStr = getLocalDateString(selectedDate);
        const notes = kitabMap[student.id] ? 'Kitab: Yes' : 'Kitab: No';
        if (next !== null) {
          await markAttendance(
            [{ studentId: student.id, status: next as any, notes }],
            dateStr, timeBlock, user.id, selectedUstazId || undefined
          );
        } else {
          // Un-marking: must delete the saved row too, or it comes back on next reload
          await clearAttendance(student.id, dateStr, timeBlock, user.id, selectedUstazId || undefined);
        }
      }
    } catch (e) {
      setAttendanceMap(prev => ({ ...prev, [student.id]: current }));
    } finally {
      setSaving(null);
    }
  }, [attendanceMap, kitabMap, user, selectedDate, timeBlock, clearAttendance, selectedUstazId]);

  const toggleKitab = useCallback(async (student: any) => {
    const current = kitabMap[student.id] || false;
    const next = !current;
    setKitabMap(prev => ({ ...prev, [student.id]: next }));

    const status = attendanceMap[student.id];
    if (status && user) {
      const dateStr = getLocalDateString(selectedDate);
      const notes = next ? 'Kitab: Yes' : 'Kitab: No';
      await markAttendance([{ studentId: student.id, status: status as any, notes }], dateStr, timeBlock, user.id, selectedUstazId || undefined);
    }
  }, [kitabMap, attendanceMap, user, selectedDate, timeBlock, selectedUstazId]);

  const openHistory = async (student: any) => {
    setCurrentStudent(student);
    setHistoryVisible(true);
    const { getStudentHistorySummary } = useReportStore.getState();
    const summary = await getStudentHistorySummary(student.id);
    setStudentHistory(summary || { attendance: [], progress: [] });
  };

  const openQirat = async (student: any) => {
    setCurrentStudent(student);
    setModalVisible(true);

    // 🛡️ FIX: pre-fill existing Nuraniyah ratings for this student/date, so re-opening
    // the modal doesn't wipe out ratings already saved (previously this state was never
    // populated at all, so localNuraniyah always started empty).
    if (isNuraniyahStudent(student)) {
      const dateStr = getLocalDateString(selectedDate);
      try {
        const rows = await getAssessments(student.id, dateStr);
        const map: Record<string, NuraniyahRating> = {};
        rows.forEach(r => { map[r.category] = r.rating; });
        setCurrentNuraniyah(map);
      } catch (e) {
        console.warn('Failed to load existing Nuraniyah ratings', e);
        setCurrentNuraniyah({});
      }
    } else {
      setCurrentNuraniyah({});
    }

    // 🆕 For the plain Qirat (Quran) entry — not Nuraniyah, not the Kitab afternoon
    // session, where page/ayah don't apply — fetch the student's last recorded page +
    // ayah range so the modal can show/pre-fill "where they left off" instead of the
    // ustaz needing to remember or look it up.
    if (!isNuraniyahStudent(student) && sessionType === 'quran') {
      const dateStr = getLocalDateString(selectedDate);
      try {
        const last = await getLastProgress(student.id, dateStr, 'quran');
        setLastQirat(last);
      } catch (e) {
        console.warn('Failed to load last Qirat progress', e);
        setLastQirat(null);
      }
    } else {
      setLastQirat(null);
    }
  };

  const submitProgress = async (data: any) => {
    if (!currentStudent || !user) return;
    if (user.role === 'committee') return; // 🛡️ view-only role, matches Qirat button being hidden
    const dateStr = getLocalDateString(selectedDate);

    const { pageNumber: p, ayahFrom: af, ayahTo: at, lessonDetails: ld, rating: r, nuraniyah } = data;

    await saveProgress({
      student_id: currentStudent.id,
      date: dateStr,
      page_number: p,
      ayah_from: af,
      ayah_to: at,
      lesson_details: ld,
      rating: r,
      ustaz_id: user.id,
      level_id: currentStudent.level_id || '',
      ustaz_notes: '',
      session_type: sessionType,
    });

    // 🛡️ FIX: previously `nuraniyah` was destructured from `data` but never used — the
    // ProgressModal collected per-category ratings into local state with no picker UI to
    // set them and no save path, so any rating a user entered was silently discarded.
    if (isNuraniyahStudent(currentStudent) && nuraniyah && Object.keys(nuraniyah).length > 0) {
      for (const category of Object.keys(nuraniyah)) {
        const rating = nuraniyah[category];
        if (!rating) continue;
        try {
          await saveAssessment(currentStudent.id, dateStr, category, rating, user.id);
        } catch (e: any) {
          Alert.alert(
            i18n.language === 'am' ? 'ስህተት' : 'Error',
            e?.message || (i18n.language === 'am' ? 'ደረጃውን ማስቀመጥ አልተቻለም' : `Could not save ${category} rating.`)
          );
        }
      }
    }

    setModalVisible(false);
    await loadData();
  };

  const safeStudents = useMemo(() => {
    let list = (students || []).filter((s, i, a) => s?.id && a.findIndex(t => t.id === s.id) === i);

    // 🛡️ Filter by Official Category (Nuraniya, Quran 1, Quran 2, Hifz)
    if (selectedLevelId) {
      list = list.filter(item => (i18n.language === 'am' ? item.level_name_am : item.level_name) === selectedLevelId);
    }

    // 🔎 Name search — matches either the Amharic or English name, case/diacritic-insensitive.
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(item =>
        (item.name_am || '').toLowerCase().includes(q) ||
        (item.name_en || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [students, selectedLevelId, selectedKitabTeam, i18n.language, selectedUstazId, attendanceMap, user?.role, searchQuery]);

  const boys = useMemo(() => safeStudents.filter(s => s.gender === 'male').sort((a, b) => a.name_am.localeCompare(b.name_am)), [safeStudents]);
  const girls = useMemo(() => safeStudents.filter(s => s.gender === 'female').sort((a, b) => a.name_am.localeCompare(b.name_am)), [safeStudents]);
  const totalStudents = safeStudents.length;
  const presentCount = Object.values(attendanceMap).filter(v => v === 'present').length;
  const absentCount = Object.values(attendanceMap).filter(v => v === 'absent').length;
  const excusedCount = Object.values(attendanceMap).filter(v => v === 'excused' || v === 'late').length;
  const unmarkedCount = totalStudents - Object.values(attendanceMap).filter(v => v !== null && v !== 'none').length;
  const markedCount = totalStudents - unmarkedCount;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Surface style={styles.header} elevation={4}>
        <View style={styles.headerTop}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton
              icon="arrow-left"
              iconColor="white"
              size={24}
              onPress={() => require('expo-router').router.replace('/(tabs)/dashboard')}
              style={{ marginLeft: -12 }}
            />
            <View>
              <Text style={styles.title}>{t('attendance')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.subTitle}>{markedCount}/{totalStudents} {i18n.language === 'am' ? 'ተመዝግቧል' : 'Marked Today'}</Text>
              </View>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => generateOverallPDFReport(selectedLevelId)} style={[styles.headerIconBtn, { backgroundColor: '#dc262625' }]}>
              <MaterialCommunityIcons name="file-pdf-box" size={20} color="#dc2626" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={[styles.headerIconBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <MaterialCommunityIcons name="calendar-month" size={20} color="white" />
              <Text style={{ color: 'white', fontWeight: '800', marginLeft: 4 }}>{selectedDate.getDate()}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 🌓 Session Toggle: Morning (Quran) vs Afternoon (Kitab) */}
        <View style={styles.sessionToggleRow}>
          <TouchableOpacity
            onPress={() => setTimeBlock('tb_morning')}
            style={[styles.sessionTab, timeBlock === 'tb_morning' && styles.sessionTabActive]}
          >
            <MaterialCommunityIcons name="weather-sunny" size={20} color={timeBlock === 'tb_morning' ? COLORS.primaryDark : 'rgba(255,255,255,0.6)'} />
            <Text style={[styles.sessionTabTxt, timeBlock === 'tb_morning' && styles.sessionTabTxtActive]}>
              {i18n.language === 'am' ? 'ጠዋት (ቁርአን)' : 'Morning (Quran)'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTimeBlock('tb_afternoon')}
            style={[styles.sessionTab, timeBlock === 'tb_afternoon' && styles.sessionTabActive]}
          >
            <MaterialCommunityIcons name="book-open-variant" size={20} color={timeBlock === 'tb_afternoon' ? COLORS.primaryDark : 'rgba(255,255,255,0.6)'} />
            <Text style={[styles.sessionTabTxt, timeBlock === 'tb_afternoon' && styles.sessionTabTxtActive]}>
              {i18n.language === 'am' ? 'ከሰዓት (ኪታብ)' : 'Afternoon (Kitab)'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 🛡️ ADMIN TEACHER PICKER */}
        {((['admin', 'finance', 'committee'] as any[]).includes(user?.role)) && (
          <View style={{ paddingHorizontal: 20, marginBottom: 15 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 5 }}>
              <Chip
                selected={selectedUstazId === null}
                onPress={() => setSelectedUstazId(null)}
                style={[styles.chip, selectedUstazId === null && styles.chipActive]}
                textStyle={[styles.chipTxt, selectedUstazId === null && styles.chipTxtActive]}
              >
                GLOBAL MONITORING
              </Chip>
              {ustazList.map(u => (
                <Chip
                  key={u.id}
                  selected={selectedUstazId === u.id}
                  onPress={() => setSelectedUstazId(u.id)}
                  style={[styles.chip, selectedUstazId === u.id && styles.chipActive]}
                  textStyle={[styles.chipTxt, selectedUstazId === u.id && styles.chipTxtActive]}
                >
                  {u.name.toUpperCase()}
                </Chip>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.levelScrollWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
            <Chip
              selected={selectedLevelId === null && selectedKitabTeam === null}
              onPress={() => {
                setSelectedLevelId(null);
                setSelectedKitabTeam(null);
              }}
              style={[styles.chip, selectedLevelId === null && selectedKitabTeam === null && styles.chipActive]}
              textStyle={[styles.chipTxt, selectedLevelId === null && selectedKitabTeam === null && styles.chipTxtActive]}
            >
              {i18n.language === 'am' ? 'ሁሉንም ተማሪዎች' : 'All Students'}
            </Chip>

            {/* ── KITAB TEAM FILTERS (Institutional Mode for Afternoon) ── */}
            {timeBlock === 'tb_afternoon' && (user?.role === 'admin' || user?.role === 'ustaz') && assignedGroups.length > 0 ? (
              assignedGroups.map((group) => {
                const isSelected = selectedKitabTeam === group;
                return (
                  <Chip
                    key={group}
                    selected={isSelected}
                    onPress={() => {
                      setSelectedKitabTeam(isSelected ? null : group);
                      setSelectedLevelId(null);
                    }}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    textStyle={[styles.chipTxt, isSelected && styles.chipTxtActive]}
                  >
                    {i18n.language === 'am' ? (
                      group.includes('Nuraniya') ? 'ኑራኒያ ቡድን' :
                        group.includes('Quran 1') ? 'ቁርአን 1 ቡድን' : 'ሂፍዝ ቡድን'
                    ) : group.replace('Team ', '')}
                  </Chip>
                );
              })
            ) : (
              /* 🛡️ Quran/Level Filters: Show levels assigned to this teacher */
              Array.from(new Set(students.map(s => i18n.language === 'am' ? s.level_name_am : s.level_name))).filter(Boolean).sort().map(uniqueName => {
                const isSelected = selectedLevelId === uniqueName;
                return (
                  <Chip
                    key={uniqueName as string}
                    selected={isSelected}
                    onPress={() => {
                      setSelectedLevelId(isSelected ? null : (uniqueName ?? ''));
                      setSelectedKitabTeam(null);
                    }}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    textStyle={[styles.chipTxt, isSelected && styles.chipTxtActive]}
                  >
                    {uniqueName as string}
                  </Chip>
                );
              })
            )}

            {/* Admin-Only: Divider if needed (deprecated and replaced by unified level filter above) */}
            {user?.role === 'admin' && <View style={styles.vDividerAttendance} />}
          </ScrollView>
        </View>

        <View style={styles.searchWrap}>
          <Searchbar
            placeholder={i18n.language === 'am' ? 'ተማሪ ፈልግ...' : 'Search student...'}
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchBar}
            inputStyle={{ fontSize: 14, minHeight: 45, paddingTop: 0, paddingBottom: 0 }}
            iconColor={COLORS.primary}
            elevation={0}
          />
        </View>
      </Surface>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {/* 📊 GLOBAL MONITORING SUMMARY */}
        {selectedUstazId === null && (['admin', 'finance', 'committee'] as any[]).includes(user?.role) && (
          <Surface style={{ margin: 20, padding: 20, borderRadius: 24, backgroundColor: 'white' }} elevation={2}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.primaryDark, marginBottom: 15, textAlign: 'center' }}>
              {i18n.language === 'am' ? 'የአጠቃላይ መከታተያ ማጠቃለያ' : 'GLOBAL ATTENDANCE SUMMARY'}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#16a34a' }}>{presentCount}</Text>
                <Text style={{ fontSize: 10, color: '#64748b' }}>{i18n.language === 'am' ? 'የመጡ' : 'Present'}</Text>
              </View>
              <View style={{ height: 30, width: 1, backgroundColor: '#f1f5f9' }} />
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#ef4444' }}>{absentCount}</Text>
                <Text style={{ fontSize: 10, color: '#64748b' }}>{i18n.language === 'am' ? 'የቀሩ' : 'Absent'}</Text>
              </View>
              <View style={{ height: 30, width: 1, backgroundColor: '#f1f5f9' }} />
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#f59e0b' }}>{excusedCount}</Text>
                <Text style={{ fontSize: 10, color: '#64748b' }}>{i18n.language === 'am' ? 'የፈቀዱ' : 'Excused'}</Text>
              </View>
              <View style={{ height: 30, width: 1, backgroundColor: '#f1f5f9' }} />
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#64748b' }}>{unmarkedCount > 0 ? unmarkedCount : 0}</Text>
                <Text style={{ fontSize: 10, color: '#64748b' }}>{i18n.language === 'am' ? 'ያልተመዘገቡ' : 'Unmarked'}</Text>
              </View>
            </View>
          </Surface>
        )}

        {boys.length > 0 && <SectionTitle emoji="👦" title={i18n.language === 'am' ? 'ወንዶች' : 'Boys'} count={boys.length} color="#3b82f6" />}
        {boys.map(s => (
          <StudentCard
            key={s.id}
            student={s}
            status={attendanceMap[s.id]}
            progress={progressMap[s.id]}
            hasKitab={kitabMap[s.id]}
            isKitabPhase={timeBlock === 'tb_afternoon'}
            onKitabToggle={() => isEditing && toggleKitab(s)}
            saving={saving === s.id}
            isEditing={isEditing}
            onTap={(st: Status) => isEditing && markStatus(s, st)}
            onHeaderPress={() => isEditing ? null : openHistory(s)}
            onLongPress={() => openHistory(s)}
            onQirat={() => openQirat(s)}
            lang={i18n.language}
            user={user}
          />
        ))}
        {girls.length > 0 && <SectionTitle emoji="👧" title={i18n.language === 'am' ? 'ሴቶች' : 'Girls'} count={girls.length} color="#ec4899" />}
        {girls.map(s => (
          <StudentCard
            key={s.id}
            student={s}
            status={attendanceMap[s.id]}
            progress={progressMap[s.id]}
            hasKitab={kitabMap[s.id]}
            isKitabPhase={timeBlock === 'tb_afternoon'}
            onKitabToggle={() => isEditing && toggleKitab(s)}
            saving={saving === s.id}
            isEditing={isEditing}
            onTap={(st: Status) => isEditing && markStatus(s, st)}
            onHeaderPress={() => isEditing ? null : openHistory(s)}
            onLongPress={() => openHistory(s)}
            onQirat={() => openQirat(s)}
            lang={i18n.language}
            user={user}
          />
        ))}
        <View style={{ height: 100 + insets.bottom }} />
      </ScrollView>

      {/* 🛡️ FIX: Edit Attendance is now always shown for admin/ustaz, including Global
          Monitoring. Previously admin had to leave Global Monitoring, tap into a specific
          ustaz, hit Edit, then navigate back — an unnecessary extra hop, since
          markAttendance() always stamps `marked_by` with the logged-in admin's own
          user.id regardless of which ustaz tab is selected. selectedUstazId is only a
          display filter here, not a requirement for editing, so the button no longer
          depends on it. */}
      {(user?.role === 'admin' || user?.role === 'ustaz') && (
        <Surface style={[styles.tabFooter, { paddingBottom: 15 + insets.bottom }]} elevation={4}>
          <Button mode="contained" onPress={() => setIsEditing(!isEditing)}
            style={[styles.editBtn, isEditing && { backgroundColor: COLORS.primary }]}
            icon={isEditing ? "check" : "pencil-outline"}>
            {isEditing
              ? (i18n.language === 'am' ? 'ጨርስ (Finish)' : 'Done Editing')
              : (i18n.language === 'am' ? 'ማስተካከያ (Edit)' : 'Edit Attendance')
            }
          </Button>
        </Surface>
      )}

      {isGenerating && (
        <Portal>
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="white" />
            <Text style={{ color: 'white', marginTop: 15, fontWeight: '800' }}>{i18n.language === 'am' ? 'ሪፖርት በመዘጋጀት ላይ...' : 'Generating PDF Report...'}</Text>
          </View>
        </Portal>
      )}

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

      <Portal>
        {/* Progress/Assessment Modal (Optimized) */}
        <ProgressModal
          key={currentStudent?.id || 'none'}
          visible={modalVisible}
          onDismiss={() => setModalVisible(false)}
          student={currentStudent}
          onSave={submitProgress}
          initialData={currentStudent ? (progressMap[currentStudent.id] || {}) : {}}
          isNuraniyah={currentStudent ? isNuraniyahStudent(currentStudent) : false}
          isKitabPhase={timeBlock === 'tb_afternoon'}
          initialNuraniyah={currentNuraniyah}
          lastProgress={lastQirat}
          categories={categories}
          ratingConfig={ratingConfig}
          isSaving={saving === (currentStudent?.id || '')}
          t={t}
          i18n={i18n}
          styles={styles}
        />

        {/* Student History Modal */}
        <Modal visible={historyVisible} onDismiss={() => setHistoryVisible(false)} contentContainerStyle={styles.historyModal}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar.Text size={40} label={currentStudent?.name_am.substring(0, 1)} style={{ backgroundColor: COLORS.primary }} />
              <View style={{ marginLeft: 12 }}>
                <Text style={{ fontSize: 18, fontWeight: '900' }}>{currentStudent?.name_am}</Text>
                <Text style={{ fontSize: 12, color: '#64748b' }}>{i18n.language === 'am' ? 'የቅርብ ጊዜ እንቅስቃሴ' : 'Recent Activity History'}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity
                onPress={() => currentStudent && generateWeeklyReport(currentStudent.id)}
                style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#dc262625', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}
              >
                <MaterialCommunityIcons name="file-pdf-box" size={24} color="#dc2626" />
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#dc2626' }}>{i18n.language === 'am' ? 'ሳምንት' : 'Week'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => currentStudent && generateMonthlyReport(currentStudent.id)}
                style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#1a4b3c25', alignItems: 'center', justifyContent: 'center' }}
              >
                <MaterialCommunityIcons name="file-chart-outline" size={22} color="#1a4b3c" />
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#1a4b3c' }}>{i18n.language === 'am' ? 'ወር' : 'Month'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={{ maxHeight: 400 }}>
            <Text style={styles.historySectionLabel}>{t('attendance')}</Text>
            {(studentHistory.attendance || []).map((a: any, i: number) => (
              <View key={i} style={styles.historyRow}>
                <Text style={styles.historyDate}>{a.date}</Text>
                <MaterialCommunityIcons name="circle" size={8} color={STATUS_UI[a.status]?.border} style={{ marginHorizontal: 10 }} />
                <Text style={{ fontWeight: '800', color: STATUS_UI[a.status]?.text, fontSize: 13 }}>{a.status.toUpperCase()}</Text>
              </View>
            ))}

            <Divider style={{ marginVertical: 15 }} />
            <Text style={styles.historySectionLabel}>{i18n.language === 'am' ? 'የትምህርት ሂደት' : 'Progress'}</Text>
            {(studentHistory.progress || []).map((p: any, i: number) => (
              <View key={i} style={styles.historyProgressCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text style={{ fontWeight: '900', color: COLORS.primaryDark }}>{p.date}</Text>
                  <Text style={{ fontWeight: '800', color: COLORS.primary }}>
                    {i18n.language === 'am' ? 'ገጽ ' : 'Page '}{p.page_number}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: '#475569' }}>{p.lesson_details}</Text>
              </View>
            ))}

            <Divider style={{ marginVertical: 15 }} />
            <Text style={styles.historySectionLabel}>{i18n.language === 'am' ? 'የኪታብ ጉርሻ ማስታወሻ' : 'Kitab Bonus Notes'}</Text>
            {((studentHistory.kitabNotes || []).length === 0) && (
              <Text style={{ fontSize: 12.5, color: '#94a3b8', fontStyle: 'italic' }}>
                {i18n.language === 'am' ? 'ምንም መረጃ የለም' : 'No bonus notes yet'}
              </Text>
            )}
            {(studentHistory.kitabNotes || []).map((n: any, i: number) => (
              <View key={i} style={styles.historyProgressCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text style={{ fontWeight: '900', color: COLORS.primaryDark }}>{n.date}</Text>
                  <View style={{ flexDirection: 'row' }}>
                    {[1, 2, 3, 4, 5].map(s => (
                      <MaterialCommunityIcons key={s} name="star" size={12} color={n.rating >= s ? '#eab308' : '#e2e8f0'} />
                    ))}
                  </View>
                </View>
                <Text style={{ fontSize: 12, color: '#475569' }}>{n.lesson_details}</Text>
              </View>
            ))}
          </ScrollView>

          <Button mode="outlined" onPress={() => setHistoryVisible(false)} style={{ marginTop: 20 }}>{t('close')}</Button>
        </Modal>
      </Portal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  header: { backgroundColor: COLORS.primaryDark, paddingTop: 50, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 15 },
  title: { color: 'white', fontSize: 22, fontWeight: '900' },
  subTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  headerIconBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },

  sessionToggleRow: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 15, gap: 10 },
  sessionTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
  sessionTabActive: { backgroundColor: 'white' },
  sessionTabTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '800' },
  sessionTabTxtActive: { color: COLORS.primaryDark },

  levelScrollWrap: { paddingVertical: 10, backgroundColor: 'transparent' },
  vDividerAttendance: { width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginHorizontal: 12 },
  chip: { marginRight: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'transparent' },
  chipActive: { backgroundColor: 'white' },
  searchWrap: { paddingHorizontal: 20, marginTop: 12, marginBottom: 5 },
  searchBar: { borderRadius: 14, backgroundColor: 'white', height: 46 },
  chipTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  chipTxtActive: { color: COLORS.primaryDark },
  list: { flex: 1, padding: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, marginTop: 15 },
  sectionEmoji: { fontSize: 18 },
  sectionTitleTxt: { fontSize: 16, fontWeight: '900', color: '#475569' },
  sectionCount: { backgroundColor: '#e2e8f0', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  sectionCountTxt: { fontSize: 11, fontWeight: '800', color: '#64748b' },

  card: { backgroundColor: 'white', borderRadius: 20, marginBottom: 15, padding: 15, overflow: 'hidden' },
  cardInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  cardName: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  cardProgSub: { fontSize: 12, color: COLORS.primary, fontWeight: '700', marginTop: 2 },
  statusIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusIndicatorTxt: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },

  actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  statusBtn: { flex: 1, minWidth: '18%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  statusBtnTxt: { fontSize: 10, fontWeight: '800' },

  cardQiratBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#f0f9ff', alignItems: 'center', justifyContent: 'center' },
  kitabRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  kitabToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 10, gap: 6 },
  kitabToggleOn: { backgroundColor: '#10b981' },
  kitabToggleTxt: { fontSize: 12, fontWeight: '800', color: '#64748b' },
  kitabBonusBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f9ff', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 10, gap: 6 },
  kitabBonusBtnTxt: { fontSize: 12, fontWeight: '800', color: COLORS.primary },

  tabFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'white', padding: 15, borderTopLeftRadius: 25, borderTopRightRadius: 25 },
  editBtn: { height: 50, borderRadius: 15, backgroundColor: '#64748b' },
  modal: { backgroundColor: 'white', padding: 25, margin: 15, borderRadius: 30 },
  modalTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center', marginBottom: 20 },
  modalInput: { marginBottom: 15, backgroundColor: 'white' },
  loadingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  historyModal: { backgroundColor: 'white', padding: 25, margin: 15, borderRadius: 30 },
  historySectionLabel: { fontSize: 11, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 10 },
  historyRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  historyDate: { width: 90, fontSize: 12, fontWeight: '700', color: '#475569' },
  historyProgressCard: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9' },
  progBadge: { backgroundColor: COLORS.primary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: COLORS.primary + '33' },
  progBadgeTxt: { fontSize: 9, fontWeight: '900', color: COLORS.primary, textTransform: 'uppercase' },
  progAyah: { fontSize: 10, fontWeight: '800', color: '#64748b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

// 🛡️ PROGRESS MODAL COMPONENT (Optimized to prevent flickering)
const ProgressModal = React.memo(({ visible, onDismiss, student, onSave, initialData, isNuraniyah, isKitabPhase, initialNuraniyah, lastProgress, categories, ratingConfig, isSaving, t, i18n, styles }: any) => {
  const [localPage, setLocalPage] = useState('');
  const [localAyahFrom, setLocalAyahFrom] = useState('');
  const [localAyahTo, setLocalAyahTo] = useState('');
  const [localDetails, setLocalDetails] = useState('');
  const [localRating, setLocalRating] = useState(5);
  const [localNuraniyah, setLocalNuraniyah] = useState<Record<string, any>>({});
  const [usedLastProgress, setUsedLastProgress] = useState(false);

  const lastId = useRef<string | null>(null);
  // 🛡️ FIX: the app re-fetches attendance/progress every ~30s in the background (and on
  // focus), which handed this modal a brand-new `initialData`/`lastProgress` object each
  // time — same content, different reference. That re-ran the pre-fill effect below and
  // stomped over whatever the ustaz had already typed, so a field could go blank the
  // moment they tabbed to the next one. `dirty` marks "the ustaz has started editing this
  // student's entry" so once set, later prop refreshes are ignored until the modal is
  // reopened (new student, or same student re-opened) — at which point it resets and the
  // real pre-fill/catch-up logic (including async Nuraniyah ratings / last-session data
  // arriving a moment after opening) runs again as intended.
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

    const hasTodayRecord = !!(initialData?.page_number || initialData?.page || initialData?.ayah_from || initialData?.ayah);

    // 🆕 If there's no record for today yet, pre-fill Page/Ayah from the student's last
    // Qirat session instead of leaving the fields blank — still fully editable, just a
    // starting point so the ustaz doesn't have to recall or look it up. If today's
    // record already exists, that takes priority as before.
    if (!hasTodayRecord && !isNuraniyah && !isKitabPhase && lastProgress) {
      setLocalPage(lastProgress.page_number?.toString() || '');
      setLocalAyahFrom(lastProgress.ayah_from?.toString() || '');
      setLocalAyahTo(lastProgress.ayah_to?.toString() || '');
      setUsedLastProgress(true);
    } else {
      // 🛡️ PROFESSIONAL PRE-FILL: Ensure we always show the current daily record if it exists
      setLocalPage(initialData?.page_number?.toString() || initialData?.page?.toString() || '');
      setLocalAyahFrom(initialData?.ayah_from || initialData?.ayah || '');
      setLocalAyahTo(initialData?.ayah_to || '');
      setUsedLastProgress(false);
    }
    setLocalDetails(initialData?.lesson_details || initialData?.details || '');
    setLocalRating(initialData?.rating || 5);
    // 🛡️ FIX: this used to read initialData?.nuraniyah, which was never set anywhere
    // (progressMap only ever holds saveProgress records, never Nuraniyah ratings), so
    // this always reset to {}. Now it seeds from the real fetched ratings.
    setLocalNuraniyah(initialNuraniyah || {});
  }, [visible, student, initialData, initialNuraniyah, lastProgress, isNuraniyah, isKitabPhase]);

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
      nuraniyah: localNuraniyah
    });
  };

  return (
    <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
      <Text style={styles.modalTitle}>{isKitabPhase ? '📗' : '📖'} {student?.name_am}</Text>
      {isKitabPhase ? (
        <View style={{ gap: 10 }}>
          <TextInput
            label={i18n.language === 'am' ? 'ማስታወሻ / ጉርሻ ምክንያት' : 'Note / Reason for bonus'}
            value={localDetails}
            onChangeText={(v: string) => { setLocalDetails(v); dirty.current = true; }}
            mode="outlined"
            multiline
            style={styles.modalInput}
            autoCorrect={false}
          />
          <Text style={{ fontSize: 12.5, color: '#64748b', fontWeight: '700', textAlign: 'center', marginTop: 2 }}>
            {i18n.language === 'am' ? 'የጉርሻ ውጤት' : 'Bonus mark'}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity key={star} onPress={() => { setLocalRating(star); dirty.current = true; }}>
                <MaterialCommunityIcons name={localRating >= star ? "star" : "star-outline"} size={36} color={localRating >= star ? "#eab308" : "#cbd5e1"} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : isNuraniyah ? (
        <View style={{ gap: 10 }}>
          <TextInput
            label={i18n.language === 'am' ? 'የገጽ/ደርስ ቁጥር' : 'Page/Lesson Number'}
            value={localPage}
            onChangeText={(v: string) => { setLocalPage(v); dirty.current = true; }}
            mode="outlined"
            style={styles.modalInput}
            keyboardType="default"
            autoCorrect={false}
          />
          <TextInput
            label={i18n.language === 'am' ? 'መስመሮች (ብዛት)' : 'Lines (Amount)'}
            value={localAyahFrom}
            onChangeText={(v: string) => { setLocalAyahFrom(v); dirty.current = true; }}
            mode="outlined"
            style={styles.modalInput}
            keyboardType="default"
            placeholder="e.g. 1-4"
            autoCorrect={false}
          />
          <TextInput label={t('lesson_details')} value={localDetails} onChangeText={(v: string) => { setLocalDetails(v); dirty.current = true; }} mode="outlined" multiline style={styles.modalInput} autoCorrect={false} />

          {/* 🛡️ FIX: this picker didn't exist before — localNuraniyah had nowhere to be set
              from the UI, so it was always {} and submitProgress had nothing to save. */}
          <View style={{ gap: 8, marginTop: 4 }}>
            {(categories || []).map((category: string) => {
              const selected = localNuraniyah[category];
              return (
                <View key={category} style={{ gap: 4 }}>
                  <Text style={{ fontWeight: '700', fontSize: 13, color: '#475569' }}>{category}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {Object.keys(ratingConfig || {}).map((ratingKey) => {
                      const cfg = ratingConfig[ratingKey];
                      const isSelected = selected === ratingKey;
                      return (
                        <TouchableOpacity
                          key={ratingKey}
                          onPress={() => { setLocalNuraniyah((prev: any) => ({ ...prev, [category]: ratingKey })); dirty.current = true; }}
                          style={{
                            flex: 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            paddingVertical: 8,
                            borderRadius: 10,
                            borderWidth: 1.5,
                            borderColor: isSelected ? cfg.color : '#e2e8f0',
                            backgroundColor: isSelected ? cfg.bg : '#fff',
                          }}
                        >
                          <Text style={{ fontSize: 14 }}>{cfg.emoji}</Text>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: isSelected ? cfg.color : '#94a3b8' }}>
                            {i18n.language === 'am' ? cfg.label_am : cfg.label_en}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput
              label={t('page_number')}
              value={localPage}
              onChangeText={(v: string) => { setLocalPage(v); setUsedLastProgress(false); dirty.current = true; }}
              mode="outlined"
              style={[styles.modalInput, { flex: 1 }]}
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
            <Text style={{ fontSize: 11.5, color: '#94a3b8', fontStyle: 'italic', marginTop: -4 }}>
              {i18n.language === 'am'
                ? `ካለፈው ክፍለ ጊዜ (${lastProgress.date}) ተሞልቷል — መቀየር ይችላሉ`
                : `Pre-filled from last session (${lastProgress.date}) — edit if needed`}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TextInput label={t('ayah_from')} value={localAyahFrom} onChangeText={(v: string) => { setLocalAyahFrom(v); setUsedLastProgress(false); dirty.current = true; }} mode="outlined" style={{ flex: 1 }} keyboardType="numeric" autoCorrect={false} />
            <TextInput label={t('ayah_to')} value={localAyahTo} onChangeText={(v: string) => { setLocalAyahTo(v); setUsedLastProgress(false); dirty.current = true; }} mode="outlined" style={{ flex: 1 }} keyboardType="numeric" autoCorrect={false} />
          </View>
          <TextInput label={t('lesson_details')} value={localDetails} onChangeText={(v: string) => { setLocalDetails(v); dirty.current = true; }} mode="outlined" multiline style={styles.modalInput} autoCorrect={false} />

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity key={star} onPress={() => { setLocalRating(star); dirty.current = true; }}>
                <MaterialCommunityIcons name={localRating >= star ? "star" : "star-outline"} size={36} color={localRating >= star ? "#eab308" : "#cbd5e1"} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}


      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button mode="outlined" onPress={onDismiss} style={{ flex: 1 }} labelStyle={{ fontWeight: '800' }}>{t('cancel')}</Button>
        <Button mode="contained" onPress={handleSave} loading={isSaving} style={{ flex: 1, backgroundColor: COLORS.primaryDark }} labelStyle={{ fontWeight: '800' }}>
          {t('save')}
        </Button>
      </View>
    </Modal>
  );
});

function SectionTitle({ emoji, title, count, color }: any) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionEmoji}>{emoji}</Text>
      <Text style={[styles.sectionTitleTxt, { color }]}>{title}</Text>
      <View style={[styles.sectionCount, { backgroundColor: color + '15' }]}>
        <Text style={[styles.sectionCountTxt, { color }]}>{count}</Text>
      </View>
    </View>
  );
}

function StudentCard({ student, status, progress, hasKitab, isKitabPhase, onKitabToggle, saving, isEditing, onTap, onHeaderPress, onLongPress, onQirat, lang, user }: any) {
  const ui = STATUS_UI[status ?? 'none'];
  const canQirat = status === 'present' || status === 'late';
  const genderColor = student.gender === 'male' ? '#3b82f6' : '#ec4899';

  const mark = (st: Status) => {
    onTap(st);
  };

  return (
    <Surface style={styles.card} elevation={1}>
      <TouchableOpacity style={styles.cardInfo} onPress={onHeaderPress} onLongPress={onLongPress}>
        <Avatar.Text
          size={42}
          label={student.name_am.substring(0, 1)}
          style={{ backgroundColor: genderColor + '15' }}
          color={genderColor}
        />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.cardName}>{lang === 'am' ? student.name_am : student.name_en}</Text>
          {progress ? (
            isKitabPhase ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                {!!progress.lesson_details && (
                  <Text style={styles.progAyah} numberOfLines={1}>{progress.lesson_details}</Text>
                )}
                <View style={{ flexDirection: 'row', marginLeft: 4 }}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <MaterialCommunityIcons key={s} name="star" size={10} color={progress.rating >= s ? '#eab308' : '#e2e8f0'} />
                  ))}
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <View style={styles.progBadge}>
                  <Text style={styles.progBadgeTxt}>{lang === 'am' ? 'ገጽ' : 'PAGE'} {progress.page_number}</Text>
                </View>
                <Text style={styles.progAyah}>
                  {isNuraniyahStudent(student) ? `[${progress.ayah_from}]` : `(${progress.ayah_from}-${progress.ayah_to})`}
                </Text>
                <View style={{ flexDirection: 'row', marginLeft: 4 }}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <MaterialCommunityIcons key={s} name="star" size={10} color={progress.rating >= s ? '#eab308' : '#e2e8f0'} />
                  ))}
                </View>
              </View>
            )
          ) : (
            <Text style={[styles.cardProgSub, { color: '#cbd5e1' }]}>— No progress yet —</Text>
          )}
        </View>
        {status && (
          <View style={[styles.statusIndicator, { backgroundColor: ui.bg }]}>
            <MaterialCommunityIcons name={ui.icon as any} size={16} color={ui.text} />
            <Text style={[styles.statusIndicatorTxt, { color: ui.text }]}>
              {lang === 'am' ? (status === 'present' ? 'አለ' : status === 'late' ? 'ዘግይቷል' : status === 'absent' ? 'የለም' : 'ፈቃድ') : ui.label}
            </Text>
          </View>
        )}
        {saving && <ActivityIndicator size="small" color={COLORS.primary} style={{ marginLeft: 8 }} />}
      </TouchableOpacity>

      <View style={styles.actionRow}>
        {(['present', 'late', 'absent', 'excused'] as Status[]).map((st) => (
          <TouchableOpacity
            key={st}
            style={[
              styles.statusBtn,
              status === st && { backgroundColor: STATUS_UI[st].border, borderColor: STATUS_UI[st].border }
            ]}
            onPress={() => mark(st)}
          >
            <MaterialCommunityIcons
              name={STATUS_UI[st].icon as any}
              size={18}
              color={status === st ? 'white' : STATUS_UI[st].border}
            />
            <Text style={[styles.statusBtnTxt, { color: status === st ? 'white' : '#64748b' }]}>
              {lang === 'am' ? (st === 'present' ? 'አለ' : st === 'late' ? 'ዘ.' : st === 'absent' ? 'የለም' : 'ፈቃድ') : STATUS_UI[st].label}
            </Text>
          </TouchableOpacity>
        ))}

        {/* 🛡️ FIX (non-Kitab only): unlike the status buttons above (gated by `isEditing &&`
            at the call site), this button called onQirat unconditionally — so a committee
            (view-only) user could open the progress modal and write a student_progress
            record regardless of role or edit mode. Committee has no equivalent "Edit"
            toggle exposed anywhere on this screen, so it should never see this button
            either. The Kitab-phase version of this button moved to its own row below —
            see the layout note there for why. */}
        {!isKitabPhase && canQirat && user?.role !== 'committee' && (
          <TouchableOpacity onPress={onQirat} style={styles.cardQiratBtn}>
            <MaterialCommunityIcons name="book-edit-outline" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* 🛡️ FIX: the Kitab toggle + bonus-mark button used to sit at the end of the action
          row above, alongside 4 flex:1 status buttons. On a phone-width screen those 4
          buttons already fill the row, so the toggle and (especially) the bonus-mark
          button got squeezed to near-zero width or pushed past the visible edge — the
          ustaz could see the "Kitab" toggle (just barely) but the star-plus bonus-mark
          button was effectively invisible. Kitab-only controls now get their own row with
          real breathing room, so both are always visible during the afternoon session. */}
      {isKitabPhase && (user?.role === 'admin' || student.is_kitab_connected) && (
        <View style={styles.kitabRow}>
          <TouchableOpacity
            onPress={onKitabToggle}
            style={[styles.kitabToggle, { flex: 1 }, hasKitab && { backgroundColor: '#10b981' }]}
          >
            <MaterialCommunityIcons
              name={hasKitab ? "book-check" : "book-outline"}
              size={20}
              color={hasKitab ? "white" : "#64748b"}
            />
            <Text style={[styles.kitabToggleTxt, hasKitab && { color: 'white' }]}>
              {lang === 'am' ? 'ኪታብ አምጥቷል' : 'Brought Kitab'}
            </Text>
          </TouchableOpacity>

          {/* 🛡️ Same role/committee gate as the non-Kitab qirat button — committee stays
              view-only, and this is the actual bonus-mark + note entry point. */}
          {canQirat && user?.role !== 'committee' && (
            <TouchableOpacity onPress={onQirat} style={[styles.kitabBonusBtn, progress && { backgroundColor: COLORS.primary + '15' }]}>
              <MaterialCommunityIcons name="star-plus-outline" size={20} color={COLORS.primary} />
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
