import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncStore } from '../store/syncStore';
import { Colors } from './ThemedComponents';

export const SyncIndicator: React.FC = () => {
  const { isOnline, isSyncing, pendingChanges, syncPendingChanges } = useSyncStore();
  const [showDetails, setShowDetails] = useState(false);
  const pulseAnim = new Animated.Value(1);

  useEffect(() => {
    if (isSyncing) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isSyncing]);

  if (isOnline && pendingChanges.length === 0 && !isSyncing) {
    return null;
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => {
        if (pendingChanges.length > 0 && isOnline) {
          syncPendingChanges();
        } else {
          setShowDetails(!showDetails);
        }
      }}
      activeOpacity={0.8}
    >
      <Animated.View style={[styles.indicator, { opacity: pulseAnim }]}>
        <Ionicons
          name={isSyncing ? 'sync' : isOnline ? 'cloud-upload' : 'cloud-offline'}
          size={16}
          color={isOnline ? Colors.primary : Colors.warning}
        />
        <Text style={[styles.text, { color: isOnline ? Colors.primary : Colors.warning }]}>
          {isSyncing
            ? 'Syncing...'
            : !isOnline
            ? 'Offline'
            : `${pendingChanges.length} pending`}
        </Text>
      </Animated.View>
      
      {showDetails && (
        <View style={styles.details}>
          <Text style={styles.detailsText}>
            {!isOnline
              ? 'Changes will sync when online'
              : `Tap to sync ${pendingChanges.length} changes`}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    right: 16,
    zIndex: 1000,
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
  },
  details: {
    marginTop: 8,
    backgroundColor: Colors.card,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailsText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
});
