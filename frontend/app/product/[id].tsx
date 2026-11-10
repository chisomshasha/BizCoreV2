import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
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
import { useAuthStore } from '../../src/store/authStore';
import { formatCurrency } from '../../src/config/clientConfig';
import { Product } from '../../src/types';

export default function ProductDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { products, inventory, fetchProducts, fetchInventory } = useAppStore();
  const { user } = useAuthStore();
  // Manual stock adjustment ("stocking and restocking") — SuperAdmin and
  // General Manager only, per the hard-coded /inventory/adjust guard.
  const canAdjustStock = user?.role === 'super_admin' || user?.role === 'general_manager';
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      await Promise.all([fetchProducts(), fetchInventory()]);
    } catch (error) {
      console.error('Error loading product:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const product = products.find((p: Product) => p.product_id === id);
  // Coerce every quantity: `sum + i.quantity` CONCATENATES when the stored
  // value is a string, turning 500 into "0500" (shown as "0 500" on screen).
  const productStock = inventory
    .filter((i: any) => i.product_id === id)
    .reduce((sum: number, i: any) => sum + (Number(i.quantity) || 0), 0);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!product) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Product Not Found</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={64} color={Colors.textMuted} />
          <Text style={styles.emptyText}>Product not found</Text>
          <Button title="Go Back" onPress={() => router.back()} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  const isLowStock = productStock <= product.reorder_level;
  const profitMargin = ((product.selling_price - product.cost_price) / product.selling_price * 100).toFixed(1);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{product.name}</Text>
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
        {/* Stock Status Banner */}
        {isLowStock && (
          <View style={styles.alertBanner}>
            <Ionicons name="warning" size={20} color={Colors.danger} />
            <Text style={styles.alertText}>Low Stock Alert - Below reorder level</Text>
          </View>
        )}

        {/* Main Info Card */}
        <Card style={styles.mainCard}>
          <View style={styles.skuBadge}>
            <Text style={styles.skuText}>{product.sku}</Text>
          </View>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.productCategory}>{product.category}</Text>
          {product.description && (
            <Text style={styles.description}>{product.description}</Text>
          )}
        </Card>

        {/* Stock Info */}
        <Card style={styles.stockCard}>
          <Text style={styles.sectionTitle}>Stock Information</Text>
          <View style={styles.stockGrid}>
            <View style={styles.stockItem}>
              <Text style={styles.stockLabel}>Current Stock</Text>
              <Text style={[
                styles.stockValue,
                isLowStock && { color: Colors.danger }
              ]}>
                {productStock} {product.unit}
              </Text>
            </View>
            <View style={styles.stockItem}>
              <Text style={styles.stockLabel}>Reorder Level</Text>
              <Text style={styles.stockValue}>{product.reorder_level} {product.unit}</Text>
            </View>
          </View>
        </Card>

        {/* Pricing Info */}
        <Card style={styles.pricingCard}>
          <Text style={styles.sectionTitle}>Pricing</Text>
          <View style={styles.pricingGrid}>
            <View style={styles.pricingItem}>
              <Text style={styles.pricingLabel}>Cost Price</Text>
              <Text style={styles.pricingValue}>{formatCurrency(product.cost_price)}</Text>
            </View>
            <View style={styles.pricingItem}>
              <Text style={styles.pricingLabel}>Selling Price</Text>
              <Text style={[styles.pricingValue, { color: Colors.success }]}>
                {formatCurrency(product.selling_price)}
              </Text>
            </View>
            <View style={styles.pricingItem}>
              <Text style={styles.pricingLabel}>Profit Margin</Text>
              <Text style={[styles.pricingValue, { color: Colors.primary }]}>
                {profitMargin}%
              </Text>
            </View>
          </View>
        </Card>

        {/* Barcode */}
        {product.barcode && (
          <Card style={styles.barcodeCard}>
            <Text style={styles.sectionTitle}>Barcode</Text>
            <View style={styles.barcodeContainer}>
              <Ionicons name="barcode-outline" size={32} color={Colors.primary} />
              <Text style={styles.barcodeText}>{product.barcode}</Text>
            </View>
          </Card>
        )}

        {/* Actions */}
        <View style={styles.actionsContainer}>
          {canAdjustStock && (
            <Button
              title="Adjust Stock"
              variant="primary"
              onPress={() => Alert.alert('Adjust Stock', 'Navigate to stock adjustment')}
              style={styles.actionButton}
            />
          )}
          <Button
            title="View History"
            variant="secondary"
            onPress={() => Alert.alert('History', 'Stock movement history coming soon')}
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
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${Colors.danger}15`,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  alertText: {
    color: Colors.danger,
    fontSize: 14,
    fontWeight: '500',
  },
  mainCard: {
    margin: 16,
    marginBottom: 12,
  },
  skuBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.cardAlt,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 12,
  },
  skuText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  productName: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  productCategory: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500',
  },
  description: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
    lineHeight: 20,
  },
  stockCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stockGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  stockItem: {
    flex: 1,
  },
  stockLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  stockValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  pricingCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  pricingGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  pricingItem: {
    flex: 1,
  },
  pricingLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  pricingValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  barcodeCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  barcodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardAlt,
    padding: 16,
    borderRadius: 8,
  },
  barcodeText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    letterSpacing: 2,
  },
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
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
