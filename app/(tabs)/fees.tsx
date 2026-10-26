import React, { useEffect, useMemo, useState } from 'react';
import {
  View, StyleSheet, FlatList, TouchableOpacity, Modal,
  KeyboardAvoidingView, Platform, Alert, ScrollView
} from 'react-native';
import { Text, Surface, Searchbar, Chip, Avatar, TextInput, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFeeStore } from '../../src/store/useFeeStore';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { COLORS } from '../../src/constants';
import {
  toEthiopicDate, getPaymentMonthOptions, PaymentMonthOption, PREV_YEAR_ARREARS_LABEL
} from '../../src/lib/dateUtils';
import { allocatePayment, totalDue, AllocationInput } from '../../src/lib/feeAllocation';

export default function FeesScreen() {
  const { i18n } = useTranslation();
  const am = i18n.language === 'am';
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  const {
    fees, totals, fetchFees, addMultiMonthPayment, editPayment,
    getPaidByMonth, getRecentPayments
  } = useFeeStore();
  const { defaultFee, fetchSettings } = useSettingsStore();

  const canManage = user?.role === 'admin' || user?.role === 'finance';

  // Recomputed on every render (cheap) so the badge/selection never goes stale after a month change.
  const ethInfo = toEthiopicDate(new Date());

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'unpaid' | 'paid' | 'all'>('all');
  const [activeTab, setActiveTab] = useState<'list' | 'history'>('list');
  const [recentPayments, setRecentPayments] = useState<any[]>([]);

  // Record-payment modal
  const [showModal, setShowModal] = useState(false);
  const [selectedFee, setSelectedFee] = useState<any>(null);
  const [monthOptions, setMonthOptions] = useState<PaymentMonthOption[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([ethInfo.monthName]);
  const [payAmount, setPayAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank'>('cash');
  const [reference, setReference] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Edit-payment modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPaymentToEdit, setSelectedPaymentToEdit] = useState<any>(null);
  const [editAmountText, setEditAmountText] = useState('');
  const [editReason, setEditReason] = useState('');

  const monthlyFee = Number(defaultFee) || 0;

  useEffect(() => {
    fetchSettings();
    fetchFees(filter);
    loadHistory();
  }, [filter]);

  const loadHistory = async () => setRecentPayments(await getRecentPayments());

  // What a selected month/arrears can still absorb. Unknown monthly fee → no cap (Infinity).
  const toAllocationInput = (o: PaymentMonthOption): AllocationInput => ({
    label: o.label,
    cap: o.kind === 'arrears' || monthlyFee > 0 ? o.remaining : Infinity,
    order: o.monthIndex // arrears = -1 → paid first, then oldest month → newest
  });

  const selectedOptions = monthOptions.filter(o => selectedMonths.includes(o.label));
  const selectedDue = totalDue(selectedOptions.map(toAllocationInput));

  const allocation = useMemo(() => {
    const amt = parseFloat(payAmount);
    return allocatePayment(Number.isFinite(amt) ? amt : 0, selectedOptions.map(toAllocationInput));
  }, [payAmount, selectedMonths, monthOptions, monthlyFee]);

  // ── Record payment ───────────────────────────────────────────────
  const openPaymentModal = async (item: any) => {
    const paidByMonth = await getPaidByMonth(item.id);
    const options = getPaymentMonthOptions({
      date: new Date(),
      paidByMonth,
      monthlyFee,
      prevYearArrears: item.prev_year_arrears || 0
    });
    const current = options[0]; // current Ethiopian month is always first → auto-selected

    setSelectedFee(item);
    setMonthOptions(options);
    setSelectedMonths([current.label]);
    setPayAmount(current.remaining > 0 ? String(current.remaining) : '');
    setMethod('cash');
    setReference('');
    setShowModal(true);
  };

  // Tick / untick a month; the amount resets to the total still due for the ticked months.
  const toggleMonth = (opt: PaymentMonthOption) => {
    if (opt.disabled) return;
    const next = selectedMonths.includes(opt.label)
      ? selectedMonths.filter(l => l !== opt.label)
      : [...selectedMonths, opt.label];
    setSelectedMonths(next);
    const due = totalDue(monthOptions.filter(o => next.includes(o.label)).map(toAllocationInput));
    setPayAmount(due && due > 0 ? String(due) : '');
  };

  const handlePay = async () => {
    if (!selectedFee || isSaving) return;
    const amt = parseFloat(payAmount);
    if (selectedMonths.length === 0) {
      Alert.alert('ስህተት', 'ቢያንስ አንድ ወር ይምረጡ');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('ስህተት', 'እባክዎን ትክክለኛ የብር መጠን ያስገቡ');
      return;
    }
    if (allocation.unallocated > 0) {
      Alert.alert('ስህተት', `የገባው መጠን ከተመረጡት ወራት ቀሪ በ ${allocation.unallocated} ETB ይበልጣል። ተጨማሪ ወር ይምረጡ ወይም መጠኑን ይቀንሱ።`);
      return;
    }
    if (method === 'bank' && !reference.trim()) {
      Alert.alert('ስህተት', 'የባንክ ማጣቀሻ ቁጥር ያስገቡ');
      return;
    }

    setIsSaving(true); // blocks double-tap → no accidental duplicate payments
    try {
      await addMultiMonthPayment(
        selectedFee.id,
        allocation.lines.map(l => ({ targetMonth: l.label, amount: l.amount })),
        user?.id || 'unknown', method, reference.trim()
      );
      setShowModal(false);
      setSelectedFee(null);
      setPayAmount('');
      loadHistory();
    } catch (e: any) {
      if (e?.message === 'DUPLICATE_REFERENCE') {
        Alert.alert('የተደገመ ማጣቀሻ', 'ይህ የባንክ ማጣቀሻ ቁጥር ከዚህ በፊት ጥቅም ላይ ውሏል።');
      } else {
        Alert.alert('ስህተት', e?.message || 'ክፍያውን መመዝገብ አልተቻለም');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ── Edit payment (fix mistakes, no duplicate row) ─────────────────
  const handleOpenEditPayment = (record: any) => {
    setSelectedPaymentToEdit(record);
    setEditAmountText(String(record.amount));
    setEditReason('');
    setShowEditModal(true);
  };

  const handleSaveEditPayment = async () => {
    if (!selectedPaymentToEdit || isSaving) return;
    const newAmt = parseFloat(editAmountText);
    if (!Number.isFinite(newAmt) || newAmt < 0) {
      Alert.alert('ስህተት', 'እባክዎን ትክክለኛ የብር መጠን ያስገቡ');
      return;
    }
    if (newAmt === selectedPaymentToEdit.amount) {
      setShowEditModal(false);
      return;
    }

    setIsSaving(true);
    try {
      await editPayment(
        selectedPaymentToEdit.id, newAmt, user?.id || 'admin',
        editReason.trim() || 'በስህተት የተመዘገበ ክፍያ ማስተካከያ'
      );
      setShowEditModal(false);
      setSelectedPaymentToEdit(null);
      loadHistory();
      Alert.alert('ተስተካክሏል', `የክፍያ መጠኑ ወደ ${newAmt} ETB ተስተካክሏል`);
    } catch (e: any) {
      Alert.alert('ስህተት', e?.message || 'ክፍያውን ማስተካከል አልተቻለም');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredFees = fees.filter(f => {
    const name = am ? f.name_am : f.name_en;
    return (name ?? '').toLowerCase().includes(searchQuery.toLowerCase());
  });

  const optionSuffix = (o: PaymentMonthOption) => {
    if (o.kind === 'current') return o.remaining > 0 || monthlyFee <= 0 ? ' (የዚህ ወር)' : ' (የዚህ ወር · ተከፍሏል)';
    if (o.kind === 'future') return ' (ቅድሚያ)';
    if (o.kind === 'past') return o.remaining > 0 ? ` (ውዝፍ · ቀሪ ${o.remaining})` : ' (ውዝፍ)';
    return o.remaining > 0 ? ` (ቀሪ ${o.remaining})` : '';
  };

  return (
    <View style={styles.container}>
      {/* ── 3-METRIC FINANCIAL COLLECTION HEADER ── */}
      <Surface style={styles.headerCompact} elevation={4}>
        <View style={styles.headerTitleRow}>
          <View style={{ marginLeft: 4 }}>
            <Text style={styles.headerMainTitle}>{am ? 'የገንዘብ ቁጥጥር' : 'Fee Ledger'}</Text>
            <Surface style={styles.ethMonthBadge} elevation={1}>
              <MaterialCommunityIcons name="calendar-star" size={12} color="white" />
              <Text style={styles.ethMonthBadgeTxt}>{ethInfo.monthName} {ethInfo.year}</Text>
            </Surface>
          </View>
        </View>

        <View style={styles.statsThreeRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{am ? 'በዚህ ወር የተሰበሰበ' : 'This Month'}</Text>
            <Text style={[styles.statVal, { color: '#4ade80' }]}>{totals.currentMonthCollected.toLocaleString()} ETB</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{am ? 'የተሰበሰበ ውዝፍ' : 'Arrears Collected'}</Text>
            <Text style={[styles.statVal, { color: '#fbbf24' }]}>{totals.arrearsCollected.toLocaleString()} ETB</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{am ? 'ጠቅላላ የተሰበሰበ' : 'Total Collected'}</Text>
            <Text style={[styles.statVal, { color: '#ffffff' }]}>{totals.totalCollected.toLocaleString()} ETB</Text>
          </View>
        </View>

        {/* Outstanding, shown separately: previous-year arrears vs this year's unpaid */}
        <View style={styles.owedRow}>
          <Text style={styles.owedTxt}>
            {PREV_YEAR_ARREARS_LABEL}: <Text style={{ fontWeight: '900', color: '#fca5a5' }}>{totals.prevYearArrears.toLocaleString()} ETB</Text>
          </Text>
          <Text style={styles.owedTxt}>
            የዚህ ዓመት ክፍያ: <Text style={{ fontWeight: '900', color: '#ffffff' }}>{totals.currentYearUnpaid.toLocaleString()} ETB</Text>
          </Text>
        </View>

        <View style={[styles.tabRow, { marginTop: 12 }]}>
          <TouchableOpacity style={[styles.miniTab, activeTab === 'list' && styles.activeTab]} onPress={() => setActiveTab('list')}>
            <Text style={[styles.tabTxt, activeTab === 'list' && { color: 'white' }]}>{am ? 'ዝርዝር' : 'Ledger'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.miniTab, activeTab === 'history' && styles.activeTab]} onPress={() => setActiveTab('history')}>
            <Text style={[styles.tabTxt, activeTab === 'history' && { color: 'white' }]}>{am ? 'የክፍያ ታሪክ' : 'History'}</Text>
          </TouchableOpacity>
        </View>
      </Surface>

      {activeTab === 'list' ? (
        <View style={{ flex: 1 }}>
          <Searchbar
            placeholder={am ? 'ተማሪ ፈልግ' : 'Search student'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchbar}
          />
          <View style={styles.filterRow}>
            {(['all', 'unpaid', 'paid'] as const).map(f => (
              <Chip key={f} selected={filter === f} onPress={() => setFilter(f)}>
                {f === 'all' ? (am ? 'ሁሉም' : 'All') : f === 'unpaid' ? (am ? 'ያልከፈሉ' : 'Unpaid') : (am ? 'የከፈሉ' : 'Paid')}
              </Chip>
            ))}
          </View>

          <FlatList
            data={filteredFees}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
            renderItem={({ item }) => (
              <Surface style={styles.feeCard} elevation={1}>
                <TouchableOpacity
                  style={styles.feeCardInner}
                  disabled={!canManage}
                  onPress={() => openPaymentModal(item)}
                >
                  <Avatar.Text size={40} label={(item.name_am ?? 'M').substring(0, 1)} style={{ backgroundColor: COLORS.primaryFaded }} color={COLORS.primary} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.feeStudentName}>{am ? item.name_am : item.name_en}</Text>

                    {/* Previous-year arrears and this year's unpaid, always separate */}
                    <View style={{ marginTop: 4 }}>
                      {(item.prev_year_arrears ?? 0) > 0 && (
                        <Text style={{ fontSize: 11, color: '#dc2626', fontWeight: '700' }}>
                          {PREV_YEAR_ARREARS_LABEL}: {item.prev_year_arrears} ETB
                        </Text>
                      )}
                      <Text style={{ fontSize: 11, color: '#475569', fontWeight: '600' }}>
                        የዚህ ዓመት ክፍያ: {item.current_year_unpaid ?? 0} ETB
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </Surface>
            )}
          />
        </View>
      ) : (
        <FlatList
          data={recentPayments}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 + insets.bottom }}
          renderItem={({ item }) => {
            const wasEdited = typeof item.notes === 'string' && item.notes.includes('Edited by');
            return (
              <Surface style={styles.historyCard} elevation={1}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyName}>{am ? item.name_am : item.name_en}</Text>
                  <Text style={styles.historyDate}>
                    {new Date(item.paid_date).toLocaleDateString()} | {item.target_month || '—'}
                    {item.is_arrears ? ' · ውዝፍ' : ''}{wasEdited ? ' · ተስተካክሏል' : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.historyAmt}>+ {item.amount} ETB</Text>
                  {canManage && (
                    <TouchableOpacity onPress={() => handleOpenEditPayment(item)} style={styles.editBtnSmall}>
                      <MaterialCommunityIcons name="pencil" size={14} color="#0284c7" />
                      <Text style={{ fontSize: 10, color: '#0284c7', fontWeight: '700' }}>ኤዲት/ማስተካከያ</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </Surface>
            );
          }}
        />
      )}

      {/* ── RECORD PAYMENT MODAL ── */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <Surface style={styles.modalCard} elevation={5}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>የወር ክፍያ መዝግብ</Text>
              {selectedFee && (
                <Text style={{ color: '#64748b', marginTop: 2 }}>{am ? selectedFee.name_am : selectedFee.name_en}</Text>
              )}

              <Text style={styles.sectionLabel}>የክፍያ ወር/ዓይነት መምረጫ (ባለብዙ ወር):</Text>
              <View style={styles.chipWrap}>
                {monthOptions.map(o => (
                  <Chip
                    key={o.key}
                    mode="outlined"
                    showSelectedCheck
                    selected={selectedMonths.includes(o.label)}
                    disabled={o.disabled}
                    onPress={() => toggleMonth(o)}
                    style={
                      o.kind === 'current' ? { backgroundColor: '#dcfce7' }
                      : o.kind === 'arrears' ? { backgroundColor: o.disabled ? '#f1f5f9' : '#fee2e2' }
                      : o.kind === 'future' ? { backgroundColor: '#e0f2fe' }
                      : undefined
                    }
                  >
                    {o.label}{optionSuffix(o)}
                  </Chip>
                ))}
              </View>

              {/* Total still due for the ticked months */}
              <View style={styles.dueRow}>
                <Text style={styles.dueLbl}>ጠቅላላ ቀሪ ({selectedMonths.length} ወር)</Text>
                <Text style={styles.dueVal}>{selectedDue === null ? '—' : `${selectedDue.toLocaleString()} ETB`}</Text>
              </View>

              <View style={styles.chipWrap}>
                <Chip selected={method === 'cash'} onPress={() => setMethod('cash')}>ጥሬ ገንዘብ</Chip>
                <Chip selected={method === 'bank'} onPress={() => setMethod('bank')}>ባንክ</Chip>
              </View>

              <TextInput
                value={payAmount}
                onChangeText={setPayAmount}
                keyboardType="numeric"
                label="የክፍያ መጠን (ETB)"
                mode="outlined"
              />
              {method === 'bank' && (
                <TextInput
                  value={reference}
                  onChangeText={setReference}
                  label="የባንክ ማጣቀሻ ቁጥር"
                  mode="outlined"
                  style={{ marginTop: 8 }}
                />
              )}

              {/* Live allocation preview: how the amount is spread over the ticked months */}
              {allocation.lines.length > 0 && (
                <View style={styles.previewBox}>
                  <Text style={styles.previewTitle}>የክፍያ ስርጭት</Text>
                  {allocation.lines.map(l => (
                    <View key={l.label} style={styles.previewRow}>
                      <Text style={styles.previewTxt}>{l.label}</Text>
                      <Text style={styles.previewAmt}>{l.amount.toLocaleString()} ETB</Text>
                    </View>
                  ))}
                  {allocation.unfunded.length > 0 && (
                    <Text style={styles.previewWarn}>ያልተሸፈነ: {allocation.unfunded.join('፣ ')}</Text>
                  )}
                  {allocation.unallocated > 0 && (
                    <Text style={styles.previewWarn}>ከተመረጡት ወራት ቀሪ በ {allocation.unallocated} ETB ይበልጣል</Text>
                  )}
                </View>
              )}

              <View style={styles.btnRow}>
                <Button mode="outlined" onPress={() => setShowModal(false)} disabled={isSaving}>ሰርዝ</Button>
                <Button mode="contained" onPress={handlePay} loading={isSaving} disabled={isSaving || allocation.lines.length === 0}>መዝግብ</Button>
              </View>
            </ScrollView>
          </Surface>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── EDIT PAYMENT MODAL ── */}
      <Modal visible={showEditModal} transparent animationType="fade" onRequestClose={() => setShowEditModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <Surface style={[styles.modalCard, { padding: 24 }]} elevation={5}>
            <Text style={styles.modalTitle}>በስህተት የተመዘገበ ክፍያ ማስተካከያ</Text>
            {selectedPaymentToEdit && (
              <Text style={{ color: '#0f172a', fontWeight: '700', marginTop: 6 }}>
                {am ? selectedPaymentToEdit.name_am : selectedPaymentToEdit.name_en} · {selectedPaymentToEdit.target_month || '—'} · አሁን: {selectedPaymentToEdit.amount} ETB
              </Text>
            )}
            <Text style={{ color: '#64748b', marginVertical: 8 }}>
              ለምሳሌ 1000 ETB ከነበረ ወደ 500 ETB ሲስተካከል በነበረው record ላይ ብቻ ይቀየራል፤ አዲስ record አይጨምርም፣ ጠቅላላ የተከፈለውም በልዩነቱ ይቀነሳል።
            </Text>

            <TextInput
              value={editAmountText}
              onChangeText={setEditAmountText}
              keyboardType="numeric"
              label="የተስተካከለ ትክክለኛ ክፍያ (ETB)"
              mode="outlined"
            />
            <TextInput
              value={editReason}
              onChangeText={setEditReason}
              label="የማስተካከያ ምክንያት (አማራጭ)"
              mode="outlined"
              style={{ marginTop: 8 }}
            />

            <View style={styles.btnRow}>
              <Button mode="outlined" onPress={() => setShowEditModal(false)} disabled={isSaving}>ሰርዝ</Button>
              <Button mode="contained" onPress={handleSaveEditPayment} buttonColor="#0284c7" loading={isSaving} disabled={isSaving}>አስተካክል</Button>
            </View>
          </Surface>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  headerCompact: { backgroundColor: '#1a6b3c', paddingTop: 40, paddingBottom: 15, paddingHorizontal: 15, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerMainTitle: { color: 'white', fontSize: 18, fontWeight: '900' },
  ethMonthBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#b91c1c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 2, alignSelf: 'flex-start' },
  ethMonthBadgeTxt: { fontSize: 11, color: 'white', fontWeight: '900' },
  statsThreeRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 10, marginTop: 12, alignItems: 'center' },
  statBox: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 9, color: 'rgba(255,255,255,0.7)', fontWeight: '700', textAlign: 'center' },
  statVal: { fontSize: 12, fontWeight: '900', marginTop: 2 },
  statDivider: { width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.2)' },
  owedRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 4 },
  owedTxt: { fontSize: 10, color: 'rgba(255,255,255,0.75)', fontWeight: '700' },
  tabRow: { flexDirection: 'row', gap: 8 },
  miniTab: { flex: 1, paddingVertical: 6, borderRadius: 10, alignItems: 'center' },
  activeTab: { backgroundColor: 'rgba(255,255,255,0.2)' },
  tabTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700' },
  searchbar: { marginHorizontal: 12, marginTop: 10, borderRadius: 14 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  feeCard: { marginHorizontal: 12, marginVertical: 6, borderRadius: 16, backgroundColor: 'white' },
  feeCardInner: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  feeStudentName: { fontSize: 14, fontWeight: '800' },
  historyCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', padding: 14, borderRadius: 14, marginBottom: 8 },
  historyName: { fontSize: 14, fontWeight: '800' },
  historyDate: { fontSize: 11, color: '#64748b' },
  historyAmt: { fontSize: 14, fontWeight: '900', color: '#16a34a' },
  editBtnSmall: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4, backgroundColor: '#e0f2fe', borderRadius: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: 'white', borderRadius: 20, padding: 20, maxHeight: '90%' },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  sectionLabel: { fontWeight: '700', marginTop: 10, marginBottom: 5 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 15 },
  dueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f0fdf4', borderRadius: 10, padding: 10, marginBottom: 10 },
  dueLbl: { fontSize: 12, fontWeight: '700', color: '#166534' },
  dueVal: { fontSize: 14, fontWeight: '900', color: '#166534' },
  previewBox: { backgroundColor: '#f8fafc', borderRadius: 10, padding: 10, marginTop: 10 },
  previewTitle: { fontSize: 11, fontWeight: '800', color: '#475569', marginBottom: 4 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  previewTxt: { fontSize: 12, color: '#0f172a' },
  previewAmt: { fontSize: 12, fontWeight: '800', color: '#16a34a' },
  previewWarn: { fontSize: 11, color: '#dc2626', fontWeight: '700', marginTop: 4 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15 }
});
