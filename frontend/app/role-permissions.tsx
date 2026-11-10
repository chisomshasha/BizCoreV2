/**
 * Role Permissions Management Screen
 * ====================================
 * Super Admin only. Accessible from More → Administration → Role Permissions.
 *
 * Features
 * --------
 * - Lists all roles (except super_admin / general_manager which are immutable).
 * - For each role: shows an expandable grid of 20 modules × 4 operations (C R U D).
 * - Each cell is a pressable toggle (on = coloured chip, off = ghost outline).
 * - "Save" sends a PUT /admin/role-permissions/:role to the backend.
 * - "Reset to Defaults" sends POST /admin/role-permissions/reset/:role.
 * - Accountant's Read toggles are disabled (always forced ON server-side).
 * - super_admin / general_manager are shown read-only with a lock badge.
 * - Unsaved changes show an amber indicator dot next to the role header.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/components/ThemedComponents';
import { useAuthStore } from '../src/store/authStore';
import api from '../src/utils/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CRUDPerm {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

type Operation = keyof CRUDPerm;

interface RolePermissions {
  role: string;
  permissions: Record<string, CRUDPerm>;
}

interface MatrixData {
  roles: RolePermissions[];
  modules: string[];
  module_labels: Record<string, string>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IMMUTABLE_ROLES = new Set(['super_admin', 'general_manager']);
const ALWAYS_READ_ROLES = new Set(['accountant']);

const ROLE_LABELS: Record<string, string> = {
  super_admin:       'Super Admin',
  general_manager:   'General Manager',
  warehouse_manager: 'Warehouse Manager',
  manager:           'Manager',
  purchase_clerk:    'Purchase Clerk',
  sales_executive:   'Sales Executive',
  sales_rep:         'Sales Rep',
  sales_clerk:       'Sales Clerk',
  accountant:        'Accountant',
  viewer:            'Viewer',
};

const OP_COLORS: Record<Operation, string> = {
  create: '#10B981',   // emerald
  read:   '#3B82F6',   // blue
  update: '#F59E0B',   // amber
  delete: '#EF4444',   // red
};

const OP_ICONS: Record<Operation, keyof typeof Ionicons.glyphMap> = {
  create: 'add-circle-outline',
  read:   'eye-outline',
  update: 'pencil-outline',
  delete: 'trash-outline',
};

const OPS: Operation[] = ['create', 'read', 'update', 'delete'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function deepClonePerms(p: Record<string, CRUDPerm>): Record<string, CRUDPerm> {
  const out: Record<string, CRUDPerm> = {};
  for (const [mod, crud] of Object.entries(p)) {
    out[mod] = { ...crud };
  }
  return out;
}

function permsEqual(a: Record<string, CRUDPerm>, b: Record<string, CRUDPerm>): boolean {
  for (const mod of Object.keys(a)) {
    const ca = a[mod];
    const cb = b[mod];
    if (!cb) return false;
    for (const op of OPS) {
      if (ca[op] !== cb[op]) return false;
    }
  }
  return true;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RolePermissionsScreen() {
  const router = useRouter();
  const { isSuperAdmin, isGeneralManager, isAccountant } = useAuthStore();
  // Viewing the matrix: Super Admin, General Manager, and Accountant
  // (matches GET /admin/role-permissions).
  const canView = isSuperAdmin || isGeneralManager || isAccountant;
  // Editing the matrix (toggle switches, Save, Reset): Super Admin and
  // General Manager ONLY. This is the master switch for the entire
  // authorization system — Accountant must not be able to write here,
  // even though they can view it (matches PUT/POST /admin/role-permissions).
  const canEdit = isSuperAdmin || isGeneralManager;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matrix, setMatrix] = useState<MatrixData | null>(null);

  // Local editable state keyed by role
  const [local, setLocal] = useState<Record<string, Record<string, CRUDPerm>>>({});
  // Snapshot of what was loaded from server (for dirty detection)
  const [server, setServer] = useState<Record<string, Record<string, CRUDPerm>>>({});
  // Which role panels are expanded
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Saving state per role
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Redirect users who can't even view this screen
  useEffect(() => {
    if (!canView) {
      Alert.alert('Access Denied', 'Only Super Admin, General Manager, or Accountant can view role permissions.');
      router.back();
    }
  }, [canView]);

  const loadMatrix = useCallback(async () => {
    try {
      const res = await api.get('/admin/role-permissions');
      const data: MatrixData = res.data;
      setMatrix(data);

      const localCopy: Record<string, Record<string, CRUDPerm>> = {};
      const serverCopy: Record<string, Record<string, CRUDPerm>> = {};
      for (const rp of data.roles) {
        localCopy[rp.role] = deepClonePerms(rp.permissions);
        serverCopy[rp.role] = deepClonePerms(rp.permissions);
      }
      setLocal(localCopy);
      setServer(serverCopy);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to load permissions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  const onRefresh = () => { setRefreshing(true); loadMatrix(); };

  // ── Toggle a single CRUD cell ──────────────────────────────────────────────
  const toggle = (role: string, module: string, op: Operation) => {
    if (IMMUTABLE_ROLES.has(role)) return;
    // Accountant read is always locked
    if (ALWAYS_READ_ROLES.has(role) && op === 'read') return;

    setLocal(prev => {
      const copy = { ...prev };
      copy[role] = deepClonePerms(copy[role] || {});
      copy[role][module] = { ...copy[role][module] };
      copy[role][module][op] = !copy[role][module][op];
      return copy;
    });
  };

  // ── Save changes for a role ────────────────────────────────────────────────
  const saveRole = async (role: string) => {
    setSaving(s => ({ ...s, [role]: true }));
    try {
      const perms = local[role];
      await api.put(`/admin/role-permissions/${role}`, { permissions: perms });
      // Update server snapshot
      setServer(s => ({ ...s, [role]: deepClonePerms(perms) }));
      Alert.alert('Saved', `Permissions for ${ROLE_LABELS[role] || role} updated.`);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to save permissions.');
    } finally {
      setSaving(s => ({ ...s, [role]: false }));
    }
  };

  // ── Reset to defaults ──────────────────────────────────────────────────────
  const resetRole = (role: string) => {
    Alert.alert(
      'Reset to Defaults',
      `Reset all permissions for ${ROLE_LABELS[role] || role} to their factory defaults?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setSaving(s => ({ ...s, [role]: true }));
            try {
              const res = await api.post(`/admin/role-permissions/reset/${role}`);
              const resetPerms = res.data.permissions as Record<string, CRUDPerm>;
              setLocal(l => ({ ...l, [role]: deepClonePerms(resetPerms) }));
              setServer(s => ({ ...s, [role]: deepClonePerms(resetPerms) }));
              Alert.alert('Reset', `${ROLE_LABELS[role] || role} permissions reset to defaults.`);
            } catch (e: any) {
              Alert.alert('Error', e.response?.data?.detail || 'Failed to reset.');
            } finally {
              setSaving(s => ({ ...s, [role]: false }));
            }
          },
        },
      ]
    );
  };

  // ── Quick helpers: grant / revoke all for a module row ────────────────────
  const toggleRow = (role: string, module: string, grant: boolean) => {
    if (IMMUTABLE_ROLES.has(role)) return;
    setLocal(prev => {
      const copy = { ...prev };
      copy[role] = deepClonePerms(copy[role] || {});
      const base = copy[role][module] || { create: false, read: false, update: false, delete: false };
      copy[role][module] = {
        create: grant,
        read: ALWAYS_READ_ROLES.has(role) ? true : grant,  // accountant read locked
        update: grant,
        delete: grant,
      };
      return copy;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading permission matrix…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!matrix) return null;

  const allRoles = matrix?.roles ?? [];
  const editableRoles = allRoles.filter(rp => !IMMUTABLE_ROLES.has(rp.role));
  const lockedRoles   = allRoles.filter(rp =>  IMMUTABLE_ROLES.has(rp.role));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Role Permissions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Legend */}
        <View style={styles.legend}>
          {OPS.map(op => (
            <View key={op} style={styles.legendItem}>
              <Ionicons name={OP_ICONS[op]} size={14} color={OP_COLORS[op]} />
              <Text style={[styles.legendText, { color: OP_COLORS[op] }]}>
                {op.charAt(0).toUpperCase() + op.slice(1)}
              </Text>
            </View>
          ))}
        </View>

        {/* Locked roles notice */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>IMMUTABLE ROLES</Text>
          {lockedRoles.map(rp => (
            <View key={rp.role} style={styles.lockedCard}>
              <Ionicons name="lock-closed" size={16} color={Colors.warning} />
              <Text style={styles.lockedText}>{ROLE_LABELS[rp.role] || rp.role}</Text>
              <Text style={styles.lockedSub}>Full access — cannot be restricted</Text>
            </View>
          ))}
        </View>

        {/* Editable roles */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CONFIGURABLE ROLES</Text>
          {editableRoles.map(rp => {
            const role = rp.role;
            const isExpanded = !!expanded[role];
            const isDirty = local[role] && server[role] && !permsEqual(local[role], server[role]);
            const isSavingNow = saving[role];
            const isAccountant = ALWAYS_READ_ROLES.has(role);

            return (
              <View key={role} style={styles.roleCard}>
                {/* Role header row */}
                <TouchableOpacity
                  style={styles.roleHeader}
                  onPress={() => setExpanded(e => ({ ...e, [role]: !e[role] }))}
                  activeOpacity={0.7}
                >
                  <View style={styles.roleHeaderLeft}>
                    {isDirty && <View style={styles.dirtyDot} />}
                    <Text style={styles.roleTitle}>{ROLE_LABELS[role] || role}</Text>
                    {isAccountant && (
                      <View style={styles.lockReadBadge}>
                        <Text style={styles.lockReadText}>Read always ON</Text>
                      </View>
                    )}
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={Colors.textMuted}
                  />
                </TouchableOpacity>

                {/* Expanded module grid */}
                {isExpanded && local[role] && (
                  <View style={styles.moduleGrid}>
                    {/* Column headers */}
                    <View style={styles.moduleRow}>
                      <Text style={[styles.moduleLabel, { flex: 2.2 }]}>Module</Text>
                      {OPS.map(op => (
                        <View key={op} style={styles.opHeader}>
                          <Ionicons name={OP_ICONS[op]} size={13} color={OP_COLORS[op]} />
                        </View>
                      ))}
                      <View style={styles.rowToggleHeader} />
                    </View>

                    {matrix.modules.map((mod, idx) => {
                      const perm = local[role][mod] || { create: false, read: false, update: false, delete: false };
                      const rowGranted = OPS.every(op =>
                        op === 'read' && isAccountant ? true : perm[op]
                      );
                      return (
                        <View
                          key={mod}
                          style={[styles.moduleRow, idx % 2 === 0 && styles.moduleRowAlt]}
                        >
                          <Text style={[styles.moduleLabel, { flex: 2.2 }]} numberOfLines={1}>
                            {matrix.module_labels[mod] || mod}
                          </Text>
                          {OPS.map(op => {
                            const locked = !canEdit;
                            const active = perm[op];
                            return (
                              <TouchableOpacity
                                key={op}
                                style={[
                                  styles.opCell,
                                  active && { backgroundColor: `${OP_COLORS[op]}22` },
                                  locked && styles.opCellLocked,
                                ]}
                                onPress={() => toggle(role, mod, op)}
                                disabled={locked}
                                activeOpacity={0.6}
                              >
                                {active ? (
                                  <Ionicons name="checkmark-circle" size={18} color={OP_COLORS[op]} />
                                ) : (
                                  <View style={[styles.opCircleOff, locked && { borderColor: Colors.border }]} />
                                )}
                              </TouchableOpacity>
                            );
                          })}
                          {/* Grant / revoke entire row — edit-capable roles only */}
                          {canEdit && (
                            <TouchableOpacity
                              style={styles.rowToggleBtn}
                              onPress={() => toggleRow(role, mod, !rowGranted)}
                            >
                              <Ionicons
                                name={rowGranted ? 'close-circle-outline' : 'add-circle-outline'}
                                size={16}
                                color={rowGranted ? Colors.danger : Colors.success}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}

                    {/* Action buttons — edit-capable roles only */}
                    {canEdit && (
                      <View style={styles.actionRow}>
                        <TouchableOpacity
                          style={[styles.resetBtn]}
                          onPress={() => resetRole(role)}
                          disabled={isSavingNow}
                        >
                          <Ionicons name="refresh-outline" size={14} color={Colors.textMuted} />
                          <Text style={styles.resetBtnText}>Reset Defaults</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.saveBtn, !isDirty && styles.saveBtnDisabled]}
                          onPress={() => saveRole(role)}
                          disabled={!isDirty || isSavingNow}
                        >
                          {isSavingNow ? (
                            <ActivityIndicator size="small" color={Colors.text} />
                          ) : (
                            <>
                              <Ionicons name="checkmark-outline" size={14} color={Colors.text} />
                              <Text style={styles.saveBtnText}>
                                {isDirty ? 'Save Changes' : 'Saved'}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendText: {
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  lockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  lockedText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
  },
  lockedSub: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  roleCard: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  roleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  roleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  dirtyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.warning,
  },
  roleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  lockReadBadge: {
    backgroundColor: `${Colors.primary}20`,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lockReadText: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: '600',
  },
  moduleGrid: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: 8,
  },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  moduleRowAlt: {
    backgroundColor: `${Colors.cardAlt}55`,
  },
  moduleLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  opHeader: {
    width: 36,
    alignItems: 'center',
  },
  opCell: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 6,
  },
  opCellLocked: {
    opacity: 0.5,
  },
  opCircleOff: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  rowToggleHeader: {
    width: 28,
  },
  rowToggleBtn: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 4,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardAlt,
  },
  resetBtnText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  saveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  saveBtnDisabled: {
    backgroundColor: Colors.cardAlt,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
});
