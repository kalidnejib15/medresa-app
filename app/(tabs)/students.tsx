import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Animated, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Searchbar, FAB, Avatar, ActivityIndicator, Text, Surface, Chip, IconButton, Modal, TextInput, Button, Divider, Portal } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStudentStore } from '../../src/store/useStudentStore';
import { useLevelStore } from '../../src/store/useLevelStore';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useGradeStore } from '../../src/store/useGradeStore';
import { COLORS } from '../../src/constants';
import { getLocalDateString } from '../../src/lib/dateUtils';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

function getGradeColor(score: number) {
  if (score >= 90) return '#059669';
  if (score >= 80) return '#10b981';
  if (score >= 70) return COLORS.primary;
  if (score >= 60) return '#d97706';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

// 🚀 Extracted to prevent catastrophic JS thread rebinding on every keystroke
const StudentCardMemo = React.memo(({ item, onGrade, onNavigate, isAdmin, role, activeTab, lang, t }: any) => {
  return (
    <Surface style={styles.card} elevation={1}>
      <TouchableOpacity
        activeOpacity={0.7}
        style={styles.cardInner}
        onPress={() => onNavigate(item)}
      >
        <View style={styles.cardLeft}>
          {/* 🛡️ Photo is only ever shown to admins; every other role sees initials only */}
          {isAdmin && item.photo_url ? (
            <Avatar.Image size={48} source={{ uri: item.photo_url }} style={{ backgroundColor: '#e2e8f0' }} />
          ) : (
            <Avatar.Text
              size={48}
              label={item.name_am.substring(0, 1)}
              style={{ backgroundColor: item.gender === 'male' ? '#eaf5ee' : '#fef2f2' }}
              color={item.gender === 'male' ? COLORS.primary : '#b91c1c'}
              labelStyle={{ fontWeight: '800' }}
            />
          )}
          <View style={styles.infoCol}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.nameTxt}>{lang === 'am' ? item.name_am : item.name_en}</Text>
              {(isAdmin || (role !== 'finance' && activeTab === 'kitab')) && (
                <View style={[styles.gpaBadge, { backgroundColor: getGradeColor(isAdmin ? item.gpa : item.subject_avg || 0) + '15', borderColor: getGradeColor(isAdmin ? item.gpa : item.subject_avg || 0) + '40' }]}>
                  <Text style={[styles.gpaTxt, { color: getGradeColor(isAdmin ? item.gpa : item.subject_avg || 0) }]}>{isAdmin ? item.gpa || 0 : item.subject_avg || 0}%</Text>
                </View>
              )}
            </View>
            <View style={styles.roleRow}>
              <Text selectable={true} style={styles.fatherTxt}>{lang === 'am' ? 'የአባት ስም: ' : 'Father: '}{item.parent_name || 'N/A'}</Text>
            </View>
            <View style={styles.roleRow}>
              <MaterialCommunityIcons
                name={item.gender === 'male' ? 'face-man-outline' : 'face-woman-outline'}
                size={14} color="#94a3b8"
              />
              <Text style={styles.roleTxt}>{item.gender === 'male' ? t('male') : t('female')}</Text>
              <View style={styles.dot} />
              <Text style={[styles.levelTxt, { marginRight: 8 }]}>{item.level_name || item.level_id.toUpperCase()}</Text>

              {/* FINANCE: Show Fee Status directly on card */}
              {(role === 'finance' || isAdmin) && (
                <View style={[
                  styles.feeSmallBadge,
                  {
                    backgroundColor: item.fee_status === 'paid' ? '#dcfce7'
                      : item.fee_status === 'exempted' ? '#fef3c7'
                        : (item.fee_status === 'unpaid' || item.fee_status === 'partial') ? '#fee2e2'
                          : '#f1f5f9'
                  }
                ]}>
                  <Text style={[
                    styles.feeSmallTxt,
                    {
                      color: item.fee_status === 'paid' ? '#16a34a'
                        : item.fee_status === 'exempted' ? '#d97706'
                          : (item.fee_status === 'unpaid' || item.fee_status === 'partial') ? '#ef4444'
                            : '#94a3b8'
                    }
                  ]}>
                    {item.fee_status === 'paid' ? (lang === 'am' ? 'ተከፍሏል' : 'PAID')
                      : item.fee_status === 'exempted' ? (lang === 'am' ? 'የተቋም ድጋፍ' : 'SPONSORED')
                        : (item.fee_status === 'partial' ? (lang === 'am' ? 'ከፊል' : 'PARTIAL') : (lang === 'am' ? 'ያልተከፈለ' : 'UNPAID'))}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {role === 'ustaz' && activeTab === 'kitab' && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                onGrade(item);
              }}
              style={styles.gradeIconBtn}
            >
              <MaterialCommunityIcons name="trophy" size={22} color="#fbbf24" />
            </TouchableOpacity>
          )}
          <IconButton icon="chevron-right" iconColor="#cbd5e1" size={20} />
        </View>
      </TouchableOpacity>
    </Surface>
  );
});

