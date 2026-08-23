import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Modal, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Text, Surface, List, Searchbar, Chip, Avatar, FAB, TextInput, Button, IconButton, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFeeStore } from '../../src/store/useFeeStore';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { COLORS } from '../../src/constants';
const toEthiopicDate = (date: Date) => {
  const amMonths = ['መስከረም', 'ጥቅምት', 'ህዳር', 'ታህሳስ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];
  
  // 🛡️ High-Fidelity Ethiopic Calendar Calculation (Generalized)
  const timestamp = date.getTime();
  const day = 24 * 60 * 60 * 1000;
  
  // Base reference: Meskerem 1, 2016 (Ethiopian) was Sept 12, 2023 (Gregorian)
  const baseGreg = new Date(2023, 8, 12).getTime(); 
  const baseEthYear = 2016;
  
  const diff = timestamp - baseGreg;
  const daysDiff = Math.floor(diff / day);
  
  let ethYear = baseEthYear;
  let ethMonth = 0;
  let ethDay = daysDiff + 1;

  // Adjust for years (approximate but highly precise for current decade)
  while (ethDay > 365) {
    const isLeap = (ethYear + 1) % 4 === 3;
    const yearDays = isLeap ? 366 : 365;
    if (ethDay > yearDays) {
      ethDay -= yearDays;
      ethYear++;
    } else break;
  }
  
  if (ethDay <= 0) {
     // Support for dates before base (if needed)
     ethYear--;
     const isLeap = ethYear % 4 === 3;
     ethDay += (isLeap ? 366 : 365);
  }

  // Calculate month and day within year
  if (ethDay > 360) {
    ethMonth = 12; // Pagume
    ethDay -= 360;
  } else {
    ethMonth = Math.floor((ethDay - 1) / 30);
    ethDay = ((ethDay - 1) % 30) + 1;
  }

  return {
    year: ethYear,
    month: amMonths[ethMonth],
    day: ethDay
  };
};

export default function FeesScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  const { fees, totals, isLoading, fetchFees, addPayment, getRecentPayments, verifyPayment, generateMonthlyFees } = useFeeStore();
  const ethMonth = useMemo(() => toEthiopicDate(new Date()).month, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'unpaid' | 'paid' | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [selectedFee, setSelectedFee] = useState<any>(null);
  const [payAmount, setPayAmount] = useState('');
  const [recentPayments, setRecentPayments] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'list' | 'history'>('list');
  const [method, setMethod] = useState<'cash' | 'bank'>('cash');
  const [reference, setReference] = useState('');

  const { defaultFee, fetchSettings } = useSettingsStore();

  useEffect(() => {
    fetchSettings();
    fetchFees(filter);
    loadHistory();
  }, [filter]);

  const loadHistory = async () => {
    const history = await getRecentPayments();
    setRecentPayments(history);
  };

  const handlePay = async () => {
    if (!selectedFee || !payAmount) return;
    const amt = parseFloat(payAmount);
    const remaining = selectedFee.amount_due - selectedFee.amount_paid;

    if (amt > remaining) {
      Alert.alert(
        i18n.language === 'am' ? 'ከፍ ያለ ክፍያ' : 'Overpayment Warning',
        i18n.language === 'am' 
          ? `የክፍያ መጠኑ ከቀሪው ዕዳ (${remaining} ብር) ይበልጣል። እርግጠኛ ነህ?` 
          : `The amount entered (${amt}) exceeds the remaining balance (${remaining}). Are you sure?`,
        [
          { text: t('cancel'), style: 'cancel' },
          { text: i18n.language === 'am' ? 'አዎ መዝግብ' : 'Yes, Record Anyway', onPress: () => proceedWithPayment(amt) }
        ]
      );
      return;
    }
    proceedWithPayment(amt);
  };

  const proceedWithPayment = async (amt: number) => {
    // 🛡️ Pre-capture info for receipt before clearing state
    const studentName = i18n.language === 'am' ? selectedFee.name_am : selectedFee.name_en;
    const feeId = selectedFee.id;
    
    await addPayment(feeId, amt, user?.id || 'unknown', method, reference);
    
    // Create a temporary payment object for immediate receipt generation
    const tempPayment = {
      id: 'LATEST',
      name_am: studentName,
      paid_date: new Date().toISOString(),
      payment_method: method,
      reference_number: reference,
      amount: amt
    };

    setShowModal(false);
    loadHistory();
    
    // Automatically trigger receipt generation after recording
    setTimeout(() => {
      Alert.alert(
        i18n.language === 'am' ? 'ክፍያ ተመዝግቧል' : 'Payment Recorded',
        i18n.language === 'am' ? 'ለተማሪው ደረሰኝ ማተም ይፈልጋሉ?' : 'Would you like to print a receipt for this student?',
        [
          { text: i18n.language === 'am' ? 'አይ' : 'No', style: 'cancel' },
          { text: i18n.language === 'am' ? 'አዎ አትም' : 'Yes, Print', onPress: () => generateReceiptPDF(tempPayment) }
        ]
      );
    }, 500);

    setSelectedFee(null);
    setPayAmount('');
    setMethod('cash');
    setReference('');
  };

  const handleVerify = async (paymentId: string) => {
    await verifyPayment(paymentId);
    loadHistory();
  };

  const handleGenerateFees = async () => {
    const ethiopic = toEthiopicDate(new Date());
    const currentEthMonth = ethiopic.month;
    const amMonths = ['መስከረም', 'ጥቅምት', 'ህዳር', 'ታህሳስ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];
    const nextMonthIndex = (amMonths.indexOf(currentEthMonth) + 1) % 13;
    const nextEthMonth = amMonths[nextMonthIndex];

    // 🛡️ SMART OVERLAP PROTECTION: Check if we've billed this month already
    const db = await (await import('../../src/lib/database')).getDatabase();
    const lastGen = await db.getFirstAsync<any>("SELECT value FROM settings WHERE key = 'last_fee_gen_month'");
    
    const isDuplicate = lastGen?.value === currentEthMonth;
    const targetMonth = isDuplicate ? nextEthMonth : currentEthMonth;

    Alert.alert(
      i18n.language === 'am' ? `${targetMonth} የክፍያ መዝገብ ፍጠር` : `Generate Fees for ${targetMonth}`,
      isDuplicate 
        ? (i18n.language === 'am' 
            ? `ለ ${currentEthMonth} ወር አስቀድመው ፈጥረዋል። ለ ${nextEthMonth} ወር መፍጠር ይፈልጋሉ?` 
            : `You already generated fees for ${currentEthMonth}. Would you like to generate for ${nextEthMonth} instead?`)
        : (i18n.language === 'am' 
            ? `ለ ${currentEthMonth} ወር ለእያንዳንዱ ተማሪ ${defaultFee} ብር እዳ መጨመር ትፈልጋለህ?` 
            : `Do you want to add ${defaultFee} ETB debt to all students for the month of ${currentEthMonth}?`),
      [
        { text: t('cancel'), style: 'cancel' },
        { 
          text: i18n.language === 'am' ? `${defaultFee} ብር ፍጠር` : `Generate ${defaultFee} ETB`, 
          onPress: async () => {
            await generateMonthlyFees(defaultFee);
            await db.runAsync("INSERT OR REPLACE INTO settings (key, value, synced) VALUES ('last_fee_gen_month', ?, 0)", [targetMonth]);
            fetchFees(filter);
            Alert.alert(t('success'), i18n.language === 'am' ? `${targetMonth} ወር ክፍያ በተሳካ ሁኔታ ተፈጥሯል` : `Fees for ${targetMonth} generated successfully!`);
          }
        }
      ]
    );
  };

  const generateReceiptPDF = async (payment: any) => {
    try {
      const { printToFileAsync } = await import('expo-print');
      const { shareAsync } = await import('expo-sharing');
      const { LOGO_BASE64 } = require('../../src/constants/logoBase64');
      
      const ethDate = toEthiopicDate(new Date(payment.paid_date));
      const logoSrc = LOGO_BASE64;
      
      // 🛡️ MULTI-MONTH DETECTION: Calculate coverage based on institutional standard fee
      const monthsCovered = Math.round(payment.amount / defaultFee);
      const coverageLabel = monthsCovered > 1 
        ? (i18n.language === 'am' ? `${monthsCovered} ወራትን ይሸፍናል` : `Covers ${monthsCovered} Months`)
        : (i18n.language === 'am' ? `1 ወር ይሸፍናል` : `Covers 1 Month`);

      const html = `
        <html>
          <head>
            <style>
              body { font-family: sans-serif; padding: 40px; color: #1e293b; border: 10px double #1a6b3c; margin: 10px; }
              .header { text-align: center; margin-bottom: 40px; }
              .logo { width: 100px; height: 100px; border-radius: 12px; margin-bottom: 15px; }
              .title { font-size: 28px; font-weight: bold; color: #1a6b3c; margin: 0; }
              .receipt-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 2px; margin-top: 10px; }
              .content { margin-top: 30px; }
              .row { display: flex; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 10px; }
              .label { font-weight: 600; color: #64748b; }
              .val { font-weight: bold; font-size: 18px; }
              .amount-box { background-color: #f1f5f9; padding: 20px; border-radius: 12px; text-align: center; margin-top: 40px; border: 2px solid #1a6b3c; }
              .amount-large { font-size: 32px; font-weight: 900; color: #1a6b3c; }
              .footer { margin-top: 60px; text-align: center; font-size: 10px; color: #94a3b8; }
              .stamp-container { position: relative; height: 120px; margin-top: 30px; }
              .digital-seal {
                position: absolute;
                right: 20px;
                width: 100px;
                height: 100px;
                border: 4px double #1a6b3c;
                border-radius: 50%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                transform: rotate(-15deg);
                background-color: rgba(26, 107, 60, 0.05);
              }
              .seal-text { font-size: 8px; color: #1a6b3c; font-weight: bold; text-align: center; text-transform: uppercase; }
              .seal-title { font-size: 10px; font-weight: 900; color: #1a6b3c; }
            </style>
          </head>
          <body>
            <div class="header">
              <img src="${logoSrc}" class="logo" />
              <h1 class="title">Abubeker Medresa</h1>
              <p style="margin: 5px 0;">Official Payment Receipt | የክፍያ ደረሰኝ</p>
              <div class="receipt-label">No: REC-${payment.id.substring(0,6).toUpperCase()}</div>
            </div>

            <div class="content">
              <div class="row">
                <span class="label">የኢትዮጵያ ቀን (Date):</span>
                <span class="val">${ethDate.month} ${ethDate.day}, ${ethDate.year}</span>
              </div>
              <div class="row">
                <span class="label">Payment Coverage (ሽፋን):</span>
                <span class="val" style="color: #1a6b3c;">${coverageLabel}</span>
              </div>
              <div class="row">
                <span class="label">Received From (ተማሪ):</span>
                <span class="val">${payment.name_am}</span>
              </div>
              <div class="row">
                <span class="label">Payment Method (ዘዴ):</span>
                <span class="val">${payment.payment_method === 'bank' ? 'Bank (ባንክ)' : 'Cash (ጥሬ)'}</span>
              </div>
              <div class="row">
                <span class="label">Reference (ማጣቀሻ):</span>
                <span class="val">${payment.reference_number || 'N/A'}</span>
              </div>
            </div>

            <div class="amount-box">
              <div style="font-size: 11px; color: #64748b; margin-bottom: 5px;">TOTAL AMOUNT PAID (ጠቅላላ ክፍያ)</div>
              <div class="amount-large">${payment.amount.toLocaleString()} ETB</div>
            </div>

            <div class="stamp-container">
              <div class="digital-seal">
                <span class="seal-title">CERTIFIED</span>
                <span class="seal-text">ABUBEKER<br/>MEDRESA</span>
                <span style="font-size: 14px;">✔</span>
                <span class="seal-text" style="font-size: 7px;">VERIFIED</span>
              </div>
            </div>
            
            <div class="footer">
              This is an official computer-generated receipt from Abubeker Medresa Administration.
              <br/>Abubeker Medresa - Educating the Future.
            </div>
          </body>
        </html>
      `;

      const { uri } = await printToFileAsync({ html });
      await shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) {
      Alert.alert('Error', 'Failed to generate receipt.');
    }
  };

  const generateFinancialPDFReport = async () => {
    const { printToFileAsync } = await import('expo-print');
    const { shareAsync } = await import('expo-sharing');
    const { LOGO_BASE64 } = require('../../src/constants/logoBase64');
    
    // 🛡️ Audit Logic: Fetch ALL payments for a true institutional report
    const db = await (await import('../../src/lib/database')).getDatabase();
    const allPayments = await db.getAllAsync<any>(`
      SELECT p.*, s.name_am, s.name_en 
      FROM payments p 
      JOIN fees f ON p.fee_id = f.id 
      JOIN students s ON f.student_id = s.id 
      ORDER BY p.paid_date DESC
    `);

    const logoSrc = LOGO_BASE64;

    const html = `
      <html>
        <head>
          <style>
            body { font-family: sans-serif; padding: 20px; color: #1e293b; }
            .header { text-align: center; border-bottom: 2px solid #1a6b3c; padding-bottom: 15px; margin-bottom: 20px; }
            .logo { width: 80px; height: 80px; margin-bottom: 10px; border-radius: 12px; }
            .title { font-size: 24px; font-weight: bold; color: #1a6b3c; margin: 0; }
            .subtitle { font-size: 14px; color: #64748b; margin-top: 5px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #f8fafc; color: #475569; padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-transform: uppercase; }
            td { padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
            .verified { color: #059669; font-weight: bold; }
            .pending { color: #94a3b8; }
            .summary { margin-top: 30px; padding: 20px; background-color: #f1f5f9; border-radius: 12px; }
            .summary-title { font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; }
            .summary-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="${logoSrc}" class="logo" />
            <div class="title">Abubeker Medresa (አቡበከር መድረሳ)</div>
            <div class="subtitle">Official Financial Audit Report | እንደ ተከፈለ የክፍያ ሪፖርት</div>
            <div class="subtitle">Full Institutional Ledger | ጠቅላላ የፋይናንስ መግለጫ</div>
            <div class="subtitle">Generated on ${new Date().toLocaleDateString()}</div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Student (ተማሪ)</th>
                <th>Date (ቀን)</th>
                <th>Method (ዘዴ)</th>
                <th>Ref # (ማጣቀሻ)</th>
                <th>Status (ሁኔታ)</th>
                <th>Amount (ብር)</th>
              </tr>
            </thead>
            <tbody>
              ${allPayments.map(p => `
                <tr>
                  <td>${p.name_am}</td>
                  <td>${new Date(p.paid_date).toLocaleDateString()}</td>
                  <td>${p.payment_method === 'bank' ? 'Bank (ባንክ)' : 'Cash (ጥሬ)'}</td>
                  <td>${p.reference_number || '-'}</td>
                  <td class="${p.is_verified ? 'verified' : 'pending'}">${p.is_verified ? 'Verified (የተረጋገጠ)' : 'Pending (በመጠባበቅ ላይ)'}</td>
                  <td style="font-weight:bold;">${p.amount} ETB</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="summary">
            <div class="summary-title">Executive Liquidity Summary (ቁልፍ የገንዘብ ማጠቃለያ)</div>
            <div class="summary-row">
              <span>Total Bank Transfers (ባንክ ገቢ):</span>
              <span style="font-weight:bold;">${allPayments.filter(p => p.payment_method === 'bank').reduce((s, p) => s + p.amount, 0).toLocaleString()} ETB</span>
            </div>
            <div class="summary-row">
              <span>Total Cash (በጥሬ ገንዘብ):</span>
              <span style="font-weight:bold;">${allPayments.filter(p => p.payment_method === 'cash').reduce((s, p) => s + p.amount, 0).toLocaleString()} ETB</span>
            </div>
            <div class="summary-row" style="margin-top:10px; font-size:18px; color:#1e40af; border-top:2px solid #cbd5e1; padding-top:10px;">
              <span>GRAND TOTAL (ጠቅላላ ድምር):</span>
              <span>${allPayments.reduce((s, p) => s + p.amount, 0).toLocaleString()} ETB</span>
            </div>
          </div>
        </body>
      </html>
    `;

    const { uri } = await printToFileAsync({ html });
    await shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
  };

  const filteredFees = fees.filter(f => {
    const name = i18n.language === 'am' ? f.name_am : f.name_en;
    return (name ?? '').toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <View style={styles.container}>
      {/* ── FINANCE HEADER ── */}
      {/* ── COMPACT FINANCE HEADER ── */}
      <Surface style={styles.headerCompact} elevation={4}>
        <View style={styles.headerTitleRow}>
           <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <IconButton 
                icon="arrow-left" 
                iconColor="white" 
                size={22} 
                onPress={() => require('expo-router').router.replace('/(tabs)/dashboard')}
                style={{ marginLeft: -8 }} 
              />
              <View style={{ marginLeft: 4 }}>
                <Text style={styles.headerMainTitle}>{i18n.language === 'am' ? 'የገንዘብ ቁጥጥር' : 'Ledger'}</Text>
                <Surface style={styles.ethMonthBadge} elevation={1}>
                  <MaterialCommunityIcons name="calendar-star" size={12} color="white" />
                  <Text style={styles.ethMonthBadgeTxt}>{ethMonth}</Text>
                </Surface>
              </View>
           </View>
           
           <View style={{ flexDirection: 'row', gap: 6 }}>
              {user?.role === 'admin' && (
                <TouchableOpacity onPress={handleGenerateFees} style={styles.actionBtnCompact}>
                   <MaterialCommunityIcons name="calendar-refresh" size={16} color="white" />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={generateFinancialPDFReport} style={styles.actionBtnCompact}>
                 <MaterialCommunityIcons name="printer" size={16} color="white" />
              </TouchableOpacity>
              {(user?.role === 'admin' || user?.role === 'finance') && (
                 <TouchableOpacity 
                   onPress={() => require('../../src/store/usePDFStore').usePDFStore.getState().generateDefaultersPDF()} 
                   style={[styles.actionBtnCompact, { backgroundColor: '#b91c1c' }]}
                 >
                    <MaterialCommunityIcons name="phone-classic" size={16} color="white" />
                 </TouchableOpacity>
               )}
           </View>
        </View>

        <View style={styles.compactHeroRow}>
           <View style={{ flex: 1 }}>
              <Text style={styles.compactHeroLab}>{i18n.language === 'am' ? 'ጠቅላላ የተሰበሰበ' : 'TOTAL COLLECTED'}</Text>
              <Text style={styles.compactHeroVal}>{totals.paid.toLocaleString()} <Text style={{fontSize:10}}>ETB</Text></Text>
           </View>
           <View style={styles.miniOverview}>
              <View style={styles.miniOvItem}>
                 <Text style={styles.miniOvVal}>{totals.due.toLocaleString()}</Text>
                 <Text style={styles.miniOvLab}>{i18n.language === 'am' ? 'ጠቅላላ' : 'Due'}</Text>
              </View>
              <View style={styles.miniOvDivider} />
              <View style={styles.miniOvItem}>
                 <Text style={[styles.miniOvVal, { color: '#fca5a5' }]}>{(totals.due - totals.paid).toLocaleString()}</Text>
                 <Text style={styles.miniOvLab}>{i18n.language === 'am' ? 'ቀሪ' : 'Oust.'}</Text>
              </View>
           </View>
        </View>

        <View style={[styles.tabRow, { marginTop: 10 }]}>
          <TouchableOpacity 
            style={[styles.miniTab, activeTab === 'list' && styles.activeTab]} 
            onPress={() => setActiveTab('list')}
          >
            <Text style={[styles.tabTxt, activeTab === 'list' && { color: 'white' }]}>{i18n.language === 'am' ? 'ዝርዝር' : 'Ledger'}</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.miniTab, activeTab === 'history' && styles.activeTab]} 
            onPress={() => setActiveTab('history')}
          >
            <Text style={[styles.tabTxt, activeTab === 'history' && { color: 'white' }]}>{i18n.language === 'am' ? 'ታሪክ' : 'History'}</Text>
          </TouchableOpacity>
        </View>
      </Surface>

      {activeTab === 'list' ? (
        <View style={{ flex: 1 }}>
          <View style={styles.searchRow}>
            <Searchbar
              placeholder={t('search')}
              onChangeText={setSearchQuery}
              value={searchQuery}
              style={styles.search}
              inputStyle={{ fontSize: 14, minHeight: 45, paddingTop: 0, paddingBottom: 0 }}
              iconColor={COLORS.primary}
              elevation={0}
            />
          </View>

          <View style={styles.chips}>
            {(['all', 'unpaid', 'paid'] as const).map(f => (
              <Chip 
                key={f}
                selected={filter === f} 
                onPress={() => setFilter(f)} 
                style={[styles.chip, filter === f && styles.selectedChip]}
                textStyle={[styles.chipTxt, filter === f && styles.selectedChipTxt]}
              >
                {t(f)}
              </Chip>
            ))}
          </View>

          <FlatList
            data={filteredFees}
            contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
            refreshing={isLoading}
            onRefresh={() => fetchFees(filter)}
            renderItem={({ item }) => (
              <Surface style={styles.feeCard} elevation={1}>
                <TouchableOpacity 
                  style={styles.feeCardInner}
                  onPress={() => {
                    setSelectedFee(item);
                    setPayAmount((item.amount_due - item.amount_paid).toString());
                    setShowModal(true);
                  }}
                >
                  <Avatar.Text 
                    size={40} 
                    label={(item.name_am ?? 'M').substring(0, 1)} 
                    style={{ backgroundColor: COLORS.primaryFaded }} 
                    color={COLORS.primary}
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.feeStudentName}>{i18n.language === 'am' ? item.name_am : item.name_en}</Text>
                      {item.status === 'exempted' && (
                        <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#fbbf24' }}>
                           <Text style={{ fontSize: 9, fontWeight: '800', color: '#d97706' }}>
                             {i18n.language === 'am' ? 'የተቋም ድጋፍ' : 'SPONSORED'}
                           </Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                       <MaterialCommunityIcons name="phone-outline" size={12} color="#94a3b8" />
                       <Text selectable={true} style={styles.feePhoneTxt}> {item.parent_phone || '---'}</Text>
                       <View style={{ width: 1, height: 10, backgroundColor: '#e2e8f0', marginHorizontal: 8 }} />
                       <Text style={styles.feeStudentSub}>
                         {item.status === 'exempted' ? (i18n.language === 'am' ? 'ነፃ' : 'EXEMPT') : `${item.amount_paid} / ${item.amount_due} ETB`}
                       </Text>
                    </View>
                  </View>
                  <View style={styles.feeActionArea}>
                    <Text style={[styles.balanceTxt, item.status === 'paid' && { color: '#16a34a' }, item.status === 'exempted' && { color: '#fbbf24' }]}>
                      {item.status === 'exempted' ? '0' : (item.amount_due - item.amount_paid)} <Text style={{fontSize:9}}>ETB</Text>
                    </Text>
                    <MaterialCommunityIcons 
                      name={item.status === 'paid' ? "check-circle" : "chevron-right"} 
                      size={20} 
                      color={item.status === 'paid' ? "#16a34a" : "#94a3b8"} 
                    />
                  </View>
                </TouchableOpacity>
              </Surface>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <MaterialCommunityIcons name="cash-remove" size={48} color="#cbd5e1" />
                <Text style={styles.emptyTxt}>{t('noData')}</Text>
              </View>
            }
          />
        </View>
      ) : (
        <FlatList
          data={recentPayments}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 + insets.bottom }}
          renderItem={({ item }) => (
            <Surface style={styles.historyCard} elevation={1}>
               <View style={styles.historyIconWrap}>
                 <MaterialCommunityIcons name="cash-check" size={20} color="#16a34a" />
               </View>
               <View style={{ flex: 1 }}>
                 <Text style={styles.historyName}>{i18n.language === 'am' ? item.name_am : item.name_en}</Text>
                 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.historyDate}>{new Date(item.paid_date).toLocaleDateString()}</Text>
                    {item.reference_number && (
                      <View style={styles.refBadge}>
                         <Text style={styles.refBadgeTxt}>REF: {item.reference_number}</Text>
                      </View>
                    )}
                    {item.is_verified ? (
                      <MaterialCommunityIcons name="check-decagram" size={14} color="#059669" />
                    ) : (
                      <TouchableOpacity onPress={() => handleVerify(item.id)}>
                        <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={14} color="#94a3b8" />
                      </TouchableOpacity>
                    )}
                 </View>
               </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={styles.historyAmt}>+ {item.amount} <Text style={{fontSize:10}}>ETB</Text></Text>
                  <TouchableOpacity 
                    style={styles.receiptPrintBtn} 
                    onPress={() => generateReceiptPDF(item)}
                  >
                    <MaterialCommunityIcons name="printer-outline" size={16} color={COLORS.primary} />
                  </TouchableOpacity>
                </View>
            </Surface>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="history" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>{i18n.language === 'am' ? 'ምንም ግብይት የለም' : 'No transactions recorded'}</Text>
            </View>
          }
        />
      )}

      {/* ── PAYMENT MODAL ── */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior="padding" style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Surface style={[styles.modalCard, { paddingBottom: 40 + insets.bottom }]} elevation={5}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>{t('addPayment')}</Text>
                <IconButton icon="close" onPress={() => setShowModal(false)} />
              </View>
              <View style={styles.modalBody}>
                <View style={styles.modalStudentInfo}>
                  <Avatar.Text size={40} label={selectedFee?.name_am.substring(0,1)} style={{ backgroundColor: COLORS.primaryFaded }} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modName}>{selectedFee?.name_am}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                       <MaterialCommunityIcons name="phone-outline" size={12} color="#94a3b8" />
                       <Text selectable={true} style={{ fontSize: 13, color: COLORS.primary, fontWeight: '700' }}> {selectedFee?.parent_phone || '---'}</Text>
                    </View>
                    <Text style={styles.modBal}>{i18n.language === 'am' ? 'ቀሪ ዕዳ' : 'Remaining'}: {selectedFee?.amount_due - selectedFee?.amount_paid} ETB</Text>
                  </View>
                  {selectedFee?.status === 'paid' && (
                    <View style={styles.statusBadgePaid}>
                      <MaterialCommunityIcons name="check-decagram" size={14} color="#059669" />
                      <Text style={styles.statusBadgeTxtPaid}>{i18n.language === 'am' ? 'ተከፍሏል' : 'PAID'}</Text>
                    </View>
                  )}
                </View>

                {selectedFee?.status === 'paid' ? (
                  <View style={styles.paidSuccessMsg}>
                    <MaterialCommunityIcons name="shield-check" size={24} color="#059669" style={{ marginBottom: 8 }} />
                    <Text style={styles.paidSuccessTitle}>{i18n.language === 'am' ? 'ሙሉ ክፍያ ተጠናቋል' : 'Full Payment Received'}</Text>
                    <Text style={styles.paidSuccessSub}>{i18n.language === 'am' ? 'ይህ ተማሪ የወር ክፍያውን ሙሉ በሙሉ ከፍሏል።' : 'This student has settled all outstanding balances for this period.'}</Text>
                    
                    <TouchableOpacity 
                      style={styles.editPaymentBtn} 
                      onPress={() => setSelectedFee({...selectedFee, status: 'unpaid'})} // Temporarily 'unlock' for editing
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={16} color="#64748b" />
                      <Text style={styles.editPaymentTxt}>{i18n.language === 'am' ? 'ክፍያውን ማስተካከል' : 'Modify Payment Record'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <View style={styles.methodToggle}>
                      <TouchableOpacity 
                        style={[styles.methodBtn, method === 'cash' && styles.methodBtnActive]}
                        onPress={() => setMethod('cash')}
                      >
                          <MaterialCommunityIcons name="cash" size={18} color={method === 'cash' ? 'white' : COLORS.primary} />
                          <Text style={[styles.methodBtnTxt, method === 'cash' && { color: 'white' }]}>{i18n.language === 'am' ? 'ጥሬ ገንዘብ' : 'Cash'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.methodBtn, method === 'bank' && styles.methodBtnActive]}
                        onPress={() => setMethod('bank')}
                      >
                          <MaterialCommunityIcons name="bank" size={18} color={method === 'bank' ? 'white' : COLORS.primary} />
                          <Text style={[styles.methodBtnTxt, method === 'bank' && { color: 'white' }]}>{i18n.language === 'am' ? 'ባንክ' : 'Bank'}</Text>
                      </TouchableOpacity>
                    </View>

                    <TextInput
                      value={payAmount}
                      onChangeText={setPayAmount}
                      mode="outlined"
                      keyboardType="numeric"
                      label={i18n.language === 'am' ? 'የክፍያ መጠን' : 'Amount to Pay'}
                      style={styles.modalInput}
                      outlineStyle={{ borderRadius: 12 }}
                      left={<TextInput.Affix text="ETB " />}
                    />

                    {method === 'bank' && (
                      <TextInput
                        value={reference}
                        onChangeText={setReference}
                        mode="outlined"
                        label={i18n.language === 'am' ? 'የማጣቀሻ ቁጥር (Transaction ID)' : 'Reference (TG Receipt ID)'}
                        placeholder="e.g. AB123456"
                        style={[styles.modalInput, { marginTop: 15 }]}
                        outlineStyle={{ borderRadius: 12 }}
                        left={<TextInput.Icon icon="file-document-outline" color={COLORS.primary} />}
                      />
                    )}

                    <Button 
                      mode="contained" 
                      onPress={handlePay} 
                      style={styles.modalBtn} 
                      contentStyle={{ height: 50 }}
                      disabled={!payAmount || parseFloat(payAmount) <= 0}
                    >
                      {i18n.language === 'am' ? 'ክፍያውን መዝግብ' : 'Record Payment'}
                    </Button>
                  </>
                )}
              </View>
            </Surface>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  headerCompact: { backgroundColor: COLORS.primaryDark, paddingTop: 45, paddingBottom: 15, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  headerTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15, marginBottom: 12 },
  headerMainTitle: { color: 'white', fontSize: 18, fontWeight: '900' },
  actionBtnCompact: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  
  compactHeroRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 15 },
  compactHeroLab: { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '800' },
  compactHeroVal: { color: 'white', fontSize: 24, fontWeight: '900', marginTop: -2 },

  miniOverview: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 10, gap: 12 },
  miniOvItem: { alignItems: 'center' },
  miniOvVal: { color: 'white', fontSize: 13, fontWeight: '900' },
  miniOvLab: { color: 'rgba(255,255,255,0.4)', fontSize: 8, fontWeight: '700' },
  miniOvDivider: { width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.1)' },

  tabRow: { flexDirection: 'row', paddingHorizontal: 15, gap: 8 },
  miniTab: { flex: 1, paddingVertical: 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  activeTab: { backgroundColor: 'rgba(255,255,255,0.15)' },
  tabTxt: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '700' },

  ethMonthBadge: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 4, 
    backgroundColor: '#b91c1c', 
    paddingHorizontal: 8, 
    paddingVertical: 2, 
    borderRadius: 8, 
    marginTop: 2 
  },
  ethMonthBadgeTxt: { 
    fontSize: 11, 
    color: 'white', 
    fontWeight: '900' 
  },

  searchRow: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  search: { borderRadius: 16, backgroundColor: 'white', height: 44 },
  chips: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 12, gap: 6 },
  chip: { backgroundColor: 'white', borderColor: '#e2e8f0', borderWidth: 1 },
  selectedChip: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  chipTxt: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  selectedChipTxt: { color: 'white' },

  feeCard: { marginHorizontal: 12, marginVertical: 6, borderRadius: 18, backgroundColor: 'white', overflow: 'hidden' },
  feeCardInner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  feeStudentName: { fontSize: 15, fontWeight: '800', color: '#1e293b' },
  feeStudentSub: { fontSize: 12, color: '#64748b', fontWeight: '700' },
  feePhoneTxt: { fontSize: 12, color: COLORS.primary, fontWeight: '800' },
  feeActionArea: { alignItems: 'flex-end', gap: 2 },
  balanceTxt: { fontSize: 16, fontWeight: '900', color: '#b91c1c' },

  historyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', padding: 16, borderRadius: 18, marginBottom: 10 },
  historyIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  historyName: { fontSize: 14, fontWeight: '800', color: '#1e293b' },
  historyDate: { fontSize: 11, color: '#94a3b8', fontWeight: '600', marginTop: 2 },
  historyAmt: { fontSize: 15, fontWeight: '900', color: '#16a34a' },
  receiptPrintBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: COLORS.primary + '10',
    borderWidth: 1,
    borderColor: COLORS.primary + '20'
  },

  empty: { padding: 80, alignItems: 'center', gap: 12 },
  emptyTxt: { color: '#94a3b8', fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: 'white', borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingBottom: 40 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  modalBody: { padding: 20 },
  modalStudentInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8fafc', padding: 12, borderRadius: 16, marginBottom: 20 },
  modName: { fontSize: 16, fontWeight: '800' },
  modBal: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  modalInput: { backgroundColor: '#fff', fontSize: 18 },
  modalBtn: { marginTop: 25, borderRadius: 16, backgroundColor: COLORS.primaryDark },
  refBadge: { backgroundColor: COLORS.primaryFaded, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  refBadgeTxt: { fontSize: 9, fontWeight: '900', color: COLORS.primary },
  methodToggle: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  methodBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primaryFaded, backgroundColor: '#f8fafc' },
  methodBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  methodBtnTxt: { fontSize: 13, fontWeight: '800', color: COLORS.primary },

  statusBadgePaid: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#dcfce7' },
  statusBadgeTxtPaid: { fontSize: 11, fontWeight: '900', color: '#16a34a' },
  paidSuccessMsg: { alignItems: 'center', paddingVertical: 20, backgroundColor: '#f8fafc', borderRadius: 20, borderWidth: 1, borderColor: '#f1f5f9', marginTop: 10 },
  paidSuccessTitle: { fontSize: 16, fontWeight: '900', color: '#1e293b', marginBottom: 4 },
  paidSuccessSub: { fontSize: 13, color: '#64748b', textAlign: 'center', paddingHorizontal: 20, lineHeight: 18, marginBottom: 15 },
  editPaymentBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 15, borderRadius: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
  editPaymentTxt: { fontSize: 13, fontWeight: '700', color: '#64748b' },
});
