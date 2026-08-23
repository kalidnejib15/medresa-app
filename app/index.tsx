import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  ImageBackground,
  KeyboardAvoidingView, 
  Platform, 
  ScrollView,
  StatusBar,
  Dimensions
} from 'react-native';
import { TextInput, Button, Surface, HelperText } from 'react-native-paper';
import { useAuthStore } from '../src/store/useAuthStore';
import { useTranslation } from 'react-i18next';

const { width, height } = Dimensions.get('window');

const COLORS = {
  primary: '#1a6b3c',
  primaryLight: '#2e8c56',
  primaryDark: '#0d4d2b',
  accent: '#fcc419',
  white: '#FFFFFF',
  error: '#ff5252'
};

const SPACING = { sm: 8, md: 16, lg: 24, xl: 32 };

export default function LoginScreen() {
  const { t, i18n } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { login, isLoading, error } = useAuthStore();

  React.useEffect(() => {
    const repairAdmin = async () => {
      // ⏳ Wait for initDatabase() in _layout.tsx to fully complete first
      await new Promise(resolve => setTimeout(resolve, 2500));
      try {
        const { getDatabase } = await import('../src/lib/database');
        const db = await getDatabase();
        // 🛡️ EMERGENCY REPAIR: Fix login credentials and sync loops
        await db.runAsync(`UPDATE users SET username = phone WHERE username IS NULL OR username = ''`);
        
        // 🧹 DEEP CLEAN: Force-clear stuck dirty records for all staff and users
        await db.runAsync(`UPDATE users SET synced = 1`);
        await db.runAsync(`UPDATE teacher_subjects SET synced = 1`);
        await db.runAsync(`UPDATE teacher_levels SET synced = 1`);
        await db.runAsync(`UPDATE teacher_student_links SET synced = 1`);
        await db.runAsync(`DELETE FROM sync_log WHERE table_name IN ('users','teacher_subjects','teacher_levels','teacher_student_links')`);
        
        console.log("🛠️ Emergency Login & Sync Repair Complete");
      } catch (e) {
        console.warn("Repair failed", e);
      }
    };
    repairAdmin();
  }, []);

  const handleLogin = async () => {
    if (!username || !password) return;
    await login(username, password);
  };

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'en' ? 'am' : 'en');
  };

  return (
    <ImageBackground
      source={require('../assets/medresa_bg.jpg')}
      style={styles.container}
      resizeMode="cover"
    >
      {/* Dark overlay so text/card stay readable over the background image */}
      <View style={styles.overlay} />
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        style={{ flex: 1 }}
      >
        <ScrollView 
          showsVerticalScrollIndicator={false} 
          contentContainerStyle={styles.scrollContent}
          bounces={false}
        >
          {/* Upper Brand Section */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Image 
                source={require('../assets/logo2.jpg')} 
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <View style={{ marginTop: 25, alignItems: 'center', paddingHorizontal: 20 }}>
              <Text style={styles.title}>{t('medersaName', 'አቡበከር መድረሳ')}</Text>
              <Text style={styles.subtitle}>{t('managementSystem', 'ABUBEKER INTEGRATED ISLAMIC STUDIES CENTER')}</Text>
            </View>
          </View>

          {/* Login Content Area */}
          <View style={styles.content}>
            <Surface style={styles.card} elevation={4}>
              <Text style={styles.cardTitle}>{t('login', 'Login')}</Text>
              
              <TextInput
                label={t('username', 'Username')}
                value={username}
                onChangeText={setUsername}
                mode="outlined"
                style={styles.input}
                outlineColor="#f1f5f9"
                activeOutlineColor={COLORS.primary}
                left={<TextInput.Icon icon="account" color={COLORS.primary} />}
                autoCapitalize="none"
              />

              <TextInput
                label={t('password', 'Password')}
                value={password}
                onChangeText={setPassword}
                mode="outlined"
                secureTextEntry={!showPassword}
                style={styles.input}
                outlineColor="#f1f5f9"
                activeOutlineColor={COLORS.primary}
                left={<TextInput.Icon icon="lock" color={COLORS.primary} />}
                right={
                  <TextInput.Icon 
                    icon={showPassword ? "eye-off" : "eye"} 
                    color={COLORS.primary} 
                    onPress={() => setShowPassword(!showPassword)}
                  />
                }
              />

              {error && (
                <HelperText type="error" visible style={styles.errorText}>
                  {t(error, 'Incorrect credentials')}
                </HelperText>
              )}

              <Button 
                mode="contained" 
                onPress={handleLogin} 
                loading={isLoading}
                disabled={isLoading}
                style={styles.loginBtn}
                contentStyle={{ height: 52 }}
                labelStyle={{ fontSize: 16, fontWeight: '900', letterSpacing: 1 }}
              >
                {t('signIn', 'Sign In')}
              </Button>

              <Button 
                mode="text" 
                onPress={toggleLanguage} 
                style={styles.langBtn}
                textColor={COLORS.primary}
                labelStyle={{ fontWeight: '800' }}
              >
                {i18n.language === 'en' ? 'አማርኛ' : 'English'}
              </Button>
            </Surface>

            <Text style={styles.footer}>© 2024 Abubeker Medersa</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 40, 20, 0.62)',
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    height: height * 0.42,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
  },
  logoContainer: {
    width: 155,
    height: 155,
    borderRadius: 80,
    backgroundColor: 'white',
    padding: 24, // Increased padding to "Zoom Out" the logo
    elevation: 20,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: { width: '100%', height: '100%', borderRadius: 10 },
  title: { fontSize: 34, fontWeight: '900', color: 'white', textAlign: 'center' },
  subtitle: { 
    fontSize: 10, 
    color: 'white', 
    opacity: 0.9, 
    marginTop: 10, 
    letterSpacing: 2, 
    textAlign: 'center', 
    fontWeight: '800', 
    textTransform: 'uppercase',
    lineHeight: 16
  },
  content: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 40,
    minHeight: height * 0.58,
  },
  card: {
    padding: 25,
    borderRadius: 35,
    backgroundColor: 'white',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  cardTitle: { fontSize: 24, fontWeight: '900', marginBottom: 25, color: '#1e293b', textAlign: 'center' },
  input: { marginBottom: 15, backgroundColor: 'white' },
  loginBtn: { marginTop: 15, borderRadius: 16, backgroundColor: COLORS.primary },
  langBtn: { marginTop: 15 },
  errorText: { textAlign: 'center', marginBottom: 10 },
  footer: { 
    marginTop: 30,
    textAlign: 'center', 
    color: 'rgba(255,255,255,0.4)', 
    fontSize: 12,
    fontWeight: '700'
  }
});
