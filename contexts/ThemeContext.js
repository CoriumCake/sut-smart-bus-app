import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = '@app_theme';

// Theme colors - SUT Orange
export const lightTheme = {
    mode: 'light',
    background: '#ffffff',
    surface: '#f5f5f5',
    card: '#ffffff',
    text: '#333333',
    textSecondary: '#666666',
    textMuted: '#999999',
    primary: '#F57C00',        // SUT Orange
    primaryLight: '#FFF3E0',   // Light orange tint
    border: '#eeeeee',
    tabBar: '#ffffff',
    tabBarBorder: '#eeeeee',
    statusBar: 'dark',
};

export const darkTheme = {
    mode: 'dark',
    background: '#121212',
    surface: '#1e1e1e',
    card: '#252525',
    text: '#ffffff',
    textSecondary: '#b0b0b0',
    textMuted: '#707070',
    primary: '#FFB74D',        // Lighter orange for dark mode
    primaryLight: '#3D2A1A',   // Dark orange tint
    border: '#333333',
    tabBar: '#1e1e1e',
    tabBarBorder: '#333333',
    statusBar: 'light',
};

const ThemeContext = createContext();

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};

export const ThemeProvider = ({ children }) => {
    const [isDark, setIsDark] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Load saved theme on mount
    useEffect(() => {
        const loadTheme = async () => {
            try {
                const saved = await AsyncStorage.getItem(THEME_KEY);
                if (saved !== null) {
                    setIsDark(saved === 'dark');
                }
            } catch (e) {
                console.error('Error loading theme:', e);
            } finally {
                setIsLoading(false);
            }
        };
        loadTheme();
    }, []);

    const toggleTheme = async () => {
        const newValue = !isDark;
        setIsDark(newValue);
        try {
            await AsyncStorage.setItem(THEME_KEY, newValue ? 'dark' : 'light');
        } catch (e) {
            console.error('Error saving theme:', e);
        }
    };

    const theme = isDark ? darkTheme : lightTheme;

    return (
        <ThemeContext.Provider value={{ theme, isDark, toggleTheme, isLoading }}>
            {children}
        </ThemeContext.Provider>
    );
};