// 🚀 Extracted Quick Grade Modal to completely isolate TextInput state and eliminate lag/focus bugs
const QuickGradeModal = React.memo(({
  visible, onDismiss, selectedStudent, weights, scores, history, isSaving, onSubmitGrades, i18n, t, styles, COLORS
}: any) => {
  const scoresRef = useRef<Record<string, string>>({});
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);

  // Extract unique subjects from weights
  const uniqueSubjects = useMemo(() => {
    const map = new Map();
    weights.forEach((w: any) => {
      if (!map.has(w.subject_id)) {
        map.set(w.subject_id, { id: w.subject_id, name: w.subject_name, name_am: w.subject_name_am });
      }
    });
    return Array.from(map.values());
  }, [weights]);

  // 🛡️ INITIALIZATION LOCK: Reset and sync whenever a NEW student is chosen
  // The 'key' prop on the parent usage ensures this component remounts and resets.
  useEffect(() => {
    if (visible) {
      scoresRef.current = { ...(scores || {}) };
      if (uniqueSubjects.length > 0 && !activeSubjectId) {
        setActiveSubjectId(uniqueSubjects[0].id);
      }
    } else {
      setActiveSubjectId(null);
    }
  }, [visible, scores, uniqueSubjects]);

  const filteredWeights = useMemo(() => {
    return weights.filter((w: any) => w.subject_id === activeSubjectId);
  }, [weights, activeSubjectId]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={() => !isSaving && onDismiss()}
        contentContainerStyle={styles.gradeModal}
      >
        <View style={styles.modalHeader}>
          <MaterialCommunityIcons name="star-circle" size={32} color={COLORS.primary} />
          <View style={{ marginLeft: 15 }}>
            <Text style={styles.mTitle}>{selectedStudent?.name_am}</Text>
            <Text style={styles.mSub}>{i18n.language === 'am' ? 'ውጤት መዝግብ' : 'Record Academic Results'}</Text>
          </View>
        </View>

        {uniqueSubjects.length > 1 && (
          <View style={{ marginTop: 15 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {uniqueSubjects.map((sub) => (
                <TouchableOpacity
                  key={sub.id}
                  onPress={() => setActiveSubjectId(sub.id)}
                  style={[
                    { paddingHorizontal: 15, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
                    activeSubjectId === sub.id && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                  ]}
                >
                  <Text style={{ fontSize: 12, fontWeight: '800', color: activeSubjectId === sub.id ? 'white' : '#64748b' }}>
                    {i18n.language === 'am' ? sub.name_am : sub.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <Divider style={{ marginVertical: 20 }} />

        <ScrollView style={{ maxHeight: 350 }}>
          <View style={styles.sectionRowModal}>
            <MaterialCommunityIcons name="pencil-box-outline" size={16} color={COLORS.primary} />
            <Text style={styles.sectionTitleModal}>{i18n.language === 'am' ? 'ውጤት መመዝገቢያ' : 'RECORD RESULT'}</Text>
          </View>

          {filteredWeights.length > 0 ? Array.from(new Map(filteredWeights.map((w: any) => [w.id, w])).values())
            .sort((a: any, b: any) => (a.subject_name || '').localeCompare(b.subject_name || ''))
            .map((w: any) => {
              const subjectName = i18n.language === 'am' ? w.subject_name_am : w.subject_name;
              const cleanWeightName = w.name.includes(':') ? w.name.split(':')[1].trim() : w.name;
              const displaySubject = subjectName || (selectedStudent?.level_name ? `${selectedStudent.level_name} Level` : 'Medresa Subject');

              return (
                <View key={w.id} style={styles.gradeInputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.weightSubject}>{displaySubject}</Text>
                    <Text style={styles.weightName}>{cleanWeightName}</Text>
                    <Text style={styles.weightMax}>{i18n.language === 'am' ? 'ከ ' : 'Max: '}{w.weight}</Text>
                  </View>

                  <TextInput
                    key={`score_${w.id}_${selectedStudent?.id}`}
                    mode="outlined"
                    placeholder="0"
                    keyboardType="numeric"
                    style={styles.scoreInput}
                    defaultValue={scoresRef.current[w.id] || ''}
                    onChangeText={(v) => { scoresRef.current[w.id] = v; }}
                    outlineStyle={{ borderRadius: 12 }}
                    selectTextOnFocus
                  />
                </View>
              );
            }) : (
            <Text style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', paddingVertical: 20 }}>
              {i18n.language === 'am' ? 'ለዚህ ተማሪ የምዝገባ መረጃ አልተገኘም' : 'No academic weights found for your subject.'}
            </Text>
          )}

          {history.filter((h: any) => h.subject_id === activeSubjectId).length > 0 && (
            <View style={{ marginTop: 10 }}>
              <View style={styles.sectionRowModal}>
                <MaterialCommunityIcons name="history" size={16} color="#64748b" />
                <Text style={[styles.sectionTitleModal, { color: '#64748b' }]}>{i18n.language === 'am' ? 'የቅርብ ውጤቶች' : 'RECENT HISTORY'}</Text>
              </View>
              {history
                .filter((h: any) => h.subject_id === activeSubjectId)
                .slice(-5)
                .map((h: any, hi: number) => (
                <View key={hi} style={styles.historyRowModal}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyName}>{h.weight_name}</Text>
                    <Text style={styles.historyDate}>{new Date(h.date).toLocaleDateString()}</Text>
                  </View>
                  <Text style={[styles.historyScore, { color: getGradeColor((h.score / h.component_max) * 100) }]}>
                    {h.score}/{h.component_max}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={styles.modalActions}>
          <Button mode="outlined" onPress={() => onDismiss()} style={{ flex: 1, borderRadius: 12 }} disabled={isSaving}>
            {t('cancel')}
          </Button>
          <Button
            mode="contained"
            onPress={() => onSubmitGrades(scoresRef.current)}
            loading={isSaving}
            disabled={isSaving || weights.length === 0}
            style={{ flex: 2, borderRadius: 12, backgroundColor: COLORS.primaryDark }}
          >
            {i18n.language === 'am' ? 'መዝግብ' : 'Save Results'}
          </Button>
        </View>
      </Modal>
    </Portal>
  );
});

export default function StudentListScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';
  const isObserver = user?.role === 'finance' || user?.role === 'committee';
  const {
    students, fetchStudents, isLoading, searchStudents,
    assignedGroups, fetchAssignedGroups
  } = useStudentStore();
  const { levels, fetchLevels } = useLevelStore();
  const { subjects, weights, fetchWeights, addGrade, fetchSubjects } = useGradeStore();

  const handleExportCSV = async () => {
    try {
      if (students.length === 0) return;

      const { shareAsync } = await import('expo-sharing');
      const FileSystem = await import('expo-file-system');

      const header = "Name(Am),Name(En),Gender,Level,Fee Status\n";
      const rows = students.map(s =>
        `"${s.name_am}","${s.name_en}","${s.gender}","${s.level_name || s.level_id}","${s.fee_status || 'N/A'}"`
      ).join("\n");

      const csvContent = header + rows;
      const fileName = `Medresa_Students_${getLocalDateString()}.csv`;
      const fileUri = FileSystem.cacheDirectory + fileName;

      await FileSystem.writeAsStringAsync(fileUri, csvContent);
      await shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Institutional Roster' });
    } catch (e) {
      Alert.alert('Export Error', 'Could not generate CSV file.');
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'quran' | 'kitab'>('quran');
  const [sessionTypes, setSessionTypes] = useState<('quran' | 'kitab')[]>(['quran', 'kitab']);
  const [activeKitabGroup, setActiveKitabGroup] = useState<string | null>(null);
  const [selectedGender, setSelectedGender] = useState<'male' | 'female' | null>(null);
  const [kitabGroupList, setKitabGroupList] = useState<string[]>([]);

  // Grade Modal State
  const [gradeModalVisible, setGradeModalVisible] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const isFirstLoad = React.useRef(true);

  const { useFocusEffect } = require('expo-router');
  
  // 🛡️ RECOVERY LOCK: Sync local state from store ONCE on mount
  useEffect(() => {
    if (!user) return;
    const storeState = useStudentStore.getState();
    const filters = storeState.lastFilters || {};
    
    // Only set if they have a value in store (Persistence)
    if (filters.sessionType) setActiveTab(filters.sessionType);
    if (filters.levelIdOrName) setSelectedLevel(filters.levelIdOrName);
    if (filters.groupName) setActiveKitabGroup(filters.groupName);
    
    fetchLevels();
    fetchSubjects();
    if (user.role === 'ustaz') fetchAssignedGroups();
  }, [user]);

  // 📡 MAIN DATA SYNC: Triggers on tab focus or local filter changes
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      
      const sessionType = user.role === 'ustaz' ? activeTab : (activeTab || undefined);
      
      // If we pass 'undefined', the store uses its internal 'lastFilters' cache.
      // If we pass a value (including null), the store uses that value.
      // 🛡️ Logic: On first load, local state is 'null'. If we want persistence, 
      // we must NOT pass 'null' if we haven't checked the store yet.
      // But we handled the store check in the useEffect above.
      
      fetchStudents(
        selectedLevel || undefined, 
        sessionType, 
        activeKitabGroup || undefined
      );
    }, [user, selectedLevel, activeKitabGroup, activeTab])
  );


  const onSearch = async (query: string) => {
    setSearchQuery(query);
    const sessionType = user?.role === 'ustaz' ? activeTab : undefined;
    if (query.length > 0) {
      await searchStudents(query, sessionType, activeKitabGroup || undefined);
    } else {
      await fetchStudents(selectedLevel || undefined, sessionType, activeKitabGroup || undefined);
    }
  };

  const filteredLevels = useMemo(() => {
    const seen = new Set();
    return levels.filter(l => {
      const duplicate = seen.has(l.name);
      seen.add(l.name);
      return !duplicate;
    });
  }, [levels]);

  // Dynamic assignment-based groups
  const kitabGroups = assignedGroups;

  const filteredData = useMemo(() => {
    let list = [...students];
    if (selectedGender) {
      list = list.filter(s => s.gender === selectedGender);
    }
    return list;
  }, [students, selectedGender]);

  const handleLevelTagEffect = (levelName: string | null) => {
    setSelectedLevel(levelName);
    setActiveKitabGroup(null);
  };

  const handleGroupTagEffect = (group: string | null) => {
    setActiveKitabGroup(group);
    setSelectedLevel(null);
  };


  const [history, setHistory] = useState<any[]>([]);

  const handleOpenGrade = useCallback(async (student: any) => {
    setSelectedStudent(student);
    setScores({});
    setHistory([]);
    if (user?.id) {
      // 🛡️ DYNAMIC SUBJECT DISCOVERY: Refresh metadata and fetch precise weights
      await fetchSubjects();
      await fetchWeights(undefined, student.id, user.id);

      // 🛡️ Isolated History: Only fetch grades from THIS teacher (unless admin)
      const teacherIdForHistory = isAdmin ? undefined : user.id;
      const existingGrades = await useGradeStore.getState().getStudentGrades(student.id, teacherIdForHistory);
      setHistory(existingGrades);

      const preScores: Record<string, string> = {};
      existingGrades.forEach(g => {
        if (g.ustaz_id === user.id) {
          preScores[g.weight_id] = g.score.toString();
        }
      });
      setScores(preScores);
    }
    setGradeModalVisible(true);
  }, [user?.id, isAdmin, fetchSubjects, fetchWeights]);

  const handleNavigate = useCallback((s: any) => {
    router.push({ pathname: '/(admin)/students/[id]', params: { id: s.id } });
  }, [router]);

  const handleSubmitGrades = async (finalScores: Record<string, string>) => {
    if (!selectedStudent || !user) return;
    setIsSaving(true);
    try {
      for (const [weightId, score] of Object.entries(finalScores)) {
        const val = parseFloat(score);
        if (!isNaN(val)) {
          // 🛡️ Academic Ceiling Protection
          const weightObj = weights.find(w => w.id === weightId);
          if (weightObj && val > weightObj.weight) {
            Alert.alert(
              i18n.language === 'am' ? 'የውጤት ስህተት' : 'Grading Error',
              i18n.language === 'am'
                ? `${weightObj.name} ከ ${weightObj.weight} በላይ ሊሆን አይችልም።`
                : `${weightObj.name} cannot be greater than ${weightObj.weight}.`
            );
            setIsSaving(false);
            return;
          }

          await addGrade({
            student_id: selectedStudent.id,
            weight_id: weightId,
            score: val,
            date: new Date().toISOString(),
            ustaz_id: user.id
          });
        }
      }
      setGradeModalVisible(false);
      Alert.alert(t('success'), i18n.language === 'am' ? 'ውጤቱ ተመዝግቧል' : 'Academic records updated successfully.');
      fetchStudents();
    } catch (e) {
      Alert.alert(t('error'), 'Failed to save grades');
    } finally {
      setIsSaving(false);
    }
  };

  const renderStudent = useCallback(({ item }: { item: any }) => (
    <StudentCardMemo
      item={item}
      isAdmin={isAdmin}
      role={user?.role}
      activeTab={activeTab}
      lang={i18n.language}
      t={t}
      onGrade={handleOpenGrade}
      onNavigate={handleNavigate}
    />
  ), [isAdmin, user?.role, activeTab, i18n.language, t, handleOpenGrade, handleNavigate]);


  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >

      {/* ── HEADER & SEARCH ── */}
      <Surface style={styles.header} elevation={4}>
        <View style={styles.headerTitleRow}>
          <IconButton
            icon="arrow-left"
            iconColor="white"
            size={24}
            onPress={() => router.replace('/(tabs)/dashboard')}
            style={{ marginLeft: -8 }}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('students')}</Text>
            <Text style={styles.subTitle}>
               {filteredData.length} {i18n.language === 'am' ? 'ተማሪዎች ተገኝተዋል' : 'Students found'}
            </Text>
          </View>
          {user?.role === 'admin' && (
            <IconButton 
              icon="file-import-outline" 
              iconColor="white" 
              size={24} 
              onPress={() => router.push('/(admin)/students/bulk-import')} 
              style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
            />
          )}
          {user?.role === 'admin' && (
             <IconButton
               icon="file-download-outline"
               iconColor="white"
               size={22}
               onPress={handleExportCSV}
               style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
             />
          )}
        </View>

        <View style={styles.searchWrap}>
          <Searchbar
            placeholder={t('search')}
            onChangeText={onSearch}
            value={searchQuery}
            style={styles.searchBar}
            inputStyle={{ fontSize: 14, minHeight: 45, paddingTop: 0, paddingBottom: 0 }}
            iconColor={COLORS.primary}
            elevation={0}
          />
        </View>

        {(!isAdmin && user?.role !== 'finance') && (
          <View style={{ paddingHorizontal: 15, paddingBottom: 10 }}>
            <View style={styles.tabToggleRow}>
              <TouchableOpacity
                onPress={() => setActiveTab('quran')}
                style={[styles.miniTab, activeTab === 'quran' && styles.miniTabActive]}
              >
                <MaterialCommunityIcons name="book-open-variant" size={14} color={activeTab === 'quran' ? COLORS.primaryDark : 'rgba(255,255,255,0.7)'} />
                <Text style={[styles.miniTabTxt, activeTab === 'quran' && styles.miniTabTxtActive]}>
                  {i18n.language === 'am' ? 'ቁርአን' : 'Quran'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveTab('kitab')}
                style={[styles.miniTab, activeTab === 'kitab' && styles.miniTabActive]}
              >
                <MaterialCommunityIcons name="book-alphabet" size={14} color={activeTab === 'kitab' ? COLORS.primaryDark : 'rgba(255,255,255,0.7)'} />
                <Text style={[styles.miniTabTxt, activeTab === 'kitab' && styles.miniTabTxtActive]}>
                  {i18n.language === 'am' ? 'ኪታብ' : 'Kitab'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── REFINED FILTER SYSTEM ── */}
        <View style={styles.filterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15 }}>
            <Chip
              selected={!selectedLevel && !activeKitabGroup && !selectedGender}
              onPress={() => {
                setSelectedLevel(null);
                setActiveKitabGroup(null);
                setSelectedGender(null);
                fetchStudents('', undefined, ''); // 🛡️ Force explicit clear of level/group filters
              }}
              style={[styles.chip, !selectedLevel && !activeKitabGroup && !selectedGender && styles.chipActive]}
              textStyle={[styles.chipTxt, !selectedLevel && !activeKitabGroup && !selectedGender && styles.chipTxtActive]}
              mode="outlined"
            >
              {i18n.language === 'am' ? 'ሁሉንም' : 'All'}
            </Chip>

            {(isAdmin || user?.role === 'finance') && (
              <>
                <Chip
                  selected={selectedGender === 'male'}
                  onPress={() => setSelectedGender(selectedGender === 'male' ? null : 'male')}
                  style={[styles.chip, selectedGender === 'male' && styles.genderChipM]}
                  textStyle={[styles.chipTxt, selectedGender === 'male' && { color: 'white' }]}
                  mode="outlined"
                  icon={() => <MaterialCommunityIcons name="face-man" size={16} color={selectedGender === 'male' ? 'white' : '#64748b'} />}
                >
                  {i18n.language === 'am' ? 'ወንዶች' : 'Males'}
                </Chip>
                <Chip
                  selected={selectedGender === 'female'}
                  onPress={() => setSelectedGender(selectedGender === 'female' ? null : 'female')}
                  style={[styles.chip, selectedGender === 'female' && styles.genderChipF]}
                  textStyle={[styles.chipTxt, selectedGender === 'female' && { color: 'white' }]}
                  mode="outlined"
                  icon={() => <MaterialCommunityIcons name="face-woman" size={16} color={selectedGender === 'female' ? 'white' : '#64748b'} />}
                >
                  {i18n.language === 'am' ? 'ሴቶች' : 'Females'}
                </Chip>
              </>
            )}

            {user?.role === 'ustaz' && kitabGroups.map((group) => (
              <Chip
                key={group}
                selected={activeKitabGroup === group}
                onPress={() => handleGroupTagEffect(group)}
                style={[styles.chip, activeKitabGroup === group && styles.chipActive]}
                textStyle={[styles.chipTxt, activeKitabGroup === group && styles.chipTxtActive]}
                mode="outlined"
              >
                {i18n.language === 'am' ? (
                  group.includes('Nuraniya') ? 'ኑራኒያ' :
                    group.includes('Quran 1') ? 'ቁርአን 1' : 'ሂፍዝ'
                ) : group.replace('Team ', '')}
              </Chip>
            ))}

            {(isAdmin || user?.role === 'finance') && filteredLevels.map((lvl) => (
              <Chip
                key={lvl.name}
                selected={selectedLevel === lvl.name}
                onPress={() => handleLevelTagEffect(lvl.name)}
                style={[styles.chip, selectedLevel === lvl.name && styles.chipActive]}
                textStyle={[styles.chipTxt, selectedLevel === lvl.name && styles.chipTxtActive]}
                mode="outlined"
              >
                {i18n.language === 'am' ? lvl.name_am : lvl.name}
              </Chip>
            ))}
          </ScrollView>
        </View>
      </Surface>

      {isLoading && filteredData.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      ) : (
        <FlatList
          data={filteredData}
          keyExtractor={(item) => item.id}
          renderItem={renderStudent}
          refreshing={isLoading}
          onRefresh={() => {
            const sessionType = user?.role === 'ustaz' ? activeTab : undefined;
            fetchStudents(selectedLevel || undefined, sessionType, activeKitabGroup || undefined);
          }}
          contentContainerStyle={[styles.list, { paddingBottom: 80 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-search-outline" size={60} color="#e2e8f0" />
              <Text style={styles.emptyTxt}>{t('noData')}</Text>
            </View>
          }
        />
      )}

      {/* ── QUICK GRADE MODAL ── */}
      <QuickGradeModal
        key={selectedStudent?.id || 'none'}
        visible={gradeModalVisible}
        onDismiss={() => setGradeModalVisible(false)}
        selectedStudent={selectedStudent}
        weights={weights}
        scores={scores}
        history={history}
        isSaving={isSaving}
        onSubmitGrades={handleSubmitGrades}
        i18n={i18n}
        t={t}
        styles={styles}
        COLORS={COLORS}
      />

      {user?.role === 'admin' && (
        <FAB
          icon="account-plus"
          label={t('addStudent')}
          style={[styles.fab, { bottom: 16 + insets.bottom }]}
          color="white"
          onPress={() => router.push('/(admin)/students/add')}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },

  header: {
    backgroundColor: COLORS.primaryDark,
    paddingTop: 45,
    paddingBottom: 10,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10
  },
  searchWrap: {
    paddingHorizontal: 20,
    marginBottom: 10
  },
  title: { color: 'white', fontSize: 22, fontWeight: '900' },
  subTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  searchBar: { borderRadius: 14, backgroundColor: 'white', height: 46 },

  filterRow: { marginTop: 18, marginBottom: 10, paddingVertical: 5 },
  chip: { marginRight: 10, backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'transparent', borderRadius: 24, paddingHorizontal: 4 },
  chipActive: { backgroundColor: 'white', elevation: 2 },
  chipTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  chipTxtActive: { color: COLORS.primaryDark, fontWeight: '800' },
  vDivider: { width: 1, height: 20, backgroundColor: '#e2e8f0', marginHorizontal: 12, alignSelf: 'center' },

  sessionTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 4,
  },
  sessionTabActive: { backgroundColor: 'white' },
  sessionTabTxt: { color: 'rgba(255,255,255,0.6)', fontWeight: '800', fontSize: 13 },
  sessionTabTxtActive: { color: COLORS.primaryDark },

  // Team Tab Bar Styles
  teamTabContainer: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  teamTabKitabExtra: { backgroundColor: '#f8fafc' },
  teamTabBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, marginRight: 10 },
  teamTabBtnActive: { backgroundColor: 'white', elevation: 2 },
  teamTabBtnTxt: { fontSize: 13, fontWeight: '800', color: '#64748b' },
  teamTabBtnTxtActive: { color: COLORS.primaryDark, fontWeight: '900' },

  // Kitab Grading Group Styles
  groupTabWrapper: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  groupTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, marginRight: 10 },
  groupTabActive: { backgroundColor: 'white', elevation: 2 },
  groupTabTxt: { fontSize: 13, fontWeight: '800', color: '#64748b' },
  groupTabTxtActive: { color: COLORS.primaryDark, fontWeight: '900' },

  // Tab Switcher Styles
  tabToggleRow: { flexDirection: 'row', backgroundColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 20, padding: 4, gap: 4, alignSelf: 'flex-start' },
  miniTab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, gap: 6 },
  miniTabActive: { backgroundColor: 'white', elevation: 2 },
  miniTabTxt: { fontSize: 13, fontWeight: '700', color: 'rgba(255, 255, 255, 0.7)' },
  miniTabTxtActive: { color: COLORS.primaryDark, fontWeight: '800' },

  levelRow: { marginTop: 5 },
  list: { padding: 12, paddingBottom: 100 },
  card: { backgroundColor: 'white', borderRadius: 20, marginBottom: 10, overflow: 'hidden' },
  cardInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  infoCol: { marginLeft: 12, flex: 1 },
  nameTxt: { fontSize: 16, fontWeight: '800', color: '#1e293b', flex: 1 },
  gpaBadge: { backgroundColor: COLORS.primary + '15', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary + '30' },
  gpaTxt: { fontSize: 13, fontWeight: '900', color: COLORS.primary },
  fatherTxt: { fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' },
  roleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  roleTxt: { fontSize: 11, color: '#64748b', fontWeight: '700', marginLeft: 4 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#cbd5e1', marginHorizontal: 8 },
  levelTxt: { fontSize: 11, color: COLORS.primary, fontWeight: '800', textTransform: 'uppercase' },

  empty: { paddingTop: 100, alignItems: 'center' },
  emptyTxt: { color: '#94a3b8', fontWeight: '800', marginTop: 15 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fab: { position: 'absolute', margin: 16, right: 0, bottom: 10, backgroundColor: COLORS.primaryDark, borderRadius: 16 },

  // Quick Grade Modal Styles
  gradeIconBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.primary + '10', alignItems: 'center', justifyContent: 'center' },
  gradeModal: { backgroundColor: 'white', padding: 25, margin: 20, borderRadius: 32 },
  modalHeader: { flexDirection: 'row', alignItems: 'center' },
  mTitle: { fontSize: 18, fontWeight: '900', color: '#1e293b' },
  mSub: { fontSize: 11, fontWeight: '800', color: COLORS.primary, textTransform: 'uppercase', marginTop: 2 },
  gradeInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 16, marginBottom: 12 },
  weightSubject: { fontSize: 9, fontWeight: '900', color: COLORS.primary, textTransform: 'uppercase' },
  weightName: { fontSize: 13, fontWeight: '800', color: '#334155', marginTop: 2 },
  weightMax: { fontSize: 10, fontWeight: '700', color: '#94a3b8', marginTop: 2 },
  scoreInput: { width: 70, height: 45, backgroundColor: 'white', textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 25 },

  // 🛡️ Added Professional Modal Styles
  sectionRowModal: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, marginTop: 15 },
  sectionTitleModal: { fontSize: 10, fontWeight: '900', color: COLORS.primary, letterSpacing: 1.5, textTransform: 'uppercase' },
  historyRowModal: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', padding: 12, borderRadius: 12, marginBottom: 8 },
  historyName: { fontSize: 13, fontWeight: '800', color: '#334155' },
  historyDate: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  historyScore: { fontSize: 15, fontWeight: '900' },

  // Finance Specific Styles
  feeSmallBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  feeSmallTxt: { fontSize: 9, fontWeight: '900' },
  genderChipM: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  genderChipF: { backgroundColor: '#ec4899', borderColor: '#ec4899' }
});
