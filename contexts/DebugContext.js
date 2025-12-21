import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { isDeviceAllowed } from '../config/allowedDevices';

const DebugContext = createContext();

export const useDebug = () => {
  const context = useContext(DebugContext);
  if (!context) {
    throw new Error('useDebug must be used within a DebugProvider');
  }
  return context;
};

export const DebugProvider = ({ children }) => {
  const [debugMode, setDebugMode] = useState(false);
  const [isDevMachine, setIsDevMachine] = useState(false);
  const [deviceId, setDeviceId] = useState(null);

  // Check if current device is in the allowlist on mount
  useEffect(() => {
    const checkDeviceAccess = async () => {
      try {
        let id = null;
        if (Platform.OS === 'android') {
          id = Application.getAndroidId();
        } else if (Platform.OS === 'ios') {
          id = await Application.getIosIdForVendorAsync();
        }

        setDeviceId(id);

        if (id && isDeviceAllowed(id)) {
          setIsDevMachine(true);
          console.log('[Security] Device authorized for debug access');
        } else {
          setIsDevMachine(false);
          setDebugMode(false); // Force debug off for non-dev devices
          console.log('[Security] Device NOT authorized for debug access');
        }
      } catch (error) {
        console.error('[Security] Error checking device:', error);
        setIsDevMachine(false);
      }
    };

    checkDeviceAccess();
  }, []);

  const toggleDebugMode = () => {
    // Only allow toggling if device is authorized
    if (isDevMachine) {
      setDebugMode(!debugMode);
    } else {
      console.warn('[Security] Attempted to enable debug on unauthorized device');
    }
  };

  return (
    <DebugContext.Provider value={{
      debugMode,
      toggleDebugMode,
      isDevMachine,  // Expose this so UI can hide toggle entirely
      deviceId
    }}>
      {children}
    </DebugContext.Provider>
  );
};