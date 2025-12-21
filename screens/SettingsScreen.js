import React, { useState, useEffect } from 'react';
import { View, Text, Switch, StyleSheet, TouchableOpacity, Platform, Modal, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDebug } from '../contexts/DebugContext';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNotifications } from '../contexts/NotificationContext';
import { API_BASE } from '../config/api';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const SettingsScreen = () => {
  const navigation = useNavigation();
  const { debugMode, toggleDebugMode, isDevMachine, deviceId } = useDebug();
  const { theme, isDark, toggleTheme } = useTheme();
  const { language, changeLanguage, t } = useLanguage();
  const { enabled: notificationsEnabled, toggleNotifications } = useNotifications();

  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [apiCount, setApiCount] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);

  // Fetch person count from API when debug mode is enabled
  useEffect(() => {
    const fetchCount = async () => {
      if (!debugMode) {
        setApiCount(null);
        return;
      }
      setApiLoading(true);
      try {
        const response = await fetch(`${API_BASE}/count`);
        if (response.ok) {
          const data = await response.json();
          setApiCount(data.passengers !== undefined ? data.passengers : 'N/A');
        } else {
          setApiCount('Error');
        }
      } catch (err) {
        setApiCount('Offline');
      }
      setApiLoading(false);
    };

    fetchCount();
    // Also poll every 5 seconds when debug is on
    const interval = debugMode ? setInterval(fetchCount, 5000) : null;
    return () => interval && clearInterval(interval);
  }, [debugMode]);

  const SettingRow = ({ icon, iconColor, label, children, onPress }) => (
    <TouchableOpacity
      style={[styles.settingItem, { borderBottomColor: theme.border }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.settingRow}>
        <Ionicons name={icon} size={22} color={iconColor || theme.primary} style={styles.icon} />
        <Text style={[styles.settingText, { color: theme.text }]}>{label}</Text>
      </View>
      {children}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>{t('settings')}</Text>

      {/* Debug Mode - Only visible on dev devices */}
      {isDevMachine && (
        <SettingRow icon="bug" iconColor="#ef4444" label={t('darkMode').replace('Dark Mode', 'Debug Mode')}>
          <Switch
            value={debugMode}
            onValueChange={toggleDebugMode}
            trackColor={{ false: theme.border, true: theme.primary }}
          />
        </SettingRow>
      )}

      {/* Bus Route Admin - Only visible when debug mode is on */}
      {debugMode && (
        <SettingRow
          icon="bus"
          iconColor="#8b5cf6"
          label={t('manageBusRoutes')}
          onPress={() => navigation.navigate('BusRouteAdmin')}
        >
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </SettingRow>
      )}

      {/* Bus Management - Only visible when debug mode is on */}
      {debugMode && (
        <SettingRow
          icon="construct"
          iconColor="#f97316"
          label="Manage Buses"
          onPress={() => navigation.navigate('BusManagement')}
        >
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </SettingRow>
      )}

      {/* API Person Count - Debug Display */}
      {debugMode && (
        <SettingRow icon="people" iconColor="#10b981" label="API Person Count">
          <Text style={{ color: apiLoading ? theme.textMuted : theme.text, fontSize: 17, fontWeight: 'bold' }}>
            {apiLoading ? '...' : (apiCount !== null ? apiCount : '-')}
          </Text>
        </SettingRow>
      )}

      {/* Dark Mode */}
      <SettingRow icon="moon" iconColor="#6366f1" label={t('darkMode')}>
        <Switch
          value={isDark}
          onValueChange={toggleTheme}
          trackColor={{ false: theme.border, true: theme.primary }}
        />
      </SettingRow>

      {/* Notifications */}
      <SettingRow icon="notifications" iconColor="#f59e0b" label={t('notifications')}>
        <Switch
          value={notificationsEnabled}
          onValueChange={toggleNotifications}
          trackColor={{ false: theme.border, true: theme.primary }}
        />
      </SettingRow>

      {/* Language */}
      <SettingRow
        icon="language"
        iconColor="#22c55e"
        label={t('language')}
        onPress={() => setLanguageModalVisible(true)}
      >
        <View style={styles.languageValue}>
          <Text style={[styles.languageText, { color: theme.textSecondary }]}>
            {language === 'en' ? 'English' : 'ไทย'}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </View>
      </SettingRow>

      {/* About */}
      <SettingRow
        icon="information-circle"
        iconColor="#0ea5e9"
        label={t('about')}
        onPress={() => navigation.navigate('About')}
      >
        <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
      </SettingRow>

      {/* Configuration - Only visible for developers */}
      {isDevMachine && (
        <View style={[styles.infoContainer, { backgroundColor: theme.surface }]}>
          <Text style={[styles.infoTitle, { color: theme.textSecondary }]}>Developer Info</Text>
          <Text style={[styles.infoText, { color: theme.textMuted }]}>API: {API_BASE}</Text>
          <Text style={[styles.infoText, { color: theme.textMuted }]}>Device: {deviceId?.slice(0, 12)}...</Text>
        </View>
      )}

      {/* Language Selection Modal */}
      <Modal
        visible={languageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguageModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setLanguageModalVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('language')}</Text>

            <TouchableOpacity
              style={[
                styles.languageOption,
                language === 'en' && { backgroundColor: theme.primaryLight }
              ]}
              onPress={() => {
                changeLanguage('en');
                setLanguageModalVisible(false);
              }}
            >
              <Text style={[styles.languageOptionText, { color: theme.text }]}>English</Text>
              {language === 'en' && <Ionicons name="checkmark" size={20} color={theme.primary} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.languageOption,
                language === 'th' && { backgroundColor: theme.primaryLight }
              ]}
              onPress={() => {
                changeLanguage('th');
                setLanguageModalVisible(false);
              }}
            >
              <Text style={[styles.languageOptionText, { color: theme.text }]}>ภาษาไทย</Text>
              {language === 'th' && <Ionicons name="checkmark" size={20} color={theme.primary} />}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 14,
  },
  settingText: {
    fontSize: 17,
  },
  languageValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  languageText: {
    fontSize: 15,
    marginRight: 4,
  },
  infoContainer: {
    marginTop: 32,
    padding: 16,
    borderRadius: 12,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoText: {
    fontSize: 13,
    marginBottom: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  languageOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
  },
  languageOptionText: {
    fontSize: 17,
  },
});

export default SettingsScreen;