import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput as RNTextInput } from 'react-native';
import { Text, Surface, Button, IconButton, Avatar, Modal, Portal, TextInput, Chip, ActivityIndicator, Searchbar, Divider } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../src/store/useAuthStore';
import { getDatabase } from '../../src/lib/database';
import { COLORS } from '../../src/constants';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useGradeStore } from '../../src/store/useGradeStore';


const KITAB_TEAMS = ['Team Nuraniya', 'Team Quran 1', 'Team Hifz'];

// ── ISOLATED ADD MODAL ───────────────────────────────────────────────────────
const AddUstazModal = React.memo(({ visible, onDismiss, onSave, subjects, isSaving, i18n }: any) => {
  const formRef = useRef({ username: '', name: '', phone: '', password: '' });
  const [expertise, setExpertise] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('ustaz');

  useEffect(() => {
    if (visible) {
      formRef.current = { username: '', name: '', phone: '', password: '' };
      setExpertise([]);
      setSelectedRole('ustaz');
    }
  }, [visible]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
          <Text style={styles.modalTitle}>Register New Ustaz</Text>
          <TextInput 
            label="Username (Login ID)" 
            defaultValue="" 
            onChangeText={(v) => { formRef.current.username = v; }} 
            mode="outlined" 
            style={styles.input} 
            autoCapitalize="none"
          />
          <TextInput 
            label="Full Name" 
            defaultValue="" 
            onChangeText={(v) => { formRef.current.name = v; }} 
            mode="outlined" 
            style={styles.input} 
          />
          <TextInput 
            label="Phone Number" 
            defaultValue="" 
            onChangeText={(v) => { formRef.current.phone = v; }} 
            mode="outlined" 
            style={styles.input} 
            keyboardType="phone-pad" 
          />
          <TextInput 
            label="System Password" 
            defaultValue="" 
            onChangeText={(v) => { formRef.current.password = v; }} 
            mode="outlined" 
            style={styles.input} 
            secureTextEntry 
          />

          <Text style={styles.label}>Account Role:</Text>
          <View style={styles.chipGrid}>
            {['ustaz', 'finance', 'committee'].map((r) => (
              <Chip
                key={r}
                selected={selectedRole === r}
                onPress={() => setSelectedRole(r)}
                style={[styles.chip, selectedRole === r ? { backgroundColor: COLORS.primaryDark } : {}]}
                selectedColor="white"
              >
                {r.toUpperCase()}
              </Chip>
            ))}
          </View>
          {selectedRole === 'ustaz' && (
            <>
              <Text style={styles.label}>Select Expertise (Subjects):</Text>
              <View style={styles.chipGrid}>
                {subjects.map((s: any) => (
                  <Chip
                    key={s.id}
                    selected={expertise.includes(s.id)}
                    onPress={() => {
                      if (expertise.includes(s.id)) setExpertise(expertise.filter(id => id !== s.id));
                      else setExpertise([...expertise, s.id]);
                    }}
                    selectedColor="white"
                    style={[styles.chip, expertise.includes(s.id) ? { backgroundColor: COLORS.primary } : {}]}
                  >
                    {i18n.language === 'am' ? s.name_am : s.name}
                  </Chip>
                ))}
              </View>
            </>
          )}
        </ScrollView>
        <Button 
          mode="contained" 
          onPress={() => onSave(formRef.current.username, formRef.current.name, formRef.current.phone, formRef.current.password, expertise, selectedRole)} 
          loading={isSaving} 
          style={styles.confirmBtn} 
          contentStyle={{ height: 50 }}
        >
          CREATE ACCOUNT
        </Button>
        <Button onPress={onDismiss} mode="text">Cancel</Button>
      </Modal>
    </Portal>
  );
});

