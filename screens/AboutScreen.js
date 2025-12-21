import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';

const AboutScreen = () => {
    const navigation = useNavigation();
    const { theme } = useTheme();
    const { t } = useLanguage();

    const openLink = (url) => {
        Linking.openURL(url).catch(err => console.error('Error opening URL:', err));
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>{t('about')}</Text>
                <View style={styles.placeholder} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {/* App Logo & Name */}
                <View style={styles.logoSection}>
                    <View style={[styles.logoContainer, { backgroundColor: theme.primary }]}>
                        <Ionicons name="bus" size={48} color="#fff" />
                    </View>
                    <Text style={[styles.appName, { color: theme.text }]}>SUT Smart Bus</Text>
                    <Text style={[styles.version, { color: theme.textSecondary }]}>
                        {t('version')} 1.0.0
                    </Text>
                </View>

                {/* Description */}
                <View style={[styles.card, { backgroundColor: theme.card }]}>
                    <Text style={[styles.description, { color: theme.textSecondary }]}>
                        {t('appDescription')}
                    </Text>
                </View>

                {/* Features */}
                <View style={[styles.card, { backgroundColor: theme.card }]}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>Features</Text>

                    <View style={styles.featureRow}>
                        <Ionicons name="location" size={20} color={theme.primary} />
                        <Text style={[styles.featureText, { color: theme.textSecondary }]}>
                            Real-time bus tracking
                        </Text>
                    </View>

                    <View style={styles.featureRow}>
                        <Ionicons name="leaf" size={20} color="#22c55e" />
                        <Text style={[styles.featureText, { color: theme.textSecondary }]}>
                            Air quality monitoring (PM2.5)
                        </Text>
                    </View>

                    <View style={styles.featureRow}>
                        <Ionicons name="notifications" size={20} color="#f59e0b" />
                        <Text style={[styles.featureText, { color: theme.textSecondary }]}>
                            Arrival notifications
                        </Text>
                    </View>

                    <View style={styles.featureRow}>
                        <Ionicons name="map" size={20} color="#8b5cf6" />
                        <Text style={[styles.featureText, { color: theme.textSecondary }]}>
                            Route visualization
                        </Text>
                    </View>
                </View>

                {/* Developer Info */}
                <View style={[styles.card, { backgroundColor: theme.card }]}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>Development Team</Text>
                    <Text style={[styles.developerText, { color: theme.textSecondary }]}>
                        Suranaree University of Technology
                    </Text>
                    <Text style={[styles.developerText, { color: theme.textSecondary }]}>
                        School of Computer Engineering
                    </Text>
                </View>

                {/* Contact */}
                <View style={[styles.card, { backgroundColor: theme.card }]}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>Contact & Support</Text>

                    <TouchableOpacity
                        style={styles.linkRow}
                        onPress={() => openLink('mailto:support@sut.ac.th')}
                    >
                        <Ionicons name="mail" size={20} color={theme.primary} />
                        <Text style={[styles.linkText, { color: theme.primary }]}>
                            support@sut.ac.th
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.linkRow}
                        onPress={() => openLink('https://www.sut.ac.th')}
                    >
                        <Ionicons name="globe" size={20} color={theme.primary} />
                        <Text style={[styles.linkText, { color: theme.primary }]}>
                            www.sut.ac.th
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Footer */}
                <Text style={[styles.footer, { color: theme.textMuted }]}>
                    © 2024 Suranaree University of Technology
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    placeholder: {
        width: 32,
    },
    content: {
        padding: 20,
    },
    logoSection: {
        alignItems: 'center',
        marginBottom: 24,
    },
    logoContainer: {
        width: 100,
        height: 100,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    appName: {
        fontSize: 28,
        fontWeight: 'bold',
    },
    version: {
        fontSize: 14,
        marginTop: 4,
    },
    card: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 12,
    },
    description: {
        fontSize: 15,
        lineHeight: 22,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    featureText: {
        marginLeft: 12,
        fontSize: 14,
    },
    developerText: {
        fontSize: 14,
        marginBottom: 4,
    },
    linkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    linkText: {
        marginLeft: 12,
        fontSize: 14,
    },
    footer: {
        textAlign: 'center',
        fontSize: 12,
        marginTop: 8,
        marginBottom: 20,
    },
});

export default AboutScreen;
