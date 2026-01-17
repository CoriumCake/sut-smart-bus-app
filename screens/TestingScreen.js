import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Platform, ScrollView, Image } from 'react-native';
import { WebView } from 'react-native-webview';
// import * as mqtt from 'mqtt'; // Removed
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDebug } from '../contexts/DebugContext';
import { useServerConfig } from '../hooks/useServerConfig';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ENV } from '../config/env';

const TestingScreen = () => {
  const { debugMode } = useDebug();
  const { serverIp, setServerIp } = useServerConfig();
  const [videoResult, setVideoResult] = useState({
    entering: 0,
    exiting: 0,
    total_unique_persons: 0,
    processing_time_ms: 0,
    boxes: []
  });
  const [statusMessage, setStatusMessage] = useState('Waiting for data...');
  const [imageRefresh, setImageRefresh] = useState(0);
  const [imageStatus, setImageStatus] = useState('Loading...');
  // const [mqttStatus, setMqttStatus] = useState('Disconnected'); // Removed

  // Double Buffering State
  const [activeBuffer, setActiveBuffer] = useState(0); // 0 or 1
  const [buffer0Url, setBuffer0Url] = useState(null);
  const [buffer1Url, setBuffer1Url] = useState(null);

  // FPS Calculation
  const [fps, setFps] = useState(0);
  const lastFrameTime = React.useRef(0);
  const [qualityScore, setQualityScore] = useState(6); // Scale 1 (Worst) to 6 (Best)
  const mqttClientRef = React.useRef(null);

  // Sequence Guards to prevent out-of-order frames (Android fix)
  const lastDisplayedSeq = React.useRef(0);
  const buffer0Seq = React.useRef(0);
  const buffer1Seq = React.useRef(0);
  const activeBufferRef = React.useRef(0);

  const handleImageLoad = (bufferIndex) => {
    const seq = bufferIndex === 0 ? buffer0Seq.current : buffer1Seq.current;

    // Only switch if this frame is equal to or newer than what we've seen
    // (Strictly newer is best, but equal is fine if duplications happen)
    if (seq > lastDisplayedSeq.current) {
      setActiveBuffer(bufferIndex);
      activeBufferRef.current = bufferIndex;
      lastDisplayedSeq.current = seq;
      setImageStatus(`Live`);
    } else {
      // Frame arrived late, discard (don't show)
      // console.log(`Dropped stale frame: ${seq} < ${lastDisplayedSeq.current}`);
    }
  };

  const changeQualityScore = (delta) => {
    const newScore = Math.max(1, Math.min(6, qualityScore + delta));
    setQualityScore(newScore);

    // Map Score (1-6) to ESP32 Value (63-13)
    // 1 -> 63 (Worst/Fastest)
    // 6 -> 13 (Best/Slowest)
    // Formula: 63 - (score - 1) * 10
    const espValue = 63 - (newScore - 1) * 10;

    if (mqttClientRef.current && mqttClientRef.current.connected) {
      mqttClientRef.current.publish('sut/bus/ESP32-CAM-01/quality', espValue.toString());
      console.log(`Sent quality update: Score ${newScore} -> Val ${espValue}`);
    }
  };

  // Auto-refresh triggers: Update the hidden buffer's URL
  useEffect(() => {
    const interval = setInterval(() => {
      setImageRefresh(prev => {
        const next = prev + 1;
        const url = `http://${serverIp}:8000/cam-view-image?t=${next}`;

        // CRITICAL FIX: Only update the buffer that is currently HIDDEN
        // Access current active buffer via ref to avoid closure staleness
        const currentActive = activeBufferRef.current;

        if (currentActive === 0) {
          // Active is 0, so update 1 (Hidden)
          setBuffer1Url(url);
          buffer1Seq.current = next; // Track sequence
        } else {
          // Active is 1, so update 0 (Hidden)
          setBuffer0Url(url);
          buffer0Seq.current = next; // Track sequence
        }
        return next;
      });
    }, 33); // 33ms = ~30 FPS (Matches Camera Hardware Limit)
    return () => clearInterval(interval);
  }, [serverIp]);

  // MQTT Logic Removed
  // useEffect(() => { ... }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.title}>Person Detection Monitor</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Server IP:</Text>
          <TextInput
            style={styles.input}
            value={serverIp}
            onChangeText={setServerIp}
            placeholder="183.89.203.247"
          />
        </View>

        {/* Processed Video Frame from Server */}
        <View style={styles.videoContainer}>
          {/* Robust Double Buffered Image View */}
          <View style={styles.videoWrapper}>
            {/* Double Buffered Images */}
            {/* Buffer 0 */}
            {buffer0Url && (
              <Image
                key="b0"
                source={{ uri: buffer0Url }}
                fadeDuration={0}
                style={[
                  styles.video,
                  { position: 'absolute', opacity: activeBuffer === 0 ? 1 : 0 }
                ]}
                onLoad={() => handleImageLoad(0)}
              />
            )}

            {/* Buffer 1 */}
            {buffer1Url && (
              <Image
                key="b1"
                source={{ uri: buffer1Url }}
                fadeDuration={0}
                style={[
                  styles.video,
                  { position: 'absolute', opacity: activeBuffer === 1 ? 1 : 0 }
                ]}
                onLoad={() => handleImageLoad(1)}
              />
            )}

            {/* --- Detection Overlays --- */}
            {/* Center Line */}
            {videoResult.line_x !== undefined && (
              <View style={{
                position: 'absolute',
                left: `${videoResult.line_x * 100}%`,
                top: 0,
                bottom: 0,
                width: 2,
                backgroundColor: 'yellow',
                zIndex: 10
              }} />
            )}

            {/* Bounding Boxes */}
            {videoResult.boxes && videoResult.boxes.map((box) => (
              <View key={box.id}>
                {/* Bounding Box */}
                <View style={{
                  position: 'absolute',
                  left: `${(box.x - box.w / 2) * 100}%`,
                  top: `${(box.y - box.h / 2) * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                  borderWidth: 2,
                  borderColor: '#0f0',
                  zIndex: 11
                }}>
                  {/* Label Removed for cleaner UI */}
                </View>

                {/* Green Centroid Dot */}
                <View style={{
                  position: 'absolute',
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: '#0f0',
                  borderWidth: 2,
                  borderColor: '#fff',
                  transform: [{ translateX: -5 }, { translateY: -5 }], // Center the dot
                  zIndex: 12
                }} />
              </View>
            ))}
          </View>

          {/* Overlays */}
          <Text style={styles.videoLabel}>Live Feed</Text>
          <View style={styles.fpsContainer}>
            <Text style={styles.fpsText}>FPS: {fps}</Text>
          </View>

          <Text style={[styles.videoLabel, { top: 10, bottom: 'auto', backgroundColor: 'rgba(0, 0, 0, 0.6)' }]}>
            {imageStatus}
          </Text>
        </View>

        {/* Quality Controls */}
        <View style={styles.controlPanel}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: 'bold', flexWrap: 'wrap' }}>
              Quality: {qualityScore} {qualityScore === 6 ? '(Best)' : qualityScore === 1 ? '(Fastest)' : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 5 }}>
            <View style={{ backgroundColor: '#ddd', borderRadius: 5, opacity: qualityScore > 1 ? 1 : 0.5 }}>
              <Text
                onPress={() => changeQualityScore(-1)}
                style={{ paddingVertical: 10, paddingHorizontal: 15, fontWeight: 'bold', minWidth: 40, textAlign: 'center' }}
              >
                -
              </Text>
            </View>
            <View style={{ backgroundColor: '#ddd', borderRadius: 5, opacity: qualityScore < 6 ? 1 : 0.5 }}>
              <Text
                onPress={() => changeQualityScore(1)}
                style={{ paddingVertical: 10, paddingHorizontal: 15, fontWeight: 'bold', minWidth: 40, textAlign: 'center' }}
              >
                +
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.statsContainer}>
          <Text style={styles.subtitle}>Real-time Detection Stats</Text>
          <Text style={styles.statusText}>Live Status: {statusMessage}</Text>

          <View style={styles.grid}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Entering</Text>
              <Text style={styles.statValue}>{videoResult.entering}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Exiting</Text>
              <Text style={styles.statValue}>{videoResult.exiting}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Total</Text>
              <Text style={styles.statValue}>{videoResult.total_unique_persons}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Time (ms)</Text>
              <Text style={[styles.statValue, { color: '#F57C00' }]}>
                {videoResult.processing_time_ms ? videoResult.processing_time_ms.toFixed(0) : 0}
              </Text>
            </View>
          </View>

          {/* Debug Controls */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 20, gap: 10 }}>
            <Text style={{ alignSelf: 'center', fontWeight: 'bold' }}>Debug UI:</Text>
            <View style={{ backgroundColor: '#ddd', borderRadius: 5 }}>
              <Text
                style={{ padding: 10, fontWeight: 'bold' }}
                onPress={() => setVideoResult(prev => ({ ...prev, total_unique_persons: prev.total_unique_persons + 1 }))}
              >
                + Total
              </Text>
            </View>
            <View style={{ backgroundColor: '#ddd', borderRadius: 5 }}>
              <Text
                style={{ padding: 10, fontWeight: 'bold' }}
                onPress={() => setVideoResult(prev => ({ ...prev, total_unique_persons: Math.max(0, prev.total_unique_persons - 1) }))}
              >
                - Total
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView >
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    marginBottom: 5,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  videoContainer: {
    height: 300,
    width: '100%',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#2563eb',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  video: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  videoWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  videoLabel: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(37, 99, 235, 0.8)',
    color: '#fff',
    padding: 5,
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 'bold',
  },
  statsContainer: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
    textAlign: 'center',
  },
  statusText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statBox: {
    width: '48%',
    backgroundColor: '#f9f9f9',
    padding: 15,
    marginBottom: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  fpsContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 5,
    borderRadius: 5,
    zIndex: 10,
  },
  fpsText: {
    color: '#0f0',
    fontWeight: 'bold',
  },
  controlPanel: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
});

export default TestingScreen;
