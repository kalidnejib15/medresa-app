import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, TouchableWithoutFeedback, Dimensions, Image, Animated, StatusBar, ActivityIndicator as RNActivityIndicator } from 'react-native';
import { Text, Avatar, Divider, Surface, ActivityIndicator, ProgressBar, Button, Portal, Modal, TextInput, IconButton, Chip } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { useStudentStore } from '../../../src/store/useStudentStore';
import { useGradeStore } from '../../../src/store/useGradeStore';
import { useAuthStore } from '../../../src/store/useAuthStore';
import { useAttendanceStore } from '../../../src/store/useAttendanceStore';
import { useNuraniyahStore } from '../../../src/store/useNuraniyahStore';
import { useLevelStore } from '../../../src/store/useLevelStore';
import { COLORS } from '../../../src/constants';
import { uploadToCloudinary } from '../../../src/lib/cloudinary';

const { width } = Dimensions.get('window');

function getGradeColor(score: number) {
  if (score >= 90) return '#059669';
  if (score >= 80) return '#10b981';
  if (score >= 70) return COLORS.primary;
  if (score >= 60) return '#d97706';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function getStatusLabel(score: number) {
  if (score >= 90) return 'ELITE';
  if (score >= 75) return 'STABLE';
  if (score >= 50) return 'NEED FOCUS';
  return 'AT RISK';
}

// 🛡️ Escapes user-entered text before it's interpolated into the PDF's HTML,
// so names/addresses/notes containing <, >, & etc. can't break the layout.
function escapeHtml(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default function StudentDetailScreen() {
  const { id } = useLocalSearchParams();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s: any) => s.user);

  const { getStudent, deactivateStudent } = useStudentStore();
  const { fetchWeights } = useGradeStore();
  const { getStudentAttendanceSummary } = useAttendanceStore();
  const { getStudentNuraniyahSummary, ratingConfig } = useNuraniyahStore();

  const { levels, fetchLevels } = useLevelStore();
  const { updateStudent } = useStudentStore();

  // 🛡️ The levels table has one row per (name, gender) pair — e.g. Nuraniya has
  // both l1m and l1f. De-dupe by name for the chip UI so each level shows once,
  // and resolve back to the gender-correct row when the user picks one.
  const uniqueLevels = useMemo(() => {
    const seen = new Set<string>();
    return (levels || []).filter((l: any) => {
      if (seen.has(l.name)) return false;
      seen.add(l.name);
      return true;
    });
  }, [levels]);

  const [student, setStudent] = useState<any>(null);
  const [grades, setGrades] = useState<any[]>([]);
  const [quranLogs, setQuranLogs] = useState<any[]>([]);
  const [attendancePercent, setAttendancePercent] = useState<number>(0);
  const [nuraniyahSummary, setNuraniyahSummary] = useState<{
    percentage: number;
    totalEntries: number;
    excellentCount: number;
    goodCount: number;
    needsWorkCount: number;
    weakCategories: string[];
  }>({ percentage: 0, totalEntries: 0, excellentCount: 0, goodCount: 0, needsWorkCount: 0, weakCategories: [] });
  const [assignedSubjects, setAssignedSubjects] = useState<any[]>([]);
  const [subjectWeights, setSubjectWeights] = useState<any[]>([]);
  const [isKitabAssigned, setIsKitabAssigned] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [showEditModal, setShowEditModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  // 🛡️ FLICKER FIX: free-text fields live in a ref, not state, so typing never
  // re-renders this whole profile page (same fix as QuickGradeModal in students.tsx).
  // Only fields that need instant visual feedback (chips, photo) stay in editForm state.
  const editFormRef = useRef<any>({});
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  // 🛡️ Which unique level name the student's actual (gendered) level_id maps to,
  // so exactly one chip shows as selected in the edit modal.
  const currentLevelName = useMemo(() => {
    return levels.find((l: any) => l.id === editForm.level_id)?.name;
  }, [levels, editForm.level_id]);

  // 🛡️ Full-screen photo preview (tap-to-zoom) — shared by header avatar & edit modal thumbnail
  const [zoomVisible, setZoomVisible] = useState(false);
  const [zoomUri, setZoomUri] = useState<string | null>(null);
  const zoomFade = useRef(new Animated.Value(0)).current;
  const zoomScale = useRef(new Animated.Value(1)).current;
  const lastTapRef = useRef(0);

  const openPhotoZoom = (uri?: string | null) => {
    if (!uri) return;
    setZoomUri(uri);
    setZoomVisible(true);
    zoomScale.setValue(1);
    zoomFade.setValue(0);
    Animated.timing(zoomFade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  };

  const closePhotoZoom = () => {
    Animated.timing(zoomFade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setZoomVisible(false);
      setZoomUri(null);
    });
  };

  // Double-tap toggles a 2.2x zoom-in on the previewed photo
  const handleZoomImageTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      const target = (zoomScale as any)._value >= 2 ? 1 : 2.2;
      Animated.spring(zoomScale, { toValue: target, useNativeDriver: true, friction: 6 }).start();
    }
    lastTapRef.current = now;
  };

  // 🛡️ Admin-only: pick & upload a new/replacement photo directly from the dossier editor
  const handleEditPhotoPick = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(
        i18n.language === 'am' ? 'ፈቃድ ያስፈልጋል' : 'Permission Required',
        i18n.language === 'am' ? 'ፎቶ ለማስቀመጥ ፈቃድ ያስፈልጋል' : 'Photo access permission is required.'
      );
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
    if (result.canceled || !result.assets[0]) return;

    setIsPhotoUploading(true);
    const url = await uploadToCloudinary(result.assets[0].uri);
    setIsPhotoUploading(false);
    if (url) {
      setEditForm((prev: any) => ({ ...prev, photo_url: url }));
    } else {
      Alert.alert(
        i18n.language === 'am' ? 'ስህተት' : 'Upload Failed',
        i18n.language === 'am' ? 'ፎቶ ወደ ደመና ማስቀመጥ አልተሳካም' : 'Could not upload photo to the cloud. Please try again.'
      );
    }
  };

  useEffect(() => {
    if (user) loadData();
  }, [id, user]);

  const loadData = async () => {
    if (!id) return;
    setIsLoading(true);

    setStudent(null);
    setQuranLogs([]);
    setAssignedSubjects([]);
    setSubjectWeights([]);
    setGrades([]);
    setIsKitabAssigned(false);

    try {
      const studentId = Array.isArray(id) ? id[0] : id;
      const s = await getStudent(studentId);
      if (!s) throw new Error("Student not found");

      setStudent(s);
      setEditForm(s);
      // 🛡️ Seed the ref copy of free-text fields whenever the student (re)loads,
      // so re-opening the modal or saving-then-reloading always starts from the
      // latest server values instead of stale typed values from a previous open.
      editFormRef.current = {
        name_am: s.name_am,
        name_en: s.name_en,
        dob: s.dob,
        school_level: s.school_level,
        last_page_learnt: s.last_page_learnt,
        has_tutor: s.has_tutor,
        tutor_days: s.tutor_days,
        tutor_arrival_time: s.tutor_arrival_time,
        academic_year: s.academic_year,
        parent_name: s.parent_name,
        parent_phone: s.parent_phone,
        address: s.address,
        emergency_contact: s.emergency_contact,
        medical_notes: s.medical_notes,
        notes: s.notes,
      };
      fetchLevels();

      const db = await (await import('../../../src/lib/database')).getDatabase();

      // 1. Fetch Grades
      let gQuery = `
         SELECT sg.*, gw.name as weight_name, gw.weight as component_max, 
                sub.name as subject_name, sub.name_am as subject_name_am, sub.id as subject_id
         FROM student_grades sg
         JOIN grade_weights gw ON sg.weight_id = gw.id
         JOIN subjects sub ON gw.subject_id = sub.id
         WHERE sg.student_id = ?
      `;
      const gParams: any[] = [studentId];
      if (user?.role === 'ustaz') {
        gQuery += ' AND sg.ustaz_id = ?';
        gParams.push(user.id);
      }
      gQuery += ' ORDER BY sg.date DESC';
      const g = await db.getAllAsync<any>(gQuery, gParams);

      // 2. Fetch Progress Logs
      let qQuery = `
         SELECT sp.*, l.name as level_name 
         FROM student_progress sp
         LEFT JOIN levels l ON sp.level_id = l.id
         WHERE sp.student_id = ?
      `;
      const qParams: any[] = [studentId];
      if (user?.role === 'ustaz') {
        qQuery += ` AND ustaz_id = ?`;
        qParams.push(user.id);
      }
      qQuery += ` ORDER BY date DESC LIMIT 10`;
      const qLogs = await db.getAllAsync<any>(qQuery, qParams);

      const attSummary = await getStudentAttendanceSummary(studentId);
      const nurSummary = await getStudentNuraniyahSummary(studentId);

      setGrades(g || []);
      setQuranLogs(qLogs || []);
      setAttendancePercent(attSummary?.percentage || 0);
      setNuraniyahSummary({
        percentage: nurSummary?.percentage || 0,
        totalEntries: nurSummary?.totalEntries || 0,
        excellentCount: nurSummary?.excellentCount || 0,
        goodCount: nurSummary?.goodCount || 0,
        needsWorkCount: nurSummary?.needsWorkCount || 0,
        weakCategories: nurSummary?.weakCategories || [],
      });

      // 3. Fetch Teacher Details
      const quranTeacher = s.quran_teacher_id ? await db.getFirstAsync<any>(`SELECT name FROM users WHERE id = ?`, [s.quran_teacher_id]) : null;

      // Deep Scan for Kitab Teachers (Subject-specific links + Primary)
      const kitabLinks = await db.getAllAsync<any>(`
        SELECT DISTINCT u.name as teacher_name, s.name as subject_name 
        FROM users u
        JOIN teacher_student_links tsl ON u.id = tsl.teacher_id
        LEFT JOIN subjects s ON tsl.subject_id = s.id
        WHERE tsl.student_id = ?
      `, [studentId]);

      setStudent({
        ...s,
        quranTeacher: quranTeacher?.name,
        kitabAssignments: kitabLinks || []
      });

      let kitabCheck = false;
      if (user?.role === 'ustaz') {
        const linkCheck = await db.getFirstAsync<{ teacher_id: string }>(`SELECT teacher_id FROM teacher_student_links WHERE student_id = ? AND teacher_id = ?`, [studentId, user.id]);
        kitabCheck = s.kitab_teacher_id === user.id || !!linkCheck;
      } else {
        kitabCheck = true; // Admin sees everything
      }
      setIsKitabAssigned(kitabCheck);

      // 4. Fetch Targeted Subject Weights
      if (user?.role === 'admin' || kitabCheck) {
        let assSubs;
        if (user?.role === 'admin') {
          assSubs = await db.getAllAsync<any>(`
            SELECT DISTINCT s.* FROM subjects s
            JOIN teacher_student_links tsl ON s.id = tsl.subject_id
            WHERE tsl.student_id = ?
          `, [studentId]);
        } else {
          assSubs = await db.getAllAsync<any>(`
            SELECT DISTINCT s.* FROM subjects s
            JOIN teacher_student_links tsl ON s.id = tsl.subject_id
            WHERE tsl.student_id = ? AND tsl.teacher_id = ?
          `, [studentId, user?.id]);
        }
        setAssignedSubjects(assSubs || []);

        if (assSubs.length > 0) {
          const rawWeights = await db.getAllAsync<any>(`
             SELECT gw.*, s.name as subject_name, s.name_am as subject_name_am
             FROM grade_weights gw
             JOIN subjects s ON gw.subject_id = s.id
             WHERE gw.subject_id IN (${assSubs.map(() => '?').join(',')})
             ORDER BY gw.weight DESC
           `, assSubs.map(as => as.id));
          setSubjectWeights(rawWeights || []);
        }
      }
    } catch (e) {
      console.error(e);
      setStudent({ error: true });
    } finally {
      setIsLoading(false);
    }
  };

  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const generateStudentPDF = async () => {
    if (isGeneratingPDF || !student) return;
    setIsGeneratingPDF(true);
    try {
      const { printToFileAsync } = await import('expo-print');
      const { shareAsync } = await import('expo-sharing');
      const { LOGO_BASE64 } = require('../../../src/constants/logoBase64');

      // 🛡️ Photo is part of the dossier only when an admin is the one generating it —
      // mirrors the same admin-only rule used everywhere else the photo can appear.
      const showPhoto = user?.role === 'admin' && !!student.photo_url;

      const fullName = `${escapeHtml(student.name_am)} / ${escapeHtml(student.name_en)}`;
      const dobStr = student.dob ? new Date(student.dob).toLocaleDateString() : 'N/A';
      const enrollStr = student.enroll_date ? new Date(student.enroll_date).toLocaleDateString() : 'N/A';
      const genderStr = student.gender === 'male' ? 'Male' : 'Female';
      const kitabAssignmentsHtml = (student.kitabAssignments && student.kitabAssignments.length > 0)
        ? student.kitabAssignments.map((a: any) => `${escapeHtml(a.teacher_name)}${a.subject_name ? ` (${escapeHtml(a.subject_name)})` : ''}`).join('<br/>')
        : 'Not Assigned';

      const html = `
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
          <style>
            body { font-family: 'Helvetica'; padding: 40px; color: #1e293b; }
            .header { display: flex; align-items: center; gap: 20px; margin-bottom: 30px; border-bottom: 2px solid #0f172a; padding-bottom: 20px; }
            .header-brand { flex: 1; text-align: center; }
            .logo { width: 70px; height: 70px; }
            .school-name { font-size: 22px; font-weight: 900; color: #0f172a; }
            .report-title { font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 2px; margin-top: 4px; }
            .photo-box { width: 90px; height: 90px; border-radius: 8px; overflow: hidden; border: 2px solid #e2e8f0; flex-shrink: 0; }
            .photo-box img { width: 100%; height: 100%; object-fit: cover; }

            .section { margin-bottom: 26px; }
            .section-title { font-size: 12px; font-weight: 800; color: #0891b2; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
            .section-title.accent-red { color: #b91c1c; }
            .section-title.accent-amber { color: #b45309; }

            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 20px; }
            .info-item { margin-bottom: 4px; }
            .info-item.span-2 { grid-column: span 2; }
            .label { font-size: 9.5px; color: #94a3b8; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; }
            .value { font-size: 13.5px; font-weight: 700; color: #1e293b; margin-top: 2px; }
            .value.alert { color: #b91c1c; }
            .value.muted { color: #94a3b8; font-weight: 600; font-style: italic; }

            .notes-box { background: #fffbeb; border: 1px dashed #fde68a; border-radius: 8px; padding: 14px; font-size: 12.5px; color: #92400e; font-style: italic; }

            .stats-row { display: flex; justify-content: space-between; background: #f8fafc; padding: 18px; border-radius: 12px; margin-top: 6px; }
            .stat-box { text-align: center; }
            .stat-val { font-size: 17px; font-weight: 900; color: #0891b2; }
            .stat-lab { font-size: 9px; color: #64748b; font-weight: 700; }

            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th { text-align: left; font-size: 9.5px; color: #94a3b8; padding: 8px 10px; border-bottom: 2px solid #f1f5f9; text-transform: uppercase; }
            td { padding: 10px; font-size: 12.5px; border-bottom: 1px solid #f1f5f9; }
            .subject-name { font-weight: 800; }
            .score { font-weight: 900; text-align: right; }
            .empty-row td { text-align: center; color: #94a3b8; font-style: italic; padding: 16px; }

            .footer { margin-top: 40px; text-align: center; font-size: 9.5px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
          </style>
        </head>
        <body>
          <div class="header">
            ${showPhoto ? `<div class="photo-box"><img src="${student.photo_url}" /></div>` : ''}
            <div class="header-brand">
              <img src="${LOGO_BASE64}" class="logo" />
              <div class="school-name">Abubeker Medresa</div>
              <div class="report-title">Official Student Dossier</div>
            </div>
          </div>

          <!-- 1. IDENTITY -->
          <div class="section">
            <div class="section-title">Registration Identity</div>
            <div class="info-grid">
              <div class="info-item span-2">
                <div class="label">Full Name</div>
                <div class="value">${fullName}</div>
              </div>
              <div class="info-item">
                <div class="label">Date of Birth</div>
                <div class="value">${dobStr}</div>
              </div>
              <div class="info-item">
                <div class="label">Gender</div>
                <div class="value">${genderStr}</div>
              </div>
              <div class="info-item">
                <div class="label">Academic (Medresa) Level</div>
                <div class="value">${escapeHtml(student.level_name) || 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="label">Regular School Level</div>
                <div class="value">${escapeHtml(student.school_level) || 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="label">Enrolled Since</div>
                <div class="value">${enrollStr}</div>
              </div>
              <div class="info-item">
                <div class="label">Sponsorship (Yetim)</div>
                <div class="value">${student.is_yetim ? 'YES (Sponsored)' : 'NO (Standard Fee)'}</div>
              </div>
            </div>
          </div>

          <!-- 2. GUARDIAN & CONTACT -->
          <div class="section">
            <div class="section-title accent-amber">Guardian & Contact</div>
            <div class="info-grid">
              <div class="info-item">
                <div class="label">Guardian Name</div>
                <div class="value">${escapeHtml(student.parent_name) || 'N/A'}</div>
              </div>
              <div class="info-item">
                <div class="label">Contact Phone</div>
                <div class="value">${escapeHtml(student.parent_phone) || 'N/A'}</div>
              </div>
              <div class="info-item span-2">
                <div class="label">Residential Address</div>
                <div class="value">${escapeHtml(student.address) || 'Not Provided'}</div>
              </div>
            </div>
          </div>

          <!-- 3. HEALTH & EMERGENCY -->
          <div class="section">
            <div class="section-title accent-red">Emergency & Health</div>
            <div class="info-grid">
              <div class="info-item span-2">
                <div class="label">Emergency Contact</div>
                <div class="value">${escapeHtml(student.emergency_contact) || 'None Listed'}</div>
              </div>
              <div class="info-item span-2">
                <div class="label">Medical Notes</div>
                <div class="value ${student.medical_notes ? 'alert' : 'muted'}">${escapeHtml(student.medical_notes) || 'No critical health conditions reported.'}</div>
              </div>
            </div>
          </div>

          <!-- 4. FACULTY ASSIGNMENTS -->
          <div class="section">
            <div class="section-title">Faculty Assignments</div>
            <div class="info-grid">
              <div class="info-item">
                <div class="label">Quran Teacher</div>
                <div class="value">${escapeHtml(student.quranTeacher) || 'Not Assigned'}</div>
              </div>
              <div class="info-item">
                <div class="label">Kitab Faculty</div>
                <div class="value">${kitabAssignmentsHtml}</div>
              </div>
            </div>
          </div>

          ${student.notes ? `
          <!-- 5. INSTITUTIONAL NOTES -->
          <div class="section">
            <div class="section-title">Institutional Notes</div>
            <div class="notes-box">"${escapeHtml(student.notes)}"</div>
          </div>
          ` : ''}

          <!-- 6. ACADEMIC SUMMARY (APPENDIX) -->
          <div class="section" style="margin-top: 34px;">
            <div class="section-title">Academic Summary</div>
            <div class="stats-row">
              <div class="stat-box">
                <div class="stat-val">${masterGpa}%</div>
                <div class="stat-lab">ACADEMIC GPA</div>
              </div>
              <div class="stat-box">
                <div class="stat-val">${attendancePercent}%</div>
                <div class="stat-lab">ATTENDANCE</div>
              </div>
              <div class="stat-box">
                <div class="stat-val">${subjectAnalysis.length}</div>
                <div class="stat-lab">SUBJECTS</div>
              </div>
              ${nuraniyahSummary.totalEntries > 0 ? `
              <div class="stat-box">
                <div class="stat-val">${nuraniyahSummary.percentage}%</div>
                <div class="stat-lab">NURANIYAH</div>
              </div>
              ` : ''}
            </div>
            ${nuraniyahSummary.weakCategories.length > 0 ? `
            <div class="notes-box" style="margin-top: 12px;">
              Needs extra attention in: ${escapeHtml(nuraniyahSummary.weakCategories.join(', '))}
            </div>
            ` : ''}
          </div>

          <div class="section">
            <div class="section-title">Kitab Academic Tracking</div>
            <table>
              <thead>
                <tr>
                  <th>SUBJECT</th>
                  <th style="text-align: right;">MASTERY STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${subjectAnalysis.length > 0 ? subjectAnalysis.map(s => `
                  <tr>
                    <td class="subject-name">${escapeHtml(s.name)}</td>
                    <td class="score" style="color: ${getGradeColor(s.avg)};">${s.avg}%</td>
                  </tr>
                `).join('') : `<tr class="empty-row"><td colspan="2">No subjects recorded.</td></tr>`}
              </tbody>
            </table>
          </div>

          <div class="section">
            <div class="section-title">Recent Quranic Progress</div>
            <table>
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>LEVEL</th>
                  <th style="text-align: right;">PROGRESSION</th>
                </tr>
              </thead>
              <tbody>
                ${quranLogs.length > 0 ? quranLogs.map(log => `
                  <tr>
                    <td>${new Date(log.date).toLocaleDateString()}</td>
                    <td>${escapeHtml(log.level_name) || 'N/A'}</td>
                    <td style="text-align: right; font-weight: 800;">Page: ${log.page_number || '-'} (${log.ayah_from || 'S'}-${log.ayah_to || 'E'})</td>
                  </tr>
                `).join('') : `<tr class="empty-row"><td colspan="3">No progress logs recorded.</td></tr>`}
              </tbody>
            </table>
          </div>

          <div class="footer">
            This is an official document generated by the Abubeker Medresa Management System.<br/>
            Date of Issue: ${new Date().toLocaleDateString()}
          </div>
        </body>
      </html>
      `;
      const { uri } = await printToFileAsync({ html });
      await shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) { Alert.alert('Error', 'PDF failed'); } finally { setIsGeneratingPDF(false); }
  };

  const subjectAnalysis = useMemo(() => {
    const map: Record<string, { id: string, name: string, grades: any[], totalScore: number, totalMax: number, avg: number }> = {};
    const getSubjectTitle = (item: any) => item.name_am || item.name || item.subject_name_am || item.subject_name || 'Unknown';

    // 1. Pre-fill with all assigned subjects to ensure "slots" are visible
    assignedSubjects.forEach(sub => {
      const key = getSubjectTitle(sub);
      map[key] = { id: sub.id, name: key, grades: [], totalScore: 0, totalMax: 0, avg: 0 };
    });

    // 2. Aggregate actual grades
    grades.forEach(g => {
      const key = getSubjectTitle(g);
      if (!map[key]) {
        map[key] = { id: g.subject_id, name: key, grades: [], totalScore: 0, totalMax: 0, avg: 0 };
      }
      map[key].grades.push(g);
    });

    return Object.values(map).map(s => {
      const score = s.grades.reduce((acc, curr) => acc + curr.score, 0);
      const max = s.grades.reduce((acc, curr) => acc + (curr.component_max || 0), 0);
      return { ...s, totalScore: score, totalMax: max, avg: max > 0 ? Math.round((score / max) * 100) : 0 };
    });
  }, [grades, assignedSubjects]);

  const masterGpa = useMemo(() => {
    if (subjectAnalysis.length === 0) return 0;
    return Math.round(subjectAnalysis.reduce((acc, curr) => acc + curr.avg, 0) / subjectAnalysis.length);
  }, [subjectAnalysis]);

  const currentId = Array.isArray(id) ? id[0] : id;

  if (isLoading || !student || student.id !== currentId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 15, color: '#64748b', fontWeight: '600' }}>{i18n.language === 'am' ? 'የተማሪ መዝገብ በመዘጋጀት ላይ...' : 'Fetching Student Dossier...'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Surface style={styles.header} elevation={4}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><MaterialCommunityIcons name="arrow-left" size={26} color="white" /></TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.language === 'am' ? 'የተማሪ መዝገብ' : 'Student Dossier'}</Text>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {user?.role === 'admin' && <IconButton icon="pencil-outline" iconColor="white" onPress={() => setShowEditModal(true)} />}
            <TouchableOpacity onPress={generateStudentPDF}><MaterialCommunityIcons name="file-document-outline" size={24} color="white" /></TouchableOpacity>
          </View>
        </View>

        <View style={styles.profileRow}>
          {/* 🛡️ Photo is admin-only; every other role always sees the initials avatar */}
          {user?.role === 'admin' && student.photo_url ? (
            <TouchableOpacity activeOpacity={0.85} onPress={() => openPhotoZoom(student.photo_url)}>
              <Avatar.Image size={72} source={{ uri: student.photo_url }} style={styles.avatar} />
            </TouchableOpacity>
          ) : (
            <Avatar.Text size={72} label={student.name_am.substring(0, 1)} style={styles.avatar} color={COLORS.primary} labelStyle={{ fontWeight: '900' }} />
          )}
          <View style={styles.profileInfo}>
            <Text style={styles.nameAm}>{student.name_am}</Text>
            <Text style={styles.nameEn}>{student.name_en}</Text>
            <View style={styles.statsRow}>
              {user?.role !== 'finance' && (
                <View style={[styles.statusBadge, { backgroundColor: getGradeColor(masterGpa) + '25' }]}>
                  <View style={[styles.statusDot, { backgroundColor: getGradeColor(masterGpa) }]} />
                  <Text style={[styles.statusTxt, { color: getGradeColor(masterGpa) }]}>{getStatusLabel(masterGpa)}</Text>
                </View>
              )}
              <Text style={styles.levelTxt}>{student.level_name}</Text>
            </View>
          </View>
        </View>

        {user?.role !== 'finance' && (
          <View style={styles.statsBar}>
            <View style={styles.statItem}><Text style={styles.statVal}>{masterGpa}%</Text><Text style={styles.statLab}>GPA</Text></View>
            <View style={styles.vDivider} />
            <View style={styles.statItem}><Text style={styles.statVal}>{subjectAnalysis.length}</Text><Text style={styles.statLab}>Subjects</Text></View>
            <View style={styles.vDivider} />
            <View style={styles.statItem}><Text style={styles.statVal}>{attendancePercent}%</Text><Text style={styles.statLab}>Attendance</Text></View>
            {nuraniyahSummary.totalEntries > 0 && (
              <>
                <View style={styles.vDivider} />
                <View style={styles.statItem}><Text style={styles.statVal}>{nuraniyahSummary.percentage}%</Text><Text style={styles.statLab}>Nuraniyah</Text></View>
              </>
            )}
          </View>
        )}
      </Surface>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 50 }}>
        <View style={styles.body}>

          {/* ── REGISTRATION & FACULTY (ADMIN & FINANCE VIEW) ── */}
          {user?.role !== 'ustaz' && (
            <>
              {/* 1. PERSONAL VITAL DETAILS */}
              <Surface style={styles.regCard} elevation={1}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="account-details-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.cardTitle}>PERSONAL VITAL DETAILS</Text>
                </View>
                <View style={styles.regGrid}>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>DATE OF BIRTH</Text>
                    <Text style={styles.regVal}>{student.dob || '---'}</Text>
                  </View>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>GENDER</Text>
                    <Text style={styles.regVal}>{student.gender === 'male' ? 'Male' : 'Female'}</Text>
                  </View>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>SCHOOL LEVEL</Text>
                    <Text style={styles.regVal}>{student.school_level || 'N/A'}</Text>
                  </View>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>ENROLLED SINCE</Text>
                    <Text style={styles.regVal}>{student.enroll_date ? new Date(student.enroll_date).toLocaleDateString() : 'N/A'}</Text>
                  </View>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>Sponsorship (Yetim)</Text>
                    <Text style={[styles.regVal, { color: student.is_yetim ? '#16a34a' : '#64748b' }]}>
                      {student.is_yetim ? 'YES (SPONSORED)' : 'NO (STANDARD FEE)'}
                    </Text>
                  </View>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>{i18n.language === 'am' ? 'የቀሩት ገጽ (ቂርዓት)' : 'QIR\'AT LAST PAGE'}</Text>
                    <Text style={styles.regVal}>{student.last_page_learnt || '---'}</Text>
                  </View>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>{i18n.language === 'am' ? 'የአካዳሚክ አስጠኚ' : 'ACADEMIC TUTOR'}</Text>
                    <Text style={[styles.regVal, { color: student.has_tutor ? '#d97706' : '#64748b' }]}>
                      {student.has_tutor ? (student.tutor_days ? `Yes (${student.tutor_days}${student.tutor_arrival_time ? ' @ ' + student.tutor_arrival_time : ''})` : 'Yes') : 'No'}
                    </Text>
                  </View>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>{i18n.language === 'am' ? 'የትምህርት ዘመን' : 'ACADEMIC YEAR'}</Text>
                    <Text style={styles.regVal}>{student.academic_year || '2019'}</Text>
                  </View>
                </View>
              </Surface>

              {/* 2. REGISTRATION IDENTITY */}
              <Surface style={[styles.regCard, { borderLeftColor: '#f59e0b' }]} elevation={1}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="card-account-details-outline" size={20} color="#f59e0b" />
                  <Text style={[styles.cardTitle, { color: '#f59e0b' }]}>
                    {i18n.language === 'am' ? 'የምዝገባ መረጃ' : 'REGISTRATION IDENTITY'}
                  </Text>
                </View>
                <View style={styles.regGrid}>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>{i18n.language === 'am' ? 'የቤተሰብ/የአሳዳጊ ስም' : 'GUARDIAN NAME'}</Text>
                    <Text style={styles.regVal}>{student.parent_name || '---'}</Text>
                  </View>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>{i18n.language === 'am' ? 'ስልክ ቁጥር' : 'PRIMARY CONTACT'}</Text>
                    <Text style={styles.regVal}>{student.parent_phone || '---'}</Text>
                  </View>
                  <View style={[styles.regItem, styles.addressItem]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <MaterialCommunityIcons name="map-marker-outline" size={13} color="#94a3b8" />
                      <Text style={[styles.regLabel, { marginBottom: 0 }]}>{i18n.language === 'am' ? 'የመኖሪያ አድራሻ' : 'RESIDENTIAL ADDRESS'}</Text>
                    </View>
                    <Text style={[styles.regVal, styles.addressVal]}>{student.address || (i18n.language === 'am' ? 'አልተጠቀሰም' : 'Not Provided')}</Text>
                  </View>
                </View>
              </Surface>

              {/* 3. EMERGENCY & HEALTH */}
              <Surface style={[styles.regCard, { borderLeftColor: '#ef4444' }]} elevation={1}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="hospital-box-outline" size={20} color="#ef4444" />
                  <Text style={[styles.cardTitle, { color: '#ef4444' }]}>
                    {i18n.language === 'am' ? 'የድንገተኛ አደጋ እና ጤና' : 'EMERGENCY & HEALTH'}
                  </Text>
                </View>
                <View style={styles.regGrid}>
                  <View style={styles.regItem}>
                    <Text style={styles.regLabel}>{i18n.language === 'am' ? 'የድንገተኛ አደጋ ተጠሪ' : 'EMERGENCY CONTACT'}</Text>
                    <Text style={styles.regVal}>{student.emergency_contact || (i18n.language === 'am' ? 'አልተመዘገበም' : 'None Listed')}</Text>
                  </View>
                  <View style={[styles.regItem, { width: '100%' }]}>
                    <Text style={styles.regLabel}>{i18n.language === 'am' ? 'የጤና ማስታወሻ' : 'MEDICAL NOTES'}</Text>
                    <Text style={[styles.regVal, { fontSize: 14.5, lineHeight: 20, color: student.medical_notes ? '#ef4444' : '#64748b' }]}>
                      {student.medical_notes || (i18n.language === 'am' ? 'ምንም አይነት የጤና ችግር አልተመዘገበም' : 'No critical health conditions reported.')}
                    </Text>
                  </View>
                </View>
              </Surface>

              {user?.role === 'admin' && (
                <Surface style={styles.facultyCard} elevation={1}>
                  <View style={styles.cardHeader}>
                    <MaterialCommunityIcons name="school" size={20} color="#0891b2" />
                    <Text style={[styles.cardTitle, { color: '#0891b2' }]}>
                      {i18n.language === 'am' ? 'የመምህራን ድልድል' : 'FACULTY ASSIGNMENTS'}
                    </Text>
                  </View>
                  <View style={styles.facultyRow}>
                    <View style={styles.facultyItem}>
                      <View style={styles.facultyIconBox}>
                        <MaterialCommunityIcons name="star-crescent" size={18} color="#0891b2" />
                      </View>
                      <View>
                        <Text style={styles.facultyLabel}>{i18n.language === 'am' ? 'የቁርአን መምህር' : 'QURAN TEACHER'}</Text>
                        <Text style={styles.facultyName}>{student.quranTeacher || (i18n.language === 'am' ? 'አልተመደበም' : 'Not Assigned')}</Text>
                      </View>
                    </View>

                    <View style={styles.vLine} />

                    <View style={[styles.facultyItem, { alignItems: 'flex-start' }]}>
                      <View style={[styles.facultyIconBox, { backgroundColor: '#f0f9ff' }]}>
                        <MaterialCommunityIcons name="book-open-page-variant" size={18} color="#0ea5e9" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.facultyLabel}>{i18n.language === 'am' ? 'የኪታብ መምህራን' : 'KITAB FACULTY'}</Text>
                        {student.kitabAssignments && student.kitabAssignments.length > 0 ? (
                          student.kitabAssignments.map((assign: any, idx: number) => (
                            <View key={idx} style={{ marginBottom: idx === student.kitabAssignments.length - 1 ? 0 : 5 }}>
                              <Text style={styles.facultyName}>{assign.teacher_name}</Text>
                              {assign.subject_name && (
                                <Text style={[styles.facultyLabel, { fontSize: 7, marginTop: 1, color: '#94a3b8' }]}>{assign.subject_name.toUpperCase()}</Text>
                              )}
                            </View>
                          ))
                        ) : (
                          <Text style={styles.facultyName}>{i18n.language === 'am' ? 'አልተመደበም' : 'Not Assigned'}</Text>
                        )}
                      </View>
                    </View>
                  </View>
                </Surface>
              )}

              {/* ── INSTITUTIONAL NOTES ── */}
              {student.notes && (
                <View style={{ marginBottom: 25 }}>
                  <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>INSTITUTIONAL NOTES</Text></View>
                  <Surface style={[styles.card, { backgroundColor: '#fffbeb', borderStyle: 'dashed', borderWidth: 1, borderColor: '#fde68a' }]} elevation={1}>
                    <Text style={{ fontSize: 13, color: '#92400e', lineHeight: 18 }}>"{student.notes}"</Text>
                  </Surface>
                </View>
              )}
            </>
          )}

          {user?.role === 'ustaz' && (
            <Surface style={styles.teacherBrief} elevation={1}>
              <View style={styles.briefHeader}>
                <MaterialCommunityIcons name="account-tie-voice" size={20} color={COLORS.primary} />
                <Text style={styles.briefTitle}>
                  {i18n.language === 'am' ? 'መምህሩ ሊያውቃቸው የሚገቡ መረጃዎች' : "TEACHER'S BRIEF & SAFETY"}
                </Text>
              </View>
              <View style={{ gap: 10 }}>
                <Text style={styles.briefLab}>{i18n.language === 'am' ? 'ወላጅ: ' : 'Parent: '} <Text style={styles.briefVal}>{student.parent_name || 'N/A'}</Text></Text>
                <Text style={styles.briefLab}>{i18n.language === 'am' ? 'ስልክ: ' : 'Contact: '} <Text style={styles.briefVal}>{student.parent_phone || 'N/A'}</Text></Text>
                <View style={{ height: 1, backgroundColor: '#f1f5f9', marginVertical: 5 }} />
                <Text style={[styles.briefLab, { color: student.medical_notes ? '#ef4444' : '#64748b' }]}>
                  {i18n.language === 'am' ? 'የጤና ሁኔታ: ' : 'Medical Alert: '}
                  <Text style={[styles.briefVal, { color: student.medical_notes ? '#ef4444' : '#1e293b' }]}>
                    {student.medical_notes || (i18n.language === 'am' ? 'ምንም' : 'None reported')}
                  </Text>
                </Text>
              </View>
            </Surface>
          )}

          {/* ── ACADEMIC PROGRESS (HIDDEN FOR FINANCE) ── */}
          {user?.role !== 'finance' && (
            <>
              {/* ── QURAN SECTION (DYNAMO) ── */}
              {(quranLogs.length > 0 || student.quran_teacher_id) && (
                <>
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionTitle}>
                      {i18n.language === 'am' ? 'የቁርአን የየቀን ክትትል' : 'QURAN DAILY TRACKING'}
                    </Text>
                  </View>
                  {quranLogs.length > 0 ? (
                    <Surface style={styles.timelineCard} elevation={1}>
                      {quranLogs.map((log, idx) => (
                        <View key={idx} style={styles.timelineItem}>
                          <View style={styles.timelineDotLine}>
                            <View style={styles.tDot} />
                            {idx !== quranLogs.length - 1 && <View style={styles.tLine} />}
                          </View>
                          <View style={styles.logContent}>
                            <View style={styles.logHeader}>
                              <Text style={styles.logDate}>{new Date(log.date).toLocaleDateString()}</Text>
                              <Text style={styles.logLevel}>{log.level_name || 'N/A'}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 }}>
                              <View style={styles.logBadge}>
                                <Text style={styles.logBadgeTxt}>
                                  {i18n.language === 'am' ? 'ገጽ ' : 'PAGE '}{log.page_number || '---'}
                                </Text>
                              </View>
                              <Text style={styles.logAyah}>
                                {log.ayah_from ? `${i18n.language === 'am' ? 'አያህ' : 'Ayah'} ${log.ayah_from} - ${log.ayah_to}` : (i18n.language === 'am' ? 'ተከታታይ ንባብ' : 'Continuous Reading')}
                              </Text>
                              <View style={{ flexDirection: 'row', marginLeft: 'auto' }}>
                                {[1, 2, 3, 4, 5].map(s => (
                                  <MaterialCommunityIcons key={s} name="star" size={12} color={log.rating >= s ? '#eab308' : '#e2e8f0'} />
                                ))}
                              </View>
                            </View>
                            {log.lesson_details && <Text style={styles.logNotes}>"{log.lesson_details}"</Text>}
                          </View>
                        </View>
                      ))}
                    </Surface>
                  ) : (
                    <Surface style={styles.timelineCard} elevation={1}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 10 }}>
                        <View style={[styles.tDot, { backgroundColor: '#94a3b8' }]} />
                        <View>
                          <Text style={{ fontWeight: '800', color: '#1e293b' }}>{student.level_name}</Text>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', marginTop: 4 }}>Awaiting first progress entry</Text>
                        </View>
                      </View>
                    </Surface>
                  )}
                </>
              )}

              {/* ── NURANIYAH PROGRESS TREND (uses getStudentNuraniyahSummary) ──
                  Previously this summary was only surfaced as a single % badge in the
                  header stat bar, and the breakdown/weak-categories only appeared inside
                  the PDF export — there was no in-app view a teacher could glance at
                  during a parent-teacher conversation. This card shows the full picture. */}
              {nuraniyahSummary.totalEntries > 0 && (
                <>
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionTitle}>
                      {i18n.language === 'am' ? 'የኑራንያ አጠቃላይ አዝማሚያ' : 'NURANIYAH PROGRESS TREND'}
                    </Text>
                  </View>
                  <Surface style={styles.card} elevation={1}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
                      <View>
                        <Text style={styles.subjectName}>
                          {i18n.language === 'am' ? 'አጠቃላይ አፈጻጸም' : 'Overall Performance'}
                        </Text>
                        <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '800' }}>
                          {nuraniyahSummary.totalEntries} {i18n.language === 'am' ? 'ግቤቶች' : 'entries recorded'}
                        </Text>
                      </View>
                      <Text style={[styles.subjectAvg, { color: getGradeColor(nuraniyahSummary.percentage) }]}>
                        {nuraniyahSummary.percentage}%
                      </Text>
                    </View>
                    <ProgressBar progress={nuraniyahSummary.percentage / 100} color={getGradeColor(nuraniyahSummary.percentage)} style={{ height: 6, borderRadius: 3 }} />

                    {/* Rating breakdown */}
                    <View style={{ flexDirection: 'row', marginTop: 18, gap: 10 }}>
                      {([
                        ['excellent', nuraniyahSummary.excellentCount],
                        ['good', nuraniyahSummary.goodCount],
                        ['needs_work', nuraniyahSummary.needsWorkCount],
                      ] as const).map(([key, count]) => (
                        <View key={key} style={{ flex: 1, alignItems: 'center', backgroundColor: ratingConfig[key].bg, borderRadius: 10, paddingVertical: 10 }}>
                          <Text style={{ fontSize: 18 }}>{ratingConfig[key].emoji}</Text>
                          <Text style={{ fontWeight: '900', fontSize: 15, color: ratingConfig[key].color, marginTop: 2 }}>{count}</Text>
                          <Text style={{ fontSize: 9, fontWeight: '800', color: ratingConfig[key].color, marginTop: 1, textAlign: 'center' }}>
                            {i18n.language === 'am' ? ratingConfig[key].label_am : ratingConfig[key].label_en}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* Weak categories flag — useful for parent-teacher conferences */}
                    {nuraniyahSummary.weakCategories.length > 0 && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 15, backgroundColor: '#fffbeb', borderRadius: 10, padding: 10 }}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#b45309" />
                        <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: '#92400e' }}>
                          {i18n.language === 'am'
                            ? `ተጨማሪ ትኩረት የሚያስፈልገው: ${nuraniyahSummary.weakCategories.join(', ')}`
                            : `Needs extra attention in: ${nuraniyahSummary.weakCategories.join(', ')}`}
                        </Text>
                      </View>
                    )}
                  </Surface>
                </>
              )}

              {/* ── KITAB SECTION (DYNAMO) ── */}
              {subjectAnalysis.length > 0 && (
                <>
                  <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>KITAB ACADEMIC ANALYTICS</Text></View>
                  {subjectAnalysis.map((s, idx) => (
                    <Surface key={idx} style={styles.card} elevation={1}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
                        <View>
                          <Text style={styles.subjectName}>{s.name}</Text>
                          <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '800' }}>{s.grades.length > 0 ? 'ACTIVE PROGRESS' : 'ENROLLED'}</Text>
                        </View>
                        <Text style={[styles.subjectAvg, { color: getGradeColor(s.avg) }]}>{s.avg}%</Text>
                      </View>
                      <ProgressBar progress={s.avg / 100} color={getGradeColor(s.avg)} style={{ height: 6, borderRadius: 3 }} />

                      <View style={{ marginTop: 15, gap: 10 }}>
                        {subjectWeights.filter(sw => sw.subject_id === s.id).map((weight, wi) => {
                          const grade = s.grades.find(g => g.weight_id === weight.id);
                          return (
                            <View key={wi} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '600' }}>{weight.name}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                {grade ? (
                                  <Text style={{ fontWeight: '800', color: '#1e293b' }}>{grade.score}/{weight.weight}</Text>
                                ) : (
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#cbd5e1' }}>-- / {weight.weight}</Text>
                                )}
                              </View>
                            </View>
                          );
                        })}
                        {subjectWeights.filter(sw => sw.subject_id === s.id).length === 0 && (
                          <Text style={{ fontStyle: 'italic', color: '#94a3b8', fontSize: 12 }}>
                            {i18n.language === 'am' ? 'ለዚህ ትምህርት የውጤት መዋቅር አልተዘጋጀም' : 'No Marka structure defined for this subject.'}
                          </Text>
                        )}
                      </View>
                    </Surface>
                  ))}
                </>
              )}
            </>
          )}

          {user?.role === 'admin' && (
            <Surface style={[styles.card, { borderTopWidth: 4, borderTopColor: '#ef4444', marginTop: 30 }]} elevation={1}>
              <Text style={{ color: '#ef4444', fontWeight: '900', marginBottom: 10 }}>
                {i18n.language === 'am' ? 'ጥንቃቄ የሚሹ ተግባራት' : 'DANGER ZONE'}
              </Text>
              <Button mode="outlined" textColor="#ef4444" style={{ borderColor: '#ef4444' }} icon="delete" onPress={() => {
                Alert.alert(
                  i18n.language === 'am' ? 'ይጥፋ?' : 'Delete?',
                  i18n.language === 'am' ? 'ይህ ተማሪ ከዝርዝር ውስጥ እንዲወጣ ይፈልጋሉ?' : 'Remove all records?', [
                  { text: i18n.language === 'am' ? 'ተመለስ' : 'Cancel' },
                  { text: i18n.language === 'am' ? 'አጥፋ' : 'Delete', onPress: async () => { await deactivateStudent(student.id); router.back(); } }
                ]);
              }}>
                {i18n.language === 'am' ? 'ተማሪውን ከዝርዝር አስወግድ' : 'Deactivate Student'}
              </Button>
            </Surface>
          )}

        </View>
      </ScrollView>

      <Portal>
        <Modal visible={showEditModal} onDismiss={() => !isUpdating && setShowEditModal(false)} contentContainerStyle={styles.editModal}>
          <ScrollView>
            <Text style={styles.modalTitle}>
              {i18n.language === 'am' ? 'የምዝገባ ማስተካከያ' : 'Master Registration Editor'}
            </Text>

            {/* 🛡️ PHOTO — admin only, mirrors the registration form's photo picker */}
            <Text style={styles.modalSectionLabel}>
              {i18n.language === 'am' ? 'የተማሪ ፎቶ' : 'Student Photo'}
            </Text>
            <View style={styles.editPhotoRow}>
              <TouchableOpacity
                activeOpacity={editForm.photo_url && !isPhotoUploading ? 0.8 : 1}
                disabled={!editForm.photo_url || isPhotoUploading}
                onPress={() => openPhotoZoom(editForm.photo_url)}
              >
                <View style={styles.editPhotoCircle}>
                  {isPhotoUploading ? (
                    <RNActivityIndicator color={COLORS.primary} size="small" />
                  ) : editForm.photo_url ? (
                    <Image source={{ uri: editForm.photo_url }} style={styles.editPhotoImg} />
                  ) : (
                    <MaterialCommunityIcons name="account-circle-outline" size={44} color="#cbd5e1" />
                  )}
                </View>
              </TouchableOpacity>
              <View style={{ flex: 1, gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button mode="outlined" compact icon="camera-plus-outline" disabled={isPhotoUploading} onPress={() => handleEditPhotoPick(true)}>
                    {i18n.language === 'am' ? 'ካሜራ' : 'Camera'}
                  </Button>
                  <Button mode="outlined" compact icon="image-plus" disabled={isPhotoUploading} onPress={() => handleEditPhotoPick(false)}>
                    {i18n.language === 'am' ? 'ማዕከል' : 'Gallery'}
                  </Button>
                </View>
                {!!editForm.photo_url && (
                  <Text style={{ fontSize: 11, color: '#16a34a', fontWeight: '700' }}>
                    {i18n.language === 'am' ? 'ፎቶ ወደ ደመና ተሰቅሏል' : 'Photo uploaded to cloud'}
                  </Text>
                )}
              </View>
            </View>

            <TextInput key={`name_am_${student?.id}`} label={i18n.language === 'am' ? 'ስም (በአማርኛ)' : 'Name (Amharic)'} defaultValue={editFormRef.current.name_am || ''} onChangeText={v => { editFormRef.current.name_am = v; }} mode="outlined" style={styles.input} />
            <TextInput key={`name_en_${student?.id}`} label={i18n.language === 'am' ? 'ስም (በእንግሊዝኛ)' : 'Name (English)'} defaultValue={editFormRef.current.name_en || ''} onChangeText={v => { editFormRef.current.name_en = v; }} mode="outlined" style={styles.input} />

            <Text style={styles.modalSectionLabel}>{i18n.language === 'am' ? 'ጾታ:' : 'Gender:'}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {(['male', 'female'] as const).map(g => (
                <Chip
                  key={g}
                  selected={editForm.gender === g}
                  onPress={() => {
                    // 🛡️ When gender flips, re-resolve the currently selected level to its
                    // matching gendered row so the registered level never silently drifts.
                    const curLevelName = levels.find((lv: any) => lv.id === editForm.level_id)?.name;
                    const match = curLevelName ? levels.find((lv: any) => lv.name === curLevelName && lv.gender === g) : null;
                    setEditForm({ ...editForm, gender: g, level_id: match?.id || editForm.level_id });
                  }}
                  style={{ backgroundColor: editForm.gender === g ? (g === 'male' ? '#1e40af' : '#9d174d') : '#f1f5f9' }}
                  textStyle={{ color: editForm.gender === g ? 'white' : '#475569', fontWeight: '700' }}
                >
                  {g === 'male' ? (i18n.language === 'am' ? 'ወንድ' : 'Male') : (i18n.language === 'am' ? 'ሴት' : 'Female')}
                </Chip>
              ))}
            </View>

            <Text style={{ fontWeight: '800', marginTop: 4, marginBottom: 10 }}>
              {i18n.language === 'am' ? 'የትምህርት ደረጃ:' : 'Academic Level:'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {uniqueLevels.map((l: any) => (
                <Chip
                  key={l.name}
                  selected={currentLevelName === l.name}
                  onPress={() => {
                    // 🛡️ Resolve to the level row matching the student's current gender —
                    // each level name (Nuraniya, Quran 1, Quran 2, Hifz) has a male & female row.
                    const match = levels.find((lv: any) => lv.name === l.name && lv.gender === editForm.gender)
                      || levels.find((lv: any) => lv.name === l.name);
                    setEditForm({ ...editForm, level_id: match?.id || l.id });
                  }}
                  selectedColor="white"
                >{l.name}</Chip>
              ))}
            </View>

            <Divider style={{ marginVertical: 20 }} />
            <Text style={{ fontWeight: '800', marginBottom: 10 }}>
              {i18n.language === 'am' ? 'የጤና እና የግል መረጃ:' : 'Vitals & Health:'}
            </Text>
            <TextInput key={`dob_${student?.id}`} label={i18n.language === 'am' ? 'የተወለዱበት ቀን (YYYY-MM-DD)' : 'Date of Birth (YYYY-MM-DD)'} defaultValue={editFormRef.current.dob || ''} onChangeText={v => { editFormRef.current.dob = v; }} mode="outlined" style={styles.input} />
            <TextInput key={`school_level_${student?.id}`} label={i18n.language === 'am' ? 'አካዳሚክ ትምህርት ቤት ደረጃ' : 'Regular School Level'} defaultValue={editFormRef.current.school_level || ''} onChangeText={v => { editFormRef.current.school_level = v; }} mode="outlined" style={styles.input} placeholder={i18n.language === 'am' ? 'ለምሳሌ 5ኛ ክፍል' : 'e.g. 5th Grade'} />
            <TextInput key={`last_page_learnt_${student?.id}`} label={i18n.language === 'am' ? 'የመጨረሻ የቀሩት ገጽ (ቂርዓት / ኑራኒያ / ቁርአን)' : 'Last Page Learnt in Qir\'at'} defaultValue={editFormRef.current.last_page_learnt || ''} onChangeText={v => { editFormRef.current.last_page_learnt = v; }} mode="outlined" style={styles.input} placeholder={i18n.language === 'am' ? 'ምሳሌ፡ ኑራኒያ ገጽ 15 ወይም ጁዝ 3' : 'e.g. Nuraniya Page 15'} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, backgroundColor: '#fef3c7', borderRadius: 12, marginBottom: 12, marginTop: 8 }}>
              <Text style={{ fontWeight: '700', color: '#92400e' }}>{i18n.language === 'am' ? 'የቤት አካዳሚክ አስጠኚ አለው?' : 'Has Academic Tutor?'}</Text>
              <Chip selected={editForm.has_tutor === 1} onPress={() => setEditForm({ ...editForm, has_tutor: editForm.has_tutor === 1 ? 0 : 1 })} style={{ backgroundColor: editForm.has_tutor === 1 ? '#d97706' : '#cbd5e1' }} textStyle={{ color: 'white' }}>
                {editForm.has_tutor === 1 ? (i18n.language === 'am' ? 'አዎ' : 'YES') : (i18n.language === 'am' ? 'የለውም' : 'NO')}
              </Chip>
            </View>

            {editForm.has_tutor === 1 && (
              <>
                <TextInput key={`tutor_days_${student?.id}`} label={i18n.language === 'am' ? 'አስጠኚ ያላቸው ቀናት (ምሳሌ፡ ሰኞ፣ ረቡዕ)' : 'Tutor Days (e.g. Monday, Wednesday)'} defaultValue={editFormRef.current.tutor_days || ''} onChangeText={v => { editFormRef.current.tutor_days = v; }} mode="outlined" style={styles.input} />
                <TextInput key={`tutor_arrival_time_${student?.id}`} label={i18n.language === 'am' ? 'የመድረሻ ሰዓት (ምሳሌ፡ 4:30 PM)' : 'Expected Arrival Time (e.g. 04:30 PM)'} defaultValue={editFormRef.current.tutor_arrival_time || ''} onChangeText={v => { editFormRef.current.tutor_arrival_time = v; }} mode="outlined" style={styles.input} />
              </>
            )}

            <Divider style={{ marginVertical: 20 }} />
            <Text style={{ fontWeight: '800', marginBottom: 10 }}>
              {i18n.language === 'am' ? 'ወላጅ / አሳዳጊ:' : 'Parent / Guardian:'}
            </Text>
            <TextInput key={`parent_name_${student?.id}`} label={i18n.language === 'am' ? 'የወላጅ ስም' : 'Parent / Guardian Name'} defaultValue={editFormRef.current.parent_name || ''} onChangeText={v => { editFormRef.current.parent_name = v; }} mode="outlined" style={styles.input} />
            <TextInput key={`parent_phone_${student?.id}`} label={i18n.language === 'am' ? 'የወላጅ ስልክ' : 'Parent Phone'} defaultValue={editFormRef.current.parent_phone || ''} onChangeText={v => { editFormRef.current.parent_phone = v; }} mode="outlined" style={styles.input} keyboardType="phone-pad" />
            <TextInput key={`address_${student?.id}`} label={i18n.language === 'am' ? 'የመኖሪያ አድራሻ' : 'Home Address'} defaultValue={editFormRef.current.address || ''} onChangeText={v => { editFormRef.current.address = v; }} mode="outlined" style={styles.input} multiline placeholder={i18n.language === 'am' ? 'ክ/ከተማ, ወረዳ, ብሎክ, ቤት ቁ.' : 'Subcity, Woreda, Block, House No.'} />
            <TextInput key={`emergency_contact_${student?.id}`} label={i18n.language === 'am' ? 'የድንገተኛ አደጋ ተጠሪ (ስም/ስልክ)' : 'Emergency Contact (Name/Phone)'} defaultValue={editFormRef.current.emergency_contact || ''} onChangeText={v => { editFormRef.current.emergency_contact = v; }} mode="outlined" style={styles.input} />
            <TextInput key={`medical_notes_${student?.id}`} label={i18n.language === 'am' ? 'የጤና ማስታወሻ' : 'Medical Notes'} defaultValue={editFormRef.current.medical_notes || ''} onChangeText={v => { editFormRef.current.medical_notes = v; }} multiline mode="outlined" style={styles.input} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, backgroundColor: '#f1f5f9', borderRadius: 12, marginBottom: 15 }}>
              <Text style={{ fontWeight: '700' }}>{i18n.language === 'am' ? 'የየቲም ድጋፍ (ስፖንሰርሺፕ)?' : 'Sponsorship (Yetim)?'}</Text>
              <Chip selected={editForm.is_yetim === 1} onPress={() => setEditForm({ ...editForm, is_yetim: editForm.is_yetim === 1 ? 0 : 1 })} style={{ backgroundColor: editForm.is_yetim === 1 ? '#16a34a' : '#cbd5e1' }} textStyle={{ color: 'white' }}>
                {editForm.is_yetim === 1 ? (i18n.language === 'am' ? 'አዎ' : 'YES') : (i18n.language === 'am' ? 'አይደለም' : 'NO')}
              </Chip>
            </View>

            <TextInput key={`notes_${student?.id}`} label={i18n.language === 'am' ? 'የተቋሙ ማስታወሻ (ለንባብ ብቻ)' : 'Institutional Notes (Internal)'} defaultValue={editFormRef.current.notes || ''} onChangeText={v => { editFormRef.current.notes = v; }} multiline mode="outlined" style={styles.input} />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 30 }}>
              <Button mode="outlined" onPress={() => setShowEditModal(false)} style={{ flex: 1 }}>
                {i18n.language === 'am' ? 'ተመለስ' : 'Cancel'}
              </Button>
              <Button mode="contained" loading={isUpdating} disabled={isUpdating || isPhotoUploading} onPress={async () => {
                setIsUpdating(true);
                // 🛡️ Merge the ref-held free-text fields back in — they were never
                // written to editForm state while typing (that's the flicker fix),
                // so pull the latest values from the ref at save time.
                const finalForm = { ...editForm, ...editFormRef.current };
                try { await updateStudent(student.id, finalForm); setShowEditModal(false); loadData(); } catch (e) { } finally { setIsUpdating(false); }
              }} style={{ flex: 1, backgroundColor: COLORS.primaryDark }}>
                {i18n.language === 'am' ? 'መዝግብ' : 'Save Changes'}
              </Button>
            </View>
          </ScrollView>
        </Modal>
      </Portal>

      {/* 🛡️ Full-screen professional photo preview — tap avatar or edit thumbnail to open, double-tap to zoom, X to close */}
      <Portal>
        <Modal
          visible={zoomVisible}
          onDismiss={closePhotoZoom}
          contentContainerStyle={styles.zoomModalContainer}
        >
          <StatusBar hidden />
          <Animated.View style={[styles.zoomBackdrop, { opacity: zoomFade }]}>
            <TouchableOpacity
              style={styles.zoomCloseBtn}
              onPress={closePhotoZoom}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <MaterialCommunityIcons name="close" size={24} color="white" />
            </TouchableOpacity>

            <Text style={styles.zoomHint}>
              {i18n.language === 'am' ? 'ለማጉላት ሁለቴ ይንኩ' : 'Double-tap to zoom'}
            </Text>

            <TouchableWithoutFeedback onPress={handleZoomImageTap}>
              <View style={styles.zoomImageWrap}>
                {zoomUri && (
                  <Animated.Image
                    source={{ uri: zoomUri }}
                    style={[styles.zoomImage, { transform: [{ scale: zoomScale }] }]}
                    resizeMode="contain"
                  />
                )}
              </View>
            </TouchableWithoutFeedback>
          </Animated.View>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: COLORS.primaryDark, paddingTop: 50, paddingBottom: 25, borderBottomLeftRadius: 40, borderBottomRightRadius: 40, paddingHorizontal: 25 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 25 },
  backBtn: { width: 40, height: 40, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: 'white', fontSize: 16, fontWeight: '800' },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { backgroundColor: 'white' },
  profileInfo: { marginLeft: 20, flex: 1 },
  nameAm: { color: 'white', fontSize: 24, fontWeight: '900' },
  nameEn: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 10 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusTxt: { fontSize: 10, fontWeight: '900' },
  levelTxt: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '800' },
  statsBar: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 25, borderRadius: 20, paddingVertical: 15 },
  statItem: { flex: 1, alignItems: 'center' },
  statVal: { color: 'white', fontSize: 18, fontWeight: '900' },
  statLab: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700' },
  vDivider: { width: 1, height: 25, backgroundColor: 'rgba(255,255,255,0.1)' },
  body: { padding: 25 },
  sectionTitleRow: { marginBottom: 15 },
  sectionTitle: { fontSize: 12, fontWeight: '900', color: '#475569', letterSpacing: 1.5 },
  card: { backgroundColor: 'white', borderRadius: 24, padding: 20, marginBottom: 20 },
  subjectName: { fontSize: 18, fontWeight: '900', color: '#1e293b' },
  subjectAvg: { fontSize: 18, fontWeight: '900' },

  regCard: { backgroundColor: 'white', borderRadius: 24, padding: 20, marginBottom: 20, borderLeftWidth: 5, borderLeftColor: COLORS.primary },
  facultyCard: { backgroundColor: 'white', borderRadius: 24, padding: 20, marginBottom: 25, borderLeftWidth: 5, borderLeftColor: '#0891b2' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  cardTitle: { fontSize: 12, fontWeight: '900', color: COLORS.primary, letterSpacing: 1.2 },
  regGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 16 },
  regItem: { width: '45%', minWidth: 130 },
  regLabel: { fontSize: 10.5, fontWeight: '800', color: '#94a3b8', marginBottom: 4, letterSpacing: 0.6, textTransform: 'uppercase' },
  regVal: { fontSize: 15.5, fontWeight: '700', color: '#1e293b', lineHeight: 21 },
  addressItem: { width: '100%', backgroundColor: '#f8fafc', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#eef2f7' },
  addressVal: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  facultyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  facultyItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  facultyIconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center' },
  facultyLabel: { fontSize: 8, fontWeight: '800', color: '#64748b', textTransform: 'uppercase' },
  facultyName: { fontSize: 13, fontWeight: '900', color: '#1e293b' },
  vLine: { width: 1, height: 30, backgroundColor: '#e2e8f0', marginHorizontal: 10 },

  timelineCard: { backgroundColor: 'white', borderRadius: 24, padding: 20, marginBottom: 25 },
  timelineItem: { flexDirection: 'row', gap: 15 },
  timelineDotLine: { alignItems: 'center', width: 20 },
  tDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary, marginTop: 5 },
  tLine: { width: 1.5, flex: 1, backgroundColor: '#e2e8f0', marginVertical: 4 },
  logContent: { flex: 1, paddingBottom: 25 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  logDate: { fontSize: 13, fontWeight: '800', color: '#1e293b' },
  logLevel: { fontSize: 10, fontWeight: '800', color: COLORS.primary, backgroundColor: COLORS.primaryFaded, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  logBadge: { backgroundColor: COLORS.primary + '15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: COLORS.primary + '33' },
  logBadgeTxt: { fontSize: 10, fontWeight: '900', color: COLORS.primary },
  logAyah: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  logNotes: { fontSize: 12, fontStyle: 'italic', color: '#64748b', marginTop: 4 },
  emptyTxt: { textAlign: 'center', color: '#94a3b8', fontSize: 13, paddingVertical: 20 },

  teacherBrief: { backgroundColor: 'white', borderRadius: 24, padding: 20, marginBottom: 25, borderLeftWidth: 5, borderLeftColor: COLORS.primary },
  briefHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 15 },
  briefTitle: { fontSize: 11, fontWeight: '900', color: COLORS.primary, letterSpacing: 1 },
  briefLab: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  briefVal: { color: '#1e293b', fontWeight: '800' },
  editModal: { backgroundColor: 'white', padding: 25, margin: 20, borderRadius: 30, maxHeight: '85%' },
  modalTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20, color: '#1e293b' },
  modalSectionLabel: { fontSize: 12, fontWeight: '800', color: '#475569', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { marginBottom: 15 },

  editPhotoRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 },
  editPhotoCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#f8fafc', borderWidth: 2, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  editPhotoImg: { width: '100%', height: '100%' },

  zoomModalContainer: { flex: 1, margin: 0, backgroundColor: 'transparent' },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(4,8,14,0.96)', alignItems: 'center', justifyContent: 'center' },
  zoomCloseBtn: { position: 'absolute', top: 50, right: 20, zIndex: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  zoomHint: { position: 'absolute', top: 60, left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, zIndex: 5 },
  zoomImageWrap: { width: width, height: width, alignItems: 'center', justifyContent: 'center' },
  zoomImage: { width: width - 40, height: width - 40, borderRadius: 12 },
});