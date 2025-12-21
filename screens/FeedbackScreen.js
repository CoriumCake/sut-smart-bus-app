import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import axios from 'axios';
import { API_BASE, getApiUrl } from '../config/api';
import { SafeAreaView } from 'react-native-safe-area-context';

const FeedbackScreen = () => {
  const [feedback, setFeedback] = useState('');

  const submitFeedback = async () => {
    if (feedback.trim()) {
      try {
        // We probably don't need API key for feedback, but let's be consistent if the backend requires it.
        // Assuming backend might need it, or at least we should check connectivity.
        // But the user request is "no crash when no api key".
        // If the backend endpoint /api/feedback is public, we don't need it.
        // But let's assume we might want to attach it if available, or just proceed.
        // However, if we use `checkApiKey` and it returns null, we should handle it if we enforce it.
        // Let's just wrap the axios call in try-catch (which it is).
        // I will add a check for API URL though.
        const apiUrl = await getApiUrl(); // This handles default
        await axios.post(`${apiUrl}/api/feedback`, {
          name: 'App User',
          message: feedback,
        });
        Alert.alert('Feedback Submitted', 'Thank you for your feedback!');
        setFeedback('');
      } catch (error) {
        console.error('Error submitting feedback:', error);
        Alert.alert('Error', 'Failed to submit feedback. Please try again.');
      }
    } else {
      Alert.alert('Error', 'Please enter your feedback.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Submit Feedback</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter your feedback here..."
        value={feedback}
        onChangeText={setFeedback}
        multiline
      />
      <TouchableOpacity style={styles.button} onPress={submitFeedback}>
        <Text style={styles.buttonText}>Submit</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    height: 150,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 5,
    padding: 10,
    marginBottom: 20,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default FeedbackScreen;