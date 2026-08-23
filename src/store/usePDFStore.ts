import { create } from 'zustand';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

import { LOGO_BASE64 } from '../constants/logoBase64';
import { getFallbackPhone } from '../lib/contactUtils';

interface PDFState {
  isGenerating: boolean;
  generateEnrollmentCard: (student: any) => Promise<void>;
  generateWeeklyReport: (studentId: string) => Promise<void>;
  generateMonthlyReport: (studentId: string) => Promise<void>;
  generateOverallPDFReport: (levelId?: string | null) => Promise<void>;
  generateDefaultersPDF: () => Promise<void>;
  generateTeamReport: (team: { name: string; emoji?: string }, members: any[]) => Promise<void>;
}

export const usePDFStore = create<PDFState>((set) => ({
  isGenerating: false,
  // ... previous methods kept as is ...
  generateDefaultersPDF: async () => {
    if (usePDFStore.getState().isGenerating) return;
    set({ isGenerating: true });

    try {
      const reportStore = (await import('./useReportStore')).useReportStore.getState();
      const rows = await reportStore.getDefaultersReport();
      
      if (!rows || rows.length === 0) {
        const { Alert } = require('react-native');
        Alert.alert("No Data", "All students have paid their fees! No defaulters found.");
        return;
      }

      let tableRows = '';
      rows.forEach((r: any) => {
        const callablePhone = getFallbackPhone(r.parent_phone, r.emergency_contact);
        tableRows += `
          <tr>
            <td style="font-weight: bold;">${r.name_am}<br><span style="font-size: 10px; color: #666;">${r.name_en}</span></td>
            <td>${r.level_name || '—'}</td>
            <td style="font-size: 14px; color: #b91c1c; font-weight: 800;">${callablePhone || 'N/A'}</td>
            <td style="font-weight: 600;">${r.parent_name || '—'}</td>
            <td style="text-align: right; color: #b91c1c; font-weight: bold;">${r.balance} ETB</td>
            <td style="width: 80px; border-left: 2px solid #ddd;"></td>
          </tr>
        `;
      });

      const html = `
        <html>
          <head>
            <style>
              body { font-family: 'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif; padding: 20px; color: #1a4b3c; margin: 0; }
              .header { text-align: center; border-bottom: 3px solid #1a4b3c; padding-bottom: 15px; margin-bottom: 20px; }
              .logo { width: 60px; height: 60px; margin-bottom: 5px; }
              .title { font-size: 26px; font-weight: 900; color: #1a4b3c; text-transform: uppercase; }
              .subtitle { font-size: 14px; font-weight: bold; color: #b91c1c; margin-top: 5px; }
              
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #e2e8f0; padding: 12px 8px; text-align: left; font-size: 12px; }
              th { background: #1a4b3c; color: white; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
              tr:nth-child(even) { background: #f8fafc; }
              
              .call-box { width: 20px; height: 20px; border: 1px solid #333; display: inline-block; vertical-align: middle; }
              .footer { margin-top: 30px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
            </style>
          </head>
          <body>
            <div class="header">
              <img src="${LOGO_BASE64}" class="logo" />
              <div class="title">የገቢና ወጪ ኮሚቴ - የክፍያ መከታተያ</div>
              <div class="subtitle">COMMITTEE FEE COLLECTION - PARENT CALL LIST</div>
              <div style="font-size: 11px; margin-top: 10px; color: #475569;">Report Generated: ${new Date().toLocaleString()}</div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Level</th>
                  <th>Phone Number (📞)</th>
                  <th>Parent Name</th>
                  <th style="text-align: right;">Balance</th>
                  <th>Call Status / Notes</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>

            <div class="footer">
              Abubeker Integrated Islamic Studies Center | Financial Oversight | Highly Confidential Data
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (e) {
      console.error('Defaulters PDF Error:', e);
      const { Alert } = require('react-native');
      Alert.alert("PDF Error", "Failed to generate committee call list.");
    } finally {
      set({ isGenerating: false });
    }
  },
  generateEnrollmentCard: async (student) => {
    if (usePDFStore.getState().isGenerating) return;
    set({ isGenerating: true });

    try {
      const html = `
        <html>
          <head>
            <style>
              body { font-family: 'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif; padding: 20px; color: #1a4b3c; margin: 0; background: #fff; }
              .border-outer { border: 12px double #1a4b3c; padding: 30px; border-radius: 5px; position: relative; min-height: 90vh; }
              
              .header { text-align: center; margin-bottom: 30px; position: relative; }
              .logo { width: 120px; height: 120px; display: block; margin: 0 auto 10px; }
              .school-name { font-size: 34px; font-weight: 800; margin: 5px 0; color: #1a4b3c; }
              .school-subtitle { font-size: 13px; color: #666; letter-spacing: 1px; font-weight: bold; }
              
              .card-title { text-align: center; font-size: 20px; font-weight: bold; margin-bottom: 30px; border-top: 1px solid #eee; border-bottom: 1px solid #eee; padding: 10px 0; background: #f4fbf7; }
              
              .main-content { display: flex; flex-direction: row; gap: 40px; margin-top: 20px; }
              .photo-placeholder { width: 130px; height: 150px; border: 2px dashed #ccc; background: #fdfdfd; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #999; }
              .student-info { flex: 1; }
              
              .info-row { display: flex; align-items: flex-end; margin-bottom: 15px; }
              .label { font-size: 14px; color: #666; font-weight: bold; min-width: 120px; }
              .value { font-size: 18px; color: #000; font-weight: bold; border-bottom: 2px solid #f0f0f0; flex: 1; padding-bottom: 2px; }
              
              .section-header { font-size: 12px; background: #1a4b3c; color: #fff; padding: 5px 15px; border-radius: 20px; display: inline-block; margin: 25px 0 15px 0; }
              
              .footer { margin-top: 80px; display: flex; justify-content: space-between; align-items: flex-end; position: relative; }
              .signature-box { text-align: center; border-top: 2px solid #333; width: 220px; padding-top: 10px; }
              .sig-label { font-size: 13px; font-weight: bold; color: #333; }
              .sig-sub { font-size: 11px; color: #666; margin-top: 3px; }
              
              .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); opacity: 0.05; width: 400px; z-index: -1; }
              .seal-img { position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); width: 100px; opacity: 0.15; }
            </style>
          </head>
          <body>
            <div class="border-outer">
              <!-- Background Watermark Seal -->
              <img class="watermark" src="${LOGO_BASE64}" />
              
              <div class="header">
                <img class="logo" src="${LOGO_BASE64}" />
                <div class="school-name">አቡበከር መድረሳ</div>
                <div class="school-subtitle">ABUBEKER INTEGRATED ISLAMIC STUDIES CENTER</div>
              </div>
              
              <div class="card-title">የተማሪ ምዝገባ መረጃ እና መታወቂያ</div>
              
              <div class="main-content">
                <div class="photo-placeholder">STUDENT PHOTO<br>እዚህ ይለጥፉ</div>
                <div class="student-info">
                  <div class="info-row">
                    <span class="label">የተማሪ ስም: </span>
                    <span class="value">${student.name_am}</span>
                  </div>
                  <div class="info-row">
                    <span class="label">English Name: </span>
                    <span class="value">${student.name_en}</span>
                  </div>
                  <div class="info-row">
                    <span class="label">መለያ ቁጥር: </span>
                    <span class="value">#${student.id.substring(0, 8).toUpperCase()}</span>
                  </div>
                  <div class="info-row">
                    <span class="label">የትምርት ደረጃ: </span>
                    <span class="value">${student.level_name_am || student.level_name || 'የተመደበ'}</span>
                  </div>
                </div>
              </div>

              <div class="section-header">የወላጅ / የአሳዳጊ መረጃ</div>
              <div class="student-info" style="margin-left: 20px;">
                  <div class="info-row">
                    <span class="label">የወላጅ ስም: </span>
                    <span class="value">${student.parent_name || '--------------------'}</span>
                  </div>
                  <div class="info-row">
                    <span class="label">ስልክ ቁጥር: </span>
                    <span class="value">${student.parent_phone || '--------------------'}</span>
                  </div>
                  <div class="info-row">
                    <span class="label">አድራሻ: </span>
                    <span class="value">${student.address || '--------------------'}</span>
                  </div>
              </div>

              <div class="footer">
                <div class="signature-box">
                   <div class="sig-label">የመድረሳው ኃላፊ ፊርማ</div>
                   <div class="sig-sub">(Principal's Signature)</div>
                </div>
                
                <img class="seal-img" src="${LOGO_BASE64}" style="width: 80px; position: absolute; left: 40%; transform: rotate(-15deg); opacity: 0.2;" />
                
                <div style="text-align: right;">
                   <div style="font-size: 11px; font-weight: bold;">የተመዘገበበት ቀን:</div>
                   <div style="font-size: 14px; color: #1a4b3c; font-weight: 900;">${new Date(student.enroll_date).toLocaleDateString('am-ET')}</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (error) {
      console.error('PDF Generation Error:', error);
      const { Alert } = require('react-native');
      Alert.alert("Report Error", "Could not generate PDF. Please check your data and try again.");
    } finally {
      set({ isGenerating: false });
    }
  },

  generateWeeklyReport: async (studentId: string) => {
    if (usePDFStore.getState().isGenerating) return;
    set({ isGenerating: true });

    try {
      const db = await (await import('./useReportStore')).useReportStore.getState().getFullStudentReport(studentId);
      const studentInfo = await (await import('../lib/database')).getDatabase().then(d => 
        d.getFirstAsync<any>('SELECT name_am, level_id FROM students WHERE id = ?', [studentId])
      );
      
      let attendanceHtml = '';
      db.attendance.slice(0, 5).forEach((a: any) => {
        const amLabel = a.status === 'present' ? 'ተገኝቷል/ች (✅)' : a.status === 'absent' ? 'ቀንቷል/ች (❌)' : a.status === 'late' ? 'አርፍዷል/ች (⏰)' : 'ፍቃድ (✔️)';
        attendanceHtml += `<tr><td>${a.date}</td><td>${amLabel}</td></tr>`;
      });
      
      let qiratHtml = '';
      db.progress.slice(0, 5).forEach((p: any) => {
        let stars = '⭐'.repeat(p.rating || 5);
        qiratHtml += `<tr><td>${p.date}</td><td>ገጽ ${p.page_number} (${p.ayah_from}-${p.ayah_to})</td><td>${stars}</td></tr>`;
      });
      
      let kitabHtml = '';
      if (db.grades.length > 0) {
        db.grades.forEach((g: any) => {
          kitabHtml += `<tr><td>${g.subject_name}</td><td>${g.weight_name}</td><td>${g.score}</td><td>${g.date.split('T')[0]}</td></tr>`;
        });
      } else {
        kitabHtml = '<tr><td colspan="4" style="text-align:center;">መረጃ አልተገኘም</td></tr>';
      }

      // 🆕 Kitab bonus-mark notes (session_type = 'kitab' rows from student_progress),
      // separate from the graded Kitab Grades table above.
      let kitabNotesHtml = '';
      (db.kitabNotes || []).slice(0, 5).forEach((n: any) => {
        const stars = '⭐'.repeat(n.rating || 0);
        kitabNotesHtml += `<tr><td>${n.date}</td><td>${n.lesson_details || '—'}</td><td>${stars}</td></tr>`;
      });

      const isNuraniyah = studentInfo?.level_id === 'l1m' || studentInfo?.level_id === 'l1f';

      // 🛡️ FIX: this report already branched on isNuraniyah to skip Kitab grades, but never
      // actually pulled in Nuraniyah ratings — so a Nuraniyah student's weekly report had
      // an attendance table and an (empty) Qirat/progress table, and nothing else. Parents
      // had no printed record of Qirat/Azkar/Behaviour ratings at all.
      let nuraniyahRatingsHtml = '';
      let nuraniyahSummaryHtml = '';
      if (isNuraniyah) {
        const { useNuraniyahStore } = await import('./useNuraniyahStore');
        const nStore = useNuraniyahStore.getState();
        const dbConn = await (await import('../lib/database')).getDatabase();
        const recentAssessments = await dbConn.getAllAsync<any>(
          'SELECT date, category, rating FROM nuraniyah_assessments WHERE student_id = ? ORDER BY date DESC, category ASC LIMIT 15',
          [studentId]
        );
        recentAssessments.forEach((a: any) => {
          const cfg = nStore.ratingConfig[a.rating as keyof typeof nStore.ratingConfig];
          nuraniyahRatingsHtml += `<tr><td>${a.date}</td><td>${a.category}</td><td>${cfg ? cfg.emoji + ' ' + cfg.label_am : a.rating}</td></tr>`;
        });

        const nSummary = await nStore.getStudentNuraniyahSummary(studentId);
        if (nSummary.totalEntries > 0) {
          nuraniyahSummaryHtml = `
            <div style="margin-bottom:10px;font-size:14px;">
              <b>አጠቃላይ ውጤት (Overall):</b> ${nSummary.percentage}%
              ${nSummary.weakCategories.length > 0 ? ` &nbsp;|&nbsp; <b style="color:#b45309;">ተጨማሪ ትኩረት የሚያስፈልገው:</b> ${nSummary.weakCategories.join(', ')}` : ''}
            </div>
          `;
        }
      }

      const html = `
        <html>
          <head>
            <style>
              body { font-family: 'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif; padding: 20px; color: #1a4b3c; margin: 0; background: #fff; }
              .border-outer { border: 2px solid #1a4b3c; padding: 20px; border-radius: 5px; position: relative; min-height: 90vh; }
              .header { text-align: center; margin-bottom: 20px; }
              .logo { width: 80px; height: 80px; display: block; margin: 0 auto; }
              .title { font-size: 24px; font-weight: 800; color: #1a4b3c; margin-top: 10px; }
              .subtitle { font-size: 16px; color: #666; font-weight: bold; margin-bottom: 20px; }
              .student-name { background: #f4fbf7; padding: 10px; text-align: center; font-size: 20px; font-weight: bold; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; margin-bottom: 30px; }
              
              table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 14px; }
              th { background-color: #1a4b3c; color: white; font-weight: bold; }
              .section-title { font-size: 16px; font-weight: bold; color: #1a4b3c; margin-bottom: 10px; border-bottom: 2px solid #1a4b3c; display: inline-block; padding-bottom: 2px; }
              
              .footer { margin-top: 50px; text-align: center; text-decoration: underline; font-size: 14px; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="border-outer">
              <div class="header">
                <img class="logo" src="${LOGO_BASE64}" />
                <div class="title">አቡበከር መድረሳ</div>
                <div class="subtitle">ሳምንታዊ የተማሪ ሪፖርት</div>
              </div>
              
              <div class="student-name">የተማሪ ስም: ${studentInfo?.name_am || ''}</div>
              
              <div class="section-title">የቅርብ ጊዜ ክትትል (Attendance)</div>
              <table>
                <thead><tr><th>ቀን (Date)</th><th>ሁኔታ (Status)</th></tr></thead>
                <tbody>${attendanceHtml || '<tr><td colspan="2">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>
              
              <div class="section-title">የቁርዓን / ቂርዓት ሂደት (Progress)</div>
              <table>
                <thead><tr><th>ቀን (Date)</th><th>ምንባብ (Lesson)</th><th>ደረጃ (Rating)</th></tr></thead>
                <tbody>${qiratHtml || '<tr><td colspan="3">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>
              
              ${isNuraniyah ? `
              <div class="section-title">የኑራንያ ደረጃዎች (Nuraniyah Ratings)</div>
              ${nuraniyahSummaryHtml}
              <table>
                <thead><tr><th>ቀን (Date)</th><th>ምድብ (Category)</th><th>ደረጃ (Rating)</th></tr></thead>
                <tbody>${nuraniyahRatingsHtml || '<tr><td colspan="3">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>
              ` : ''}

              ${!isNuraniyah ? `
              <div class="section-title">የኪታብ ውጤቶች (Kitab Grades)</div>
              <table>
                <thead><tr><th>የትምህርት አይነት</th><th>ፈተና/ድርሻ</th><th>ውጤት</th><th>ቀን</th></tr></thead>
                <tbody>${kitabHtml}</tbody>
              </table>

              <div class="section-title">የኪታብ ጉርሻ ማስታወሻ (Kitab Bonus Notes)</div>
              <table>
                <thead><tr><th>ቀን (Date)</th><th>ማስታወሻ (Note)</th><th>ጉርሻ (Bonus)</th></tr></thead>
                <tbody>${kitabNotesHtml || '<tr><td colspan="3">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>
              ` : ''}

              <div class="footer">የመድረሳው አስተዳደር</div>
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (error) {
      console.error('Weekly Report Error:', error);
      const { Alert } = require('react-native');
      Alert.alert("Weekly Report Error", "Could not generate student report.");
    } finally {
      set({ isGenerating: false });
    }
  },

  // 🆕 Monthly counterpart to generateWeeklyReport: same layout, scoped to the trailing
  // 30 days via getMonthlyStudentReport, including Kitab bonus notes.
  generateMonthlyReport: async (studentId: string) => {
    if (usePDFStore.getState().isGenerating) return;
    set({ isGenerating: true });

    try {
      const db = await (await import('./useReportStore')).useReportStore.getState().getMonthlyStudentReport(studentId);
      const studentInfo = await (await import('../lib/database')).getDatabase().then(d =>
        d.getFirstAsync<any>('SELECT name_am, level_id FROM students WHERE id = ?', [studentId])
      );

      let attendanceHtml = '';
      db.attendance.forEach((a: any) => {
        const amLabel = a.status === 'present' ? 'ተገኝቷል/ች (✅)' : a.status === 'absent' ? 'ቀንቷል/ች (❌)' : a.status === 'late' ? 'አርፍዷል/ች (⏰)' : 'ፍቃድ (✔️)';
        attendanceHtml += `<tr><td>${a.date}</td><td>${amLabel}</td></tr>`;
      });

      let qiratHtml = '';
      db.progress.forEach((p: any) => {
        let stars = '⭐'.repeat(p.rating || 0);
        qiratHtml += `<tr><td>${p.date}</td><td>ገጽ ${p.page_number} (${p.ayah_from}-${p.ayah_to})</td><td>${stars}</td></tr>`;
      });

      let kitabHtml = '';
      if (db.grades.length > 0) {
        db.grades.forEach((g: any) => {
          kitabHtml += `<tr><td>${g.subject_name}</td><td>${g.weight_name}</td><td>${g.score}</td><td>${g.date.split('T')[0]}</td></tr>`;
        });
      } else {
        kitabHtml = '<tr><td colspan="4" style="text-align:center;">መረጃ አልተገኘም</td></tr>';
      }

      let kitabNotesHtml = '';
      (db.kitabNotes || []).forEach((n: any) => {
        const stars = '⭐'.repeat(n.rating || 0);
        kitabNotesHtml += `<tr><td>${n.date}</td><td>${n.lesson_details || '—'}</td><td>${stars}</td></tr>`;
      });

      const isNuraniyah = studentInfo?.level_id === 'l1m' || studentInfo?.level_id === 'l1f';

      const html = `
        <html>
          <head>
            <style>
              body { font-family: 'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif; padding: 20px; color: #1a4b3c; margin: 0; background: #fff; }
              .border-outer { border: 2px solid #1a4b3c; padding: 20px; border-radius: 5px; position: relative; min-height: 90vh; }
              .header { text-align: center; margin-bottom: 20px; }
              .logo { width: 80px; height: 80px; display: block; margin: 0 auto; }
              .title { font-size: 24px; font-weight: 800; color: #1a4b3c; margin-top: 10px; }
              .subtitle { font-size: 16px; color: #666; font-weight: bold; margin-bottom: 20px; }
              .student-name { background: #f4fbf7; padding: 10px; text-align: center; font-size: 20px; font-weight: bold; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; margin-bottom: 30px; }
              table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 14px; }
              th { background-color: #1a4b3c; color: white; font-weight: bold; }
              .section-title { font-size: 16px; font-weight: bold; color: #1a4b3c; margin-bottom: 10px; border-bottom: 2px solid #1a4b3c; display: inline-block; padding-bottom: 2px; }
              .footer { margin-top: 50px; text-align: center; text-decoration: underline; font-size: 14px; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="border-outer">
              <div class="header">
                <img class="logo" src="${LOGO_BASE64}" />
                <div class="title">አቡበከር መድረሳ</div>
                <div class="subtitle">ወርሃዊ የተማሪ ሪፖርት (Monthly Report)</div>
              </div>

              <div class="student-name">የተማሪ ስም: ${studentInfo?.name_am || ''}</div>

              <div class="section-title">ወርሃዊ ክትትል (Attendance — Last 30 Days)</div>
              <table>
                <thead><tr><th>ቀን (Date)</th><th>ሁኔታ (Status)</th></tr></thead>
                <tbody>${attendanceHtml || '<tr><td colspan="2">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>

              <div class="section-title">የቁርዓን / ቂርዓት ሂደት (Progress)</div>
              <table>
                <thead><tr><th>ቀን (Date)</th><th>ምንባብ (Lesson)</th><th>ደረጃ (Rating)</th></tr></thead>
                <tbody>${qiratHtml || '<tr><td colspan="3">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>

              ${!isNuraniyah ? `
              <div class="section-title">የኪታብ ውጤቶች (Kitab Grades)</div>
              <table>
                <thead><tr><th>የትምህርት አይነት</th><th>ፈተና/ድርሻ</th><th>ውጤት</th><th>ቀን</th></tr></thead>
                <tbody>${kitabHtml}</tbody>
              </table>

              <div class="section-title">የኪታብ ጉርሻ ማስታወሻ (Kitab Bonus Notes)</div>
              <table>
                <thead><tr><th>ቀን (Date)</th><th>ማስታወሻ (Note)</th><th>ጉርሻ (Bonus)</th></tr></thead>
                <tbody>${kitabNotesHtml || '<tr><td colspan="3">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>
              ` : ''}

              <div class="footer">የመድረሳው አስተዳደር</div>
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (error) {
      console.error('Monthly Report Error:', error);
      const { Alert } = require('react-native');
      Alert.alert("Monthly Report Error", "Could not generate student report.");
    } finally {
      set({ isGenerating: false });
    }
  },

  generateOverallPDFReport: async (levelId) => {
    if (usePDFStore.getState().isGenerating) return;
    set({ isGenerating: true });

    try {
      const db = await (await import('../lib/database')).getDatabase();
      
      let query = `
        SELECT s.name_en, s.name_am, l.name as level, a.date, a.status, 
               p.page_number, p.ayah_from, p.ayah_to, p.lesson_details, p.rating,
               k.lesson_details as kitab_note, k.rating as kitab_bonus
        FROM students s
        JOIN levels l ON s.level_id = l.id
        LEFT JOIN attendance a ON (s.id = a.student_id AND a.date = DATE('now', 'localtime'))
        LEFT JOIN student_progress p ON (s.id = p.student_id AND a.date = p.date AND p.session_type = 'quran')
        LEFT JOIN student_progress k ON (s.id = k.student_id AND a.date = k.date AND k.session_type = 'kitab')
        WHERE s.is_active = 1
      `;
      const params: any[] = [];
      if (levelId) {
        query += ` AND s.level_id = ?`;
        params.push(levelId);
      }
      query += ` ORDER BY l.id, s.name_en ASC`;

      const rows = await db.getAllAsync<any>(query, params);
      
      let tableRows = '';
      rows.forEach(r => {
        const statusEmoji = r.status === 'present' ? '✅' : r.status === 'absent' ? '❌' : r.status === 'late' ? '⏰' : '✔️';
        const kitabBonusStars = r.kitab_bonus ? '⭐'.repeat(r.kitab_bonus) : '—';
        tableRows += `
          <tr>
            <td>${r.name_am}</td>
            <td>${r.level}</td>
            <td style="text-align:center;">${r.status ? statusEmoji : '—'}</td>
            <td style="text-align:center;">${r.page_number || '—'}</td>
            <td>${r.lesson_details || '—'}</td>
            <td>${r.kitab_note || '—'}</td>
            <td style="text-align:center;">${kitabBonusStars}</td>
          </tr>
        `;
      });

      const html = `
        <html>
          <head>
            <style>
              body { font-family: 'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif; padding: 20px; color: #1a4b3c; margin: 0; }
              .header { text-align: center; border-bottom: 2px solid #1a4b3c; padding-bottom: 20px; margin-bottom: 20px; }
              .logo { width: 70px; height: 70px; }
              .title { font-size: 24px; font-weight: 800; }
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #eee; padding: 10px; font-size: 12px; text-align: left; }
              th { background: #1a4b3c; color: white; }
              tr:nth-child(even) { background: #f9f9f9; }
            </style>
          </head>
          <body>
            <div class="header">
              <img src="${LOGO_BASE64}" class="logo" />
              <div class="title">አቡበከር መድረሳ - ጠቅላላ ሪፖርት</div>
              <div style="font-size:12px; color:#666;">Medresa Overall Daily Report | ${new Date().toLocaleDateString()}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>ተማሪ</th>
                  <th>ደረጃ</th>
                  <th>ሁኔታ</th>
                  <th>ገጽ</th>
                  <th>ዝርዝር</th>
                  <th>የኪታብ ማስታወሻ</th>
                  <th>ጉርሻ</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (error) {
      console.error('Overall PDF Error:', error);
      const { Alert } = require('react-native');
      Alert.alert("Overall Report Error", "Could not generate aggregate PDF.");
    } finally {
      set({ isGenerating: false });
    }
  },

  // 🆕 Simple one-page PDF summary for a recitation Team: each member's recent
  // attendance + recitation entries side by side, so an ustaz can hand parents/admin
  // one sheet for the whole group instead of printing each student separately.
  generateTeamReport: async (team, members) => {
    if (usePDFStore.getState().isGenerating) return;
    set({ isGenerating: true });

    try {
      const { useReportStore } = await import('./useReportStore');
      const reportStore = useReportStore.getState();

      let sections = '';
      for (const m of members) {
        const summary = await reportStore.getStudentHistorySummary(m.id);

        let attRows = '';
        (summary.attendance || []).forEach((a: any) => {
          const label = a.status === 'present' ? 'ተገኝቷል/ች (✅)' : a.status === 'absent' ? 'ቀንቷል/ች (❌)' : a.status === 'late' ? 'አርፍዷል/ች (⏰)' : 'ፍቃድ (✔️)';
          attRows += `<tr><td>${a.date}</td><td>${label}</td></tr>`;
        });

        let progRows = '';
        (summary.progress || []).forEach((p: any) => {
          const stars = '⭐'.repeat(p.rating || 0);
          progRows += `<tr><td>${p.date}</td><td>ገጽ ${p.page_number || '—'}</td><td>${stars}</td></tr>`;
        });

        // 🆕 Kitab bonus-mark notes, kept in their own table alongside Attendance/Recitation.
        let kitabNoteRows = '';
        (summary.kitabNotes || []).forEach((n: any) => {
          const stars = '⭐'.repeat(n.rating || 0);
          kitabNoteRows += `<tr><td>${n.date}</td><td>${n.lesson_details || '—'}</td><td>${stars}</td></tr>`;
        });

        sections += `
          <div class="member-block">
            <div class="member-name">${m.name_am} <span style="color:#666;font-size:12px;">(${m.name_en || ''})</span></div>
            <div class="member-tables">
              <table>
                <thead><tr><th colspan="2">የቅርብ ጊዜ ክትትል (Attendance)</th></tr></thead>
                <tbody>${attRows || '<tr><td colspan="2">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>
              <table>
                <thead><tr><th colspan="3">የቅርብ ጊዜ ንባብ (Recitation)</th></tr></thead>
                <tbody>${progRows || '<tr><td colspan="3">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>
              <table>
                <thead><tr><th colspan="3">የኪታብ ጉርሻ ማስታወሻ (Kitab Bonus Notes)</th></tr></thead>
                <tbody>${kitabNoteRows || '<tr><td colspan="3">ምንም መረጃ የለም</td></tr>'}</tbody>
              </table>
            </div>
          </div>
        `;
      }

      const html = `
        <html>
          <head>
            <style>
              body { font-family: 'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif; padding: 20px; color: #1a4b3c; margin: 0; }
              .header { text-align: center; border-bottom: 3px solid #1a4b3c; padding-bottom: 15px; margin-bottom: 20px; }
              .logo { width: 60px; height: 60px; margin-bottom: 5px; }
              .title { font-size: 24px; font-weight: 900; color: #1a4b3c; }
              .subtitle { font-size: 14px; font-weight: bold; color: #666; margin-top: 4px; }
              .member-block { margin-bottom: 22px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
              .member-name { font-size: 15px; font-weight: 800; margin-bottom: 8px; }
              .member-tables { display: flex; gap: 14px; }
              table { flex: 1; border-collapse: collapse; }
              th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; font-size: 11.5px; }
              th { background: #1a6b3c; color: white; }
              .footer { margin-top: 30px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
            </style>
          </head>
          <body>
            <div class="header">
              <img src="${LOGO_BASE64}" class="logo" />
              <div class="title">${team.emoji || '👥'} ${team.name} — Team Report</div>
              <div class="subtitle">Recitation Team Summary | ${new Date().toLocaleDateString()}</div>
            </div>
            ${sections}
            <div class="footer">የመድረሳው አስተዳደር — Generated by Medresa App</div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (error) {
      console.error('Team Report Error:', error);
      const { Alert } = require('react-native');
      Alert.alert("Team Report Error", "Could not generate team report.");
    } finally {
      set({ isGenerating: false });
    }
  }
}));
