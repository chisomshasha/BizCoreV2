import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  Colors,
  Card,
  Button,
  Badge,
  LoadingScreen,
} from '../../src/components/ThemedComponents';
import { useAppStore } from '../../src/store/appStore';
import { formatCurrency } from '../../src/config/clientConfig';

export default function PartnerDetailScreen() {
  const router = useRouter();
  // The Partner tab was retired — this screen is now Supplier-only.
  // We accept the route param defensively but always treat as supplier.
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    suppliers,
    purchaseOrders,
    fetchSuppliers,
    fetchPurchaseOrders,
  } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      await Promise.all([fetchSuppliers(), fetchPurchaseOrders()]);
    } catch (error) {
      console.error('Error loading supplier:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const partner = suppliers.find(
    (s: any) => s.supplier_id === id || s._id === id
  );

  const orders = purchaseOrders.filter(
    (po: any) => po.supplier_id === id
  );

  const totalOrderValue = orders.reduce(
    (sum: number, o: any) => sum + (o.total_amount ?? 0),
    0
  );
  const completedOrders = orders.filter(
    (o: any) => o.status === 'received' || o.status === 'paid' || o.status === 'delivered'
  ).length;

  const handleCall = () => {
    if (partner?.phone) {
      Linking.openURL(`tel:${partner.phone}`);
    }
  };

  const handleEmail = () => {
    if (partner?.email) {
      Linking.openURL(`mailto:${partner.email}`);
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (!partner) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Supplier Not Found</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Ionicons name="person-outline" size={64} color={Colors.textMuted} />
          <Text style={styles.emptyText}>Supplier not found</Text>
          <Button title="Go Back" onPress={() => router.back()} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          Supplier
        </Text>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => Alert.alert('Edit', 'Edit functionality coming soon')}
        >
          <Ionicons name="create-outline" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Partner Info Card */}
        <Card style={styles.mainCard}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {partner.name?.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Badge text="Supplier" variant="primary" />
          </View>
          <Text style={styles.partnerName}>{partner.name}</Text>
          {partner.contact_person && (
            <Text style={styles.contactPerson}>{partner.contact_person}</Text>
          )}

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.quickAction, !partner.phone && styles.disabledAction]}
              onPress={handleCall}
              disabled={!partner.phone}
            >
              <Ionicons name="call" size={20} color={partner.phone ? Colors.success : Colors.textMuted} />
              <Text style={[styles.quickActionText, !partner.phone && styles.disabledText]}>
                Call
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickAction, !partner.email && styles.disabledAction]}
              onPress={handleEmail}
              disabled={!partner.email}
            >
              <Ionicons name="mail" size={20} color={partner.email ? Colors.primary : Colors.textMuted} />
              <Text style={[styles.quickActionText, !partner.email && styles.disabledText]}>
                Email
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickAction}
              onPress={() => Alert.alert('Message', 'Messaging coming soon')}
            >
              <Ionicons name="chatbubble" size={20} color={Colors.info} />
              <Text style={styles.quickActionText}>Message</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Contact Details */}
        <Card style={styles.contactCard}>
          <Text style={styles.sectionTitle}>Contact Details</Text>

          {partner.phone && (
            <View style={styles.contactRow}>
              <Ionicons name="call-outline" size={20} color={Colors.textMuted} />
              <Text style={styles.contactText}>{partner.phone}</Text>
            </View>
          )}

          {partner.email && (
            <View style={styles.contactRow}>
              <Ionicons name="mail-outline" size={20} color={Colors.textMuted} />
              <Text style={styles.contactText}>{partner.email}</Text>
            </View>
          )}

          {partner.address && (
            <View style={styles.contactRow}>
              <Ionicons name="location-outline" size={20} color={Colors.textMuted} />
              <Text style={styles.contactText}>{partner.address}</Text>
            </View>
          )}
        </Card>

        {/* Statistics */}
        <Card style={styles.statsCard}>
          <Text style={styles.sectionTitle}>Statistics</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{orders.length}</Text>
              <Text style={styles.statLabel}>Total Orders</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{completedOrders}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: Colors.success }]}>
                {formatCurrency(totalOrderValue)}
              </Text>
              <Text style={styles.statLabel}>Total Value</Text>
            </View>
          </View>
        </Card>

        {/* Recent Orders */}
        <Card style={styles.ordersCard}>
          <View style={styles.ordersHeader}>
            <Text style={styles.sectionTitle}>Recent Orders</Text>
            {orders.length > 3 && (
              <TouchableOpacity onPress={() => router.push('/(tabs)/orders')}>
                <Text style={styles.viewAllText}>View All</Text>
              </TouchableOpacity>
            )}
          </View>

          {orders.length === 0 ? (
            <View style={styles.emptyOrders}>
              <Ionicons name="document-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyOrdersText}>No orders yet</Text>
            </View>
          ) : (
            orders.slice(0, 3).map((order: any) => (
              <TouchableOpacity
                key={order.po_id || order._id}
                style={styles.orderRow}
                onPress={() => router.push({
                  pathname: '/order/[id]',
                  params: { id: order.po_id || order._id, type: 'purchase' }
                })}
              >
                <View style={styles.orderInfo}>
                  <Text style={styles.orderNumber}>{order.po_number}</Text>
                  <Text style={styles.orderDate}>
                    {order.items?.length || 0} items
                  </Text>
                </View>
                <View style={styles.orderRight}>
                  <Text style={styles.orderAmount}>
                    {formatCurrency(order.total_amount ?? 0)}
                  </Text>
                  <Badge
                    text={order.status}
                    variant={
                      order.status === 'received' ||
                      order.status === 'paid' ||
                      order.status === 'delivered'
                        ? 'success'
                        : 'warning'
                    }
                  />
                </View>
              </TouchableOpacity>
            ))
          )}
        </Card>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            title="New Purchase Order"
            variant="primary"
            onPress={() => router.push('/(tabs)/orders')}
            style={styles.actionButton}
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
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
  editButton: {
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
    marginHorizontal: 12,
  },
  mainCard: {
    margin: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.text,
  },
  partnerName: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  contactPerson: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  quickActions: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 24,
  },
  quickAction: {
    alignItems: 'center',
    gap: 4,
  },
  disabledAction: {
    opacity: 0.5,
  },
  quickActionText: {
    fontSize: 12,
    color: Colors.text,
  },
  disabledText: {
    color: Colors.textMuted,
  },
  contactCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  contactText: {
    fontSize: 14,
    color: Colors.text,
    flex: 1,
  },
  statsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
  ordersCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  ordersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewAllText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500',
  },
  emptyOrders: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyOrdersText: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 8,
  },
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  orderInfo: {},
  orderNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  orderDate: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  orderRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  orderAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  actionsContainer: {
    paddingHorizontal: 16,
  },
  actionButton: {
    width: '100%',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textMuted,
    marginTop: 12,
  },
});
