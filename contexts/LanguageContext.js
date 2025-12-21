import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LANGUAGE_KEY = '@app_language';

// Translation strings
const translations = {
    en: {
        // Settings
        settings: 'Settings',
        darkMode: 'Dark Mode',
        notifications: 'Notifications',
        language: 'Language',
        about: 'About',
        manageBusRoutes: 'Manage Bus Routes',

        // Language names
        english: 'English',
        thai: 'ภาษาไทย',

        // Map
        map: 'Map',
        routes: 'Routes',
        airQuality: 'Air Quality',
        bus: 'Bus',
        seats: 'Seats',

        // Notifications
        notificationsEnabled: 'Notifications Enabled',
        busArriving: 'Bus arriving in {minutes} minutes',
        approachingStop: 'Approaching your stop',
        arrivedAtStop: 'You have arrived at your destination',

        // About
        version: 'Version',
        appDescription: 'SUT Smart Bus helps you track buses around Suranaree University of Technology campus.',
        developer: 'Developed by SUT Team',

        // General
        loading: 'Loading...',
        error: 'Error',
        save: 'Save',
        cancel: 'Cancel',
    },
    th: {
        // Settings
        settings: 'ตั้งค่า',
        darkMode: 'โหมดมืด',
        notifications: 'การแจ้งเตือน',
        language: 'ภาษา',
        about: 'เกี่ยวกับ',
        manageBusRoutes: 'จัดการเส้นทางรถ',

        // Language names
        english: 'English',
        thai: 'ภาษาไทย',

        // Map
        map: 'แผนที่',
        routes: 'เส้นทาง',
        airQuality: 'คุณภาพอากาศ',
        bus: 'รถบัส',
        seats: 'ที่นั่ง',

        // Notifications
        notificationsEnabled: 'เปิดการแจ้งเตือน',
        busArriving: 'รถบัสจะมาถึงใน {minutes} นาที',
        approachingStop: 'กำลังเข้าใกล้ป้ายของคุณ',
        arrivedAtStop: 'คุณมาถึงจุดหมายปลายทางแล้ว',

        // About
        version: 'เวอร์ชัน',
        appDescription: 'SUT Smart Bus ช่วยให้คุณติดตามรถบัสในมหาวิทยาลัยเทคโนโลยีสุรนารี',
        developer: 'พัฒนาโดยทีม มทส.',

        // General
        loading: 'กำลังโหลด...',
        error: 'ข้อผิดพลาด',
        save: 'บันทึก',
        cancel: 'ยกเลิก',
    },
};

const LanguageContext = createContext();

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};

export const LanguageProvider = ({ children }) => {
    const [language, setLanguage] = useState('en');
    const [isLoading, setIsLoading] = useState(true);

    // Load saved language on mount
    useEffect(() => {
        const loadLanguage = async () => {
            try {
                const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
                if (saved) {
                    setLanguage(saved);
                }
            } catch (e) {
                console.error('Error loading language:', e);
            } finally {
                setIsLoading(false);
            }
        };
        loadLanguage();
    }, []);

    const changeLanguage = async (lang) => {
        setLanguage(lang);
        try {
            await AsyncStorage.setItem(LANGUAGE_KEY, lang);
        } catch (e) {
            console.error('Error saving language:', e);
        }
    };

    // Translation function with parameter support
    const t = (key, params = {}) => {
        let text = translations[language]?.[key] || translations.en[key] || key;

        // Replace parameters like {minutes}
        Object.keys(params).forEach(param => {
            text = text.replace(`{${param}}`, params[param]);
        });

        return text;
    };

    return (
        <LanguageContext.Provider value={{
            language,
            changeLanguage,
            t,
            isLoading,
            isEnglish: language === 'en',
            isThai: language === 'th',
        }}>
            {children}
        </LanguageContext.Provider>
    );
};
