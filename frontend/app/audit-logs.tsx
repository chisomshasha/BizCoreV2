import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Colors,
  Card,
  Badge,
  LoadingScreen,
  EmptyState,
} from '../src/components/ThemedComponents';
import { format, formatDistanceToNow } from 'date-fns';
import api from '../src/utils/api';
import { useAuthStore } from '../src/store/authStore';

interface AuditLog {
  log_id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value?: any;
  new_value?: any;
  timestamp: string;
  ip_address?: string;
}

export default function AuditLogsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  // Top echelon only — matches backend GET /audit-logs gate.
  const canView = ['super_admin', 'general_manager', 'accountant'].includes(user?.role ?? '');

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entityFilter, setEntityFilter] = useState<string>('all');

  useEffect(() => {
    if (!canView) {
      router.back();
      return;
    }
    loadData();
  }, [canView]);

  const loadData = async () => {
    try {
      await fetchLogs();
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await api.get('/audit-logs?limit=100');
      setLogs(response.data);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchLogs();
    setRefreshing(false);
  };

  const getActionIcon = (action: string): keyof typeof Ionicons.glyphMap => {
    switch (action) {
      case 'create': return 'add-circle';
      case 'update': return 'create';
      case 'delete': return 'trash';
      case 'update_status': return 'checkmark-circle';
      case 'login': return 'log-in';
      case 'logout': return 'log-out';
      default: return 'ellipse';
    }
  };

  const getActionColor = (action: string): string => {
    switch (action) {
      case 'create': return Colors.success;
      case 'update': return Colors.info;
      case 'delete': return Colors.danger;
      case 'update_status': return Colors.warning;
      case 'login': return Colors.primary;
      case 'logout': return Colors.textMuted;
      default: return Colors.textSecondary;
    }
  };

  const getEntityIcon = (entity: string): keyof typeof Ionicons.glyphMap => {
    switch (entity) {
      case 'product': return 'cube';
      case 'supplier': return 'business';
      case 'sales_rep': return 'people';
      case 'purchase_order': return 'cart';
      case 'sales_order': return 'bag';
      case 'quotation': return 'document-text';
      case 'delivery_note': return 'car';
      case 'invoice': return 'receipt';
      case 'expense': return 'cash';
      case 'bom': return 'construct';
      case 'user': return 'person';
      default: return 'document';
    }
  };

  const entityTypes = ['all', ...new Set(logs.map(l => l.entity_type))];
  
  const filteredLogs = entityFilter === 'all'
    ? logs
    : logs.filter(l => l.entity_type === entityFilter);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Audit Logs</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Entity Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterContainer}>
        {entityTypes.map(entity => (
          <TouchableOpacity
            key={entity}
            style={[styles.filterChip, entityFilter === entity && styles.filterChipActive]}
            onPress={() => setEntityFilter(entity)}
          >
            <Text style={[styles.filterText, entityFilter === entity && styles.filterTextActive]}>
              {entity === 'all' ? 'All' : entity.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Stats */}
      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{logs.length}</Text>
          <Text style={styles.statLabel}>Total Actions</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{logs.filter(l => l.action === 'create').length}</Text>
          <Text style={styles.statLabel}>Created</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{logs.filter(l => l.action === 'update' || l.action === 'update_status').length}</Text>
          <Text style={styles.statLabel}>Updated</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{logs.filter(l => l.action === 'delete').length}</Text>
          <Text style={styles.statLabel}>Deleted</Text>
        </Card>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        contentContainerStyle={styles.content}
      >
        {filteredLogs.length === 0 ? (
          <EmptyState
            icon="time-outline"
            title="No Audit Logs"
            message="System activity will be recorded here"
          />
        ) : (
          filteredLogs.map((log, index) => (
            <View key={log.log_id || index} style={styles.logItem}>
              <View style={styles.timeline}>
                <View style={[styles.timelineDot, { backgroundColor: getActionColor(log.action) }]}>
                  <Ionicons name={getActionIcon(log.action)} size={12} color={Colors.text} />
                </View>
                {index < filteredLogs.length - 1 && <View style={styles.timelineLine} />}
              </View>
              <Card style={styles.logCard}>
                <View style={styles.logHeader}>
                  <View style={styles.logEntity}>
                    <View style={styles.entityIcon}>
                      <Ionicons name={getEntityIcon(log.entity_type)} size={16} color={Colors.primary} />
                    </View>
                    <Text style={styles.logEntityText}>
                      {log.entity_type.replace('_', ' ')}
                    </Text>
                  </View>
                  <Badge
                    text={log.action.replace('_', ' ')}
                    variant={
                      log.action === 'create' ? 'success' :
                      log.action === 'delete' ? 'danger' : 'info'
                    }
                  />
                </View>
                <Text style={styles.logId}>ID: {log.entity_id}</Text>
                {log.new_value && Object.keys(log.new_value).length > 0 && (
                  <View style={styles.logChanges}>
                    {Object.entries(log.new_value).slice(0, 3).map(([key, value]) => (
                      <Text key={key} style={styles.logChangeText} numberOfLines={1}>
                        {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </Text>
                    ))}
                  </View>
                )}
                <View style={styles.logFooter}>
                  <View style={styles.logUser}>
                    <Ionicons name="person-outline" size={12} color={Colors.textMuted} />
                    <Text style={styles.logUserText}>{log.user_id.substring(0, 20)}...</Text>
                  </View>
                  <Text style={styles.logTime}>
                    {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                  </Text>
                </View>
              </Card>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.card,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { color: Colors.textSecondary, fontSize: 13 },
  filterTextActive: { color: Colors.text, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  statValue: { fontSize: 20, fontWeight: '700', color: Colors.text },
  statLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  content: { paddingHorizontal: 16 },
  logItem: { flexDirection: 'row' },
  timeline: { width: 32, alignItems: 'center' },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  logCard: {
    flex: 1,
    marginBottom: 12,
    marginLeft: 8,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logEntity: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  entityIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: `${Colors.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logEntityText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    textTransform: 'capitalize',
  },
  logId: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 8,
    fontFamily: 'monospace',
  },
  logChanges: {
    marginTop: 8,
    padding: 8,
    backgroundColor: Colors.cardAlt,
    borderRadius: 6,
  },
  logChangeText: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  logFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  logUser: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  logUserText: { fontSize: 11, color: Colors.textMuted },
  logTime: { fontSize: 11, color: Colors.textMuted },
});
