import React, { useState, useMemo, useRef } from 'react';
import {
  ScrollView, StyleSheet, View, Alert, Image,
  TouchableOpacity, Animated, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { TextInput, Text, IconButton, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useStudentStore } from '../../../src/store/useStudentStore';
import { useLevelStore } from '../../../src/store/useLevelStore';
import { COLORS } from '../../../src/constants';
import { useRouter } from 'expo-router';
import { uploadToCloudinary } from '../../../src/lib/cloudinary';

type MCIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Section card wrapper ─────────────────────────────────────────────────────
function SectionCard({ icon, title, accent, children }: {
  icon: MCIcon; title: string; accent: string; children: React.ReactNode;
}) {
  return (
    <View style={[styles.sectionCard, { borderTopColor: accent }]}>
      <View style={styles.sectionHead}>
        <View style={[styles.sectionIconWrap, { backgroundColor: accent + '14' }]}>
          <MaterialCommunityIcons name={icon} size={20} color={accent} />
        </View>
        <Text style={[styles.sectionTitle, { color: accent }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

// ── Labelled field wrapper ───────────────────────────────────────────────────
function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <View style={styles.fieldLabel}>
      <Text style={styles.fieldLabelTxt}>{label}</Text>
      {required && <Text style={styles.requiredStar}> *</Text>}
    </View>
  );
}

// ── Gender toggle ────────────────────────────────────────────────────────────
function GenderToggle({ value, onChange, t }: {
  value: 'male' | 'female'; onChange: (v: 'male' | 'female') => void; t: any;
}) {
  return (
    <View style={styles.genderRow}>
      {(['male', 'female'] as const).map(g => {
        const active = value === g;
        const color  = g === 'male' ? '#1e40af' : '#9d174d';
        const icon: MCIcon = g === 'male' ? 'face-man-outline' : 'face-woman-outline';
        return (
          <TouchableOpacity
            key={g}
            onPress={() => onChange(g)}
            style={[
              styles.genderBtn, 
              active ? { backgroundColor: color, borderColor: color } : { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' }
            ]}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name={icon} size={22} color={active ? 'white' : color} />
            <Text style={[styles.genderTxt, active ? { color: 'white' } : { color }]}>
              {g === 'male' ? t('male') : t('female')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Level chip grid ──────────────────────────────────────────────────────────
function LevelGrid({ levels, selected, onChange, lang }: {
  levels: any[]; selected: string; onChange: (id: string) => void; lang: string;
}) {
  const LEVEL_ICONS: Record<string, MCIcon> = {
    Nuraniya: 'star-outline',
    'Quran 1': 'book-open-variant',
    'Quran 2': 'book-open-page-variant-outline',
    Hifz: 'school-outline',
  };

  return (
    <View style={styles.levelGrid}>
      {levels.map(l => {
        const active = selected === l.name;
        const icon: MCIcon   = LEVEL_ICONS[l.name] || 'bookshelf';
        return (
          <TouchableOpacity
            key={l.id}
            onPress={() => onChange(l.name)}
            style={[styles.levelChip, active && styles.levelChipActive]}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons 
              name={icon} 
              size={18} 
              color={active ? COLORS.primary : '#64748b'} 
            />
            <Text style={[styles.levelChipTxt, active && styles.levelChipTxtActive]}>
              {lang === 'am' ? l.name_am : l.name}
            </Text>
            {active && <View style={styles.levelCheckDot} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Photo Picker Component ──────────────────────────────────────────────────
function PhotoPicker({ photoUri, uploading, onPickGallery, onPickCamera }: {
  photoUri: string | null;
  uploading: boolean;
  onPickGallery: () => void;
  onPickCamera: () => void;
}) {
  return (
    <View style={styles.photoPicker}>
      {/* Avatar Circle */}
      <View style={styles.photoCircle}>
        {uploading ? (
          <View style={styles.photoPlaceholder}>
            <ActivityIndicator color={COLORS.primary} size="large" />
            <Text style={styles.photoUploadingTxt}>Uploading...</Text>
          </View>
        ) : photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photoImage} />
        ) : (
          <View style={styles.photoPlaceholder}>
            <MaterialCommunityIcons name="account-circle-outline" size={60} color="#cbd5e1" />
            <Text style={styles.photoEmptyTxt}>No Photo</Text>
          </View>
        )}
        {/* Checkmark overlay when uploaded */}
        {photoUri && !uploading && (
          <View style={styles.photoCheckBadge}>
            <MaterialCommunityIcons name="check-circle" size={22} color="white" />
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.photoActions}>
        <TouchableOpacity style={styles.photoBtn} onPress={onPickCamera} activeOpacity={0.8} disabled={uploading}>
          <MaterialCommunityIcons name="camera-plus-outline" size={20} color={COLORS.primaryDark} />
          <Text style={styles.photoBtnTxt}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.photoBtn} onPress={onPickGallery} activeOpacity={0.8} disabled={uploading}>
          <MaterialCommunityIcons name="image-plus" size={20} color={COLORS.primaryDark} />
          <Text style={styles.photoBtnTxt}>Gallery</Text>
        </TouchableOpacity>
      </View>

      {photoUri && !uploading && (
        <View style={styles.photoSuccessBadge}>
          <MaterialCommunityIcons name="cloud-check" size={14} color="#16a34a" />
          <Text style={styles.photoSuccessTxt}>Uploaded to Cloud</Text>
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function AddStudentScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { addStudent, isLoading } = useStudentStore();
  const { levels, fetchLevels }   = useLevelStore();

  const [nameAm,      setNameAm]      = useState('');
  const [nameEn,      setNameEn]      = useState('');
  const [gender,      setGender]      = useState<'male' | 'female'>('male');
  const [levelName,   setLevelName]   = useState('Nuraniya');
  const [dob,         setDob]         = useState('');
  const [schoolLevel, setSchoolLevel] = useState('');
  const [parentName,  setParentName]  = useState('');
  const [phone,       setPhone]       = useState('');
  const [address,     setAddress]     = useState({ subcity: '', woreda: '', block: '', house: '' });
  const [emergency,   setEmergency]   = useState({ name: '', phone: '' });
  const [medical,     setMedical]     = useState('');
  const [isYetim,     setIsYetim]     = useState(false);
  const [lastPageLearnt, setLastPageLearnt] = useState('');
  const [hasTutor,    setHasTutor]    = useState(false);
  const [tutorDays,   setTutorDays]   = useState<string[]>([]);
  const [tutorArrivalTime, setTutorArrivalTime] = useState('');
  const [saving,      setSaving]      = useState(false);

  const toggleTutorDay = (day: string) => {
    setTutorDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  // 🛡️ Photo state
  const [photoUri,    setPhotoUri]    = useState<string | null>(null);   // local preview
  const [photoUrl,    setPhotoUrl]    = useState<string | null>(null);   // cloud URL
  const [uploading,   setUploading]   = useState(false);

  const saveScale = useRef(new Animated.Value(1)).current;

  React.useEffect(() => { fetchLevels(); }, []);

  const uniqueLevels = useMemo(() => {
    const seen = new Set<string>();
    return (levels || []).filter(l => { 
        const name = l.name;
        if (seen.has(name)) return false; 
        seen.add(name); 
        return true; 
    });
  }, [levels]);

  // Auto-resolve to the correct gendered level_id
  const resolvedLevelId = useMemo(() => {
    const match = (levels || []).find(l => l.name === levelName && l.gender === gender);
    return match?.id || (levels || []).find(l => l.name === levelName)?.id || 'l1m';
  }, [levels, levelName, gender]);

  const filled = useMemo(() => {
    let count = 0;
    if (nameAm) count++;
    if (phone)  count++;
    if (parentName) count++;
    if (dob)    count++;
    if (address.woreda) count++;
    return count;
  }, [nameAm, phone, parentName, dob, address]);

  const totalFields = 5;
  const progress = filled / totalFields;

  // ── 🛡️ Photo Handlers ──────────────────────────────────────────────────────
  const handleUpload = async (uri: string) => {
    setPhotoUri(uri);
    setUploading(true);
    const url = await uploadToCloudinary(uri);
    setUploading(false);
    if (url) {
      setPhotoUrl(url);
    } else {
      Alert.alert(
        i18n.language === 'am' ? 'ስህተት' : 'Upload Failed',
        i18n.language === 'am' ? 'ፎቶ ወደ ደመና ማስቀመጥ አልተሳካም' : 'Could not upload photo to cloud. You can continue without it.'
      );
      setPhotoUri(null);
    }
  };

  const handlePickGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        i18n.language === 'am' ? 'ፈቃድ ያስፈልጋል' : 'Permission Required',
        i18n.language === 'am' ? 'ፎቶ ለማስቀመጥ ፈቃድ ያስፈልጋል' : 'Gallery access is needed to select a photo.'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled && result.assets[0]) {
      await handleUpload(result.assets[0].uri);
    }
  };

  const handlePickCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        i18n.language === 'am' ? 'ፈቃድ ያስፈልጋል' : 'Permission Required',
        i18n.language === 'am' ? 'ካሜራ ለማስጀመር ፈቃድ ያስፈልጋል' : 'Camera access is needed to take a photo.'
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled && result.assets[0]) {
      await handleUpload(result.assets[0].uri);
    }
  };

  // ── 🛡️ Save Handler ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!nameAm || !phone || !parentName || !dob) {
      Alert.alert(t('error'), t('required'));
      return;
    }

    // Age validation (must be 4+)
    const age = new Date().getFullYear() - new Date(dob).getFullYear();
    if (age < 4) {
      Alert.alert("Invalid Age", i18n.language === 'am' ? "የተማሪው እድሜ ከ4 አመት በላይ መሆን አለበት" : "Student must be at least 4 years old.");
      return;
    }

    if (uploading) {
      Alert.alert(
        i18n.language === 'am' ? 'ጥቂት ይጠብቁ' : 'Please Wait',
        i18n.language === 'am' ? 'ፎቶ አሁንም እየተሰቀለ ነው' : 'Photo is still uploading.'
      );
      return;
    }

    Animated.sequence([
      Animated.timing(saveScale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(saveScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    setSaving(true);
    const fullAddress = `${address.subcity}, W:${address.woreda}, B:${address.block}, H:${address.house}`;
    
    const id = await addStudent(
      { 
        name_am: nameAm, 
        name_en: nameEn || nameAm, 
        gender, 
        level_id: resolvedLevelId, 
        dob,
        is_yetim: isYetim ? 1 : 0,
        enroll_date: new Date().toISOString(), 
        is_active: 1,
        photo_url: photoUrl ?? undefined,   // 🛡️ Save the cloud URL
        school_level: schoolLevel || undefined, // 🛡️ Regular/academic school level (its own DB column)
        last_page_learnt: lastPageLearnt || undefined,
        has_tutor: hasTutor ? 1 : 0,
        tutor_days: hasTutor && tutorDays.length > 0 ? tutorDays.join(', ') : undefined,
        tutor_arrival_time: hasTutor && tutorArrivalTime ? tutorArrivalTime : undefined,
        academic_year: '2019'
      },
      { 
        parent_name: parentName, 
        parent_phone: phone, 
        address: fullAddress, 
        emergency_contact: `${emergency.name}: ${emergency.phone}`,
        medical_notes: medical 
      }
    );
    setSaving(false);

    if (id) {
      Alert.alert(t('success'), t('saved'));
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialCommunityIcons name="chevron-left" size={28} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{t('addStudent')}</Text>
            <Text style={styles.headerSub}>
              {i18n.language === 'am' ? 'አቡበከር መድረሳ ኦፊሴላዊ የምዝገባ ቅጽ' : 'Abubeker Medresa Official Registration'}
            </Text>
          </View>
          
          <View style={styles.progressRing}>
             <MaterialCommunityIcons 
               name={progress === 1 ? "check-circle" : "account-edit-outline"} 
               size={20} 
               color={progress === 1 ? COLORS.accent : 'white'} 
             />
             <Text style={[styles.progressPct, progress === 1 && { color: COLORS.accent }]}>
               {Math.round(progress * 100)}%
             </Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ── 🛡️ Section 0: Photo ── */}
          <SectionCard icon="camera-account" title={i18n.language === 'am' ? 'የተማሪ ፎቶ' : 'Student Photo'} accent="#0891b2">
            <PhotoPicker
              photoUri={photoUri}
              uploading={uploading}
              onPickGallery={handlePickGallery}
              onPickCamera={handlePickCamera}
            />
          </SectionCard>

          {/* ── Section 1: Basic Info ── */}
          <SectionCard icon="account-details-outline" title={t('basicInfo')} accent={COLORS.primary}>
            <FieldLabel label={t('nameAm')} required />
            <TextInput
              value={nameAm} onChangeText={setNameAm}
              mode="outlined" style={styles.input}
              placeholder="ሙሉ ስም"
              activeOutlineColor={COLORS.primary}
              outlineColor="#e2e8f0"
              theme={{ colors: { background: 'white' } }}
            />

            <FieldLabel label={i18n.language === 'am' ? 'በፊደል (English)' : 'Full Name (English)'} />
            <TextInput
              value={nameEn} onChangeText={setNameEn}
              mode="outlined" style={styles.input}
              placeholder="Full name in English"
              activeOutlineColor={COLORS.primary}
              outlineColor="#e2e8f0"
              theme={{ colors: { background: 'white' } }}
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <FieldLabel label={i18n.language === 'am' ? 'የትውልድ ቀን' : 'Date of Birth'} required />
                <TextInput
                  value={dob} onChangeText={setDob}
                  mode="outlined" style={styles.input}
                  placeholder="YYYY-MM-DD"
                  activeOutlineColor={COLORS.primary}
                  outlineColor="#e2e8f0"
                  theme={{ colors: { background: 'white' } }}
                />
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <FieldLabel label={i18n.language === 'am' ? 'የት/ቤት ደረጃ' : 'Grade / School Level'} />
                <TextInput
                  value={schoolLevel} onChangeText={setSchoolLevel}
                  mode="outlined" style={styles.input}
                  placeholder="e.g. 5th Grade"
                  activeOutlineColor={COLORS.primary}
                  outlineColor="#e2e8f0"
                  theme={{ colors: { background: 'white' } }}
                />
              </View>
            </View>
          </SectionCard>

          {/* ── Section: Qir'at Progress & Academic Tutor ── */}
          <SectionCard icon="book-education-outline" title={i18n.language === 'am' ? 'ቂርዓት እና የአካዳሚክ አስጠኚ' : "Qir'at & Academic Tutor"} accent="#d97706">
            <FieldLabel label={i18n.language === 'am' ? 'የመጨረሻ የቀሩት ገጽ (ቂርዓት / ኑራኒያ / ቁርአን)' : 'Last Page Learnt in Qir\'at'} />
            <TextInput
              value={lastPageLearnt} onChangeText={setLastPageLearnt}
              mode="outlined" style={styles.input}
              placeholder={i18n.language === 'am' ? 'ምሳሌ፡ ኑራኒያ ገጽ 15 ወይም ጁዝ 3' : 'e.g. Nuraniya Page 15 or Juz 3'}
              activeOutlineColor="#d97706"
              outlineColor="#e2e8f0"
              theme={{ colors: { background: 'white' } }}
            />

            <FieldLabel label={i18n.language === 'am' ? 'የቤት አካዳሚክ አስጠኚ አለው?' : 'Has Academic Tutor?'} />
            <View style={styles.genderRow}>
              <TouchableOpacity
                onPress={() => setHasTutor(false)}
                style={[styles.genderBtn, !hasTutor ? { backgroundColor: '#64748b', borderColor: '#64748b' } : { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' }]}
              >
                <MaterialCommunityIcons name="close-circle-outline" size={20} color={!hasTutor ? 'white' : '#64748b'} />
                <Text style={[styles.genderTxt, !hasTutor && { color: 'white' }]}>{i18n.language === 'am' ? 'የለውም' : 'No'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setHasTutor(true)}
                style={[styles.genderBtn, hasTutor ? { backgroundColor: '#d97706', borderColor: '#d97706' } : { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' }]}
              >
                <MaterialCommunityIcons name="check-circle-outline" size={20} color={hasTutor ? 'white' : '#d97706'} />
                <Text style={[styles.genderTxt, hasTutor && { color: 'white' }]}>{i18n.language === 'am' ? 'አለው' : 'Yes'}</Text>
              </TouchableOpacity>
            </View>

            {hasTutor && (
              <View style={{ marginTop: 14 }}>
                <FieldLabel label={i18n.language === 'am' ? 'አስጠኚ ያለውባቸው ቀናት (ከ1 በላይ መምረጥ ይቻላል)' : 'Tutor Days (Select 1 or more)'} />
                <View style={styles.levelGrid}>
                  {[
                    { id: 'Mon', en: 'Monday', am: 'ሰኞ' },
                    { id: 'Tue', en: 'Tuesday', am: 'ማክሰኞ' },
                    { id: 'Wed', en: 'Wednesday', am: 'ረቡዕ' },
                    { id: 'Thu', en: 'Thursday', am: 'ሐሙስ' },
                    { id: 'Fri', en: 'Friday', am: 'አርብ' },
                    { id: 'Sat', en: 'Saturday', am: 'ቅዳሜ' },
                    { id: 'Sun', en: 'Sunday', am: 'እሁድ' },
                  ].map(day => {
                    const active = tutorDays.includes(day.en);
                    return (
                      <TouchableOpacity
                        key={day.id}
                        onPress={() => toggleTutorDay(day.en)}
                        style={[styles.levelChip, active && { backgroundColor: '#fef3c7', borderColor: '#d97706' }]}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.levelChipTxt, active && { color: '#b45309', fontWeight: '800' }]}>
                          {i18n.language === 'am' ? day.am : day.en}
                        </Text>
                        {active && <View style={[styles.levelCheckDot, { backgroundColor: '#d97706' }]} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <FieldLabel label={i18n.language === 'am' ? 'በአስጠኚ ቀናት ወደ መድረሳ የሚመጣበት ሰዓት (ለአቴንዳንስ)' : 'Expected Arrival Time on Tutor Days (for Attendance)'} />
                <TextInput
                  value={tutorArrivalTime} onChangeText={setTutorArrivalTime}
                  mode="outlined" style={styles.input}
                  placeholder={i18n.language === 'am' ? 'ምሳሌ፡ 4:30 PM ወይም 10:30' : 'e.g. 04:30 PM'}
                  activeOutlineColor="#d97706"
                  outlineColor="#e2e8f0"
                  theme={{ colors: { background: 'white' } }}
                />
              </View>
            )}
          </SectionCard>

          {/* ── Section 2: Gender ── */}
          <SectionCard icon="gender-male-female" title={t('gender')} accent="#6d28d9">
            <GenderToggle value={gender} onChange={setGender} t={t} />
          </SectionCard>

          {/* ── Section: Financial Status ── */}
          <SectionCard icon="hand-heart-outline" title={i18n.language === 'am' ? 'የገንዘብ ሁኔታ' : 'Financial Status'} accent="#16a34a">
            <View style={styles.genderRow}>
               <TouchableOpacity 
                 onPress={() => setIsYetim(false)}
                 style={[styles.genderBtn, !isYetim ? { backgroundColor: '#16a34a', borderColor: '#16a34a' } : { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' }]}
               >
                  <MaterialCommunityIcons name="cash-check" size={20} color={!isYetim ? 'white' : '#16a34a'} />
                  <Text style={[styles.genderTxt, !isYetim && { color: 'white' }]}>{i18n.language === 'am' ? 'ክፍያ አለበት' : 'Regular'}</Text>
               </TouchableOpacity>
               <TouchableOpacity 
                 onPress={() => setIsYetim(true)}
                 style={[styles.genderBtn, isYetim ? { backgroundColor: '#ea580c', borderColor: '#ea580c' } : { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' }]}
               >
                  <MaterialCommunityIcons name="heart-outline" size={20} color={isYetim ? 'white' : '#ea580c'} />
                  <Text style={[styles.genderTxt, isYetim && { color: 'white' }]}>{i18n.language === 'am' ? 'የቲም / ነጻ' : 'Yetim / Free'}</Text>
               </TouchableOpacity>
            </View>
          </SectionCard>

          {/* ── Section 3: Level ── */}
          <SectionCard icon="stairs-up" title={t('level')} accent="#0369a1">
            <LevelGrid
              levels={uniqueLevels}
              selected={levelName}
              onChange={setLevelName}
              lang={i18n.language}
            />
          </SectionCard>

          {/* ── Section 4: Address ── */}
          <SectionCard icon="map-marker-outline" title={i18n.language === 'am' ? 'የመኖሪያ አድራሻ' : 'Home Address'} accent="#0891b2">
             <View style={styles.row}>
               <TextInput
                 value={address.subcity} onChangeText={v => setAddress({...address, subcity: v})}
                 mode="outlined" style={[styles.input, { flex: 1 }]} label="Subcity"
               />
               <View style={{ width: 8 }} />
               <TextInput
                 value={address.woreda} onChangeText={v => setAddress({...address, woreda: v})}
                 mode="outlined" style={[styles.input, { flex: 1 }]} label="Woreda"
               />
             </View>
             <View style={styles.row}>
               <TextInput
                 value={address.block} onChangeText={v => setAddress({...address, block: v})}
                 mode="outlined" style={[styles.input, { flex: 1 }]} label="Block"
               />
               <View style={{ width: 8 }} />
               <TextInput
                 value={address.house} onChangeText={v => setAddress({...address, house: v})}
                 mode="outlined" style={[styles.input, { flex: 1 }]} label="House No"
               />
             </View>
          </SectionCard>

          {/* ── Section 5: Parent & Emergency ── */}
          <SectionCard icon="shield-lock-outline" title={t('confidential')} accent="#b91c1c">
            <FieldLabel label={t('parentName')} required />
            <TextInput
              value={parentName} onChangeText={setParentName}
              mode="outlined" style={styles.input}
              placeholder={i18n.language === 'am' ? 'ወላጅ ወይም አሳዳጊ ሙሉ ስም' : 'Full name of parent/guardian'}
              activeOutlineColor="#1a6b3c"
              outlineColor="#E2E8F0"
              textColor="black"
              theme={{ colors: { background: 'white' } }}
            />

            <FieldLabel label={t('phone')} required />
            <TextInput
              value={phone} onChangeText={setPhone}
              mode="outlined" style={styles.input}
              placeholder="09XX XXX XXX"
              keyboardType="phone-pad"
              activeOutlineColor="#1a6b3c"
              outlineColor="#E2E8F0"
              textColor="black"
              theme={{ colors: { background: 'white' } }}
            />

            <Divider style={{ marginVertical: 12 }} />
            <Text style={styles.subHeading}>{i18n.language === 'am' ? 'የአደጋ ጊዜ ተጠሪ' : 'Emergency Contact'}</Text>

            <TextInput
              value={emergency.name} onChangeText={v => setEmergency({...emergency, name: v})}
              mode="outlined" style={styles.input} placeholder="Contact Name"
              activeOutlineColor="#1a6b3c"
              textColor="black"
            />
            <TextInput
              value={emergency.phone} onChangeText={v => setEmergency({...emergency, phone: v})}
              mode="outlined" style={styles.input} placeholder="Contact Phone"
              keyboardType="phone-pad"
              activeOutlineColor="#1a6b3c"
              textColor="black"
            />

            <Divider style={{ marginVertical: 12 }} />
            <Text style={styles.subHeading}>{i18n.language === 'am' ? 'የጤና ማስታወሻ' : 'Medical Notes'}</Text>
            <TextInput
              value={medical} onChangeText={setMedical}
              mode="outlined" style={styles.input}
              placeholder={i18n.language === 'am' ? 'ማናቸውም የጤና ሁኔታ (አስፈላጊ ከሆነ)' : 'Any medical condition (if applicable)'}
              multiline numberOfLines={3}
              activeOutlineColor="#1a6b3c"
              textColor="black"
              theme={{ colors: { background: 'white' } }}
            />
          </SectionCard>

          {/* ── Final Rules checkbox area ── */}
          <View style={styles.rulesCard}>
             <MaterialCommunityIcons name="information" size={18} color="#64748b" />
             <Text style={styles.rulesTxt}>
               {i18n.language === 'am' 
                 ? "በመድረሳው መተዳደሪያ ደንብ እና ህጎች እስማማለሁ።" 
                 : "I agree to the Medresa's bylaws and rules."}
             </Text>
          </View>

          {/* ── Save Button area ── */}
          <View style={styles.saveArea}>
            <Animated.View style={{ transform: [{ scale: saveScale }] }}>
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving || isLoading || uploading}
                activeOpacity={0.8}
                style={[styles.saveBtn, (saving || isLoading || uploading) && { opacity: 0.7 }]}
              >
                <MaterialCommunityIcons 
                  name={saving || isLoading ? "sync" : "content-save-check-outline"} 
                  size={22} 
                  color="white" 
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.saveBtnTxt}>
                  {uploading 
                    ? (i18n.language === 'am' ? 'ፎቶ እየተሰቀለ ነው...' : 'Uploading photo...')
                    : t('save')
                  }
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>

          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#f4f6f8' },
  scroll: { flex: 1 },
  header: { backgroundColor: COLORS.primaryDark, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 18, gap: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: 'white', fontSize: 18, fontWeight: '800' },
  headerSub:   { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  progressRing: { width: 65, height: 42, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  progressPct: { color: 'white', fontSize: 13, fontWeight: '800' },
  progressTrack: { height: 3, backgroundColor: '#e2e8f0' },
  progressFill:  { height: 3, backgroundColor: COLORS.accent },

  sectionCard: { backgroundColor: 'white', marginHorizontal: 12, marginTop: 12, borderRadius: 16, padding: 16, borderTopWidth: 3, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 5 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  sectionIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 14, fontWeight: '800' },
  fieldLabel: { flexDirection: 'row', marginBottom: 6, marginTop: 4 },
  fieldLabelTxt: { fontSize: 12, fontWeight: '700', color: '#475569' },
  requiredStar: { color: '#b91c1c', fontWeight: '900' },
  input: { marginBottom: 12, fontSize: 13 },
  row: { flexDirection: 'row' },
  subHeading: { fontSize: 12, fontWeight: '800', color: '#475569', marginBottom: 10, textTransform: 'uppercase' },

  genderRow: { flexDirection: 'row', gap: 10 },
  genderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5 },
  genderTxt: { fontSize: 14, fontWeight: '700' },

  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  levelChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  levelChipActive: { backgroundColor: '#e8f5ee', borderColor: COLORS.primary },
  levelChipTxt: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  levelChipTxtActive: { color: COLORS.primary },
  levelCheckDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary, marginLeft: 2 },

  // 🛡️ Photo Picker Styles
  photoPicker: { alignItems: 'center', paddingVertical: 8, gap: 16 },
  photoCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: '#e2e8f0', overflow: 'hidden', backgroundColor: '#f8fafc', position: 'relative' },
  photoImage: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoEmptyTxt: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  photoUploadingTxt: { fontSize: 10, color: COLORS.primary, fontWeight: '700' },
  photoCheckBadge: { position: 'absolute', bottom: 4, right: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  photoActions: { flexDirection: 'row', gap: 12 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: '#f0f9ff', borderWidth: 1.5, borderColor: '#bae6fd' },
  photoBtnTxt: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark },
  photoSuccessBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  photoSuccessTxt: { fontSize: 11, fontWeight: '700', color: '#16a34a' },

  rulesCard: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 16 },
  rulesTxt: { fontSize: 11, color: '#64748b', fontWeight: '600' },

  saveArea: { marginHorizontal: 12, marginTop: 20, gap: 8 },
  saveBtn: { backgroundColor: COLORS.primaryDark, borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: COLORS.primaryDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  saveBtnTxt: { color: 'white', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
});
