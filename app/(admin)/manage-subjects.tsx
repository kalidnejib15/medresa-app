import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  Text, Surface, Button, IconButton, TextInput,
  Portal, Modal, ActivityIndicator, Divider, Chip,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useGradeStore } from '../../src/store/useGradeStore';
import { getDatabase, queueSync } from '../../src/lib/database';
import { COLORS } from '../../src/constants';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useStudentStore } from '../../src/store/useStudentStore';
import { useAuthStore } from '../../src/store/useAuthStore';

// ── Types ────────────────────────────────────────────────────────────────────
type Subject = { id: string; name: string; name_am: string; level_id?: string; is_active: number };
type Weight = { id: string; subject_id: string; name: string; weight: number };

const STANDARD_COMPONENTS = [
  { n: 'Quiz', w: 10 },
  { n: 'Assignment', w: 10 },
  { n: 'Participation', w: 15 },
  { n: 'Mid Exam', w: 25 },
  { n: 'Final Exam', w: 40 }
];

const DEFAULT_KITABS = [
  { en: 'Fiqh (L1)', am: 'ፊቅህ (ደረጃ 1)', level_id: 'l1m', components: STANDARD_COMPONENTS },
  { en: 'Aqeedah (L1)', am: 'አቂዳ (ደረጃ 1)', level_id: 'l1m', components: STANDARD_COMPONENTS },
  { en: 'Hadith (L2)', am: 'ሐዲስ (ደረጃ 2)', level_id: 'l2m', components: STANDARD_COMPONENTS },
  { en: 'Seerah (L2)', am: 'ሲራ (ደረጃ 2)', level_id: 'l2m', components: STANDARD_COMPONENTS },
];

const SubjectEditorModal = React.memo(({ visible, onDismiss, onSave, onDelete, initialData, levels, isSaving, lang }: any) => {
  const nameEnRef = useRef<string>('');
  const nameAmRef = useRef<string>('');
  const [subjLevel, setSubjLevel] = useState('');

  useEffect(() => {
    if (visible && initialData) {
      nameEnRef.current = initialData.name || '';
      nameAmRef.current = initialData.name_am || '';
      setSubjLevel(initialData.level_id || '');
    } else if (visible) {
      nameEnRef.current = ''; nameAmRef.current = ''; setSubjLevel('');
    }
  }, [visible, initialData]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <Text style={styles.modalTitle}>{lang === 'am' ? 'የኪታብ መረጃ' : 'Kitab Details'}</Text>
        <TextInput label={lang === 'am' ? 'ስም (እንግሊዝኛ)' : 'Name (EN)'} defaultValue={nameEnRef.current} onChangeText={(v) => { nameEnRef.current = v; }} mode="outlined" style={styles.input} />
        <TextInput label={lang === 'am' ? 'ስም (አማርኛ)' : 'Name (AM)'} defaultValue={nameAmRef.current} onChangeText={(v) => { nameAmRef.current = v; }} mode="outlined" style={styles.input} />
        <Text style={styles.inputLabel}>{lang === 'am' ? 'የሚሰጥበት ደረጃ' : 'Target Level'}</Text>
        <View style={styles.levelGrid}>
          {levels.map((lvl: any) => {
            // 🛡️ Each level name (Nuraniya, Quran 1, Quran 2, Hifz) has a separate
            // male & female row with the identical name — tag with gender so the
            // two chips are never visually indistinguishable.
            const genderTag = lvl.gender === 'male'
              ? (lang === 'am' ? 'ወንድ' : 'Male')
              : (lang === 'am' ? 'ሴት' : 'Female');
            const label = `${lang === 'am' ? lvl.name_am : lvl.name} (${genderTag})`;
            return (
              <Chip key={lvl.id} selected={subjLevel === lvl.id} onPress={() => setSubjLevel(lvl.id)} style={[styles.smallChip, subjLevel === lvl.id && { backgroundColor: COLORS.primary }]} selectedColor="white">
                {label}
              </Chip>
            );
          })}
        </View>
        <Button mode="contained" onPress={() => onSave(nameEnRef.current, nameAmRef.current, subjLevel)} loading={isSaving} style={{ backgroundColor: COLORS.primaryDark, marginTop: 10 }}>
          {lang === 'am' ? 'መዝግብ' : 'Save'}
        </Button>
        {initialData && (
          <Button mode="outlined" onPress={onDelete} textColor="#ef4444" style={{ borderColor: '#ef4444', marginTop: 10 }}>
            {lang === 'am' ? 'ኪታቡን አጥፋ' : 'Delete Kitab'}
          </Button>
        )}
      </Modal>
    </Portal>
  );
});