// ── ISOLATED EDIT MODAL ───────────────────────────────────────────────────────
const EditUstazModal = React.memo(({ visible, onDismiss, onSave, onDelete, initialData, subjects, isUpdating, i18n }: any) => {
  const formRef = useRef({ username: '', name: '', phone: '', password: '' });
  const [expertise, setExpertise] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  useEffect(() => {
    if (visible && initialData) {
      formRef.current = { 
        username: initialData.username || '',
        name: initialData.name || '', 
        phone: initialData.phone || '', 
        password: '' 
      };
      
      let initialTeams = [];
      if (initialData.kitab_teams) {
        try {
          initialTeams = JSON.parse(initialData.kitab_teams);
          if (!Array.isArray(initialTeams)) initialTeams = [initialData.kitab_teams];
        } catch (e) {
          initialTeams = [initialData.kitab_teams];
        }
      }
      setTeams(initialTeams);
      setExpertise(initialData.expertise ? initialData.expertise.map((s: any) => s.id) : []);
    }
  }, [visible, initialData]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
          <Text style={styles.modalTitle}>Edit Staff Profile</Text>
          <TextInput 
            key={`user_${initialData?.id}`}
            label="Username (Login ID)" 
            defaultValue={initialData?.username || ''} 
            onChangeText={(v) => { formRef.current.username = v; }} 
            mode="outlined" 
            style={styles.input} 
            autoCapitalize="none"
          />
          <TextInput 
            key={`name_${initialData?.id}`}
            label="Full Name" 
            defaultValue={initialData?.name || ''} 
            onChangeText={(v) => { formRef.current.name = v; }} 
            mode="outlined" 
            style={styles.input} 
          />
          <TextInput 
            key={`phone_${initialData?.id}`}
            label="Phone Number" 
            defaultValue={initialData?.phone || ''} 
            onChangeText={(v) => { formRef.current.phone = v; }} 
            mode="outlined" 
            style={styles.input} 
            keyboardType="phone-pad" 
          />
          <TextInput 
            key={`pass_${initialData?.id}`}
            label="Reset Password (Leave blank to keep current)" 
            defaultValue="" 
            onChangeText={(v) => { formRef.current.password = v; }} 
            mode="outlined" 
            style={styles.input} 
            secureTextEntry 
          />
          
          <Text style={styles.label}>Update Expertise (Subjects):</Text>
          <View style={styles.chipGrid}>
            {subjects.map((s: any) => (
              <Chip
                key={s.id}
                selected={expertise.includes(s.id)}
                onPress={() => {
                  if (expertise.includes(s.id)) setExpertise(expertise.filter(id => id !== s.id));
                  else setExpertise([...expertise, s.id]);
                }}
                selectedColor="white"
                style={[styles.chip, expertise.includes(s.id) ? { backgroundColor: COLORS.primary } : {}]}
              >
                {i18n.language === 'am' ? s.name_am : s.name}
              </Chip>
            ))}
          </View>
          <Text style={styles.label}>Authorized Kitab Teams:</Text>
          <View style={styles.chipGrid}>
            {KITAB_TEAMS.map(team => (
              <Chip
                key={team}
                selected={teams.includes(team)}
                onPress={() => {
                  if (teams.includes(team)) setTeams(teams.filter(t => t !== team));
                  else setTeams([...teams, team]);
                }}
                selectedColor="white"
                style={[styles.chip, teams.includes(team) ? { backgroundColor: '#3b82f6' } : {}]}
              >
                {team}
              </Chip>
            ))}
          </View>
        </ScrollView>
        <Button 
          mode="contained" 
          onPress={() => onSave(formRef.current.username, formRef.current.name, formRef.current.phone, formRef.current.password, expertise, teams)} 
          loading={isUpdating} 
          style={styles.confirmBtn} 
          contentStyle={{ height: 50 }}
        >
          SAVE CHANGES
        </Button>

        <TouchableOpacity 
          onPress={() => onDelete(initialData.id)}
          style={{ marginTop: 20, padding: 10 }}
        >
           <Text style={{ color: '#ef4444', textAlign: 'center', fontWeight: 'bold' }}>
             PERMANENTLY DELETE STAFF ACCOUNT
           </Text>
        </TouchableOpacity>

        <Button onPress={onDismiss} mode="text" style={{ marginTop: 10 }}>Cancel</Button>
      </Modal>
    </Portal>
  );
});

