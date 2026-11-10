import React from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../src/components/ThemedComponents';
import { useAuthStore } from '../../src/store/authStore';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { isAgent, isClerk, isPurchaseClerk, isApprover, isSuperAdmin, isGeneralManager,
          isWarehouseManager, isAccountant } = useAuthStore();

  const bottomPadding = Platform.OS === 'android'
    ? Math.max(insets.bottom, 10) + 10
    : insets.bottom || 25;

  const tabBarHeight = Platform.OS === 'android' ? 60 + bottomPadding : 85;

  // Sales reps (agents) only see Home, Orders, and their Ledger (via More)
  const agentOnly = isAgent && !isApprover && !isSuperAdmin && !isGeneralManager;

  // Roles that do NOT get Finance or Reports tabs:
  // - Sales Rep (field agents — no financial overview)
  // - Sales Clerk (fulfillment — no financial overview)
  // - Purchase Clerk (procurement — no financial overview; backend already guards content)
  const hideFinanceReports = agentOnly || isClerk || isPurchaseClerk;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingTop: 8,
          paddingBottom: bottomPadding,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          elevation: 8,
        },
      }}
    >
      {/* Home — everyone (content role-gated inside index.tsx) */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={color} />
          ),
        }}
      />

      {/* Inventory — hidden from pure agents */}
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          href: agentOnly ? null : undefined,
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'cube' : 'cube-outline'} size={22} color={color} />
          ),
        }}
      />

      {/* Orders — everyone (agents see their own SOs; managers see all) */}
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'cart' : 'cart-outline'} size={22} color={color} />
          ),
        }}
      />

      {/* Finance — top echelon + Warehouse Manager only */}
      <Tabs.Screen
        name="finance"
        options={{
          title: 'Finance',
          href: hideFinanceReports ? null : undefined,
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={22} color={color} />
          ),
        }}
      />

      {/* Reports — top echelon + Warehouse Manager only */}
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          href: hideFinanceReports ? null : undefined,
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} size={22} color={color} />
          ),
        }}
      />

      {/* More — everyone */}
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'menu' : 'menu-outline'} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});