const WeightEditorModal = React.memo(({ visible, onDismiss, onSave, onDelete, initialData, isSaving, lang }: any) => {
  const wNameRef = useRef<string>('');
  const wMaxRef = useRef<string>('');

  useEffect(() => {
    if (visible && initialData) {
      wNameRef.current = initialData.name || '';
      wMaxRef.current = String(initialData.weight || '');
    } else if (visible) {
      wNameRef.current = ''; wMaxRef.current = '';
    }
  }, [visible, initialData]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <Text style={styles.modalTitle}>{lang === 'am' ? 'የውጤት መዋቅር' : 'Component Details'}</Text>
        <TextInput label={lang === 'am' ? 'የመዋቅር ስም' : 'Name'} defaultValue={wNameRef.current} onChangeText={(v) => { wNameRef.current = v; }} mode="outlined" style={styles.input} />
        <TextInput label={lang === 'am' ? 'ነጥብ' : 'Points'} defaultValue={wMaxRef.current} onChangeText={(v) => { wMaxRef.current = v; }} mode="outlined" keyboardType="numeric" style={styles.input} />
        <Button mode="contained" onPress={() => onSave(wNameRef.current, wMaxRef.current)} loading={isSaving} style={{ backgroundColor: COLORS.primaryDark, marginTop: 10 }}>
          {lang === 'am' ? 'መዋቅር መዝግብ' : 'Save Component'}
        </Button>
        {initialData && (
          <Button mode="outlined" onPress={onDelete} textColor="#ef4444" style={{ borderColor: '#ef4444', marginTop: 10 }}>
            {lang === 'am' ? 'ይህን መዋቅር አጥፋ' : 'Delete Component'}
          </Button>
        )}
      </Modal>
    </Portal>
  );
});

