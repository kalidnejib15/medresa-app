import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Surface, ActivityIndicator, IconButton, Avatar, DataTable } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { getDatabase } from '../../src/lib/database';
import { useGradeStore } from '../../src/store/useGradeStore';
import { useLevelStore } from '../../src/store/useLevelStore';
import { COLORS } from '../../src/constants';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function AcademicMasterReport() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { subjects, fetchSubjects } = useGradeStore();
  const { levels, fetchLevels } = useLevelStore();
  
  const [selectedLevelId, setSelectedLevelId] = useState('');
  const [reportData, setReportData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchSubjects();
    fetchLevels();
  }, []);

  useEffect(() => {
    if (selectedLevelId) loadGridData();
  }, [selectedLevelId]);

  const loadGridData = async () => {
    setIsLoading(true);
    const db = await getDatabase();
    
    // 1. Get Students in level
    const students = await db.getAllAsync<any>(
      'SELECT id, name_am, name_en FROM students WHERE level_id = ? AND is_active = 1',
      [selectedLevelId]
    );

    // 2. Get Grades for these students
    const grades = await db.getAllAsync<any>(
      `SELECT g.student_id, g.score, w.subject_id, w.weight
       FROM student_grades g
       JOIN grade_weights w ON g.weight_id = w.id
       WHERE g.student_id IN (SELECT id FROM students WHERE level_id = ?)`,
      [selectedLevelId]
    );

    // 3. Map into Grid structure
    const grid = students.map(s => {
      const studentGrades: any = {};
      subjects.forEach(sub => {
        // Calculate average / total for this subject
        const subGrades = grades.filter(g => g.student_id === s.id && g.subject_id === sub.id);
        if (subGrades.length > 0) {
          const total = subGrades.reduce((sum, curr) => sum + curr.score, 0);
          studentGrades[sub.id] = Math.round(total);
        } else {
          studentGrades[sub.id] = '-';
        }
      });
      return { ...s, grades: studentGrades };
    });

    setReportData(grid);
    setIsLoading(false);
  };

  return (
    <View style={styles.container}>
      <Surface style={styles.header} elevation={4}>
        <View style={styles.headerTop}>
          <IconButton icon="arrow-left" iconColor="white" onPress={() => router.back()} />
          <Text style={styles.title}>{i18n.language === 'am' ? 'የውጤት መጋዘን' : 'Academic Master Grid'}</Text>
        </View>
        
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.levelScroll}>
          {levels.map(l => (
            <TouchableOpacity 
              key={l.id} 
              style={[styles.levelChip, selectedLevelId === l.id && styles.levelChipActive]}
              onPress={() => setSelectedLevelId(l.id)}
            >
              <Text style={[styles.levelChipTxt, selectedLevelId === l.id && styles.levelChipTxtActive]}>
                {i18n.language === 'am' ? l.name_am : l.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Surface>

      <ScrollView horizontal>
        <View>
          <DataTable style={styles.table}>
            <DataTable.Header style={styles.tableHeader}>
              <DataTable.Title style={{ width: 150 }}>{t('student')}</DataTable.Title>
              {subjects.map(s => (
                <DataTable.Title key={s.id} numeric style={{ width: 80 }}>
                    {i18n.language === 'am' ? s.name_am : (s.name || 'Subject').substring(0,4)}
                </DataTable.Title>
              ))}
            </DataTable.Header>

            {isLoading ? (
              <ActivityIndicator style={{ marginTop: 50 }} color={COLORS.primary} />
            ) : reportData.length === 0 ? (
              <Text style={styles.empty}>{selectedLevelId ? 'No data for this level' : 'Select a level to view report'}</Text>
            ) : (
              <ScrollView>
                {reportData.map((row, idx) => (
                  <DataTable.Row key={row.id} style={[styles.row, idx % 2 === 0 && { backgroundColor: '#f8fafc' }]}>
                    <DataTable.Cell style={{ width: 150 }}>
                      <Text style={styles.studentName}>{i18n.language === 'am' ? row.name_am : row.name_en}</Text>
                    </DataTable.Cell>
                    {subjects.map(sub => (
                      <DataTable.Cell key={sub.id} numeric style={{ width: 80 }}>
                        <Text style={[styles.score, typeof row.grades[sub.id] === 'number' && { color: COLORS.primary, fontWeight: '900' }]}>
                          {row.grades[sub.id]}
                        </Text>
                      </DataTable.Cell>
                    ))}

                  </DataTable.Row>
                ))}
              </ScrollView>
            )}
          </DataTable>
        </View>
      </ScrollView>

      {!selectedLevelId && (
        <View style={styles.placeholder}>
          <MaterialCommunityIcons name="table-search" size={60} color="#cbd5e1" />
          <Text style={styles.placeholderTxt}>Select a level to generate the Master Grid</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  header: { backgroundColor: COLORS.primaryDark, paddingTop: 40, paddingBottom: 15, borderBottomLeftRadius: 25, borderBottomRightRadius: 25 },
  headerTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  title: { color: 'white', fontSize: 19, fontWeight: '900', marginLeft: 5 },
  levelScroll: { marginTop: 15, paddingHorizontal: 20 },
  levelChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', marginRight: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  levelChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  levelChipTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  levelChipTxtActive: { color: COLORS.primaryDark, fontWeight: '900' },
  
  table: { backgroundColor: 'white', marginTop: 15, minWidth: 600 },
  tableHeader: { backgroundColor: '#f1f5f9', borderTopWidth: 0 },
  row: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9', height: 55 },
  studentName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  score: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  empty: { textAlign: 'center', marginTop: 30, color: '#94a3b8', fontSize: 14 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', opacity: 0.8 },
  placeholderTxt: { color: '#94a3b8', marginTop: 12, fontSize: 14, fontWeight: '600' }
});
