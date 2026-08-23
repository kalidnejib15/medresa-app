import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Surface, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/constants';

type MCIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function RuleItem({ index, text, icon }: { index: number; text: string; icon: MCIcon }) {
  return (
    <View style={styles.ruleItem}>
      <View style={styles.iconCircle}>
        <MaterialCommunityIcons name={icon} size={18} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.ruleText}>{text}</Text>
      </View>
    </View>
  );
}

export default function BylawsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const rules_en = [
    { icon: 'account-clock', text: "Registration Age: Students must be 4-5 years or older." },
    { icon: 'cash-multiple', text: "Monthly Fee: 500 ETB, payable between the 25th and 10th." },
    { icon: 'alert-octagon', text: "Late Payment: Students with 3 months of unpaid fees will be expelled." },
    { icon: 'tshirt-crew', text: "Dress Code: Islamic attire (Jelabia and Kufi) is preferred." },
    { icon: 'calendar-remove', text: "Attendance: 10 consecutive days of unauthorized absence leads to disciplinary action." },
    { icon: 'hand-heart', text: "Behavior: Respect for teachers, students, and mosque property is mandatory." },
  ];

  const rules_am = [
    { icon: 'account-clock', text: "የምዝገባ እድሜ፡ እድሜው/ዋ ለቂርዐት መድረስ 4-5 በላይ መሆን አለበት።" },
    { icon: 'cash-multiple', text: "ወርሃዊ ክፍያ፡ 500 ብር ሲሆን ከወሩ 25 እስከ ቀጣዩ ወር 10 መከፈል አለበት።" },
    { icon: 'alert-octagon', text: "ክፍያ ማዘግየት፡ ለ3 ተከታታይ ወራት ክፍያ ያልከፈለ ተማሪ ከመድረሳው ይባረራል።" },
    { icon: 'tshirt-crew', text: "አለባበስ፡ ኢስላማዊ አለባበስ (ጀለቢያ እና ኮፊያ) መከተል ይመከራል።" },
    { icon: 'calendar-remove', text: "መቅረት፡ ያለ በቂ ምክንያት ለ10 ተከታታይ ቀናት መቅረት ለዕርምጃ ይዳርጋል።" },
    { icon: 'hand-heart', text: "ስነ-ምግባር፡ ለኡስታዞች፣ ለተማሪዎች እና ለመስጂዱ ንብረት ክብር መስጠት ግዴታ ነው።" },
  ];

  const currentRules = i18n.language === 'am' ? rules_am : rules_en;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={28} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{i18n.language === 'am' ? 'መተዳደሪያ ደንብ' : 'Bylaws & Rules'}</Text>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <Surface style={styles.card} elevation={2}>
           <View style={styles.cardHeader}>
             <MaterialCommunityIcons name="book-open-page-variant-outline" size={24} color={COLORS.primary} />
             <Text style={styles.cardTitle}>{i18n.language === 'am' ? 'የአቡበከር መድረሳ ህጎች' : 'Abubeker Medersa Rules'}</Text>
           </View>
           <Divider style={{ marginBottom: 16 }} />

           {currentRules.map((rule, i) => (
             <RuleItem key={i} index={i + 1} text={rule.text} icon={rule.icon as MCIcon} />
           ))}
        </Surface>

        <Surface style={[styles.card, { marginTop: 10 }]} elevation={2}>
           <Text style={styles.disclaimerTitle}>{i18n.language === 'am' ? 'ማሳሰቢያ' : 'Important Note'}</Text>
           <Text style={styles.disclaimerText}>
             {i18n.language === 'am' 
               ? "እነዚህ ህጎች በተማሪዎች፣ በወላጆች እና በኡስታዞች መካከል መልካም ስርአት እንዲሰፍን የታለሙ ናቸው።" 
               : "These rules aim to ensure discipline and a positive learning environment for students, parents, and teachers."}
           </Text>
        </Surface>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  header: { 
    backgroundColor: COLORS.primaryDark, 
    flexDirection: 'row', alignItems: 'center', 
    paddingTop: 50, paddingBottom: 20, paddingHorizontal: 16, gap: 12 
  },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: 'white', fontSize: 18, fontWeight: '800' },
  
  scroll: { flex: 1, padding: 12 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 20, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#1e293b' },
  
  ruleItem: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primaryFaded, alignItems: 'center', justifyContent: 'center' },
  ruleText: { fontSize: 13, color: '#475569', fontWeight: '600', lineHeight: 18 },

  disclaimerTitle: { fontSize: 14, fontWeight: '800', color: COLORS.accent, marginBottom: 6 },
  disclaimerText: { fontSize: 12, color: '#64748b', lineHeight: 18 }
});