export default function ManageSubjectsScreen() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fetchSubjects } = useGradeStore();
  const { user } = useAuthStore();

  const [levels, setLevels] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [weights, setWeights] = useState<Record<string, Weight[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [subjectModal, setSubjectModal] = useState(false);
  const [weightModal, setWeightModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editSubjectData, setEditSubjectData] = useState<any>(null);
  const [editWeightData, setEditWeightData] = useState<any>(null);
  const [weightSubjectId, setWeightSubjectId] = useState('');

  const refresh = useCallback(async (isInitial = false, force = false) => {
    if ((subjectModal || weightModal) && !force) return;
    if (isInitial) setIsLoading(true);
    try {
      const db = await getDatabase();
      const lvls = await db.getAllAsync<any>('SELECT * FROM levels ORDER BY name');
      setLevels(lvls);
      const subs = await db.getAllAsync<Subject>('SELECT * FROM subjects ORDER BY name');
      setSubjects(subs);
      const ws = await db.getAllAsync<Weight>(`SELECT * FROM grade_weights ORDER BY subject_id, weight DESC`);
      const map: Record<string, Weight[]> = {};
      ws.forEach(w => {
        if (!map[w.subject_id]) map[w.subject_id] = [];
        map[w.subject_id].push(w);
      });
      setWeights(map);
      await fetchSubjects();
    } catch { }
    if (isInitial) setIsLoading(false);
  }, [subjectModal, weightModal, fetchSubjects]);

  useEffect(() => {
    if (!subjectModal && !weightModal) refresh(true);
  }, []); // Only initial on mount

  const handleSaveSubject = async (en: string, am: string, lvl: string) => {
    if (!en.trim() || !am.trim()) return;
    setIsSaving(true);
    const db = await getDatabase();
    try {
      if (editSubjectData) {
        await db.runAsync('UPDATE subjects SET name = ?, name_am = ?, level_id = ? WHERE id = ?', [en.trim(), am.trim(), lvl || null, editSubjectData.id]);
        await queueSync('subjects', editSubjectData.id, 'update');
      } else {
        const newId = 's_' + Crypto.randomUUID().substring(0, 8);
        await db.runAsync('INSERT INTO subjects (id, name, name_am, level_id, is_active) VALUES (?,?,?,?,1)', [newId, en.trim(), am.trim(), lvl || null]);
        await queueSync('subjects', newId, 'insert');
      }
      setSubjectModal(false);
      const { triggerBackgroundSync } = await import('../../src/lib/sync');
      triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
      refresh(false, true);
    } catch { Alert.alert('Error', 'Save failed'); }
    setIsSaving(false);
  };

  const handleDeleteSubject = async () => {
    if (!editSubjectData) return;
    Alert.alert(
      i18n.language === 'am' ? 'ኪታቡ ይጥፋ?' : 'Delete Subject?',
      i18n.language === 'am' ? 'ይህንን ኪታብ ስታጠፋው ሁሉንም ውጤቶች እና መዋቅሮች አብረህ ታጠፋለህ። እርግጠኛ ነህ?' : 'Deleting this Kitab will permanently remove all associated scores, components, and teaching assignments. Continue?', [
      { text: i18n.language === 'am' ? 'ተመለስ' : 'Cancel' },
      {
        text: i18n.language === 'am' ? 'አጥፋ' : 'DELETE', style: 'destructive', onPress: async () => {
          setIsSaving(true);
          try {
            const db = await getDatabase();
            const subId = editSubjectData.id;

            // 1. Queue deletion of student grades for weights of this subject
            const weightsForSub = await db.getAllAsync<{ id: string }>('SELECT id FROM grade_weights WHERE subject_id = ?', [subId]);
            for (const w of weightsForSub) {
              const grades = await db.getAllAsync<{ id: string }>('SELECT id FROM student_grades WHERE weight_id = ?', [w.id]);
              for (const g of grades) await queueSync('student_grades', g.id, 'delete');
              await queueSync('grade_weights', w.id, 'delete');
            }

            // 2. Queue deletion of assignments
            const tLinks = await db.getAllAsync<{ teacher_id: string; student_id: string }>('SELECT teacher_id, student_id FROM teacher_student_links WHERE subject_id = ?', [subId]);
            for (const l of tLinks) await queueSync('teacher_student_links', `${l.teacher_id},${l.student_id},${subId}`, 'delete');

            const tSubs = await db.getAllAsync<{ teacher_id: string }>('SELECT teacher_id FROM teacher_subjects WHERE subject_id = ?', [subId]);
            for (const ts of tSubs) await queueSync('teacher_subjects', `${ts.teacher_id},${subId}`, 'delete');

            // 3. Queue subject deletion
            await queueSync('subjects', subId, 'delete');

            // 4. Local wipe
            await db.runAsync('DELETE FROM student_grades WHERE weight_id IN (SELECT id FROM grade_weights WHERE subject_id = ?)', [subId]);
            await db.runAsync('DELETE FROM grade_weights WHERE subject_id = ?', [subId]);
            await db.runAsync('DELETE FROM teacher_student_links WHERE subject_id = ?', [subId]);
            await db.runAsync('DELETE FROM teacher_subjects WHERE subject_id = ?', [subId]);
            await db.runAsync('DELETE FROM subjects WHERE id = ?', [subId]);

            setSubjectModal(false);
            const { triggerBackgroundSync } = await import('../../src/lib/sync');
            triggerBackgroundSync(true);
            refresh(false, true);
          } catch { Alert.alert('Error', 'Delete failed'); }
          setIsSaving(false);
        }
      }
    ]);
  };

  const handleDeleteWeight = async () => {
    if (!editWeightData) return;
    Alert.alert(
      i18n.language === 'am' ? 'መዋቅሩ ይጥፋ?' : 'Delete Component?',
      i18n.language === 'am' ? 'ይህንን የውጤት መዋቅር ስታጠፋው የሁሉም ተማሪዎች ውጤት አብሮ ይጠፋል። እርግጠኛ ነህ?' : 'Deleting this component will permanently remove all student marks for this specific category. Continue?', [
      { text: i18n.language === 'am' ? 'ተመለስ' : 'Cancel' },
      {
        text: i18n.language === 'am' ? 'አጥፋ' : 'DELETE', style: 'destructive', onPress: async () => {
          setIsSaving(true);
          try {
            const db = await getDatabase();
            const wId = editWeightData.id;

            // 1. Queue all student grades for this weight
            const grades = await db.getAllAsync<{ id: string }>('SELECT id FROM student_grades WHERE weight_id = ?', [wId]);
            for (const g of grades) await queueSync('student_grades', g.id, 'delete');

            // 2. Queue weight deletion
            await queueSync('grade_weights', wId, 'delete');

            // 3. Local wipe
            await db.runAsync('DELETE FROM student_grades WHERE weight_id = ?', [wId]);
            await db.runAsync('DELETE FROM grade_weights WHERE id = ?', [wId]);

            setWeightModal(false);
            const { triggerBackgroundSync } = await import('../../src/lib/sync');
            triggerBackgroundSync(true);
            refresh(false, true);
          } catch { Alert.alert('Error', 'Delete failed'); }
          setIsSaving(false);
        }
      }
    ]);
  };

  const handleSaveWeight = async (name: string, max: string) => {
    const maxNum = parseFloat(max);
    if (!name.trim() || isNaN(maxNum)) return;
    setIsSaving(true);
    const db = await getDatabase();
    try {
      if (editWeightData) {
        const conflicts = await db.getAllAsync<{ id: string }>('SELECT id FROM grade_weights WHERE subject_id = ? AND name = ? AND id != ?', [weightSubjectId, name.trim(), editWeightData.id]);
        for (const c of conflicts) await queueSync('grade_weights', c.id, 'delete');
        await db.runAsync('DELETE FROM grade_weights WHERE subject_id = ? AND name = ? AND id != ?', [weightSubjectId, name.trim(), editWeightData.id]);

        await db.runAsync('UPDATE grade_weights SET name = ?, weight = ? WHERE id = ?', [name.trim(), maxNum, editWeightData.id]);
        await queueSync('grade_weights', editWeightData.id, 'update');
      } else {
        const conflicts = await db.getAllAsync<{ id: string }>('SELECT id FROM grade_weights WHERE subject_id = ? AND name = ?', [weightSubjectId, name.trim()]);
        for (const c of conflicts) await queueSync('grade_weights', c.id, 'delete');
        await db.runAsync('DELETE FROM grade_weights WHERE subject_id = ? AND name = ?', [weightSubjectId, name.trim()]);

        const newId = 'gw_' + Crypto.randomUUID().substring(0, 8);
        await db.runAsync('INSERT INTO grade_weights (id, subject_id, name, weight) VALUES (?,?,?,?)', [newId, weightSubjectId, name.trim(), maxNum]);
        await queueSync('grade_weights', newId, 'insert');
      }
      setWeightModal(false);
      const { triggerBackgroundSync } = await import('../../src/lib/sync');
      triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
      refresh(false, true);
    } catch { Alert.alert('Error', 'Save failed'); }
    setIsSaving(false);
  };

  const handleResetAll = () => {
    Alert.alert(
      i18n.language === 'am' ? 'ሁሉንም ዳታ አጥፋ' : 'Wipe All Data',
      i18n.language === 'am' ? 'ሁሉንም ኪታቦች እና ውጤቶች በቋሚነት እንዲጠፉ ይፈልጋሉ?' : 'Delete ALL Kitabs and Grades permanently?', [
      { text: i18n.language === 'am' ? 'ተመለስ' : 'Cancel', style: 'cancel' },
      {
        text: i18n.language === 'am' ? 'ሁሉንም ዳታ አጥፋ' : 'WIPE EVERYTHING', style: 'destructive', onPress: async () => {
          setIsLoading(true);
          try {
            const db = await getDatabase();
            // 🛡️ LOCAL FIRST: Wipe phone data immediately
            await db.runAsync('DELETE FROM student_grades');
            await db.runAsync('DELETE FROM grade_weights');
            await db.runAsync('DELETE FROM teacher_student_links');
            await db.runAsync('DELETE FROM teacher_subjects');
            await db.runAsync('DELETE FROM student_progress');
            await db.runAsync('DELETE FROM nuraniyah_assessments');
            await db.runAsync('DELETE FROM subjects');
            await db.runAsync('DELETE FROM sync_log WHERE table_name IN ("subjects", "grade_weights", "student_grades", "teacher_subjects", "teacher_student_links", "student_progress", "nuraniyah_assessments")');

            // ☁️ CLOUD BEST-EFFORT: Try wiping cloud, but don't stop if it fails
            try {
              const { supabase } = await import('../../src/lib/supabase');
              await supabase.from('student_grades').delete().neq('id', 'void');
              await supabase.from('grade_weights').delete().neq('id', 'void');
              await supabase.from('subjects').delete().neq('id', 'void');
            } catch (cloudErr) { console.warn('Cloud wipe skipped:', cloudErr); }

            Alert.alert(
              i18n.language === 'am' ? 'ተሳክቷል' : 'Success',
              i18n.language === 'am' ? 'የስልኩ ዳታ ጠፍቷል' : 'Phone data wiped. Cloud cleanup dispatched immediately.'
            );
            const { triggerBackgroundSync } = await import('../../src/lib/sync');
            triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
            await refresh();
          } catch (e) { Alert.alert(i18n.language === 'am' ? 'ስህተት' : 'Error', i18n.language === 'am' ? 'ዳታውን ማጥፋት አልተቻለም' : 'Wipe failed. Contact support.'); }
          setIsLoading(false);
        }
      }
    ]);
  };

  const handleClearAssessments = () => {
    Alert.alert('Clear All Scores', 'Remove all scoring components and grades?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'CLEAR SCORES', style: 'destructive', onPress: async () => {
          setIsLoading(true);
          try {
            const db = await getDatabase();
            // 🛡️ LOCAL FIRST
            await db.runAsync('DELETE FROM student_grades');
            await db.runAsync('DELETE FROM grade_weights');
            await db.runAsync('DELETE FROM sync_log WHERE table_name IN ("grade_weights", "student_grades")');

            // ☁️ CLOUD BEST-EFFORT
            try {
              const { supabase } = await import('../../src/lib/supabase');
              await supabase.from('student_grades').delete().neq('id', 'void');
              await supabase.from('grade_weights').delete().neq('id', 'void');
            } catch (cloudErr) { console.warn('Cloud scoring wipe skipped:', cloudErr); }

            setWeights({});
            await useStudentStore.getState().fetchStudents();

            Alert.alert('Success', 'All scores and components cleared instantly.');

            const { triggerBackgroundSync } = await import('../../src/lib/sync');
            triggerBackgroundSync(true);
            await refresh();
          } catch (e) { Alert.alert('Error', 'Clear failed.'); }
          setIsLoading(false);
        }
      }
    ]);
  };

  const handleSeedDefaults = () => {
    Alert.alert(
      i18n.language === 'am' ? 'አጠቃላይ አደረጃጀት' : 'Standardize Weights',
      i18n.language === 'am' ? 'ያሉትን መዘበራረቆች አጥፍተህ የ100% አወቃቀሩን (ኩዊዝ 10፣ ፊርማ 15፣ ፈተና 40...) ተግባራዊ ለማድረግ እርግጠኛ ነህ?' : 'Wipe all messy/duplicate weights and apply the exact 100% Medresa standard (Quiz 10, Assgn 10, Partic 15, Mid 25, Final 40) to ALL current Kitabs?', [
      { text: i18n.language === 'am' ? 'ተመለስ' : 'Cancel', style: 'cancel' },
      {
        text: i18n.language === 'am' ? 'አደራጅ' : 'STANDARDIZE ALL', onPress: async () => {
          setIsLoading(true);
          try {
            const db = await getDatabase();
            // 1. Wipe old grades (marks) and weights, queueing deletions
            const oldGrades = await db.getAllAsync<{ id: string }>('SELECT id FROM student_grades');
            for (const g of oldGrades) {
              await queueSync('student_grades', g.id, 'delete');
            }
            await db.runAsync('DELETE FROM student_grades');

            const oldWeights = await db.getAllAsync<{ id: string }>('SELECT id FROM grade_weights');
            for (const w of oldWeights) {
              await queueSync('grade_weights', w.id, 'delete');
            }
            await db.runAsync('DELETE FROM grade_weights');

            // 2. Fetch all existing subjects and apply the standard 100% distribution
            const activeSubjects = await db.getAllAsync<{ id: string }>('SELECT id FROM subjects');

            for (const subj of activeSubjects) {
              for (const c of STANDARD_COMPONENTS) {
                const wId = 'gw_' + Crypto.randomUUID().substring(0, 8);
                await db.runAsync('INSERT INTO grade_weights (id, subject_id, name, weight) VALUES (?,?,?,?)', [wId, subj.id, c.n, c.w]);
                await queueSync('grade_weights', wId, 'insert');
              }
            }
            const { triggerBackgroundSync } = await import('../../src/lib/sync');
            triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH

            // 🛡️ CRITICAL: Refresh student list to update the visual GPAs/Averages
            await useStudentStore.getState().fetchStudents();

            await refresh();
            Alert.alert(
              i18n.language === 'am' ? 'ተሳክቷል' : 'Success',
              i18n.language === 'am' ? `ለ ${activeSubjects.length} ኪታቦች የ100% አወቃቀሩ ተዘጋጅቷል` : `Applied 100% standard weights and cleaned marks for ${activeSubjects.length} Kitabs. Synced instantly!`
            );
          } catch { Alert.alert(i18n.language === 'am' ? 'ስህተት' : 'Error', i18n.language === 'am' ? 'ማደራጀት አልተቻለም' : 'Standardization failed'); }
          setIsLoading(false);
        }
      }
    ]);
  };

  return (
    <View style={styles.container}>
      <Surface style={styles.header} elevation={4}>
        <IconButton icon="arrow-left" iconColor="white" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{i18n.language === 'am' ? 'ኪታቦችን መቆጣጠሪያ' : 'Manage Kitabs'}</Text>
          <Text style={styles.subTitle}>{subjects.length} {i18n.language === 'am' ? 'ኪታቦች' : 'Kitabs'}</Text>
        </View>
        {user?.role === 'admin' && (
          <>
            <TouchableOpacity style={styles.headerToolBtn} onPress={handleSeedDefaults}><MaterialCommunityIcons name="auto-fix" size={20} color="white" /></TouchableOpacity>
            <TouchableOpacity style={styles.headerToolBtn} onPress={handleClearAssessments}><MaterialCommunityIcons name="playlist-remove" size={20} color="#fbbf24" /></TouchableOpacity>
            <TouchableOpacity style={styles.headerToolBtn} onPress={handleResetAll}><MaterialCommunityIcons name="trash-can-outline" size={20} color="#fca5a5" /></TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => { setEditSubjectData(null); setSubjectModal(true); }}><MaterialCommunityIcons name="plus" size={22} color="white" /></TouchableOpacity>
          </>
        )}
      </Surface>

      {isLoading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} size="large" /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
          {subjects.map(s => {
            const isExpanded = expandedId === s.id;
            const subWeights = weights[s.id] || [];
            return (
              <Surface key={s.id} style={styles.subjectCard} elevation={2}>
                <TouchableOpacity style={styles.subjectRow} onPress={() => setExpandedId(isExpanded ? null : s.id)}>
                  <View style={styles.subjectIcon}><MaterialCommunityIcons name="book-open-variant" size={22} color={COLORS.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sNameAm}>{s.name_am}</Text>
                    <Text style={styles.sNameEn}>{s.name}</Text>
                  </View>
                  {user?.role === 'admin' && (
                    <IconButton icon="pencil" size={20} onPress={() => { setEditSubjectData(s); setSubjectModal(true); }} />
                  )}
                  <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={22} color="#94a3b8" />
                </TouchableOpacity>
                {isExpanded && (
                  <View style={styles.weightsSection}>
                    <Divider style={{ marginBottom: 12 }} />
                    <View style={styles.weightsSectionHeader}>
                      <Text style={styles.weightsSectionTitle}>
                        {i18n.language === 'am' ? 'የውጤት መዋቅሮች' : 'Components'}
                      </Text>
                      {user?.role === 'admin' && (
                        <TouchableOpacity style={styles.addWeightBtn} onPress={() => { setWeightSubjectId(s.id); setEditWeightData(null); setWeightModal(true); }}>
                          <Text style={styles.addWeightTxt}>+ {i18n.language === 'am' ? 'ጨምር' : 'Add'}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {subWeights.map(w => (
                      <View key={w.id} style={styles.weightRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.wName}>{w.name}</Text>
                          <Text style={styles.wMax}>{i18n.language === 'am' ? 'ከፍተኛ: ' : 'Max: '}{w.weight}</Text>
                        </View>
                        {user?.role === 'admin' && (
                          <IconButton icon="pencil" size={16} onPress={() => { setWeightSubjectId(s.id); setEditWeightData(w); setWeightModal(true); }} />
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </Surface>
            );
          })}
        </ScrollView>
      )}

      <SubjectEditorModal
        key={`sub_${editSubjectData?.id || 'new'}_${subjectModal}`}
        visible={subjectModal}
        onDismiss={() => setSubjectModal(false)}
        onSave={handleSaveSubject}
        onDelete={handleDeleteSubject}
        initialData={editSubjectData}
        levels={levels}
        isSaving={isSaving}
        lang={i18n.language}
      />
      <WeightEditorModal
        key={`weight_${editWeightData?.id || 'new'}_${weightModal}`}
        visible={weightModal}
        onDismiss={() => setWeightModal(false)}
        onSave={handleSaveWeight}
        onDelete={handleDeleteWeight}
        initialData={editWeightData}
        isSaving={isSaving}
        lang={i18n.language}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: COLORS.primaryDark, paddingTop: 50, paddingBottom: 15, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomLeftRadius: 25, borderBottomRightRadius: 25 },
  headerToolBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  title: { color: 'white', fontSize: 18, fontWeight: '900' },
  subTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  subjectCard: { backgroundColor: 'white', borderRadius: 20, marginBottom: 12, overflow: 'hidden' },
  subjectRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  subjectIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary + '15' },
  sNameAm: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  sNameEn: { fontSize: 12, color: '#64748b', marginTop: 2, fontWeight: '600' },
  weightsSection: { paddingHorizontal: 16, paddingBottom: 16 },
  weightsSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  weightsSectionTitle: { fontSize: 11, fontWeight: '900', color: '#64748b', textTransform: 'uppercase' },
  addWeightBtn: { backgroundColor: COLORS.primaryDark, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  addWeightTxt: { color: 'white', fontSize: 12, fontWeight: '800' },
  weightRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  wName: { fontSize: 14, fontWeight: '700', color: '#334155' },
  wMax: { fontSize: 11, color: '#94a3b8' },
  modal: { backgroundColor: 'white', padding: 24, margin: 20, borderRadius: 28 },
  input: { marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20 },
  inputLabel: { fontSize: 12, fontWeight: '800', color: '#64748b', marginTop: 10, marginBottom: 8, textTransform: 'uppercase' },
  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 15 },
  smallChip: { height: 32 },
});