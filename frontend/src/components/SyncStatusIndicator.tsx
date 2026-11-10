import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncStore } from '../store/syncStore';
import clientConfig from '../config/clientConfig';

const Colors = clientConfig.theme;

export const SyncStatusIndicator: React.FC = () => {
  const { isOnline, isSyncing, pendingChanges, lastSyncTime, syncPendingChanges } = useSyncStore();
  
  if (!clientConfig.features.enableOfflineMode) {
    return null;
  }
  
  const hasPendingChanges = pendingChanges.length > 0;
  
  const getStatusColor = () => {
    if (!isOnline) return Colors.danger;
    if (isSyncing) return Colors.warning;
    if (hasPendingChanges) return Colors.warning;
    return Colors.success;
  };
  
  const getStatusIcon = (): keyof typeof Ionicons.glyphMap => {
    if (!isOnline) return 'cloud-offline';
    if (isSyncing) return 'sync';
    if (hasPendingChanges) return 'cloud-upload';
    return 'cloud-done';
  };
  
  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSyncing) return 'Syncing...';
    if (hasPendingChanges) return `${pendingChanges.length} pending`;
    return 'Synced';
  };
  
  const handlePress = () => {
    if (isOnline && hasPendingChanges && !isSyncing) {
      syncPendingChanges();
    }
  };
  
  return (
    <TouchableOpacity 
      style={styles.container} 
      onPress={handlePress}
      disabled={!isOnline || isSyncing || !hasPendingChanges}
      activeOpacity={0.7}
    >
      <View style={[styles.indicator, { backgroundColor: getStatusColor() }]}>
        <Ionicons 
          name={getStatusIcon()} 
          size={12} 
          color={Colors.text} 
        />
      </View>
      <Text style={styles.text}>{getStatusText()}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardAlt,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  indicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
});
