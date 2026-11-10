import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BarChart } from 'react-native-gifted-charts';
import {
  Colors,
  Card,
  StatCard,
  Badge,
  LoadingScreen,
} from '../../src/components/ThemedComponents';
import { useAppStore } from '../../src/store/appStore';
import { useAuthStore } from '../../src/store/authStore';
import { formatCurrency } from '../../src/config/clientConfig';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { format } from 'date-fns';

const { width } = Dimensions.get('window');

// Roles whose designated area of the app is an overview of the business
// (or their warehouse): SuperAdmin, General Manager, Warehouse Manager,
// Accountant. Other roles (sales_rep, sales_clerk, purchase_clerk, viewer)
// have their own designated screens and should not see the company-wide
// Home dashboard, including overall inventory value.
const DASHBOARD_ALLOWED_ROLES = ['super_admin', 'general_manager', 'warehouse_manager', 'accountant'];

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const role = user?.role ?? '';
  const canViewDashboard = DASHBOARD_ALLOWED_ROLES.includes(role);
  const canViewInventoryValue = role === 'super_admin' || role === 'general_manager';
  const {
    dashboardStats,
    recentActivity,
    salesChart,
    topProducts,
    lowStockItems,
    isLoading,
    fetchDashboard,
    fetchLowStockItems,
  } = useAppStore();
  
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (canViewDashboard) {
      loadData();
    }
  }, [canViewDashboard]);

  const loadData = async () => {
    try {
      await Promise.all([
        fetchDashboard(),
        fetchLowStockItems(),
      ]);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const formatNaira = (value: number) =>
    formatCurrency(value, { maximumFractionDigits: 0 });

  // Roles outside the dashboard-allowed set get a lightweight, role-relevant
  // home screen instead of the company-wide overview — quick links to their
  // own designated parts of the app, with no business-wide financial data.
  if (!canViewDashboard) {
    return <RoleHomeScreen role={role} userName={user?.name} />;
  }

  if (isLoading && !dashboardStats) {
    return <LoadingScreen />;
  }

  // Prepare chart data (defensive: salesChart may be null if the dashboard
  // fetch failed mid-flight)
  const chartData = (salesChart || []).map((item, index) => ([
    {
      value: item?.sales || 0,
      label: item?.date ? format(new Date(item.date), 'EEE') : '',
      frontColor: Colors.primary,
      spacing: 2,
    },
    {
      value: item?.purchases || 0,
      frontColor: Colors.secondary,
    },
  ])).flat();

  return (
    <ErrorBoundary>
    <SafeAreaView style={styles.container} edges={['top']}>
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
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.userName}>{user?.name || 'User'}</Text>
          </View>
          <TouchableOpacity
            style={styles.notificationButton}
            onPress={() => router.push('/notifications')}
          >
            <Ionicons name="notifications-outline" size={24} color={Colors.text} />
            {(lowStockItems?.length || 0) > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {lowStockItems?.length || 0}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Stats Grid */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.statsContainer}
          contentContainerStyle={styles.statsContent}
        >
          {canViewInventoryValue && (
            <StatCard
              title="Inventory Value"
              value={formatNaira(dashboardStats?.total_inventory_value || 0)}
              icon="cube"
              color={Colors.primary}
            />
          )}
          <StatCard
            title="Low Stock Items"
            value={dashboardStats?.low_stock_count || 0}
            icon="alert-circle"
            color={Colors.danger}
          />
          <StatCard
            title="Today's Sales"
            value={formatNaira(dashboardStats?.today_sales || 0)}
            icon="trending-up"
            color={Colors.success}
          />
          <StatCard
            title="Today's Purchases"
            value={formatNaira(dashboardStats?.today_purchases || 0)}
            icon="trending-down"
            color={Colors.warning}
          />
          <StatCard
            title="Pending Invoices"
            value={dashboardStats?.pending_invoices || 0}
            icon="document-text"
            color={Colors.primaryLight}
          />
        </ScrollView>

        {/* Quick Stats Row */}
        <View style={styles.quickStatsRow}>
          <Card style={styles.quickStatCard}>
            <View style={styles.quickStatIcon}>
              <Ionicons name="cube-outline" size={20} color={Colors.primary} />
            </View>
            <Text style={styles.quickStatValue}>{dashboardStats?.total_products || 0}</Text>
            <Text style={styles.quickStatLabel}>Products</Text>
          </Card>
          <Card style={styles.quickStatCard}>
            <View style={[styles.quickStatIcon, { backgroundColor: `${Colors.secondary}20` }]}>
              <Ionicons name="business-outline" size={20} color={Colors.secondary} />
            </View>
            <Text style={styles.quickStatValue}>{dashboardStats?.total_suppliers || 0}</Text>
            <Text style={styles.quickStatLabel}>Suppliers</Text>
          </Card>
          <Card style={styles.quickStatCard}>
            <View style={[styles.quickStatIcon, { backgroundColor: `${Colors.warning}20` }]}>
              <Ionicons name="people-outline" size={20} color={Colors.warning} />
            </View>
            <Text style={styles.quickStatValue}>{dashboardStats?.total_agents || 0}</Text>
            <Text style={styles.quickStatLabel}>Sales Reps</Text>
          </Card>
          <Card style={styles.quickStatCard}>
            <View style={[styles.quickStatIcon, { backgroundColor: `${Colors.success}20` }]}>
              <Ionicons name="home-outline" size={20} color={Colors.success} />
            </View>
            <Text style={styles.quickStatValue}>{dashboardStats?.total_warehouses || 0}</Text>
            <Text style={styles.quickStatLabel}>Warehouses</Text>
          </Card>
        </View>

        {/* Sales vs Purchases Chart */}
        {chartData.length > 0 && (
          <Card style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <Text style={styles.chartTitle}>Sales vs Purchases (7 Days)</Text>
              <View style={styles.chartLegend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.primary }]} />
                  <Text style={styles.legendText}>Sales</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.secondary }]} />
                  <Text style={styles.legendText}>Purchases</Text>
                </View>
              </View>
            </View>
            <BarChart
              data={chartData}
              barWidth={16}
              spacing={24}
              roundedTop
              roundedBottom
              hideRules
              xAxisThickness={0}
              yAxisThickness={0}
              yAxisTextStyle={{ color: Colors.textMuted, fontSize: 10 }}
              xAxisLabelTextStyle={{ color: Colors.textMuted, fontSize: 10 }}
              noOfSections={4}
              maxValue={
                (chartData.length
                  ? Math.max(...chartData.map((d) => d.value || 0)) * 1.2
                  : 100) || 100
              }
              width={width - 100}
              height={150}
              isAnimated
            />
          </Card>
        )}

        {/* Low Stock Alerts */}
        {(lowStockItems?.length || 0) > 0 && (
          <Card style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <View style={styles.alertIconContainer}>
                <Ionicons name="warning" size={20} color={Colors.danger} />
              </View>
              <Text style={styles.alertTitle}>Low Stock Alerts</Text>
              <Badge text={`${lowStockItems?.length || 0}`} variant="danger" />
            </View>
            {lowStockItems?.slice(0, 3).map((item: any, index: number) => (
              <View key={item.product_id || index} style={styles.alertItem}>
                <View style={styles.alertItemInfo}>
                  <Text style={styles.alertItemName}>{item.name}</Text>
                  <Text style={styles.alertItemSku}>SKU: {item.sku}</Text>
                </View>
                <View style={styles.alertItemStock}>
                  <Text style={styles.alertItemStockValue}>{item.current_stock}</Text>
                  <Text style={styles.alertItemStockLabel}>/ {item.reorder_level}</Text>
                </View>
              </View>
            ))}
            {(lowStockItems?.length || 0) > 3 && (
              <TouchableOpacity
                style={styles.viewAllButton}
                onPress={() => router.push('/inventory')}
              >
                <Text style={styles.viewAllText}>View All ({lowStockItems?.length})</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
              </TouchableOpacity>
            )}
          </Card>
        )}

        {/* Top Products */}
        {topProducts.length > 0 && (
          <Card style={styles.topProductsCard}>
            <Text style={styles.sectionTitle}>Top Selling Products</Text>
            {topProducts.slice(0, 5).map((product, index) => (
              <View key={product.product_id} style={styles.topProductItem}>
                <View style={styles.topProductRank}>
                  <Text style={styles.topProductRankText}>#{index + 1}</Text>
                </View>
                <View style={styles.topProductInfo}>
                  <Text style={styles.topProductName}>{product.name}</Text>
                  <Text style={styles.topProductSku}>{product.quantity_sold} sold</Text>
                </View>
                <Text style={styles.topProductRevenue}>
                  {formatNaira(product.revenue)}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Recent Activity */}
        <Card style={styles.activityCard}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {recentActivity.length === 0 ? (
            <View style={styles.emptyActivity}>
              <Ionicons name="time-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyActivityText}>No recent activity</Text>
            </View>
          ) : (
            recentActivity.slice(0, 5).map((activity, index) => (
              <View key={index} style={styles.activityItem}>
                <View
                  style={[
                    styles.activityIcon,
                    {
                      backgroundColor:
                        activity.type === 'sales_order'
                          ? `${Colors.success}20`
                          : activity.type === 'purchase_order'
                          ? `${Colors.warning}20`
                          : `${Colors.primary}20`,
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      activity.type === 'sales_order'
                        ? 'cart'
                        : activity.type === 'purchase_order'
                        ? 'cube'
                        : 'swap-horizontal'
                    }
                    size={16}
                    color={
                      activity.type === 'sales_order'
                        ? Colors.success
                        : activity.type === 'purchase_order'
                        ? Colors.warning
                        : Colors.primary
                    }
                  />
                </View>
                <View style={styles.activityContent}>
                  <Text style={styles.activityTitle}>{activity.title}</Text>
                  <Text style={styles.activityDesc}>{activity.description}</Text>
                </View>
                {activity.amount && (
                  <Text style={styles.activityAmount}>
                    {formatNaira(activity.amount)}
                  </Text>
                )}
              </View>
            ))
          )}
        </Card>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
    </ErrorBoundary>
  );
}

type RoleHomeLink = {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
};

const ROLE_HOME_CONFIG: Record<string, { greeting: string; links: RoleHomeLink[] }> = {
  sales_rep: {
    greeting: 'Create quotations, track your orders, and manage your ledger.',
    links: [
      { title: 'Quotations', subtitle: 'Create and submit quotations for approval', icon: 'document-text-outline', route: '/quotations' },
      { title: 'My Orders', subtitle: 'View your released sales orders', icon: 'cart-outline', route: '/(tabs)/orders' },
      { title: 'Dispatch', subtitle: 'Confirm receipt of released goods', icon: 'car-sport-outline', route: '/dispatch' },
      { title: 'My Ledger', subtitle: 'Goods in custody, payments & balance', icon: 'wallet-outline', route: '/agent-ledger' },
    ],
  },
  sales_clerk: {
    greeting: 'Process orders, release goods to agents, and track delivery.',
    links: [
      { title: 'Dispatch', subtitle: 'Release approved goods to Sales Reps', icon: 'car-sport-outline', route: '/dispatch' },
      { title: 'Orders', subtitle: 'Process and manage sales orders', icon: 'cart-outline', route: '/(tabs)/orders' },
      { title: 'Delivery Notes', subtitle: 'Track shipments', icon: 'car-outline', route: '/delivery-notes' },
    ],
  },
  purchase_clerk: {
    greeting: 'Manage procurement — buy materials and finished goods for the business before they are stocked into inventory.',
    links: [
      { title: 'Orders', subtitle: 'Manage purchase orders', icon: 'cart-outline', route: '/(tabs)/orders' },
      { title: 'Purchase Requisitions', subtitle: 'Request materials with approval', icon: 'document-attach-outline', route: '/requisitions' },
      { title: 'Goods Receipt (GRN)', subtitle: 'Receive and verify incoming goods', icon: 'receipt-outline', route: '/grn' },
      { title: '3-Way Matching', subtitle: 'PO-GRN-Invoice verification', icon: 'git-compare-outline', route: '/three-way-match' },
    ],
  },
  viewer: {
    greeting: 'You have read-only access to the app.',
    links: [
      { title: 'Orders', subtitle: 'View sales and purchase orders', icon: 'cart-outline', route: '/(tabs)/orders' },
      { title: 'Notifications', subtitle: 'View recent alerts', icon: 'notifications-outline', route: '/notifications' },
    ],
  },
};

/**
 * Lightweight home screen for roles that don't have access to the
 * company-wide overview dashboard (sales_rep, sales_clerk, purchase_clerk,
 * viewer). Surfaces quick links to each role's own designated screens
 * instead of business-wide financial figures like overall inventory value.
 */
function RoleHomeScreen({ role, userName }: { role: string; userName?: string }) {
  const router = useRouter();
  const config = ROLE_HOME_CONFIG[role] || ROLE_HOME_CONFIG.viewer;

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>Welcome back,</Text>
              <Text style={styles.userName}>{userName || 'User'}</Text>
            </View>
            <TouchableOpacity
              style={styles.notificationButton}
              onPress={() => router.push('/notifications')}
            >
              <Ionicons name="notifications-outline" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <Card style={{ marginHorizontal: 20, marginBottom: 16 }}>
            <Text style={styles.sectionTitle}>Quick Links</Text>
            <Text style={[styles.emptyActivityText, { marginBottom: 12, marginTop: -4 }]}>
              {config.greeting}
            </Text>
            {config.links.map((link) => (
              <TouchableOpacity
                key={link.route}
                style={styles.activityItem}
                onPress={() => router.push(link.route as any)}
              >
                <View style={[styles.activityIcon, { backgroundColor: `${Colors.primary}20` }]}>
                  <Ionicons name={link.icon} size={18} color={Colors.primary} />
                </View>
                <View style={styles.activityContent}>
                  <Text style={styles.activityTitle}>{link.title}</Text>
                  <Text style={styles.activityDesc}>{link.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </Card>

          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  greeting: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 2,
  },
  notificationButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  notificationBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: Colors.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: Colors.text,
    fontSize: 10,
    fontWeight: '600',
  },
  statsContainer: {
    marginBottom: 16,
  },
  statsContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  quickStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 16,
  },
  quickStatCard: {
    flex: 1,
    minWidth: (width - 64) / 2,
    alignItems: 'center',
    padding: 12,
  },
  quickStatIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${Colors.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickStatValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  quickStatLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  chartCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  chartLegend: {
    flexDirection: 'row',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  alertCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderColor: Colors.danger,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  alertIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: `${Colors.danger}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  alertTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  alertItemInfo: {
    flex: 1,
  },
  alertItemName: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  alertItemSku: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  alertItemStock: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  alertItemStockValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.danger,
  },
  alertItemStockLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
  },
  viewAllText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500',
  },
  topProductsCard: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
  },
  topProductItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topProductRank: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.cardAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  topProductRankText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  topProductInfo: {
    flex: 1,
  },
  topProductName: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  topProductSku: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  topProductRevenue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.success,
  },
  activityCard: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  emptyActivity: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyActivityText: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 8,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  activityDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  activityAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
});
