import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  RefreshControl,
  Linking,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Colors,
  Card,
  Button,
  Input,
  ListItem,
  LoadingScreen,
  EmptyState,
} from '../../src/components/ThemedComponents';
import { useAuthStore } from '../../src/store/authStore';
import { useAppStore } from '../../src/store/appStore';
import { useSyncStore } from '../../src/store/syncStore';
import { SyncStatusIndicator } from '../../src/components/SyncStatusIndicator';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import clientConfig, { isFeatureEnabled, formatCurrency as formatNaira } from '../../src/config/clientConfig';
import api from '../../src/utils/api';

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const role = user?.role ?? '';

  const isSuperAdmin        = role === 'super_admin';
  const isGeneralManager    = role === 'general_manager';
  const isWarehouseManager  = role === 'warehouse_manager';
  const isAccountant        = role === 'accountant';
  const isApprover          = ['super_admin','general_manager','warehouse_manager','accountant'].includes(role);
  const isAgent             = role === 'sales_rep';
  const isClerk             = role === 'sales_clerk';
  const isSalesClerk        = role === 'sales_clerk';
  const isPurchaseClerk     = role === 'purchase_clerk';
  const isTopEchelon        = isSuperAdmin || isGeneralManager || isAccountant;

  const { warehouses, fetchWarehouses, createWarehouse, deleteWarehouse } = useAppStore();

  const [refreshing, setRefreshing] = useState(false);
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showReportsModal, setShowReportsModal] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [stockReport, setStockReport] = useState<any[]>([]);
  const [warehouseForm, setWarehouseForm] = useState({ name: '', address: '' });
  const [loadingReport, setLoadingReport] = useState(false);

  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [userForm, setUserForm] = useState({
    name: '', email: '', phone: '', role: 'viewer', warehouse_id: '',
  });
  const [userFormSaving, setUserFormSaving] = useState(false);

  useEffect(() => {
    fetchWarehouses();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchWarehouses();
    setRefreshing(false);
  };

  const loadUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data || []);
    } catch (error: any) {
      if (error.response?.status === 403) {
        Alert.alert('Access Denied', 'You do not have permission to view users');
        setShowUsersModal(false);
      } else {
        console.error('loadUsers error:', error?.message || error);
      }
      setUsers([]);
    }
  };

  const loadStockReport = async () => {
    try {
      setLoadingReport(true);
      const response = await api.get('/reports/stock-summary');
      setStockReport(response.data);
    } catch (error) {
      console.error('Error loading report:', error);
    } finally {
      setLoadingReport(false);
    }
  };

  const handleCreateWarehouse = async () => {
    if (!warehouseForm.name) {
      Alert.alert('Error', 'Warehouse name is required');
      return;
    }
    try {
      await createWarehouse(warehouseForm);
      setShowWarehouseModal(false);
      setWarehouseForm({ name: '', address: '' });
      Alert.alert('Success', 'Warehouse created');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create warehouse');
    }
  };

  const handleDeleteWarehouse = (warehouse: any) => {
    Alert.alert(
      'Delete Warehouse',
      `Are you sure you want to delete "${warehouse.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteWarehouse(warehouse.warehouse_id);
              Alert.alert('Success', 'Warehouse deleted');
            } catch (error: any) {
              Alert.alert('Error', 'Failed to delete warehouse');
            }
          },
        },
      ]
    );
  };

  const handleSaveUser = async () => {
    if (!userForm.name.trim() || !userForm.email.trim() || !userForm.phone.trim()) {
      Alert.alert('Validation', 'Name, email, and phone are required.');
      return;
    }
    setUserFormSaving(true);
    try {
      if (editingUser) {
        const updatePayload: any = {
          name: userForm.name.trim(),
          phone: userForm.phone.trim(),
          role: userForm.role,
          warehouse_id: userForm.warehouse_id || null,
        };
        if (typeof editingUser.is_active === 'boolean') {
          updatePayload.is_active = editingUser.is_active;
        }
        await api.put(`/users/${editingUser.user_id}`, updatePayload);
        Alert.alert('Success', 'User updated.');
      } else {
        const response = await api.post('/users/create', {
          name: userForm.name.trim(),
          email: userForm.email.trim(),
          phone: userForm.phone.trim(),
          role: userForm.role,
          warehouse_id: userForm.warehouse_id || null,
        });
        const initialPassword = response.data?.initial_password;
        Alert.alert(
          'User created',
          initialPassword
            ? `Share these credentials with the new user:\n\nUsername: ${response.data?.username || userForm.email.split('@')[0]}\nTemporary password: ${initialPassword}\n\nThey can change it after first login.`
            : 'User created successfully.',
          [{ text: 'OK' }],
        );
      }
      setShowUserForm(false);
      setEditingUser(null);
      setUserForm({ name: '', email: '', phone: '', role: 'viewer', warehouse_id: '' });
      await loadUsers();
    } catch (error: any) {
      if (error.response?.status === 401) {
        Alert.alert(
          'Session Expired',
          'Your session is no longer valid. Please log in again.',
          [{ text: 'OK', onPress: () => logout() }]
        );
        return;
      }
      const detail = error.response?.data?.detail || 'Failed to save user';
      Alert.alert('Error', detail);
    } finally {
      setUserFormSaving(false);
    }
  };

  const handleDeleteUser = (u: any) => {
    const isInactive = u.is_active === false;
    Alert.alert(
      isInactive ? 'Permanently Delete User' : 'Delete User',
      `Are you sure you want to delete "${u.name}"?${
        isInactive
          ? ' This user is already inactive and has no transaction history.'
          : ' If they have historical records they will be deactivated instead of permanently removed.'
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await api.delete(`/users/${u.user_id}`);
              const msg = response.data?.message || 'User deleted.';
              Alert.alert('Done', msg);
              await loadUsers();
            } catch (error: any) {
              const detail = error.response?.data?.detail || 'Failed to delete user';
              Alert.alert('Error', detail);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      super_admin:       'Super Admin',
      general_manager:   'General Manager',
      warehouse_manager: 'Warehouse Manager',
      purchase_clerk:    'Purchase Clerk',
      sales_rep:         'Sales Representative',
      sales_clerk:       'Sales Clerk',
      accountant:        'Accountant',
      viewer:            'Viewer',
    };
    return labels[role] || role;
  };

  const getRoleBadgeColor = (role: string): 'success' | 'warning' | 'info' | 'default' => {
    switch (role) {
      case 'super_admin':
      case 'general_manager':
        return 'success';
      case 'warehouse_manager':
        return 'warning';
      case 'accountant':
        return 'info';
      default:
        return 'default';
    }
  };

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          <View style={styles.header}>
            <Text style={styles.title}>More</Text>
          </View>

          <Card style={styles.profileCard}>
            <View style={styles.profileHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </Text>
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>{user?.name || 'User'}</Text>
                <Text style={styles.profileEmail}>{user?.email || ''}</Text>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleText}>{getRoleLabel(user?.role || 'viewer')}</Text>
                </View>
              </View>
            </View>
          </Card>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Locations</Text>
            <ListItem
              title="Warehouses"
              subtitle={`${warehouses.length} locations`}
              leftIcon="home-outline"
              onPress={() => setShowWarehouseModal(true)}
            />
          </View>

          {!isAgent && !isSalesClerk && !isPurchaseClerk && (isSuperAdmin || isGeneralManager || isWarehouseManager || isAccountant) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Administration</Text>
              <ListItem
                title="Users"
                subtitle="Manage team members and roles"
                leftIcon="people-outline"
                onPress={() => {
                  setShowUsersModal(true);
                  loadUsers();
                }}
              />
              {isTopEchelon && (
                <ListItem
                  title="Audit Logs"
                  subtitle="Track system activity"
                  leftIcon="time-outline"
                  onPress={() => router.push('/audit-logs')}
                />
              )}
              {(isSuperAdmin || isGeneralManager || role === 'accountant') && (
                <ListItem
                  title="Role Permissions"
                  subtitle="Configure CRUD access per role"
                  leftIcon="shield-checkmark-outline"
                  onPress={() => router.push('/role-permissions')}
                />
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sales & Purchases</Text>
            {(isAgent || isSuperAdmin || isGeneralManager || isWarehouseManager) && (
              <ListItem
                title="Quotations"
                subtitle={isAgent ? "Create and track your quotations" : "Approve agent quotations"}
                leftIcon="document-text-outline"
                onPress={() => router.push('/quotations')}
              />
            )}
            {isAgent && (
              <ListItem
                title="My Ledger"
                subtitle="Goods released, payments & balance"
                leftIcon="wallet-outline"
                onPress={() => router.push('/agent-ledger')}
              />
            )}
            {(isSalesClerk || isWarehouseManager || isSuperAdmin || isGeneralManager || isAgent) && (
              <ListItem
                title="Dispatch"
                subtitle={isAgent ? "Confirm receipt of released goods" : "Release goods to Sales Reps"}
                leftIcon="car-sport-outline"
                onPress={() => router.push('/dispatch')}
              />
            )}
            {(isSalesClerk || isWarehouseManager || isSuperAdmin || isGeneralManager || isAccountant) && (
              <ListItem
                title="Delivery Notes"
                subtitle="Track shipments"
                leftIcon="car-outline"
                onPress={() => router.push('/delivery-notes')}
              />
            )}
            {(isPurchaseClerk || isWarehouseManager || isSuperAdmin || isGeneralManager || isAccountant) && (
              <ListItem
                title="Bill of Materials"
                subtitle="Production recipes"
                leftIcon="construct-outline"
                onPress={() => router.push('/bom')}
              />
            )}
            {(isPurchaseClerk || isWarehouseManager || isSuperAdmin || isGeneralManager || isAccountant) && (
              <ListItem
                title="Purchase Requisitions"
                subtitle={isPurchaseClerk ? "Request materials with approval" : "Review and approve requisitions"}
                leftIcon="document-attach-outline"
                onPress={() => router.push('/requisitions')}
              />
            )}
            {(isPurchaseClerk || isWarehouseManager || isSuperAdmin || isGeneralManager || isAccountant) && (
              <ListItem
                title="Goods Receipt (GRN)"
                subtitle="Receive and verify goods"
                leftIcon="receipt-outline"
                onPress={() => router.push('/grn')}
              />
            )}
            {(isPurchaseClerk || isWarehouseManager || isSuperAdmin || isGeneralManager || isAccountant) && (
              <ListItem
                title="3-Way Matching"
                subtitle="PO-GRN-Invoice verification"
                leftIcon="git-compare-outline"
                onPress={() => router.push('/three-way-match')}
              />
            )}
            {(isSuperAdmin || isGeneralManager || isWarehouseManager || isAccountant) && (
              <ListItem
                title="Warehouse Transfers"
                subtitle="Move stock between branches"
                leftIcon="swap-horizontal-outline"
                onPress={() => router.push('/warehouse-transfers')}
              />
            )}
          </View>

          {(isTopEchelon || isWarehouseManager) && !isAgent && !isSalesClerk && !isPurchaseClerk && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Financial Reports</Text>
              <ListItem
                title="Balance Sheet & Trial Balance"
                subtitle="Financial statements"
                leftIcon="stats-chart-outline"
                onPress={() => router.push('/financial-reports')}
              />
              <ListItem
                title="Performance Dashboard"
                subtitle="Supplier & Agent metrics"
                leftIcon="analytics-outline"
                onPress={() => router.push('/performance-dashboard')}
              />
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reports</Text>
            {(isSuperAdmin || isGeneralManager || isAccountant) && (
              <ListItem
                title="Stock Summary"
                subtitle="View inventory valuation"
                leftIcon="stats-chart-outline"
                onPress={() => {
                  setShowReportsModal(true);
                  loadStockReport();
                }}
              />
            )}
            <ListItem
              title="Export Data"
              subtitle="Download reports as CSV"
              leftIcon="download-outline"
              onPress={() => Alert.alert('Coming Soon', 'Export functionality will be available soon')}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Settings</Text>
            <ListItem
              title="Company Profile"
              subtitle="Business information"
              leftIcon="business-outline"
              onPress={() => Alert.alert('Coming Soon', 'Company settings will be available soon')}
            />
            <ListItem
              title="Notifications"
              subtitle="Manage alerts"
              leftIcon="notifications-outline"
              onPress={() => Alert.alert('Coming Soon', 'Notification settings will be available soon')}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <View style={styles.logoutIcon}>
                <Ionicons name="log-out-outline" size={22} color={Colors.danger} />
              </View>
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.appInfo}>
            <Text style={styles.appName}>{clientConfig.appName}</Text>
            <Text style={styles.appVersion}>Version 1.0.0</Text>
            <Text style={styles.appTagline}>{clientConfig.tagline}</Text>
            {isFeatureEnabled('enableOfflineMode') && (
              <View style={{ marginTop: 12 }}>
                <SyncStatusIndicator />
              </View>
            )}
          </View>
          <View style={{ height: 100 }} />
        </ScrollView>

        <Modal visible={showWarehouseModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Warehouses</Text>
                <TouchableOpacity onPress={() => setShowWarehouseModal(false)}>
                  <Ionicons name="close" size={24} color={Colors.text} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {(isSuperAdmin || isGeneralManager || isWarehouseManager) && (
                  <View style={styles.addWarehouseSection}>
                    <Text style={styles.subsectionTitle}>Add New Warehouse</Text>
                    <Input
                      label="Name *"
                      value={warehouseForm.name}
                      onChangeText={(text) => setWarehouseForm({ ...warehouseForm, name: text })}
                      placeholder="Enter warehouse name"
                    />
                    <Input
                      label="Address"
                      value={warehouseForm.address}
                      onChangeText={(text) => setWarehouseForm({ ...warehouseForm, address: text })}
                      placeholder="Enter address"
                    />
                    <Button
                      title="Add Warehouse"
                      onPress={handleCreateWarehouse}
                      style={{ marginTop: 8 }}
                    />
                  </View>
                )}
                <Text style={styles.subsectionTitle}>Existing Warehouses</Text>
                {warehouses.length === 0 ? (
                  <Text style={styles.emptyText}>No warehouses yet</Text>
                ) : (
                  warehouses.map((warehouse) => (
                    <View key={warehouse.warehouse_id} style={styles.warehouseItem}>
                      <View style={styles.warehouseInfo}>
                        <Text style={styles.warehouseName}>{warehouse.name}</Text>
                        {warehouse.address && (
                          <Text style={styles.warehouseAddress}>{warehouse.address}</Text>
                        )}
                      </View>
                      {(isSuperAdmin || isGeneralManager || isWarehouseManager) && (
                        <TouchableOpacity
                          style={styles.deleteButton}
                          onPress={() => handleDeleteWarehouse(warehouse)}
                        >
                          <Ionicons name="trash-outline" size={20} color={Colors.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={showUsersModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Team Members</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {(isSuperAdmin || isGeneralManager || isWarehouseManager || isAccountant) && (
                    <TouchableOpacity
                      onPress={() => {
                        setEditingUser(null);
                        setUserForm({
                          name: '', email: '', phone: '',
                          role: 'viewer', warehouse_id: '',
                        });
                        setShowUserForm(true);
                      }}
                    >
                      <Ionicons name="add-circle" size={26} color={Colors.primary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => setShowUsersModal(false)}>
                    <Ionicons name="close" size={24} color={Colors.text} />
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {users.length === 0 ? (
                  <EmptyState message="No users found" icon="people-outline" />
                ) : (
                  users.map((u) => (
                    <View key={u.user_id} style={styles.userItem}>
                      <View style={styles.userAvatar}>
                        <Text style={styles.userAvatarText}>
                          {u.name?.charAt(0).toUpperCase() || 'U'}
                        </Text>
                      </View>
                      <View style={styles.userInfo}>
                        <Text style={styles.userName}>
                          {u.name}
                          {u.is_active === false && '  (inactive)'}
                        </Text>
                        <Text style={styles.userEmail}>{u.email}</Text>
                      </View>
                      <View style={styles.userActions}>
                        <View
                          style={[
                            styles.userRoleBadge,
                            {
                              backgroundColor: `${getRoleBadgeColor(u.role) === 'success'
                                ? Colors.success
                                : getRoleBadgeColor(u.role) === 'warning'
                                ? Colors.warning
                                : Colors.primary}20`,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.userRoleText,
                              {
                                color: getRoleBadgeColor(u.role) === 'success'
                                  ? Colors.success
                                  : getRoleBadgeColor(u.role) === 'warning'
                                  ? Colors.warning
                                  : Colors.primary,
                              },
                            ]}
                          >
                            {getRoleLabel(u.role)}
                          </Text>
                        </View>
                        {(isSuperAdmin || isGeneralManager || isWarehouseManager || isAccountant) && u.user_id !== user?.user_id && (
                          <>
                            <TouchableOpacity
                              onPress={() => {
                                setEditingUser(u);
                                setUserForm({
                                  name: u.name || '',
                                  email: u.email || '',
                                  phone: u.phone || '',
                                  role: u.role || 'viewer',
                                  warehouse_id: u.warehouse_id || '',
                                });
                                setShowUserForm(true);
                              }}
                              style={styles.userActionBtn}
                            >
                              <Ionicons name="create-outline" size={20} color={Colors.primary} />
                            </TouchableOpacity>
                            {(isSuperAdmin || isGeneralManager) && (
                              <TouchableOpacity
                                onPress={() => handleDeleteUser(u)}
                                style={styles.userActionBtn}
                              >
                                <Ionicons name="trash-outline" size={20} color={Colors.danger} />
                              </TouchableOpacity>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={showUserForm} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {editingUser ? 'Edit User' : 'Create New User'}
                </Text>
                <TouchableOpacity onPress={() => setShowUserForm(false)}>
                  <Ionicons name="close" size={24} color={Colors.text} />
                </TouchableOpacity>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.formLabel}>Full Name *</Text>
                <TextInput
                  style={styles.formInput}
                  value={userForm.name}
                  onChangeText={(t) => setUserForm({ ...userForm, name: t })}
                  placeholder="Jane Doe"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.formLabel}>Email *</Text>
                <TextInput
                  style={styles.formInput}
                  value={userForm.email}
                  onChangeText={(t) => setUserForm({ ...userForm, email: t })}
                  placeholder="jane@example.com"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!editingUser}
                />
                <Text style={styles.formLabel}>Phone *</Text>
                <TextInput
                  style={styles.formInput}
                  value={userForm.phone}
                  onChangeText={(t) => setUserForm({ ...userForm, phone: t })}
                  placeholder="+234 800 000 0000"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                />
                <Text style={styles.formLabel}>Role *</Text>
                <View style={styles.roleSelector}>
                  {(() => {
                    const ROLE_RANK: Record<string, number> = {
                      viewer: 1, sales_clerk: 2, purchase_clerk: 2, sales_rep: 3,
                      accountant: 4, warehouse_manager: 5, general_manager: 6, super_admin: 7,
                    };
                    const callerRank = ROLE_RANK[role] ?? 0;
                    const allRoles = ['viewer', 'sales_clerk', 'purchase_clerk', 'sales_rep',
                                       'accountant', 'warehouse_manager', 'general_manager', 'super_admin'];
                    return allRoles.filter((r) => isSuperAdmin || ROLE_RANK[r] < callerRank);
                  })().map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[
                        styles.roleOption,
                        userForm.role === r && styles.roleOptionActive,
                      ]}
                      onPress={() => setUserForm({ ...userForm, role: r })}
                    >
                      <Text
                        style={[
                          styles.roleOptionText,
                          userForm.role === r && styles.roleOptionTextActive,
                        ]}
                      >
                        {getRoleLabel(r)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.formLabel}>Warehouse (optional)</Text>
                <View style={styles.warehouseSelector}>
                  <TouchableOpacity
                    style={[
                      styles.warehouseOption,
                      !userForm.warehouse_id && styles.warehouseOptionActive,
                    ]}
                    onPress={() => setUserForm({ ...userForm, warehouse_id: '' })}
                  >
                    <Text style={styles.warehouseOptionText}>None</Text>
                  </TouchableOpacity>
                  {warehouses.map((w: any) => (
                    <TouchableOpacity
                      key={w.warehouse_id}
                      style={[
                        styles.warehouseOption,
                        userForm.warehouse_id === w.warehouse_id && styles.warehouseOptionActive,
                      ]}
                      onPress={() => setUserForm({ ...userForm, warehouse_id: w.warehouse_id })}
                    >
                      <Text
                        style={[
                          styles.warehouseOptionText,
                          userForm.warehouse_id === w.warehouse_id && styles.warehouseOptionTextActive,
                        ]}
                      >
                        {w.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {editingUser && (
                  <>
                    <Text style={styles.formLabel}>Status</Text>
                    <View style={styles.roleSelector}>
                      <TouchableOpacity
                        style={[
                          styles.roleOption,
                          editingUser.is_active !== false && styles.roleOptionActive,
                        ]}
                        onPress={() => {
                          setEditingUser({ ...editingUser, is_active: true });
                        }}
                      >
                        <Text
                          style={[
                            styles.roleOptionText,
                            editingUser.is_active !== false && styles.roleOptionTextActive,
                          ]}
                        >
                          Active
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.roleOption,
                          editingUser.is_active === false && styles.roleOptionActive,
                        ]}
                        onPress={() => {
                          setEditingUser({ ...editingUser, is_active: false });
                        }}
                      >
                        <Text
                          style={[
                            styles.roleOptionText,
                            editingUser.is_active === false && styles.roleOptionTextActive,
                          ]}
                        >
                          Inactive
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                <TouchableOpacity
                  style={[styles.submitButton, userFormSaving && styles.submitButtonDisabled]}
                  onPress={handleSaveUser}
                  disabled={userFormSaving}
                >
                  <Text style={styles.submitButtonText}>
                    {userFormSaving ? 'Saving...' : editingUser ? 'Save Changes' : 'Create User'}
                  </Text>
                </TouchableOpacity>
                {!editingUser && (
                  <Text style={styles.formHint}>
                    The system will generate a temporary password and show it to you after creation.
                    Share it with the new user — they can change it after first login.
                  </Text>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={showReportsModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Stock Summary Report</Text>
                <TouchableOpacity onPress={() => setShowReportsModal(false)}>
                  <Ionicons name="close" size={24} color={Colors.text} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {loadingReport ? (
                  <LoadingScreen />
                ) : stockReport.length === 0 ? (
                  <EmptyState message="No stock data" icon="stats-chart-outline" />
                ) : (
                  <>
                    <View style={styles.reportSummary}>
                      <View style={styles.reportSummaryItem}>
                        <Text style={styles.reportSummaryValue}>
                          {formatNaira(stockReport.reduce((sum, item) => sum + (item.value || 0), 0), { maximumFractionDigits: 0 })}
                        </Text>
                        <Text style={styles.reportSummaryLabel}>Total Value</Text>
                      </View>
                      <View style={styles.reportSummaryItem}>
                        <Text style={styles.reportSummaryValue}>{stockReport.length}</Text>
                        <Text style={styles.reportSummaryLabel}>Items</Text>
                      </View>
                      <View style={styles.reportSummaryItem}>
                        <Text
                          style={[
                            styles.reportSummaryValue,
                            { color: Colors.danger },
                          ]}
                        >
                          {stockReport.filter((item) => item.is_low_stock).length}
                        </Text>
                        <Text style={styles.reportSummaryLabel}>Low Stock</Text>
                      </View>
                    </View>
                    {stockReport.map((item, index) => (
                      <View key={index} style={styles.reportItem}>
                        <View style={styles.reportItemHeader}>
                          <Text style={styles.reportItemName}>{item.product_name}</Text>
                          {item.is_low_stock && (
                            <View style={styles.lowStockBadge}>
                              <Text style={styles.lowStockText}>LOW</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.reportItemDetails}>
                          <View style={styles.reportItemDetail}>
                            <Text style={styles.reportItemDetailLabel}>SKU</Text>
                            <Text style={styles.reportItemDetailValue}>{item.sku}</Text>
                          </View>
                          <View style={styles.reportItemDetail}>
                            <Text style={styles.reportItemDetailLabel}>Qty</Text>
                            <Text style={styles.reportItemDetailValue}>
                              {item.quantity} {item.unit}
                            </Text>
                          </View>
                          <View style={styles.reportItemDetail}>
                            <Text style={styles.reportItemDetailLabel}>Value</Text>
                            <Text style={styles.reportItemDetailValue}>
                              {formatNaira(item.value || 0)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 28, fontWeight: '700', color: Colors.text },
  profileCard: { marginHorizontal: 20, marginBottom: 24 },
  profileHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 64, height: 64, borderRadius: 16, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: Colors.text },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 20, fontWeight: '600', color: Colors.text },
  profileEmail: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  roleBadge: {
    backgroundColor: `${Colors.primary}20`, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, alignSelf: 'flex-start', marginTop: 8,
  },
  roleText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionTitle: {
    fontSize: 14, fontWeight: '600', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12,
  },
  logoutButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    padding: 16, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
  },
  logoutIcon: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: `${Colors.danger}20`,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  logoutText: { fontSize: 16, fontWeight: '500', color: Colors.danger },
  appInfo: { alignItems: 'center', paddingVertical: 24 },
  appName: { fontSize: 18, fontWeight: '700', color: Colors.textSecondary },
  appVersion: { fontSize: 13, color: Colors.textMuted, marginTop: 4 },
  appTagline: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Colors.background, borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 20, maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  addWarehouseSection: {
    backgroundColor: Colors.cardAlt, borderRadius: 12, padding: 16, marginBottom: 20,
  },
  subsectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 12 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingVertical: 20 },
  warehouseItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    padding: 14, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  warehouseInfo: { flex: 1 },
  warehouseName: { fontSize: 16, fontWeight: '500', color: Colors.text },
  warehouseAddress: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  deleteButton: { padding: 8 },
  userItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    padding: 14, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  userAvatar: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  userAvatarText: { fontSize: 18, fontWeight: '700', color: Colors.text },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '500', color: Colors.text },
  userEmail: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  userRoleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  userRoleText: { fontSize: 11, fontWeight: '600' },
  userActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userActionBtn: { padding: 6 },
  formLabel: {
    fontSize: 12, fontWeight: '600', color: Colors.textMuted,
    marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  formInput: {
    backgroundColor: Colors.cardAlt, borderRadius: 10, padding: 12,
    color: Colors.text, fontSize: 15, borderWidth: 1, borderColor: Colors.border,
  },
  roleSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  roleOption: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.cardAlt, borderWidth: 1, borderColor: Colors.border,
  },
  roleOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  roleOptionText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
  roleOptionTextActive: { color: Colors.text, fontWeight: '600' },
  warehouseSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  warehouseOption: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.cardAlt, borderWidth: 1, borderColor: Colors.border,
  },
  warehouseOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  warehouseOptionText: { color: Colors.textSecondary, fontSize: 13 },
  warehouseOptionTextActive: { color: Colors.text, fontWeight: '600' },
  submitButton: {
    backgroundColor: Colors.primary, borderRadius: 12,
    padding: 14, alignItems: 'center', marginTop: 20,
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  formHint: { color: Colors.textMuted, fontSize: 12, marginTop: 12, lineHeight: 18 },
  reportSummary: {
    flexDirection: 'row', backgroundColor: Colors.cardAlt,
    borderRadius: 12, padding: 16, marginBottom: 20,
  },
  reportSummaryItem: { flex: 1, alignItems: 'center' },
  reportSummaryValue: { fontSize: 20, fontWeight: '700', color: Colors.text },
  reportSummaryLabel: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  reportItem: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  reportItemHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  reportItemName: { fontSize: 15, fontWeight: '500', color: Colors.text, flex: 1 },
  lowStockBadge: {
    backgroundColor: `${Colors.danger}20`, paddingHorizontal: 8,
    paddingVertical: 2, borderRadius: 4,
  },
  lowStockText: { fontSize: 10, fontWeight: '700', color: Colors.danger },
  reportItemDetails: { flexDirection: 'row', justifyContent: 'space-between' },
  reportItemDetail: { alignItems: 'center' },
  reportItemDetailLabel: { fontSize: 11, color: Colors.textMuted, marginBottom: 2 },
  reportItemDetailValue: { fontSize: 13, color: Colors.text, fontWeight: '500' },
});
