import React, { useEffect, useState } from 'react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  Colors,
  Card,
  Button,
  Input,
  Badge,
  ListItem,
  LoadingScreen,
  EmptyState,
} from '../../src/components/ThemedComponents';
import { useAppStore } from '../../src/store/appStore';
import { useAuthStore } from '../../src/store/authStore';
import { useRouter } from 'expo-router';
import { Product, ProductCategory } from '../../src/types';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';
import clientConfig, { isFeatureEnabled, formatCurrency as formatNaira } from '../../src/config/clientConfig';
import api from '../../src/utils/api';

export default function InventoryScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const role = user?.role ?? '';
  // Product catalog management (add/edit products) — SuperAdmin, General
  // Manager, Warehouse Manager (matches backend products:create/update).
  const canManageProducts = ['super_admin', 'general_manager', 'warehouse_manager'].includes(role);
  // Manual stock adjustment ("stocking and restocking") — SuperAdmin and
  // General Manager only, per the hard-coded /inventory/adjust guard.
  const canAdjustStock = role === 'super_admin' || role === 'general_manager';

  const {
    products,
    inventory,
    warehouses,
    isLoading,
    fetchProducts,
    fetchInventory,
    fetchWarehouses,
    createProduct,
    updateProduct,
    deleteProduct,
    adjustInventory,
  } = useAppStore();

  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState<'products' | 'stock'>('products');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'all'>('all');

  // Per-warehouse inventory (Stock tab)
  const [inventoryByWarehouse, setInventoryByWarehouse] = useState<any[]>([]);
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
  const [stockLoading, setStockLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    description: '',
    category: 'raw' as ProductCategory,
    unit: 'pcs',
    cost_price: '',
    selling_price: '',
    reorder_level: '10',
    barcode: '',
    initial_warehouse_id: '',
    initial_quantity: '',
  });

  const [adjustData, setAdjustData] = useState({
    warehouse_id: '',
    quantity: '',
    type: 'adjustment' as 'adjustment' | 'return',
    notes: '',
  });

  useEffect(() => {
    loadData();
    // Load aggregated stock on mount so Products tab shows correct quantities immediately
    loadInventoryByWarehouse();
  }, []);

  useEffect(() => {
    if (activeTab === 'stock' && inventoryByWarehouse.length === 0) {
      loadInventoryByWarehouse();
    }
  }, [activeTab]);

  const loadData = async () => {
    try {
      await Promise.all([
        fetchProducts(),
        fetchInventory(),
        fetchWarehouses(),
      ]);
    } catch (error) {
      console.error('Error loading inventory:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadData(), loadInventoryByWarehouse()]);
    setRefreshing(false);
  };

  const loadInventoryByWarehouse = async () => {
    try {
      setStockLoading(true);
      const response = await api.get('/inventory/by-warehouse');
      setInventoryByWarehouse(response.data || []);
    } catch (error) {
      console.error('Error loading per-warehouse inventory:', error);
    } finally {
      setStockLoading(false);
    }
  };

  const handleAddProduct = async () => {
    try {
      if (!formData.sku || !formData.name) {
        Alert.alert('Error', 'SKU and Name are required');
        return;
      }

      const newProduct = await createProduct({
        ...formData,
        cost_price: parseFloat(formData.cost_price) || 0,
        selling_price: parseFloat(formData.selling_price) || 0,
        reorder_level: parseInt(formData.reorder_level) || 10,
      });

      // Seed initial stock if warehouse + quantity were provided
      const initQty = parseFloat(formData.initial_quantity);
      if (formData.initial_warehouse_id && initQty > 0) {
        try {
          await adjustInventory({
            product_id: newProduct.product_id,
            warehouse_id: formData.initial_warehouse_id,
            type: 'adjustment',
            quantity: initQty,
            notes: 'Initial stock on product creation',
          });
        } catch (stockErr: any) {
          // Product was created; warn but don't block
          Alert.alert(
            'Product Created',
            `Product was created but the initial stock could not be set: ${stockErr?.response?.data?.detail || 'Unknown error'}. You can add stock using the Adjust Stock option.`
          );
          setShowAddModal(false);
          resetForm();
          await loadInventoryByWarehouse();
          return;
        }
      }

      setShowAddModal(false);
      resetForm();
      await loadInventoryByWarehouse();
      Alert.alert(
        'Success',
        initQty > 0 && formData.initial_warehouse_id
          ? `Product created and ${initQty.toLocaleString()} units added to stock.`
          : 'Product created successfully.'
      );
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create product');
    }
  };

  const handleUpdateProduct = async () => {
    if (!selectedProduct) return;
    
    try {
      await updateProduct(selectedProduct.product_id, {
        name: formData.name,
        description: formData.description,
        category: formData.category,
        unit: formData.unit,
        cost_price: parseFloat(formData.cost_price) || 0,
        selling_price: parseFloat(formData.selling_price) || 0,
        reorder_level: parseInt(formData.reorder_level) || 10,
        barcode: formData.barcode,
      });

      setShowDetailModal(false);
      resetForm();
      Alert.alert('Success', 'Product updated successfully');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update product');
    }
  };

  const handleDeleteProduct = (product: Product) => {
    Alert.alert(
      'Delete Product',
      `Are you sure you want to delete "${product.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProduct(product.product_id);
              setShowDetailModal(false);
              Alert.alert('Success', 'Product deleted');
            } catch (error: any) {
              Alert.alert('Error', 'Failed to delete product');
            }
          },
        },
      ]
    );
  };

  const handleAdjustStock = async () => {
    if (!selectedProduct || !adjustData.warehouse_id || !adjustData.quantity) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }

    try {
      await adjustInventory({
        product_id: selectedProduct.product_id,
        warehouse_id: adjustData.warehouse_id,
        type: adjustData.type,
        quantity: parseFloat(adjustData.quantity),
        notes: adjustData.notes,
      });

      setShowAdjustModal(false);
      setAdjustData({ warehouse_id: '', quantity: '', type: 'adjustment', notes: '' });
      Alert.alert('Success', 'Stock adjusted successfully');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to adjust stock');
    }
  };

  const resetForm = () => {
    setFormData({
      sku: '',
      name: '',
      description: '',
      category: 'raw',
      unit: 'pcs',
      cost_price: '',
      selling_price: '',
      reorder_level: '10',
      barcode: '',
      initial_warehouse_id: '',
      initial_quantity: '',
    });
    setSelectedProduct(null);
  };

  const openProductDetail = (product: Product) => {
    setSelectedProduct(product);
    setFormData({
      sku: product.sku,
      name: product.name,
      description: product.description || '',
      category: product.category,
      unit: product.unit,
      cost_price: product.cost_price.toString(),
      selling_price: product.selling_price.toString(),
      reorder_level: product.reorder_level.toString(),
      barcode: product.barcode || '',
      // Opening an existing product is not a "create" flow — the opening
      // stock fields only apply when creating a brand-new product.
      initial_warehouse_id: '',
      initial_quantity: '',
    });
    setShowDetailModal(true);
  };

  const handleBarcodeProductFound = (product: any, stock: number) => {
    Alert.alert(
      'Product Found',
      `${product.name}\nSKU: ${product.sku}\nStock: ${stock} ${product.unit}`,
      [
        { text: 'View Details', onPress: () => openProductDetail(product) },
        ...(canAdjustStock ? [{ text: 'Adjust Stock', onPress: () => {
          setSelectedProduct(product);
          setShowAdjustModal(true);
        }}] : []),
        { text: 'Close', style: 'cancel' as const },
      ]
    );
  };

  const getProductStock = (productId: string): number => {
    // Prefer the aggregated by-warehouse data (already summed on the backend)
    const byWh = inventoryByWarehouse.find((p: any) => p.product_id === productId);
    if (byWh) return Number(byWh.total_quantity) || 0;
    // Fallback to flat inventory records
    const stocks = inventory.filter((s) => s.product_id === productId);
    return stocks.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
  };

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getCategoryColor = (category: ProductCategory) => {
    switch (category) {
      case 'raw':
        return Colors.primary;
      case 'finished':
        return Colors.success;
      case 'packaging':
        return Colors.warning;
      default:
        return Colors.textMuted;
    }
  };

  if (isLoading && products.length === 0) {
    return (
      <ErrorBoundary>
        <LoadingScreen />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Inventory</Text>
        <View style={styles.headerButtons}>
          {isFeatureEnabled('enableBarcodeScan') && (
            <TouchableOpacity
              style={styles.scanButton}
              onPress={() => setShowBarcodeScanner(true)}
            >
              <Ionicons name="barcode-outline" size={24} color={Colors.text} />
            </TouchableOpacity>
          )}
          {canManageProducts && (
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => {
                resetForm();
                setShowAddModal(true);
              }}
            >
              <Ionicons name="add" size={24} color={Colors.text} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'products' && styles.activeTab]}
          onPress={() => setActiveTab('products')}
        >
          <Text style={[styles.tabText, activeTab === 'products' && styles.activeTabText]}>
            Products
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'stock' && styles.activeTab]}
          onPress={() => setActiveTab('stock')}
        >
          <Text style={[styles.tabText, activeTab === 'stock' && styles.activeTabText]}>
            Stock Levels
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Ionicons name="search" size={20} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {(['all', 'raw', 'finished', 'packaging'] as const).map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[
              styles.filterChip,
              selectedCategory === cat && styles.filterChipActive,
            ]}
            onPress={() => setSelectedCategory(cat)}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedCategory === cat && styles.filterChipTextActive,
              ]}
            >
              {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        contentContainerStyle={styles.content}
      >
        {activeTab === 'products' ? (
          filteredProducts.length === 0 ? (
            <EmptyState message="No products found" icon="cube-outline" />
          ) : (
            filteredProducts.map((product) => {
              const stock = getProductStock(product.product_id);
              const isLowStock = stock <= product.reorder_level;

              return (
                <TouchableOpacity
                  key={product.product_id}
                  style={styles.productCard}
                  onPress={() => openProductDetail(product)}
                  activeOpacity={0.7}
                >
                  <View style={styles.productHeader}>
                    <View
                      style={[
                        styles.categoryBadge,
                        { backgroundColor: `${getCategoryColor(product.category)}20` },
                      ]}
                    >
                      <Text
                        style={[
                          styles.categoryText,
                          { color: getCategoryColor(product.category) },
                        ]}
                      >
                        {product.category.toUpperCase()}
                      </Text>
                    </View>
                    {isLowStock && <Badge text="Low Stock" variant="danger" />}
                  </View>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productSku}>SKU: {product.sku}</Text>
                  <View style={styles.productFooter}>
                    <View>
                      <Text style={styles.priceLabel}>Cost</Text>
                      <Text style={styles.priceValue}>{formatNaira(product.cost_price || 0)}</Text>
                    </View>
                    <View>
                      <Text style={styles.priceLabel}>Sell</Text>
                      <Text style={[styles.priceValue, { color: Colors.success }]}>
                        {formatNaira(product.selling_price || 0)}
                      </Text>
                    </View>
                    <View>
                      <Text style={styles.priceLabel}>Stock</Text>
                      <Text
                        style={[
                          styles.priceValue,
                          { color: isLowStock ? Colors.danger : Colors.text },
                        ]}
                      >
                        {stock.toLocaleString()}{product.unit && isNaN(Number(product.unit)) ? ` ${product.unit}` : ''}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )
        ) : (
          stockLoading ? (
            <LoadingScreen />
          ) : inventoryByWarehouse.length === 0 ? (
            <EmptyState message="No stock records" icon="layers-outline" />
          ) : (
            <StockByWarehouseView
              data={inventoryByWarehouse}
              expanded={expandedProducts}
              onToggle={(pid) =>
                setExpandedProducts((prev) => ({ ...prev, [pid]: !prev[pid] }))
              }
              searchQuery={searchQuery}
            />
          )
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Add Product Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Product</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Input
                label="SKU *"
                value={formData.sku}
                onChangeText={(text) => setFormData({ ...formData, sku: text })}
                placeholder="Enter SKU"
              />
              <Input
                label="Name *"
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
                placeholder="Enter product name"
              />
              <Input
                label="Description"
                value={formData.description}
                onChangeText={(text) => setFormData({ ...formData, description: text })}
                placeholder="Enter description"
                multiline
                numberOfLines={3}
              />
              <Text style={styles.inputLabel}>Category</Text>
              <View style={styles.categoryPicker}>
                {(['raw', 'finished', 'packaging'] as const).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryOption,
                      formData.category === cat && styles.categoryOptionActive,
                    ]}
                    onPress={() => setFormData({ ...formData, category: cat })}
                  >
                    <Text
                      style={[
                        styles.categoryOptionText,
                        formData.category === cat && styles.categoryOptionTextActive,
                      ]}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Input
                    label="Cost Price"
                    value={formData.cost_price}
                    onChangeText={(text) => setFormData({ ...formData, cost_price: text })}
                    placeholder="0.00"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfInput}>
                  <Input
                    label="Selling Price"
                    value={formData.selling_price}
                    onChangeText={(text) => setFormData({ ...formData, selling_price: text })}
                    placeholder="0.00"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Input
                    label="Unit"
                    value={formData.unit}
                    onChangeText={(text) => setFormData({ ...formData, unit: text })}
                    placeholder="pcs"
                  />
                </View>
                <View style={styles.halfInput}>
                  <Input
                    label="Reorder Level"
                    value={formData.reorder_level}
                    onChangeText={(text) => setFormData({ ...formData, reorder_level: text })}
                    placeholder="10"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <Input
                label="Barcode"
                value={formData.barcode}
                onChangeText={(text) => setFormData({ ...formData, barcode: text })}
                placeholder="Enter barcode"
              />

              {/* ── Initial Stock (optional) ── */}
              <Text style={[styles.inputLabel, { marginTop: 16, color: Colors.primary }]}>
                Initial Stock (Optional)
              </Text>
              <Text style={[styles.inputLabel, { fontSize: 11, marginTop: -4, marginBottom: 8, color: Colors.textMuted }]}>
                Select a warehouse and enter the opening quantity to seed stock immediately.
              </Text>
              <Text style={styles.inputLabel}>Warehouse</Text>
              <View style={styles.warehousePicker}>
                {warehouses.map((wh) => (
                  <TouchableOpacity
                    key={wh.warehouse_id}
                    style={[
                      styles.warehouseOption,
                      formData.initial_warehouse_id === wh.warehouse_id && styles.warehouseOptionActive,
                    ]}
                    onPress={() =>
                      setFormData({ ...formData, initial_warehouse_id: wh.warehouse_id })
                    }
                  >
                    <Ionicons
                      name="home-outline"
                      size={18}
                      color={
                        formData.initial_warehouse_id === wh.warehouse_id
                          ? Colors.primary
                          : Colors.textMuted
                      }
                    />
                    <Text
                      style={[
                        styles.warehouseOptionText,
                        formData.initial_warehouse_id === wh.warehouse_id &&
                          styles.warehouseOptionTextActive,
                      ]}
                    >
                      {wh.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Input
                label="Opening Quantity"
                value={formData.initial_quantity}
                onChangeText={(text) => setFormData({ ...formData, initial_quantity: text })}
                placeholder="0"
                keyboardType="numeric"
              />

              <Button title="Create Product" onPress={handleAddProduct} style={{ marginTop: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Product Detail Modal */}
      <Modal visible={showDetailModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Product</Text>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.skuDisplay}>
                <Text style={styles.skuLabel}>SKU</Text>
                <Text style={styles.skuValue}>{formData.sku}</Text>
              </View>
              <Input
                label="Name *"
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
                placeholder="Enter product name"
              />
              <Input
                label="Description"
                value={formData.description}
                onChangeText={(text) => setFormData({ ...formData, description: text })}
                placeholder="Enter description"
                multiline
                numberOfLines={3}
              />
              <Text style={styles.inputLabel}>Category</Text>
              <View style={styles.categoryPicker}>
                {(['raw', 'finished', 'packaging'] as const).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryOption,
                      formData.category === cat && styles.categoryOptionActive,
                    ]}
                    onPress={() => setFormData({ ...formData, category: cat })}
                  >
                    <Text
                      style={[
                        styles.categoryOptionText,
                        formData.category === cat && styles.categoryOptionTextActive,
                      ]}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Input
                    label="Cost Price"
                    value={formData.cost_price}
                    onChangeText={(text) => setFormData({ ...formData, cost_price: text })}
                    placeholder="0.00"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfInput}>
                  <Input
                    label="Selling Price"
                    value={formData.selling_price}
                    onChangeText={(text) => setFormData({ ...formData, selling_price: text })}
                    placeholder="0.00"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Input
                    label="Unit"
                    value={formData.unit}
                    onChangeText={(text) => setFormData({ ...formData, unit: text })}
                    placeholder="pcs"
                  />
                </View>
                <View style={styles.halfInput}>
                  <Input
                    label="Reorder Level"
                    value={formData.reorder_level}
                    onChangeText={(text) => setFormData({ ...formData, reorder_level: text })}
                    placeholder="10"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <Input
                label="Barcode"
                value={formData.barcode}
                onChangeText={(text) => setFormData({ ...formData, barcode: text })}
                placeholder="Enter barcode"
              />
              <Button
                title="View Full Details"
                variant="outline"
                onPress={() => {
                  if (!selectedProduct) return;
                  setShowDetailModal(false);
                  router.push(`/product/${selectedProduct.product_id}`);
                }}
                style={{ marginTop: 16 }}
              />
              {canManageProducts && (
                <Button title="Update Product" onPress={handleUpdateProduct} style={{ marginTop: 12 }} />
              )}
              {canAdjustStock && (
                <Button
                  title="Adjust Stock"
                  variant="outline"
                  onPress={() => {
                    setShowDetailModal(false);
                    setShowAdjustModal(true);
                  }}
                  style={{ marginTop: 12 }}
                />
              )}
              {canManageProducts && (
                <Button
                  title="Delete Product"
                  variant="danger"
                  onPress={() => selectedProduct && handleDeleteProduct(selectedProduct)}
                  style={{ marginTop: 12 }}
                />
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Adjust Stock Modal */}
      <Modal visible={showAdjustModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Adjust Stock</Text>
              <TouchableOpacity onPress={() => setShowAdjustModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {selectedProduct && (
                <View style={styles.selectedProductInfo}>
                  <Text style={styles.selectedProductName}>{selectedProduct.name}</Text>
                  <Text style={styles.selectedProductSku}>SKU: {selectedProduct.sku}</Text>
                </View>
              )}
              <Text style={styles.inputLabel}>Warehouse *</Text>
              <View style={styles.warehousePicker}>
                {warehouses.map((wh) => (
                  <TouchableOpacity
                    key={wh.warehouse_id}
                    style={[
                      styles.warehouseOption,
                      adjustData.warehouse_id === wh.warehouse_id && styles.warehouseOptionActive,
                    ]}
                    onPress={() => setAdjustData({ ...adjustData, warehouse_id: wh.warehouse_id })}
                  >
                    <Ionicons
                      name="home-outline"
                      size={18}
                      color={
                        adjustData.warehouse_id === wh.warehouse_id
                          ? Colors.primary
                          : Colors.textMuted
                      }
                    />
                    <Text
                      style={[
                        styles.warehouseOptionText,
                        adjustData.warehouse_id === wh.warehouse_id && styles.warehouseOptionTextActive,
                      ]}
                    >
                      {wh.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.inputLabel}>Adjustment Type</Text>
              <View style={styles.adjustTypePicker}>
                {(['adjustment', 'return'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.adjustTypeOption,
                      adjustData.type === type && styles.adjustTypeOptionActive,
                    ]}
                    onPress={() => setAdjustData({ ...adjustData, type })}
                  >
                    <Text
                      style={[
                        styles.adjustTypeOptionText,
                        adjustData.type === type && styles.adjustTypeOptionTextActive,
                      ]}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Input
                label="Quantity * (use negative for decrease)"
                value={adjustData.quantity}
                onChangeText={(text) => setAdjustData({ ...adjustData, quantity: text })}
                placeholder="Enter quantity"
                keyboardType="numeric"
              />
              <Input
                label="Notes"
                value={adjustData.notes}
                onChangeText={(text) => setAdjustData({ ...adjustData, notes: text })}
                placeholder="Enter notes"
                multiline
                numberOfLines={3}
              />
              <Button title="Adjust Stock" onPress={handleAdjustStock} style={{ marginTop: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Barcode Scanner */}
      {isFeatureEnabled('enableBarcodeScan') && (
        <BarcodeScanner
          visible={showBarcodeScanner}
          onClose={() => setShowBarcodeScanner(false)}
          onProductFound={handleBarcodeProductFound}
        />
      )}
    </SafeAreaView>
    </ErrorBoundary>
  );
}

// ── Stock by Warehouse view ─────────────────────────────────────────────────
// Shows one card per product, expandable to reveal the per-warehouse
// breakdown. Each card displays a grand total across all warehouses and
// highlights low-stock products in danger color.
function StockByWarehouseView({
  data,
  expanded,
  onToggle,
  searchQuery,
}: {
  data: any[];
  expanded: Record<string, boolean>;
  onToggle: (productId: string) => void;
  searchQuery: string;
}) {
  const filtered = data.filter((p: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (p.product_name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );
  });

  // Grand totals
  const grandTotalValue = filtered.reduce(
    (sum, p) => sum + (Number(p.total_value) || 0),
    0
  );
  const grandTotalQty = filtered.reduce(
    (sum, p) => sum + (Number(p.total_quantity) || 0),
    0
  );
  const lowStockCount = filtered.filter((p) => p.is_low_stock).length;

  return (
    <View>
      {/* Grand totals card */}
      <Card style={styles.stockTotalsCard}>
        <Text style={styles.stockTotalsTitle}>Grand Total (across all warehouses)</Text>
        <View style={styles.stockTotalsRow}>
          <View style={styles.stockTotalsItem}>
            <Text style={styles.stockTotalsValue}>
              {grandTotalQty.toLocaleString()}
            </Text>
            <Text style={styles.stockTotalsLabel}>Units</Text>
          </View>
          <View style={styles.stockTotalsItem}>
            <Text style={[styles.stockTotalsValue, { color: Colors.success }]}>
              {formatNaira(grandTotalValue)}
            </Text>
            <Text style={styles.stockTotalsLabel}>Value</Text>
          </View>
          <View style={styles.stockTotalsItem}>
            <Text
              style={[
                styles.stockTotalsValue,
                { color: lowStockCount > 0 ? Colors.danger : Colors.text },
              ]}
            >
              {lowStockCount}
            </Text>
            <Text style={styles.stockTotalsLabel}>Low stock</Text>
          </View>
        </View>
      </Card>

      {filtered.map((p: any) => {
        const isOpen = !!expanded[p.product_id];
        const qtyColor = p.is_low_stock ? Colors.danger : Colors.success;
        return (
          <Card key={p.product_id} style={styles.stockCard}>
            <TouchableOpacity
              onPress={() => onToggle(p.product_id)}
              activeOpacity={0.7}
              style={styles.stockHeader}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.stockProductName}>{p.product_name}</Text>
                <Text style={styles.stockSku}>SKU: {p.sku}</Text>
              </View>
              <View style={styles.stockQuantity}>
                <Text style={[styles.stockQuantityValue, { color: qtyColor }]}>
                  {p.total_quantity}
                </Text>
                <Text style={styles.stockQuantityLabel}>total units</Text>
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={Colors.textMuted}
                  style={{ marginTop: 4 }}
                />
              </View>
            </TouchableOpacity>

            <View style={styles.stockFooter}>
              <Text style={styles.stockValue}>
                Total value: {formatNaira(p.total_value || 0)}
              </Text>
              {p.is_low_stock && (
                <Badge text="Low stock" variant="danger" />
              )}
            </View>

            {isOpen && (
              <View style={styles.warehouseBreakdown}>
                <Text style={styles.warehouseBreakdownTitle}>By warehouse</Text>
                {p.by_warehouse && p.by_warehouse.length > 0 ? (
                  p.by_warehouse.map((w: any) => (
                    <View key={w.warehouse_id} style={styles.warehouseRow}>
                      <View style={styles.warehouseRowLeft}>
                        <Ionicons
                          name="home-outline"
                          size={14}
                          color={Colors.textMuted}
                        />
                        <Text style={styles.warehouseName}>
                          {w.warehouse_name}
                        </Text>
                      </View>
                      <View style={styles.warehouseRowRight}>
                        <Text
                          style={[
                            styles.warehouseQty,
                            { color: w.quantity === 0 ? Colors.textMuted : Colors.text },
                          ]}
                        >
                          {w.quantity} {p.unit}
                        </Text>
                        <Text style={styles.warehouseValue}>
                          {formatNaira(w.value || 0)}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.warehouseEmpty}>No warehouses configured</Text>
                )}
              </View>
            )}
          </Card>
        );
      })}
    </View>
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
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  scanButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.cardAlt,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.card,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  activeTab: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  activeTabText: {
    color: Colors.text,
  },
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    color: Colors.text,
    fontSize: 16,
  },
  filterContainer: {
    marginBottom: 16,
  },
  filterContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: Colors.text,
  },
  content: {
    paddingHorizontal: 20,
  },
  productCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
  },
  productName: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 4,
  },
  productSku: {
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: 12,
  },
  productFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  priceLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  priceValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  stockCard: {
    marginBottom: 12,
  },
  stockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  stockProductName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  stockSku: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  stockQuantity: {
    alignItems: 'flex-end',
  },
  stockQuantityValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  stockQuantityLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  stockFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  stockWarehouse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stockWarehouseName: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  stockValue: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  inputLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  categoryPicker: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  categoryOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.cardAlt,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryOptionText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  categoryOptionTextActive: {
    color: Colors.text,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  skuDisplay: {
    backgroundColor: Colors.cardAlt,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  skuLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  skuValue: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  selectedProductInfo: {
    backgroundColor: Colors.cardAlt,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  selectedProductName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  selectedProductSku: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 4,
  },
  warehousePicker: {
    gap: 8,
    marginBottom: 16,
  },
  warehouseOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 10,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  warehouseOptionActive: {
    backgroundColor: `${Colors.primary}20`,
    borderColor: Colors.primary,
  },
  warehouseOptionText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  warehouseOptionTextActive: {
    color: Colors.primary,
    fontWeight: '500',
  },
  adjustTypePicker: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  adjustTypeOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.cardAlt,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  adjustTypeOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  adjustTypeOptionText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  adjustTypeOptionTextActive: {
    color: Colors.text,
  },
  // Stock by warehouse view
  stockTotalsCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  stockTotalsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stockTotalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  stockTotalsItem: {
    alignItems: 'center',
    flex: 1,
  },
  stockTotalsValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  stockTotalsLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
  warehouseBreakdown: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  warehouseBreakdownTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  warehouseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  warehouseRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  warehouseRowRight: {
    alignItems: 'flex-end',
  },
  warehouseName: {
    color: Colors.text,
    fontSize: 14,
  },
  warehouseQty: {
    fontSize: 14,
    fontWeight: '600',
  },
  warehouseValue: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  warehouseEmpty: {
    color: Colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
});
