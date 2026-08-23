import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput } from 'react-native';
import { Text, Surface, Button, Checkbox, Avatar, IconButton, Divider, ActivityIndicator, SegmentedButtons } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getDatabase, queueSync } from '../../../src/lib/database';
import { COLORS } from '../../../src/constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useStudentStore } from '../../../src/store/useStudentStore';
import { useLevelStore } from '../../../src/store/useLevelStore';
import { useGradeStore } from '../../../src/store/useGradeStore';
import { useAuthStore } from '../../../src/store/useAuthStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ReInventedBulkAssign() {
  const router = useRouter();
  const { i18n } = useTranslation();
  const insets = useSafeAreaInsets();

  const { students, fetchStudents, isLoading: studentsLoading } = useStudentStore();
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';
  const { levels, fetchLevels } = useLevelStore();
  const subjects = useGradeStore(s => s.subjects);

  // High-level mode
  const [mode, setMode] = useState('quran'); // 'quran' | 'kitab'

  // Filters
  const [selectedLevelName, setSelectedLevelName] = useState<string>('');
  const [selectedKitabTeam, setSelectedKitabTeam] = useState<'Team Nuraniya' | 'Team Quran 1' | 'Team Hifz' | null>(null);
  const [selectedUstazId, setSelectedUstazId] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');

  // Kitab Team Mapping
  const getTeamForLevel = (levelName: string) => {
    const n = levelName.toLowerCase();
    if (n.includes('nuraniya')) return 'Team Nuraniya';
    if (n.includes('quran 1')) return 'Team Quran 1';
    if (n.includes('quran 2') || n.includes('hifz')) return 'Team Hifz';
    return null;
  };

  const KITAB_TEAMS = ['Team Nuraniya', 'Team Quran 1', 'Team Hifz'];

  // Data
  const [allUstazs, setAllUstazs] = useState<any[]>([]);
  const [teacherExpertiseMap, setTeacherExpertiseMap] = useState<Record<string, string[]>>({});
  const [existingAssignmentMap, setExistingAssignmentMap] = useState<Record<string, string>>({}); // studentId -> teacherName

  // UI State
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchLevels();
    useGradeStore.getState().fetchSubjects();
    loadUstazData();
  }, []);

  const loadUstazData = async () => {
    const db = await getDatabase();
    const uRows = await db.getAllAsync('SELECT id, name, kitab_teams FROM users WHERE role = "ustaz" AND is_active = 1');
    setAllUstazs(uRows);

    const eRows = await db.getAllAsync<{ teacher_id: string, subject_id: string }>('SELECT teacher_id, subject_id FROM teacher_subjects');
    const map: Record<string, string[]> = {};
    eRows.forEach(r => {
      if (!map[r.teacher_id]) map[r.teacher_id] = [];
      map[r.teacher_id].push(r.subject_id);
    });
    setTeacherExpertiseMap(map);
  };

  // Fetch current assignments for badge display
  const loadExistingAssignments = async () => {
    if (!selectedLevelName && !selectedKitabTeam) return;
    const db = await getDatabase();
    let rows: any[] = [];

    if (mode === 'quran') {
      rows = await db.getAllAsync<{ id: string, name: string }>(
        'SELECT s.id, u.name FROM students s JOIN users u ON s.quran_teacher_id = u.id JOIN levels l ON s.level_id = l.id WHERE l.name = ?',
        [selectedLevelName]
      );
    } else if (selectedSubjectId) {
      // Kitab uses teams or levels
      const levelNames = selectedKitabTeam
        ? levels.filter(l => getTeamForLevel(l.name) === selectedKitabTeam).map(l => l.name)
        : [selectedLevelName];

      const placeholders = levelNames.map(() => '?').join(',');
      rows = await db.getAllAsync<{ id: string, name: string }>(
        `SELECT tsl.student_id as id, u.name FROM teacher_student_links tsl 
         JOIN users u ON tsl.teacher_id = u.id 
         JOIN students s ON tsl.student_id = s.id 
         JOIN levels l ON s.level_id = l.id 
         WHERE l.name IN (${placeholders}) AND tsl.subject_id = ? AND tsl.type = "kitab"`,
        [...levelNames, selectedSubjectId]
      );
    }

    const map: Record<string, string> = {};
    rows.forEach(r => map[r.id] = r.name);
    setExistingAssignmentMap(map);
  };

  useEffect(() => {
    loadExistingAssignments();
  }, [selectedLevelName, selectedKitabTeam, selectedSubjectId, mode]);

  useEffect(() => {
    if (mode === 'quran') {
      if (selectedLevelName) fetchStudents(selectedLevelName);
    } else {
      // KITAB TEAM FETCH
      if (selectedKitabTeam) {
        // We need a way to fetch multiple levels at once
        fetchStudentsByTeam(selectedKitabTeam);
      } else if (selectedLevelName) {
        fetchStudents(selectedLevelName);
      }
    }
    setSelectedStudentIds(new Set());
  }, [selectedLevelName, selectedKitabTeam, mode]);

  const fetchStudentsByTeam = async (team: string) => {
    const relevantLevels = levels.filter(l => getTeamForLevel(l.name) === team);
    // Fetch manually if store doesn't support teams yet
    const db = await getDatabase();
    const placeholders = relevantLevels.map(() => '?').join(',');
    const rows = await db.getAllAsync<any>(
      `SELECT s.*, l.name as level_name, l.name_am as level_name_am 
       FROM students s 
       JOIN levels l ON s.level_id = l.id 
       WHERE l.name IN (${placeholders}) AND s.is_active = 1`,
      relevantLevels.map(l => l.name)
    );
    useStudentStore.setState({ students: rows });
  };

  const uniqueLevels = useMemo(() => {
    const seen = new Set<string>();
    return levels.filter(l => {
      if (seen.has(l.name)) return false;
      seen.add(l.name);
      return true;
    }).sort((a, b) => a.id.localeCompare(b.id));
  }, [levels]);

  // Reset secondary filters when mode changes
  useEffect(() => {
    setSelectedUstazId('');
    setSelectedSubjectId('');
    setSelectedStudentIds(new Set());
  }, [mode]);

  // Compute which Ustazs can teach the selected subject AND are authorized for this team
  const validUstazs = useMemo(() => {
    if (mode === 'quran') return allUstazs;
    if (!selectedSubjectId || !selectedKitabTeam) return [];

    return allUstazs.filter(u => {
      // 1. Check Subject Expertise
      const hasSubjectExp = teacherExpertiseMap[u.id]?.includes(selectedSubjectId);

      // 2. Check Team Authorization
      let authorizedTeams: string[] = [];
      if (u.kitab_teams) {
        try {
          const parsed = JSON.parse(u.kitab_teams);
          authorizedTeams = Array.isArray(parsed) ? parsed : [u.kitab_teams];
        } catch {
          // Legacy/malformed value (e.g. a comma-separated string) — fall back to
          // splitting it instead of throwing and wiping out the whole teacher list.
          authorizedTeams = u.kitab_teams.split(',').map((t: string) => t.trim());
        }
      }
      const isTeamAuth = authorizedTeams.includes(selectedKitabTeam);

      return hasSubjectExp && isTeamAuth;
    });
  }, [mode, selectedSubjectId, selectedKitabTeam, allUstazs, teacherExpertiseMap]);

  const sortedAndFilteredStudents = useMemo(() => {
    const filtered = students.filter(s =>
      s.name_en.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.name_am.includes(searchQuery)
    );
    // SORT: Males First, then Females
    return [...filtered].sort((a, b) => {
      if (a.gender === 'male' && b.gender === 'female') return -1;
      if (a.gender === 'female' && b.gender === 'male') return 1;
      return (a.name_en || '').localeCompare(b.name_en || '');
    });
  }, [students, searchQuery]);

  const handleAssignNow = async () => {
    if (!selectedUstazId || selectedStudentIds.size === 0) {
      Alert.alert('Selection Required', 'Please select an Ustaz and students.');
      return;
    }
    if (mode === 'kitab' && !selectedSubjectId) {
      Alert.alert('Subject Required', 'Please select a Kitab (Subject).');
      return;
    }

    setIsSaving(true);
    const db = await getDatabase();
    try {
      await db.withTransactionAsync(async () => {
        for (const sId of selectedStudentIds) {
          if (mode === 'quran') {
            await db.runAsync('UPDATE students SET quran_teacher_id = ? WHERE id = ?', [selectedUstazId, sId]);
            await queueSync('students', sId, 'update');
          } else {
            // KITAB: 1 Student -> Many Subjects, Each with its own teacher.
            // PK is (teacherId, studentId, subjectId)
            // We ensure we replace any old teacher for THIS SPECIFIC STUDENT-SUBJECT pair.
            await db.runAsync(
              'DELETE FROM teacher_student_links WHERE student_id = ? AND subject_id = ?',
              [sId, selectedSubjectId]
            );
            await db.runAsync(
              'INSERT INTO teacher_student_links (teacher_id, student_id, subject_id, type) VALUES (?,?,?,?)',
              [selectedUstazId, sId, selectedSubjectId, 'kitab']
            );
            await queueSync('teacher_student_links', `${selectedUstazId},${sId},${selectedSubjectId}`, 'insert');
          }
        }
      });

      const { triggerBackgroundSync } = await import('../../../src/lib/sync');
      triggerBackgroundSync();

      Alert.alert('Success', `Successfully assigned ${selectedStudentIds.size} students to ${allUstazs.find(u => u.id === selectedUstazId)?.name}`);
      setSelectedStudentIds(new Set());
    } catch (e) {
      Alert.alert('Error', 'Assignment failed. Please verify teacher expertise.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Surface style={styles.topHeader} elevation={4}>
        <View style={styles.headerTitleRow}>
          <IconButton icon="arrow-left" iconColor="white" onPress={() => router.back()} />
          <Text style={styles.mainTitle}>ቡድን ምደባ (Budin Mideba)</Text>
        </View>

        <SegmentedButtons
          value={mode}
          onValueChange={setMode}
          buttons={[
            { value: 'quran', label: 'Quran (Morning)', icon: 'weather-sunny' },
            { value: 'kitab', label: 'Kitab (Afternoon)', icon: 'book-open-variant' },
          ]}
          style={styles.segBtn}
        />
      </Surface>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom }}>

        {/* STEP 1: CLASS SELECTION */}
        <SectionHeader title={mode === 'quran' ? "1. Select Classroom (Level)" : "1. Select Kitab Team (Group)"} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
          {mode === 'quran' ? (
            uniqueLevels.map(l => (
              <TouchableOpacity
                key={l.id}
                style={[styles.smallChip, selectedLevelName === l.name && styles.activeChip]}
                onPress={() => setSelectedLevelName(l.name)}
              >
                <Text style={[styles.chipText, selectedLevelName === l.name && styles.activeChipText]}>{i18n.language === 'am' ? l.name_am : l.name}</Text>
              </TouchableOpacity>
            ))
          ) : (
            KITAB_TEAMS.map(team => (
              <TouchableOpacity
                key={team}
                style={[styles.smallChip, selectedKitabTeam === team && styles.activeChipKitab]}
                onPress={() => {
                  setSelectedKitabTeam(team as any);
                  setSelectedLevelName('');
                }}
              >
                <Text style={[styles.chipText, selectedKitabTeam === team && styles.activeChipText]}>
                  {team === 'Team Nuraniya' ? 'Nuraniya Group' : team === 'Team Quran 1' ? 'Quran 1 Group' : 'Quran 2 + Hifz Group'}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <Divider style={styles.div} />

        {/* STEP 2: SUBJECT & TEACHER */}
        <SectionHeader title={mode === 'quran' ? "2. Select Quran Ustaz" : "2. Select Kitab & Expert Ustaz"} />

        {mode === 'kitab' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
            {subjects.filter(s => s.id !== 'quran').map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.smallChip, selectedSubjectId === s.id && styles.activeChipSubject]}
                onPress={() => {
                  setSelectedSubjectId(s.id);
                  setSelectedUstazId(''); // Reset teacher when subject changes
                }}
              >
                <Text style={[styles.chipText, selectedSubjectId === s.id && styles.activeChipText]}>{i18n.language === 'am' ? s.name_am : s.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={{ height: 10 }} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
          {validUstazs.length > 0 ? validUstazs.map(u => (
            <TouchableOpacity
              key={u.id}
              style={[styles.teacherChip, selectedUstazId === u.id && styles.activeChipTeacher]}
              onPress={() => setSelectedUstazId(u.id)}
            >
              <Avatar.Text size={20} label={u.name.substring(0, 1)} style={{ marginRight: 6, backgroundColor: 'white' }} color={COLORS.primary} />
              <Text style={[styles.chipText, selectedUstazId === u.id && styles.activeChipText]}>{u.name}</Text>
            </TouchableOpacity>
          )) : (
            <Text style={styles.emptyNote}>{mode === 'kitab' && !selectedSubjectId ? 'Select a Kitab FIRST' : 'No experts found for this Kitab'}</Text>
          )}
        </ScrollView>

        <Divider style={styles.div} />

        {/* STEP 3: STUDENT SELECTION */}
        <View style={styles.studentHeader}>
          <SectionHeader title="3. Select Students" />
          {isAdmin && sortedAndFilteredStudents.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                if (selectedStudentIds.size === sortedAndFilteredStudents.length) setSelectedStudentIds(new Set());
                else setSelectedStudentIds(new Set(sortedAndFilteredStudents.map(s => s.id)));
              }}
              style={styles.selectAllBtn}
            >
              <MaterialCommunityIcons
                name={selectedStudentIds.size === sortedAndFilteredStudents.length ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={16} color={COLORS.primary}
              />
              <Text style={styles.selectAllText}>Select All</Text>
            </TouchableOpacity>
          )}
        </View>

        <Surface style={styles.searchWrap} elevation={1}>
          <MaterialCommunityIcons name="magnify" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Search in this classroom..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={{ flex: 1, fontSize: 13 }}
          />
        </Surface>

        {studentsLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />
        ) : (
          sortedAndFilteredStudents.map(s => (
            <TouchableOpacity
              key={s.id}
              style={[styles.sCard, selectedStudentIds.has(s.id) && styles.sCardActive]}
              onPress={() => {
                const n = new Set(selectedStudentIds);
                if (n.has(s.id)) n.delete(s.id); else n.add(s.id);
                setSelectedStudentIds(n);
              }}
            >
              <Checkbox status={selectedStudentIds.has(s.id) ? 'checked' : 'unchecked'} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.sName}>{i18n.language === 'am' ? s.name_am : s.name_en}</Text>
                  {existingAssignmentMap[s.id] && (
                    <View style={[
                      styles.regBadge,
                      allUstazs.find(u => u.id === selectedUstazId)?.name === existingAssignmentMap[s.id] && styles.regBadgeMine
                    ]}>
                      <MaterialCommunityIcons
                        name={allUstazs.find(u => u.id === selectedUstazId)?.name === existingAssignmentMap[s.id] ? "account-star" : "check-decagram"}
                        size={10}
                        color={allUstazs.find(u => u.id === selectedUstazId)?.name === existingAssignmentMap[s.id] ? "#2563eb" : "#059669"}
                      />
                      <Text style={[
                        styles.regBadgeTxt,
                        allUstazs.find(u => u.id === selectedUstazId)?.name === existingAssignmentMap[s.id] && styles.regBadgeTxtMine
                      ]}>
                        {allUstazs.find(u => u.id === selectedUstazId)?.name === existingAssignmentMap[s.id] ? 'My Student' : existingAssignmentMap[s.id]}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.sMeta}>{s.gender.toUpperCase()} • {s.level_name}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {isAdmin && (
        <Surface style={[styles.actionFooter, { paddingBottom: 20 + insets.bottom }]} elevation={4}>
          <View style={{ flex: 1 }}>
            <Text style={styles.footerCount}>{selectedStudentIds.size} Selected</Text>
            <Text style={styles.footerMeta}>Assigning to {allUstazs.find(u => u.id === selectedUstazId)?.name || '...'}</Text>
          </View>
          <Button
            mode="contained"
            onPress={handleAssignNow}
            loading={isSaving}
            disabled={selectedStudentIds.size === 0 || !selectedUstazId}
            style={styles.finalBtn}
          >
            {i18n.language === 'am' ? 'ምደባ አረጋግጥ' : 'CONFIRM ASSIGN'}
          </Button>
        </Surface>
      )}
    </View>
  );
}

function SectionHeader({ title }: any) {
  return <Text style={styles.sectLabel}>{title}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  topHeader: { backgroundColor: COLORS.primaryDark, paddingTop: 50, paddingBottom: 20, paddingHorizontal: 16, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  mainTitle: { color: 'white', fontSize: 18, fontWeight: '900' },
  segBtn: { backgroundColor: 'white', borderRadius: 12 },

  sectLabel: { fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  scrollRow: { marginBottom: 12 },
  smallChip: { backgroundColor: 'white', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  activeChip: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  activeChipKitab: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  activeChipSubject: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
  activeChipTeacher: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  chipText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  activeChipText: { color: 'white' },

  teacherChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  emptyNote: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', paddingVertical: 5 },
  div: { marginVertical: 15, height: 1, backgroundColor: '#e2e8f0' },

  studentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  selectAllText: { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 10, height: 38, marginBottom: 12 },

  sCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', padding: 8, borderRadius: 12, marginBottom: 6, borderWidth: 1, borderColor: 'transparent' },
  sCardActive: { borderColor: COLORS.primary + '33', backgroundColor: COLORS.primary + '08' },
  sName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  sMeta: { fontSize: 9, fontWeight: '800', color: '#94a3b8', marginTop: 1 },

  regBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ecfdf5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#10b98133', gap: 3 },
  regBadgeMine: { backgroundColor: '#eff6ff', borderColor: '#3b82f633' },
  regBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#059669', textTransform: 'uppercase' },
  regBadgeTxtMine: { color: '#2563eb' },

  actionFooter: { backgroundColor: 'white', padding: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30, flexDirection: 'row', alignItems: 'center' },
  footerCount: { fontSize: 16, fontWeight: '900', color: '#1e293b' },
  footerMeta: { fontSize: 11, color: '#64748b' },
  finalBtn: { borderRadius: 12, height: 48, justifyContent: 'center' }
});