export default function ManageTeachersScreen() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const { subjects, fetchSubjects } = useGradeStore();

  const [ustazs, setUstazs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newExpertise, setNewExpertise] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUstaz, setEditingUstaz] = useState<any>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    loadData();
    fetchSubjects();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    const users = await useAuthStore.getState().getUstazs();

    // Enrich with subjects
    const db = await getDatabase();
    const enriched = await Promise.all(users.map(async (u) => {
      const subs = await db.getAllAsync<any>(
        'SELECT s.id, s.name_am, s.name FROM subjects s JOIN teacher_subjects ts ON s.id = ts.subject_id WHERE ts.teacher_id = ?',
        [u.id]
      );
      return { ...u, expertise: subs };
    }));

    setUstazs(enriched);
    setIsLoading(false);
  };

  const handleAddUstaz = async (newUsername: string, newName: string, newPhone: string, newPassword: string, newExpertise: string[], selectedRole: string) => {
    if (!newUsername || !newName || !newPhone || !newPassword) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    setIsSaving(true);
    const success = await useAuthStore.getState().addUser(newUsername, newName, newPhone, newPassword, selectedRole as any);
    if (success) {
      const db = await getDatabase();
      const all = await useAuthStore.getState().getUstazs();
      const fresh = all.find(u => u.phone === newPhone);
      if (fresh) {
        // Update Kitab Teams (Default empty array)
        await db.runAsync('UPDATE users SET kitab_teams = ? WHERE id = ?', [JSON.stringify([]), fresh.id]);
        
        const { queueSync } = require('../../src/lib/database');
        await queueSync('users', fresh.id, 'insert');

        if (newExpertise.length > 0) {
          for (const sId of newExpertise) {
            await db.runAsync('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?,?)', [fresh.id, sId]);
            await queueSync('teacher_subjects', `${fresh.id},${sId}`, 'insert');
          }
        }
      }
      Alert.alert('Success', 'Ustaz account created!');
      setShowAddModal(false);
      loadData();
    } else {
      Alert.alert('Error', 'Failed to create account');
    }
    setIsSaving(false);
  };

  const openEditModal = (u: any) => {
    setEditingUstaz(u);
    setShowEditModal(true);
  };

  const handleUpdateUstaz = async (editUsername: string, editName: string, editPhone: string, editPassword: string, editExpertise: string[], editTeams: string[]) => {
    if (!editUsername || !editName || !editPhone || !editingUstaz) return;
    setIsUpdating(true);
    const db = await getDatabase();
    try {
      // 🛡️ UNIQUE CHECK: Ensure the new username/phone doesn't belong to ANOTHER user
      const existingUser = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM users WHERE (phone = ? OR username = ?) AND id != ?',
        [editPhone.trim(), editUsername.trim(), editingUstaz.id]
      );
      if (existingUser) {
        Alert.alert('Error', 'This username or phone number is already registered to another staff member.');
        setIsUpdating(false);
        return;
      }

      const teamsStr = JSON.stringify(editTeams);
      if (editPassword) {
        const Crypto = require('expo-crypto');
        const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, editPassword);
        await db.runAsync('UPDATE users SET username = ?, name = ?, phone = ?, kitab_teams = ?, password_hash = ? WHERE id = ?', [editUsername.trim(), editName, editPhone.trim(), teamsStr, hashed, editingUstaz.id]);
      } else {
        await db.runAsync('UPDATE users SET username = ?, name = ?, phone = ?, kitab_teams = ? WHERE id = ?', [editUsername.trim(), editName, editPhone.trim(), teamsStr, editingUstaz.id]);
      }

      // 🛡️ SYNC PROFILE CHANGE
      const { queueSync } = require('../../src/lib/database');
      const { triggerBackgroundSync } = require('../../src/lib/sync');
      
      await queueSync('users', editingUstaz.id, 'update');

      // Update expertise
      await db.runAsync('DELETE FROM teacher_subjects WHERE teacher_id = ?', [editingUstaz.id]);
      for (const sId of editExpertise) {
        await db.runAsync('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?,?)', [editingUstaz.id, sId]);
        await queueSync('teacher_subjects', `${editingUstaz.id},${sId}`, 'insert');
      }

      triggerBackgroundSync(true); // 🚀 INSTANT PROFILE DISPATCH

      // 🛡️ SESSION REFRESH: If admin edited their own profile, update the cached session
      // so new username/password takes effect immediately without being blocked by stale cache
      const { useAuthStore } = require('../../src/store/useAuthStore');
      const currentUser = useAuthStore.getState().user;
      if (currentUser?.id === editingUstaz.id) {
        const SecureStore = require('expo-secure-store');
        const updatedUser = await db.getFirstAsync<any>('SELECT * FROM users WHERE id = ?', [editingUstaz.id]);
        if (updatedUser) {
          await SecureStore.setItemAsync('medersa_user_v1', JSON.stringify(updatedUser));
          useAuthStore.setState({ user: updatedUser });
        }
      }

      Alert.alert('Success', 'Profile updated successfully');
      setShowEditModal(false);
      loadData();
    } catch (e) {
      console.error('Teacher update critical failure:', e);
      Alert.alert('Error', 'Failed to update profile. Please ensure the phone number is valid.');
    }
    setIsUpdating(false);
  };

  const handleDeleteUstaz = async (id: string, name: string) => {
    Alert.alert(
      "Permanent Delete",
      `Are you sure? This will remove Ustaz "${name}" and all their student assignments from the cloud permanently.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "DELETE FOREVER", 
          style: "destructive",
          onPress: async () => {
            const db = await getDatabase();
            try {
              const { queueSync } = require('../../src/lib/database');
              const { triggerBackgroundSync } = require('../../src/lib/sync');
              
              // 🛡️ DEEP CLEAN: Queue deletions for all links (Junction tables use composite IDs)
              const links = await db.getAllAsync<any>(`SELECT teacher_id, student_id, subject_id FROM teacher_student_links WHERE teacher_id = ?`, [id]);
              for (const link of links) {
                // Build composite ID: "teacher_id,student_id,subject_id"
                const compositeId = `${link.teacher_id},${link.student_id},${link.subject_id}`;
                await queueSync('teacher_student_links', compositeId, 'delete');
              }
              
              const subLinks = await db.getAllAsync<any>(`SELECT teacher_id, subject_id FROM teacher_subjects WHERE teacher_id = ?`, [id]);
              for (const sl of subLinks) {
                // Build composite ID: "teacher_id,subject_id"
                const compositeId = `${sl.teacher_id},${sl.subject_id}`;
                await queueSync('teacher_subjects', compositeId, 'delete');
              }

              // 1. Queue the Cloud Delete for the user
              await queueSync('users', id, 'delete');
              
              // 2. Local Delete (Cascade will handle subjects and links locally)
              await db.runAsync('DELETE FROM users WHERE id = ?', [id]);
              
              triggerBackgroundSync(true); // 🚀 INSTANT DISPATCH
              setShowEditModal(false);
              loadData();
              Alert.alert('Deleted', 'Staff member and all their records removed.');
            } catch (e) {
              console.error('Delete Error:', e);
              Alert.alert('Error', 'Failed to perform deep clean delete.');
            }
          }
        }
      ]
    );
  };

  const filteredTeachers = ustazs.filter(u =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.phone.includes(searchQuery)
  );

  return (
    <View style={styles.container}>
      <Surface style={styles.header} elevation={4}>
        <View style={styles.headerContent}>
          <IconButton icon="arrow-left" iconColor="white" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{i18n.language === 'am' ? 'የሠራተኞች መቆጣጠሪያ' : 'Staff Management'}</Text>
          </View>
          <TouchableOpacity 
             style={styles.quickAction} 
             onPress={() => router.push('/(admin)/manage-subjects')}
          >
             <MaterialCommunityIcons name="book-open-variant" size={20} color="white" />
             <Text style={styles.quickActionTxt}>{i18n.language === 'am' ? 'ኪታቦች' : 'Kitabs'}</Text>
          </TouchableOpacity>
        </View>
        <Searchbar
          placeholder="Search staff..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
          inputStyle={{ fontSize: 14, minHeight: 45, paddingTop: 0, paddingBottom: 0 }}
          iconColor={COLORS.primary}
          elevation={0}
        />
      </Surface>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.statsRow}>
          <Surface style={styles.statCard} elevation={1}>
            <Text style={styles.statVal}>{ustazs.length}</Text>
            <Text style={styles.statLab}>Active Staff</Text>
          </Surface>
          {user?.role === 'admin' && (
            <TouchableOpacity style={styles.addCard} onPress={() => setShowAddModal(true)}>
              <MaterialCommunityIcons name="account-plus-outline" size={24} color={COLORS.primary} />
              <Text style={styles.addTxt}>{i18n.language === 'am' ? 'ሠራተኛ ጨምር' : 'Add Staff'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          filteredTeachers.map(u => (
            <Surface key={u.id} style={styles.teacherCard} elevation={1}>
              <View style={styles.cardTop}>
                <Avatar.Text size={40} label={u.name.substring(0, 1)} style={{ backgroundColor: '#f1f5f9' }} labelStyle={{ color: COLORS.primary, fontWeight: '800' }} />
                 <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.uName}>{u.name}</Text>
                    <View style={[styles.miniRoleBadge, { backgroundColor: u.role === 'committee' ? '#fde68a' : u.role === 'finance' ? '#dcfce7' : '#e0f2fe' }]}>
                      <Text style={[styles.miniRoleTxt, { color: u.role === 'committee' ? '#92400e' : u.role === 'finance' ? '#166534' : '#0369a1' }]}>
                        {u.role?.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text selectable={true} style={styles.uPhone}>📞 {u.phone}</Text>
                </View>
                {user?.role === 'admin' && (
                  <IconButton icon="pencil-outline" iconColor={COLORS.primary} size={20} onPress={() => openEditModal(u)} />
                )}
              </View>

              <Divider style={{ marginVertical: 10, opacity: 0.5 }} />

              <View style={styles.expertiseRow}>
                {u.expertise && u.expertise.length > 0 ? (
                  u.expertise.map((s: any, idx: number) => (
                    <View key={`${u.id}_${s.id || idx}_${s.name}`} style={styles.subBadge}>
                      <Text style={styles.subBadgeTxt}>{i18n.language === 'am' ? s.name_am : s.name}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noExp}>No subjects assigned</Text>
                )}
              </View>
            </Surface>
          ))
        )}
      </ScrollView>

      <AddUstazModal 
        visible={showAddModal} 
        onDismiss={() => setShowAddModal(false)}
        onSave={handleAddUstaz}
        subjects={subjects}
        isSaving={isSaving}
        i18n={i18n}
      />

      <EditUstazModal 
        visible={showEditModal} 
        onDismiss={() => setShowEditModal(false)}
        onSave={handleUpdateUstaz}
        onDelete={handleDeleteUstaz}
        initialData={editingUstaz}
        subjects={subjects}
        isUpdating={isUpdating}
        i18n={i18n}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: COLORS.primaryDark, paddingTop: 50, paddingBottom: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, paddingHorizontal: 15 },
  headerContent: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  title: { color: 'white', fontSize: 20, fontWeight: '900', marginLeft: 5 },
  searchBar: { borderRadius: 12, height: 45, backgroundColor: 'white' },

  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: 'white', borderRadius: 15, padding: 15, alignItems: 'center', justifyContent: 'center' },
  statVal: { fontSize: 22, fontWeight: '900', color: COLORS.primary },
  statLab: { fontSize: 12, color: '#64748b', marginTop: 4 },
  addCard: { flex: 1, backgroundColor: '#eff6ff', borderRadius: 15, borderStyle: 'dashed', borderWidth: 2, borderColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center' },
  addTxt: { color: COLORS.primary, fontWeight: '800', marginTop: 4, fontSize: 13 },

  teacherCard: { backgroundColor: 'white', borderRadius: 20, padding: 15, marginBottom: 15 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  uName: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  uPhone: { fontSize: 12, color: '#64748b', marginTop: 1 },
  miniRoleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  miniRoleTxt: { fontSize: 8, fontWeight: '900' },
  expertiseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  subBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  subBadgeTxt: { fontSize: 11, fontWeight: '700', color: COLORS.primaryDark },
  noExp: { fontSize: 11, color: '#94a3b8', fontStyle: 'italic' },

  modal: { backgroundColor: 'white', padding: 25, margin: 20, borderRadius: 25 },
  modalTitle: { fontSize: 20, fontWeight: '900', color: '#1e293b', marginBottom: 20, textAlign: 'center' },
  input: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '700', marginTop: 10, marginBottom: 10, color: '#1e293b' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 25 },
  chip: { marginBottom: 4 },
  confirmBtn: { borderRadius: 12, backgroundColor: COLORS.primaryDark, marginTop: 10 },
  quickAction: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 5, marginRight: 10 },
  quickActionTxt: { color: 'white', fontSize: 13, fontWeight: '800' }
});
