import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { Text, Surface, ActivityIndicator, Avatar, Divider } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useGradeStore } from '../../src/store/useGradeStore';
import { useAuthStore } from '../../src/store/useAuthStore';
import { COLORS } from '../../src/constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const MEDALS = ['🥇', '🥈', '🥉'];
const MEDAL_COLORS = ['#b45309', '#64748b', '#92400e'];
const MEDAL_BG = ['#fef3c7', '#f1f5f9', '#fde8cc'];

const AUTHORIZED_TEAMS = [
  { id: 'all', label_en: 'All Teams', label_am: 'ሁሉንም ቡድን' },
  { id: 'Team Nuraniya', label_en: 'Team Nuraniya', label_am: 'ቡድን ኑራኒያ' },
  { id: 'Team Quran 1', label_en: 'Team Quran 1', label_am: 'ቡድን ቁርአን 1' },
  { id: 'Team Hifz', label_en: 'Team Hifz', label_am: 'ቡድን ሂፍዝ' }
];

function getGradeColor(score: number) {
  if (score >= 90) return '#059669';
  if (score >= 80) return '#10b981';
  if (score >= 70) return '#0284c7'; // Professional Blue
  if (score >= 60) return '#f59e0b'; // Warm Amber
  if (score >= 50) return '#d97706'; // Dark Amber
  return '#ef4444';
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SubjectScore {
  ustaz_id: string;
  ustaz_name: string;
  subject_name: string;
  score: number; // average for this subject from this teacher
  entries: number;
}

interface StudentRecord {
  student_id: string;
  student_name: string;
  level_name: string;
  level_id: string;
  kitab_group_override?: string;
  subjects: SubjectScore[];
  overallAvg: number;
}

const TEAM_MAP: Record<string, { label: string, color: string, bg: string }> = {
  'Team Nuraniya': { label: 'Team Nuraniya', color: '#0284c7', bg: '#f0f9ff' },
  'Team Quran 1': { label: 'Team Quran 1', color: '#059669', bg: '#ecfdf5' },
  'Team Hifz': { label: 'Team Hifz', color: '#7c3aed', bg: '#f5f3ff' }
};

const getTeamForLevel = (levelId: string, kitabGroupOverride?: string) => {
  if (['l1m', 'l1f'].includes(levelId)) return 'Team Nuraniya';
  // 🛡️ Kitab-session override: an explicit group_name tag on the student's
  // kitab link wins over their academic level (used to move individual
  // students between the Quran 1 / Hifz kitab tabs without changing level_id).
  if (kitabGroupOverride && kitabGroupOverride.includes('Quran 1')) return 'Team Quran 1';
  if (kitabGroupOverride && kitabGroupOverride.includes('Hifz')) return 'Team Hifz';
  if (['l2m', 'l2f'].includes(levelId)) return 'Team Quran 1';
  if (['l3m', 'l3f', 'l4m', 'l4f'].includes(levelId)) return 'Team Hifz';
  return 'other';
};

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function ReportsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { getRankings } = useGradeStore();
  const { getUstazs } = useAuthStore();

  const [isLoading, setIsLoading] = useState(true);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [view, setView] = useState<'ranking' | 'teacher'>('ranking');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [ustazStats, setUstazStats] = useState<any[]>([]);
  const [expandedUstaz, setExpandedUstaz] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const rawRows = await getRankings(selectedTeam);
      const teachers = await getUstazs();

      // ── Step 1: Aggregate rows per student ──────────────────────────────────
      const studentMap: Record<string, StudentRecord> = {};

      rawRows.forEach((row: any) => {
        const sid = row.student_id;

        // 🛡️ NAME RESOLUTION: Match exactly the localization logic used in the grading screen
        const subjAm = row.subject_name_am;
        const subjEn = row.subject_name_en;
        const rawName = i18n.language === 'am' ? (subjAm || subjEn) : (subjEn || subjAm);
        const displaySubject = rawName || (row.level_name ? `${row.level_name} Level` : 'Medresa Subject');

        if (!studentMap[sid]) {
          studentMap[sid] = {
            student_id: sid,
            student_name: row.student_name,
            level_name: row.level_name || '',
            level_id: row.level_id || '',
            kitab_group_override: row.kitab_group_override || undefined,
            subjects: [],
            overallAvg: 0,
          };
        }
        studentMap[sid].subjects.push({
          ustaz_id: row.ustaz_id,
          ustaz_name: row.ustaz_name,
          subject_name: displaySubject,
          score: parseFloat(row.subject_score),
          entries: row.component_count,
        });
      });

      // ── Step 2: Calculate each student's overall average ────────────────────
      const studentList: StudentRecord[] = Object.values(studentMap).map(s => ({
        ...s,
        overallAvg: s.subjects.reduce((sum, sub) => sum + sub.score, 0) / s.subjects.length,
      })).sort((a, b) => b.overallAvg - a.overallAvg);

      // ── Step 3: Per-teacher breakdown ────────────────────────────────────────
      const teacherMap: Record<string, any> = {};
      rawRows.forEach((row: any) => {
        const tid = row.ustaz_id;
        if (!teacherMap[tid]) {
          teacherMap[tid] = {
            id: tid,
            name: row.ustaz_name,
            students: {},
          };
        }
        const sid = row.student_id;
        if (!teacherMap[tid].students[sid]) {
          teacherMap[tid].students[sid] = {
            student_id: sid,
            student_name: row.student_name,
            subjects: [],
          };
        }

        // 🛡️ RE-APPLY THE NAME RESOLUTION FOR TEACHERS LIST
        const subjAm = row.subject_name_am;
        const subjEn = row.subject_name_en;
        const rawName = i18n.language === 'am' ? (subjAm || subjEn) : (subjEn || subjAm);
        const displaySubject = rawName || (row.level_name ? `${row.level_name} Level` : 'Medresa Subject');

        teacherMap[tid].students[sid].subjects.push({
          subject_name: displaySubject,
          score: parseFloat(row.subject_score),
          entries: row.component_count,
        });
      });

      const teacherList = Object.values(teacherMap).map((t: any) => {
        const studs = Object.values(t.students) as any[];
        // student avg = mean of their subjects under this teacher
        const studsWithAvg = studs.map((s: any) => ({
          ...s,
          avg: s.subjects.reduce((a: number, b: any) => a + b.score, 0) / s.subjects.length,
        })).sort((a, b) => b.avg - a.avg);
        const classAvg = studsWithAvg.length > 0
          ? studsWithAvg.reduce((sum, s) => sum + s.avg, 0) / studsWithAvg.length
          : 0;
        return { ...t, students: studsWithAvg, classAvg };
      }).sort((a, b) => b.classAvg - a.classAvg);

      setStudents(studentList);
      setUstazStats(teacherList);
    } catch (e) {
      console.error('Reports error:', e);
    }
    setIsLoading(false);
  };

  useEffect(() => { loadData(); }, [selectedTeam]);

  const schoolAvg = students.length > 0
    ? students.reduce((s, r) => s + r.overallAvg, 0) / students.length
    : 0;

  if (isLoading && students.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} size="large" />
        <Text style={styles.loadingTxt}>{i18n.language === 'am' ? 'ሪፖርት በመጫን...' : 'Loading...'}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadData} />}>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="white" />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <View>
            <Text style={styles.title}>
              {selectedTeam === 'all'
                ? (i18n.language === 'am' ? 'አካዳሚክ ሪፖርት' : 'Academic Report')
                : (i18n.language === 'am' ? `${TEAM_MAP[selectedTeam]?.label} ሪፖርት` : `${TEAM_MAP[selectedTeam]?.label} Report`)
              }
            </Text>
            <Text style={styles.subtitle}>{i18n.language === 'am' ? 'ልዩ ልዩ ዑስታዝ ውጤቶች ተጠቃለው' : 'Consolidated departmental metrics'}</Text>
          </View>
          <MaterialCommunityIcons name="finance" size={32} color="rgba(255,255,255,0.3)" />
        </View>
        <View style={styles.headerStats}>
          <View style={styles.hStat}>
            <Text style={styles.hStatVal}>{students.length}</Text>
            <Text style={styles.hStatLbl}>{i18n.language === 'am' ? 'ተማሪዎች' : 'Students'}</Text>
          </View>
          <View style={styles.hStatDiv} />
          <View style={styles.hStat}>
            <Text style={styles.hStatVal}>{ustazStats.length}</Text>
            <Text style={styles.hStatLbl}>{i18n.language === 'am' ? 'ዑስታዞች' : 'Teachers'}</Text>
          </View>
          <View style={styles.hStatDiv} />
          <View style={styles.hStat}>
            <Text style={[styles.hStatVal, { color: '#86efac' }]}>{schoolAvg.toFixed(1)}%</Text>
            <Text style={styles.hStatLbl}>
              {selectedTeam === 'all'
                ? (i18n.language === 'am' ? 'አማካይ' : 'School Avg')
                : (i18n.language === 'am' ? 'የቡድን አማካይ' : 'Track Avg')
              }
            </Text>
          </View>
        </View>
      </View>

      {/* ── ELITE VIEW SWITCHER (Floating) ── */}
      <View style={styles.floatingSwitcherWrap}>
        <View style={styles.switcher}>
          <TouchableOpacity
            onPress={() => setView('ranking')}
            activeOpacity={0.9}
            style={[styles.switchBtn, view === 'ranking' && styles.switchBtnActive]}>
            <MaterialCommunityIcons name="trophy" size={16} color={view === 'ranking' ? 'white' : '#64748b'} />
            <Text style={[styles.switchTxt, view === 'ranking' && styles.switchTxtActive]}>
              {i18n.language === 'am' ? 'ደረጃ' : 'Rankings'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setView('teacher')}
            activeOpacity={0.9}
            style={[styles.switchBtn, view === 'teacher' && styles.switchBtnActive]}>
            <MaterialCommunityIcons name="account-tie" size={16} color={view === 'teacher' ? 'white' : '#64748b'} />
            <Text style={[styles.switchTxt, view === 'teacher' && styles.switchTxtActive]}>
              {i18n.language === 'am' ? 'ዑስታዝ' : 'By Teacher'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── TEAM FILTER BUTTONS (Elite) ── */}
      <View style={{ marginTop: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamFilterScroll}>
          {AUTHORIZED_TEAMS.map((team) => (
            <TouchableOpacity
              key={team.id}
              onPress={() => setSelectedTeam(team.id)}
              activeOpacity={0.7}
              style={[
                styles.teamBtn,
                selectedTeam === team.id && styles.teamBtnActive,
                { shadowColor: selectedTeam === team.id ? COLORS.primary : '#000' }
              ]}>
              <MaterialCommunityIcons
                name={selectedTeam === team.id ? "check-circle" : "circle-outline"}
                size={12}
                color={selectedTeam === team.id ? 'white' : '#94a3b8'}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.teamBtnTxt, selectedTeam === team.id && styles.teamBtnTxtActive]}>
                {i18n.language === 'am' ? team.label_am : team.label_en}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ════════════════════ RANKING VIEW ════════════════════ */}
      {view === 'ranking' && (
        <>
          <View style={styles.sectionRow}>
            <MaterialCommunityIcons name="trophy-outline" size={15} color="#b45309" />
            <Text style={styles.sectionTitle}>{i18n.language === 'am' ? 'አጠቃላይ ደረጃ' : 'STUDENT RANKINGS'}</Text>
          </View>

          {students.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialCommunityIcons name="database-off-outline" size={50} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>{i18n.language === 'am' ? 'ምንም ውጤት የለም' : 'No results yet'}</Text>
            </View>
          ) : (
            students.map((s, index) => {
              const color = getGradeColor(s.overallAvg);
              const isMedal = index < 3;
              const isExpanded = expandedStudent === s.student_id;

              return (
                <Surface key={s.student_id} style={styles.studentCard} elevation={isExpanded ? 3 : 1}>
                  <TouchableOpacity
                    onPress={() => setExpandedStudent(isExpanded ? null : s.student_id)}
                    activeOpacity={0.8}>
                    <View style={[styles.studentRow, isMedal && { backgroundColor: MEDAL_BG[index] + '80' }]}>
                      {/* Rank */}
                      <View style={[styles.rankBadge, { backgroundColor: isMedal ? MEDAL_BG[index] : '#f8fafc' }]}>
                        <Text style={[styles.rankNum, { color: isMedal ? MEDAL_COLORS[index] : '#94a3b8' }]}>
                          {isMedal ? MEDALS[index] : index + 1}
                        </Text>
                      </View>

                      {/* Name & Levels */}
                      <View style={{ flex: 1, paddingVertical: 4 }}>
                        <Text style={styles.studentName}>{s.student_name}</Text>
                        <View style={{ marginTop: 6, gap: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <MaterialCommunityIcons name="layers-outline" size={13} color={COLORS.primary} />
                            <Text style={[styles.studentMeta, { color: COLORS.primaryDark, fontSize: 13, fontWeight: '800' }]}>{s.level_name}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.studentMeta}>{s.subjects.length} {i18n.language === 'am' ? 'ትምህርቶች' : 'subjects'}</Text>
                            <View style={[styles.teamBadge, { backgroundColor: TEAM_MAP[getTeamForLevel(s.level_id, s.kitab_group_override)]?.bg || '#f1f5f9' }]}>
                              <Text style={[styles.teamBadgeTxt, { color: TEAM_MAP[getTeamForLevel(s.level_id, s.kitab_group_override)]?.color || '#64748b' }]}>
                                {TEAM_MAP[getTeamForLevel(s.level_id, s.kitab_group_override)]?.label || 'Other'}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>

                      {/* Score */}
                      <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
                        <Text style={styles.scoreMain}>{s.overallAvg.toFixed(1)}</Text>
                        <Text style={styles.scoreOf}>/100</Text>
                      </View>


                      <MaterialCommunityIcons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18} color="#94a3b8" style={{ marginLeft: 6 }} />
                    </View>
                  </TouchableOpacity>

                  {/* Expanded: subject breakdown */}
                  {isExpanded && (
                    <View style={styles.subjectBreakdown}>
                      <Divider style={{ marginBottom: 12 }} />
                      <Text style={styles.breakdownTitle}>
                        {i18n.language === 'am' ? 'ዝርዝር ውጤት ከ ሁሉም ዑስታዝ' : 'Detailed scores from all teachers'}
                      </Text>
                      {s.subjects.map((sub, si) => {
                        const color = getGradeColor(sub.score);
                        return (
                          <View key={si} style={styles.subjectRow}>
                            <View style={styles.subjectIconWrap}>
                              <MaterialCommunityIcons name="book-open-variant" size={14} color={COLORS.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.subjectName}>{sub.subject_name}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                                <MaterialCommunityIcons name="account-circle-outline" size={12} color="#64748b" />
                                <Text style={[styles.subjectUstaz, { color: '#475569', fontWeight: '800' }]}>{sub.ustaz_name}</Text>
                              </View>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={[styles.subjectScore, { color: color, marginBottom: 2 }]}>
                                {sub.score.toFixed(1)}/100
                              </Text>
                              <Text style={{ fontSize: 9, color: '#94a3b8', fontWeight: '700' }}>{sub.entries} {i18n.language === 'am' ? 'ምዘናዎች' : 'exams'}</Text>
                            </View>
                          </View>
                        );
                      })}

                      {/* Overall avg bar */}
                      <View style={styles.overallRow}>
                        <Text style={styles.overallLabel}>
                          {i18n.language === 'am' ? 'አጠቃላይ አማካይ' : 'Overall Average'}
                        </Text>
                        <Text style={[styles.overallVal, { color: color }]}>
                          {s.overallAvg.toFixed(1)}/100
                        </Text>
                      </View>
                    </View>
                  )}
                </Surface>
              );
            })
          )}
        </>
      )}

      {/* ════════════════════ TEACHER VIEW ════════════════════ */}
      {view === 'teacher' && (
        <>
          <View style={styles.sectionRow}>
            <MaterialCommunityIcons name="account-tie" size={15} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>{i18n.language === 'am' ? 'የዑስታዝ ሪፖርት' : 'TEACHER REPORTS'}</Text>
          </View>

          {ustazStats.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTxt}>{i18n.language === 'am' ? 'ምንም ዑስታዝ አልተገኘም' : 'No teacher data'}</Text>
            </View>
          ) : (
            ustazStats.map((u, idx) => {
              const color = getGradeColor(u.classAvg);
              const isExp = expandedUstaz === u.id;
              return (
                <Surface key={u.id} style={styles.teacherCard} elevation={isExp ? 3 : 1}>
                  <TouchableOpacity onPress={() => setExpandedUstaz(isExp ? null : u.id)} activeOpacity={0.8}>
                    <View style={styles.teacherHeader}>
                      <Avatar.Text size={44} label={(u.name || 'U').substring(0, 1)}
                        style={{ backgroundColor: idx === 0 ? COLORS.primary : '#e2e8f0' }}
                        color={idx === 0 ? 'white' : '#64748b'} />
                      <View style={styles.teacherInfo}>
                        <Text style={styles.teacherName}>{u.name}</Text>
                        <Text style={styles.teacherMeta}>
                          {u.students.length} {i18n.language === 'am' ? 'ተማሪዎች' : 'students'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <View style={[styles.avgBadge, { backgroundColor: color + '15' }]}>
                          <Text style={[styles.avgVal, { color: color }]}>{u.classAvg.toFixed(1)}/100</Text>
                        </View>
                        <Text style={styles.avgLbl}>{i18n.language === 'am' ? 'አማካይ' : 'avg'}</Text>
                      </View>
                      <MaterialCommunityIcons
                        name={isExp ? 'chevron-up' : 'chevron-down'}
                        size={20} color="#94a3b8" style={{ marginLeft: 8 }} />
                    </View>
                  </TouchableOpacity>

                  {isExp && (
                    <View style={styles.subjectBreakdown}>
                      <Divider style={{ marginBottom: 12 }} />
                      {u.students.map((st: any, si: number) => {
                        const sColor = getGradeColor(st.avg);
                        return (
                          <View key={st.student_id} style={[styles.tStudentRow, si % 2 === 0 && { backgroundColor: '#f8fafc' }]}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.studentName}>{st.student_name}</Text>
                              <Text style={styles.studentMeta}>
                                {st.subjects.map((sub: any) => sub.subject_name).join(' · ')}
                              </Text>
                            </View>
                            <Text style={[styles.scoreMain, { fontSize: 16, color: sColor }]}>{st.avg.toFixed(1)}</Text>
                            <Text style={styles.scoreOf}>/100</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </Surface>
              );
            })
          )}
        </>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingTxt: { color: '#94a3b8', fontWeight: '700' },

  header: {
    backgroundColor: COLORS.primaryDark,
    paddingHorizontal: 25, paddingTop: 55, paddingBottom: 30,
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
  },
  title: { color: 'white', fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', marginTop: 4 },
  headerStats: {
    flexDirection: 'row', marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 15,
  },
  hStat: { flex: 1, alignItems: 'center' },
  hStatVal: { color: 'white', fontSize: 22, fontWeight: '900' },
  hStatLbl: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700', marginTop: 2 },
  hStatDiv: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 5 },

  floatingSwitcherWrap: {
    marginTop: 15, marginHorizontal: 20, marginBottom: 15,
    backgroundColor: 'white', borderRadius: 20,
    padding: 6, elevation: 8, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10,
  },
  switcher: {
    flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 15, padding: 3,
  },
  switchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12 },
  switchBtnActive: { backgroundColor: COLORS.primary, elevation: 4, shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 5 },
  switchTxt: { fontSize: 13, fontWeight: '800', color: '#64748b' },
  switchTxtActive: { color: 'white' },

  teamFilterScroll: { paddingHorizontal: 18, paddingBottom: 15, gap: 10, paddingTop: 5 },
  teamBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 24, backgroundColor: 'white',
    borderWidth: 1.5, borderColor: '#e2e8f0',
    elevation: 2, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 3,
  },
  teamBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    elevation: 6, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  teamBtnTxt: { fontSize: 13, fontWeight: '800', color: '#64748b' },
  teamBtnTxtActive: { color: 'white' },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, marginBottom: 12, marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '900', color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase' },

  studentCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 24, backgroundColor: 'white', overflow: 'hidden', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  studentRow: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 10 },
  rankBadge: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankNum: { fontSize: 16, fontWeight: '900' },
  studentName: { fontSize: 15, fontWeight: '800', color: '#1e293b' },
  studentMeta: { fontSize: 11, color: '#94a3b8', fontWeight: '700', marginTop: 2 },
  scoreMain: { fontSize: 22, fontWeight: '900', color: '#0f172a' },
  scoreOf: { fontSize: 11, color: '#94a3b8', fontWeight: '700' },

  teacherCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 24, backgroundColor: 'white', overflow: 'hidden', borderLeftWidth: 4, borderLeftColor: COLORS.primary },
  teacherHeader: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 12 },
  teacherInfo: { flex: 1 },
  teacherName: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  teacherMeta: { fontSize: 11, color: '#94a3b8', fontWeight: '700', marginTop: 2 },
  avgBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  avgVal: { fontSize: 15, fontWeight: '900' },
  avgLbl: { fontSize: 10, color: '#94a3b8', fontWeight: '800', textAlign: 'right', marginTop: 2 },
  tStudentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6 },

  subjectBreakdown: { paddingHorizontal: 18, paddingBottom: 18 },
  breakdownTitle: { fontSize: 11, fontWeight: '900', color: '#94a3b8', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },
  subjectRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f8fafc', gap: 10 },
  subjectIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.primary + '12', alignItems: 'center', justifyContent: 'center' },
  subjectName: { fontSize: 14, fontWeight: '800', color: '#1e293b' },
  subjectUstaz: { fontSize: 12, color: '#94a3b8', fontWeight: '700', marginTop: 2 },
  subjectScore: { fontSize: 17, fontWeight: '900', marginRight: 8 },
  overallRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, paddingTop: 12, borderTopWidth: 2, borderTopColor: '#f1f5f9' },
  overallLabel: { fontSize: 13, fontWeight: '800', color: '#64748b' },
  overallVal: { fontSize: 18, fontWeight: '900' },

  emptyBox: { padding: 60, alignItems: 'center', gap: 15 },
  emptyTxt: { color: '#cbd5e1', fontWeight: '800', fontSize: 16 },

  teamBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  teamBadgeTxt: { fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },

  backBtn: { width: 35, height: 35, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});