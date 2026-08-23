import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { Text, Surface, IconButton, ActivityIndicator, Avatar } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getDatabase } from '../../src/lib/database';
import { getLocalDateString } from '../../src/lib/dateUtils';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useNuraniyahStore, NuraniyahRating } from '../../src/store/useNuraniyahStore';
import { COLORS } from '../../src/constants';

// Nuraniyah levels only — same ids used across the app (attendance.tsx isNuraniyahStudent,
// useStudentStore, useGradeStore, usePDFStore) to identify Qirat/Azkar/Behaviour students.
const NURANIYAH_LEVELS: { id: string; label_am: string; label_en: string }[] = [
  { id: 'l1m', label_am: 'ኑራንያ - ወንድ', label_en: 'Nuraniyah - Male' },
  { id: 'l1f', label_am: 'ኑራንያ - ሴት', label_en: 'Nuraniyah - Female' },
];

// Cycling order for quick tap-to-rate. Long-press a rated cell to clear it entirely
// (calls deleteAssessment) instead of just cycling forward.
const RATING_CYCLE: NuraniyahRating[] = ['excellent', 'good', 'needs_work'];

export default function NuraniyahDailyScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { categories, ratingConfig, getDailyClassAssessments, saveAssessment, deleteAssessment } = useNuraniyahStore();

  const [selectedLevelId, setSelectedLevelId] = useState<string>(NURANIYAH_LEVELS[0].id);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [roster, setRoster] = useState<any[]>([]);
  const [ratingsMap, setRatingsMap] = useState<Record<string, Record<string, NuraniyahRating>>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const dateStr = useMemo(() => getLocalDateString(selectedDate), [selectedDate]);
  const isUstaz = user?.role === 'ustaz';

  const loadData = useCallback(async () => {
    try {
      const db = await getDatabase();

      // 🛡️ ROSTER: mirrors the ownership pattern used elsewhere (attendance.tsx validLevelIds,
      // useStudentStore adminWhere) — admins see the whole level, an ustaz only sees the
      // students actually linked to them via teacher_student_links.
      let students: any[];
      if (user?.role === 'admin') {
        students = await db.getAllAsync<any>(
          'SELECT id, name_am, name_en, level_id FROM students WHERE level_id = ? AND is_active = 1 ORDER BY name_en ASC',
          [selectedLevelId]
        );
      } else if (user?.role === 'ustaz') {
        students = await db.getAllAsync<any>(
          `SELECT s.id, s.name_am, s.name_en, s.level_id
           FROM students s
           JOIN teacher_student_links tsl ON s.id = tsl.student_id
           WHERE s.level_id = ? AND s.is_active = 1 AND tsl.teacher_id = ?
           ORDER BY s.name_en ASC`,
          [selectedLevelId, user.id]
        );
      } else {
        students = [];
      }
      setRoster(students || []);

      const rows = await getDailyClassAssessments(dateStr, selectedLevelId);
      const map: Record<string, Record<string, NuraniyahRating>> = {};
      (rows || []).forEach((r: any) => {
        if (!map[r.student_id]) map[r.student_id] = {};
        map[r.student_id][r.category] = r.rating;
      });
      setRatingsMap(map);
    } catch (e) {
      console.error('Nuraniyah Daily Load Error:', e);
      Alert.alert(
        i18n.language === 'am' ? 'ስህተት' : 'Error',
        i18n.language === 'am' ? 'ውሂብ መጫን አልተቻለም' : 'Failed to load ratings.'
      );
    }
  }, [selectedLevelId, dateStr, user]);

  useEffect(() => {
    setIsLoading(true);
    loadData().finally(() => setIsLoading(false));
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCellTap = async (studentId: string, category: string) => {
    if (!user) return;
    const current = ratingsMap[studentId]?.[category];
    const nextIdx = current ? (RATING_CYCLE.indexOf(current) + 1) % RATING_CYCLE.length : 0;
    const nextRating = RATING_CYCLE[nextIdx];
    const cellKey = `${studentId}:${category}`;

    setSavingCell(cellKey);
    try {
      await saveAssessment(studentId, dateStr, category, nextRating, user.id);
      setRatingsMap(prev => ({
        ...prev,
        [studentId]: { ...prev[studentId], [category]: nextRating },
      }));
    } catch (e: any) {
      Alert.alert(
        i18n.language === 'am' ? 'ስህተት' : 'Error',
        e?.message || (i18n.language === 'am' ? 'ደረጃ መመዝገብ አልተቻለም' : 'Failed to save rating.')
      );
    } finally {
      setSavingCell(null);
    }
  };

  const handleCellClear = (studentId: string, category: string, studentLabel: string) => {
    if (!user || !ratingsMap[studentId]?.[category]) return;
    const cellKey = `${studentId}:${category}`;

    Alert.alert(
      i18n.language === 'am' ? 'ደረጃ ይሰረዝ?' : 'Clear rating?',
      i18n.language === 'am'
        ? `የ${studentLabel} ${category} ደረጃ ለ${dateStr} ይሰረዛል።`
        : `This will remove the ${category} rating for ${studentLabel} on ${dateStr}.`,
      [
        { text: i18n.language === 'am' ? 'ይቅር' : 'Cancel', style: 'cancel' },
        {
          text: i18n.language === 'am' ? 'ሰርዝ' : 'Clear',
          style: 'destructive',
          onPress: async () => {
            setSavingCell(cellKey);
            try {
              await deleteAssessment(studentId, dateStr, category, user.id);
              setRatingsMap(prev => {
                const next = { ...prev, [studentId]: { ...prev[studentId] } };
                delete next[studentId][category];
                return next;
              });
            } catch (e: any) {
              Alert.alert(
                i18n.language === 'am' ? 'ስህተት' : 'Error',
                e?.message || (i18n.language === 'am' ? 'ደረጃ መሰረዝ አልተቻለም' : 'Failed to clear rating.')
              );
            } finally {
              setSavingCell(null);
            }
          },
        },
      ]
    );
  };

  const changeDay = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
  };

  const stats = useMemo(() => {
    const counts: Record<string, number> = { excellent: 0, good: 0, needs_work: 0, unmarked: 0 };
    roster.forEach(s => {
      categories.forEach(cat => {
        const r = ratingsMap[s.id]?.[cat];
        if (r) counts[r] = (counts[r] || 0) + 1;
        else counts.unmarked += 1;
      });
    });
    return counts;
  }, [roster, ratingsMap, categories]);

  const isToday = dateStr === getLocalDateString(new Date());

  return (
    <View style={styles.container}>
      <Surface style={[styles.header, { paddingTop: insets.top + 10 }]} elevation={4}>
        <View style={styles.headerTop}>
          <IconButton icon="arrow-left" iconColor="white" onPress={() => router.back()} />
          <Text style={styles.title}>
            {i18n.language === 'am' ? 'የኑራንያ ዕለታዊ ደረጃዎች' : 'Nuraniyah Daily Ratings'}
          </Text>
        </View>

        {/* Level toggle — ustaz only ever manages one gendered group in practice, but both
            chips are shown; the roster query above naturally returns empty for a level
            they have no linked students in. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.levelScroll}>
          {NURANIYAH_LEVELS.map(l => (
            <TouchableOpacity
              key={l.id}
              style={[styles.levelChip, selectedLevelId === l.id && styles.levelChipActive]}
              onPress={() => setSelectedLevelId(l.id)}
            >
              <Text style={[styles.levelChipTxt, selectedLevelId === l.id && styles.levelChipTxtActive]}>
                {i18n.language === 'am' ? l.label_am : l.label_en}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.dateRow}>
          <IconButton icon="chevron-left" iconColor="white" size={22} onPress={() => changeDay(-1)} />
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
            <MaterialCommunityIcons name="calendar" size={16} color="white" />
            <Text style={styles.dateTxt}>
              {selectedDate.toLocaleDateString(i18n.language === 'am' ? 'am-ET' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </Text>
            {isToday && <Text style={styles.todayBadge}>{i18n.language === 'am' ? 'ዛሬ' : 'Today'}</Text>}
          </TouchableOpacity>
          <IconButton icon="chevron-right" iconColor="white" size={22} onPress={() => changeDay(1)} disabled={isToday} />
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display="default"
            maximumDate={new Date()}
            onChange={(_, d) => {
              setShowDatePicker(false);
              if (d) setSelectedDate(d);
            }}
          />
        )}
      </Surface>

      {/* Quick summary strip */}
      <View style={styles.statsRow}>
        {(['excellent', 'good', 'needs_work'] as NuraniyahRating[]).map(r => (
          <View key={r} style={styles.statPill}>
            <Text style={{ fontSize: 14 }}>{ratingConfig[r].emoji}</Text>
            <Text style={[styles.statTxt, { color: ratingConfig[r].color }]}>{stats[r]}</Text>
          </View>
        ))}
        <View style={styles.statPill}>
          <MaterialCommunityIcons name="help-circle-outline" size={14} color="#94a3b8" />
          <Text style={[styles.statTxt, { color: '#94a3b8' }]}>{stats.unmarked}</Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 50 }} color={COLORS.primary} />
      ) : roster.length === 0 ? (
        <View style={styles.placeholder}>
          <MaterialCommunityIcons name="account-search-outline" size={60} color="#cbd5e1" />
          <Text style={styles.placeholderTxt}>
            {isUstaz
              ? (i18n.language === 'am' ? 'ለዚህ ደረጃ የተመደቡ ተማሪዎች የሉዎትም' : 'You have no students assigned in this level')
              : (i18n.language === 'am' ? 'በዚህ ደረጃ ንቁ ተማሪዎች የሉም' : 'No active students in this level')}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
        >
          {/* Column headers */}
          <View style={styles.gridHeaderRow}>
            <Text style={[styles.gridHeaderCell, { flex: 1.6, textAlign: 'left' }]}>
              {i18n.language === 'am' ? 'ተማሪ' : 'Student'}
            </Text>
            {categories.map((cat: string) => (
              <Text key={cat} style={[styles.gridHeaderCell, { flex: 1 }]}>{cat}</Text>
            ))}
          </View>

          {roster.map((student, idx) => (
            <View key={student.id} style={[styles.row, idx % 2 === 0 && styles.rowAlt]}>
              <View style={[styles.studentCell, { flex: 1.6 }]}>
                <Avatar.Text
                  size={30}
                  label={(i18n.language === 'am' ? student.name_am : student.name_en)?.charAt(0) || '?'}
                  style={{ backgroundColor: COLORS.primaryFaded }}
                  color={COLORS.primaryDark}
                  labelStyle={{ fontSize: 13, fontWeight: '900' }}
                />
                <Text style={styles.studentName} numberOfLines={1}>
                  {i18n.language === 'am' ? student.name_am : student.name_en}
                </Text>
              </View>

              {categories.map((cat: string) => {
                const rating = ratingsMap[student.id]?.[cat];
                const cfg = rating ? ratingConfig[rating] : null;
                const cellKey = `${student.id}:${cat}`;
                const isSaving = savingCell === cellKey;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={{ flex: 1, alignItems: 'center' }}
                    onPress={() => handleCellTap(student.id, cat)}
                    onLongPress={() => handleCellClear(student.id, cat, (i18n.language === 'am' ? student.name_am : student.name_en) || '')}
                    disabled={isSaving}
                  >
                    <View style={[styles.ratingCell, cfg && { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
                      {isSaving ? (
                        <ActivityIndicator size={12} color={COLORS.primary} />
                      ) : (
                        <Text style={{ fontSize: 16 }}>{cfg ? cfg.emoji : '—'}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <Text style={styles.footNote}>
            {i18n.language === 'am'
              ? 'ደረጃ ለመቀየር ይንኩ። ደረጃ ለማጥፋት ተጫነው ይያዙ።'
              : 'Tap a cell to cycle its rating. Long-press a rated cell to clear it.'}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  header: { backgroundColor: COLORS.primaryDark, paddingBottom: 15, borderBottomLeftRadius: 25, borderBottomRightRadius: 25 },
  headerTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  title: { color: 'white', fontSize: 18, fontWeight: '900', marginLeft: 5, flexShrink: 1 },
  levelScroll: { marginTop: 10, paddingHorizontal: 20 },
  levelChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', marginRight: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  levelChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  levelChipTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  levelChipTxtActive: { color: COLORS.primaryDark, fontWeight: '900' },

  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14 },
  dateTxt: { color: 'white', fontWeight: '800', fontSize: 13 },
  todayBadge: { color: COLORS.accentLight, fontSize: 10, fontWeight: '900', marginLeft: 4 },

  statsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'white', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, elevation: 1 },
  statTxt: { fontWeight: '900', fontSize: 13 },

  gridHeaderRow: { flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 8 },
  gridHeaderCell: { fontSize: 11, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'white' },
  rowAlt: { backgroundColor: '#f8fafc' },
  studentCell: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 },
  studentName: { fontSize: 12.5, fontWeight: '700', color: '#1e293b', flexShrink: 1 },

  ratingCell: { width: 40, height: 34, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },

  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', opacity: 0.8, paddingHorizontal: 40 },
  placeholderTxt: { color: '#94a3b8', marginTop: 12, fontSize: 14, fontWeight: '600', textAlign: 'center' },

  footNote: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 14, marginHorizontal: 30, lineHeight: 16 },
});
