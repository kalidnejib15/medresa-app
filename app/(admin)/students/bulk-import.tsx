import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { Text, Surface, TextInput, Button, ActivityIndicator, Divider, List, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStudentStore } from '../../../src/store/useStudentStore';
import { COLORS } from '../../../src/constants';

export default function BulkImportScreen() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const { bulkAddStudents, fetchStudents } = useStudentStore();
  
  const [csvText, setCsvText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedData, setParsedData] = useState<any[]>([]);

  const handleParse = () => {
    if (!csvText.trim()) return;
    
    try {
      const lines = csvText.trim().split('\n');
      const students: any[] = [];
      
      lines.forEach((line) => {
        // ULTRA-RESILIENT SPLIT: Handles Tabs (\t), Comma (,), Pipe (|), or 2+ Spaces
        const parts = line.split(/\t|,|\|| {2,}/).map(s => s.trim()).filter(p => p !== '');
        if (parts.length < 4) return; 

        // If the first part is a number (like from my table), shift if needed or handle
        let offset = 0;
        if (!isNaN(parseInt(parts[0])) && parts[0].length < 4) {
           offset = 1; // Skip the row number if present
        }

        students.push({
          name_am: parts[offset + 0],
          name_en: parts[offset + 1],
          gender: parts[offset + 2].toLowerCase(),
          level_id: parts[offset + 3].toLowerCase(),
          dob: parts[offset + 4] || '',
          school_level: parts[offset + 5] || '',
          parent_name: parts[offset + 6] || '',
          parent_phone: parts[offset + 7] || '',
          subcity: parts[offset + 8] || '',
          woreda: parts[offset + 9] || '',
          block: parts[offset + 10] || '',
          house: parts[offset + 11] || '',
          emergency_name: parts[offset + 12] || '',
          emergency_phone: parts[offset + 13] || '',
          medical_notes: parts[offset + 14] || '',
          is_yetim: parts[offset + 15] === '1' || parts[offset + 15]?.toLowerCase() === 'yes'
        });
      });

      if (students.length === 0) {
        Alert.alert('Parser Error', 'No valid student records found. Copy-paste directly from Excel tabs.');
        return;
      }

      setParsedData(students);
      Alert.alert('Success', `Parsed ${students.length} students with full registration data.`);
    } catch (e) {
      Alert.alert('Error', 'Could not parse text. Ensure you have 16 columns from Excel.');
    }
  };

  const handleImport = async () => {
    if (parsedData.length === 0) return;
    
    setIsProcessing(true);
    try {
      await bulkAddStudents(parsedData);
      await fetchStudents();
      Alert.alert('Success', `${parsedData.length} students registered successfully!`);
      router.back();
    } catch (e) {
      Alert.alert('Import Failed', 'There was an error saving the students to the database.');
    } finally {
      setIsProcessing(false);
    }
  };

  const templateColumns = "Name_AM\tName_EN\tGender\tLevel_ID\tDOB\tSchool\tParent\tPhone\tSubcity\tWoreda\tBlock\tHouse\tEmergency\tEmg_Phone\tMedical\tYetim";

  return (
    <View style={styles.container}>
      <Surface style={styles.header} elevation={4}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Master Bulk Enroll</Text>
        </View>
      </Surface>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Surface style={styles.infoCard} elevation={1}>
           <MaterialCommunityIcons name="database-import" size={24} color={COLORS.primary} />
           <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>Master Template (16 Columns):</Text>
              <Text style={styles.infoText}>1. Name_AM, 2. Name_EN, 3. Gender, 4. Level_ID</Text>
              <Text style={styles.infoText}>5. DOB, 6. School, 7. Parent, 8. Phone, 9. Subcity</Text>
              <Text style={styles.infoText}>10. Woreda, 11. Block, 12. House, 13. Emg_Name</Text>
              <Text style={styles.infoText}>14. Emg_Phone, 15. Medical, 16. Yetim (0/1)</Text>
           </View>
        </Surface>

        <Text style={styles.label}>Paste Excel Rows Here:</Text>
        <TextInput
          mode="outlined"
          multiline
          numberOfLines={8}
          placeholder={templateColumns}
          value={csvText}
          onChangeText={setCsvText}
          style={styles.input}
          outlineStyle={{ borderRadius: 15 }}
        />

        <Button 
          mode="contained" 
          onPress={handleParse} 
          disabled={!csvText || isProcessing}
          style={styles.parseBtn}
          icon="file-search-outline"
        >
          Identify Students
        </Button>

        {parsedData.length > 0 && (
          <View style={{ marginTop: 30 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <Text style={styles.sectionTitle}>REVIEW IMPORT ({parsedData.length})</Text>
              <Button onPress={() => setParsedData([])} textColor="#ef4444">Clear</Button>
            </View>
            
            <Surface style={styles.reviewCard} elevation={1}>
              {parsedData.slice(0, 10).map((s, idx) => (
                <List.Item
                  key={idx}
                  title={i18n.language === 'am' ? s.name_am : s.name_en}
                  description={`${s.level_id.toUpperCase()} • ${s.gender.toUpperCase()} • ${s.parent_phone || 'No Phone'}`}
                  left={props => <List.Icon {...props} icon="account-circle" color={COLORS.primary} />}
                  style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}
                />
              ))}
              {parsedData.length > 10 && (
                <Text style={styles.moreText}>+ {parsedData.length - 10} more students...</Text>
              )}
            </Surface>

            <Button 
              mode="contained" 
              onPress={handleImport} 
              loading={isProcessing}
              disabled={isProcessing}
              style={styles.importBtn}
              buttonColor={COLORS.primaryDark}
            >
              Start Bulk Enrollment
            </Button>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: COLORS.primaryDark, paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: 'white', fontSize: 18, fontWeight: '900' },
  
  infoCard: { flexDirection: 'row', backgroundColor: 'white', padding: 20, borderRadius: 20, gap: 15, marginBottom: 25 },
  infoTitle: { fontWeight: '900', color: '#1e293b', marginBottom: 5 },
  infoText: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  
  label: { fontSize: 14, fontWeight: '800', color: '#64748b', marginBottom: 10, marginLeft: 5 },
  input: { backgroundColor: 'white', marginBottom: 15 },
  parseBtn: { borderRadius: 15, paddingVertical: 5 },
  
  sectionTitle: { fontSize: 11, fontWeight: '900', color: COLORS.primary, letterSpacing: 1 },
  reviewCard: { backgroundColor: 'white', borderRadius: 20, overflow: 'hidden', padding: 5 },
  moreText: { textAlign: 'center', padding: 15, fontSize: 12, color: '#94a3b8', fontWeight: '700' },
  importBtn: { marginTop: 25, borderRadius: 15, paddingVertical: 10 },
});
