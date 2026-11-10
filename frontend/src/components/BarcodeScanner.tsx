import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  Vibration,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Button } from './ThemedComponents';
import api from '../utils/api';

interface BarcodeScannerProps {
  visible: boolean;
  onClose: () => void;
  onProductFound: (product: any, stock: number) => void;
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  visible,
  onClose,
  onProductFound,
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setScanned(false);
    }
  }, [visible]);

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    if (scanned || loading) return;
    
    setScanned(true);
    setLoading(true);
    
    // Vibrate on scan
    if (Platform.OS !== 'web') {
      Vibration.vibrate(100);
    }

    try {
      const response = await api.get(`/barcode/${data}`);
      const { product, total_stock } = response.data;
      
      onProductFound(product, total_stock);
      onClose();
    } catch (error: any) {
      if (error.response?.status === 404) {
        Alert.alert(
          'Product Not Found',
          `No product found with barcode: ${data}`,
          [
            { text: 'Scan Again', onPress: () => setScanned(false) },
            { text: 'Close', onPress: onClose },
          ]
        );
      } else {
        Alert.alert('Error', 'Failed to look up barcode');
        setScanned(false);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!permission) {
    return null;
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.permissionContainer}>
            <Ionicons name="camera-outline" size={64} color={Colors.primary} />
            <Text style={styles.permissionTitle}>Camera Permission Required</Text>
            <Text style={styles.permissionText}>
              We need camera access to scan barcodes and look up products.
            </Text>
            <Button title="Grant Permission" onPress={requestPermission} style={{ marginTop: 20 }} />
            <Button title="Cancel" variant="outline" onPress={onClose} style={{ marginTop: 12 }} />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{
            barcodeTypes: [
              'qr',
              'ean13',
              'ean8',
              'upc_a',
              'upc_e',
              'code39',
              'code128',
              'codabar',
              'itf14',
            ],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={28} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Scan Barcode</Text>
            <View style={{ width: 44 }} />
          </View>

          {/* Scan Frame */}
          <View style={styles.scanFrameContainer}>
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            <Text style={styles.scanText}>
              {loading ? 'Looking up product...' : 'Position barcode within the frame'}
            </Text>
          </View>

          {/* Bottom Controls */}
          <View style={styles.bottomControls}>
            {scanned && !loading && (
              <Button
                title="Scan Again"
                onPress={() => setScanned(false)}
                icon="refresh"
              />
            )}
          </View>
        </CameraView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  camera: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionContainer: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 30,
    margin: 20,
    alignItems: 'center',
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 16,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  scanFrameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 280,
    height: 180,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: Colors.primary,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  scanText: {
    color: Colors.text,
    fontSize: 14,
    marginTop: 24,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  bottomControls: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});
