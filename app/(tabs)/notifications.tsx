import React, { useEffect } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Card, List, IconButton, Badge, Surface } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useNoticeStore } from '../../src/store/useNoticeStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { notices, fetchNotices, markAsRead } = useNoticeStore();

  useEffect(() => {
    fetchNotices();
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Surface style={styles.header} elevation={2}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{i18n.language === 'am' ? 'ማስታወቂያዎች' : 'Updates'}</Text>
          {notices.filter(n => !n.is_read).length > 0 && (
            <Badge style={styles.badge}>{notices.filter(n => !n.is_read).length}</Badge>
          )}
        </View>
      </Surface>

      <ScrollView contentContainerStyle={styles.scroll}>
        {notices.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="bell-off-outline" size={64} color="#ccc" />
            <Text style={styles.emptyTxt}>
              {i18n.language === 'am' ? 'ምንም አዲስ ማስታወቂያ የለም' : 'No announcements yet'}
            </Text>
          </View>
        ) : (
          notices.map((item) => (
            <Card 
              key={item.id} 
              style={[styles.card, !item.is_read && styles.unreadCard]}
              onPress={() => markAsRead(item.id)}
            >
              <Card.Title
                title={item.title}
                subtitle={`${item.sender} • ${new Date(item.created_at).toLocaleDateString()}`}
                left={(props) => (
                  <View style={[styles.iconBox, { backgroundColor: item.is_read ? '#f0f0f0' : '#1a6b3c' }]}>
                    <MaterialCommunityIcons 
                      name={item.is_read ? "bell-outline" : "bell-ring"} 
                      size={20} 
                      color={item.is_read ? "#666" : "white"} 
                    />
                  </View>
                )}
              />
              <Card.Content>
                <Text style={styles.message}>{item.message}</Text>
              </Card.Content>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: {
    backgroundColor: '#1a6b3c',
    padding: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: 'bold', color: 'white' },
  badge: { backgroundColor: '#fcc419', color: '#1a6b3c', fontWeight: 'bold' },
  scroll: { padding: 16, gap: 12 },
  card: { borderRadius: 16, backgroundColor: 'white', elevation: 1 },
  unreadCard: { borderLeftWidth: 4, borderLeftColor: '#1a6b3c' },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  message: { fontSize: 15, color: '#333', lineHeight: 22, marginTop: 4 },
  empty: { alignItems: 'center', marginTop: 100, gap: 12 },
  emptyTxt: { color: '#999', fontSize: 16 }
});
