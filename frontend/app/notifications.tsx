import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Colors,
  Card,
  Button,
  Badge,
  LoadingScreen,
  EmptyState,
} from '../src/components/ThemedComponents';
import { useAppStore } from '../src/store/appStore';
import { formatDistanceToNow } from 'date-fns';
import clientConfig from '../src/config/clientConfig';

interface Notification {
  notification_id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications, fetchNotifications, markNotificationRead } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      await fetchNotifications();
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleNotificationPress = async (notification: Notification) => {
    if (!notification.is_read) {
      try {
        await markNotificationRead(notification.notification_id);
      } catch (error) {
        console.error('Error marking notification read:', error);
      }
    }

    // Navigate based on notification type
    switch (notification.type) {
      case 'low_stock':
        router.push('/(tabs)/inventory');
        break;
      case 'order':
        router.push('/(tabs)/orders');
        break;
      case 'payment':
        router.push('/(tabs)/finance');
        break;
      default:
        break;
    }
  };

  const getNotificationIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'low_stock':
        return 'warning';
      case 'order':
        return 'cart';
      case 'payment':
        return 'cash';
      case 'delivery':
        return 'car-outline';
      default:
        return 'notifications';
    }
  };

  const getNotificationColor = (type: string): string => {
    switch (type) {
      case 'low_stock':
        return Colors.danger;
      case 'order':
        return Colors.success;
      case 'payment':
        return Colors.warning;
      case 'delivery':
        return Colors.info;
      default:
        return Colors.primary;
    }
  };

  const unreadCount = notifications.filter((n: Notification) => !n.is_read).length;

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={styles.title}>Notifications</Text>
          {unreadCount > 0 && (
            <Badge text={`${unreadCount} new`} variant="primary" />
          )}
        </View>
        <View style={{ width: 44 }} />
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
        contentContainerStyle={styles.content}
      >
        {notifications.length === 0 ? (
          <EmptyState
            icon="notifications-off-outline"
            title="No Notifications"
            message="You're all caught up! Check back later for updates."
          />
        ) : (
          notifications.map((notification: Notification) => (
            <TouchableOpacity
              key={notification.notification_id}
              style={[
                styles.notificationCard,
                !notification.is_read && styles.unreadCard,
              ]}
              onPress={() => handleNotificationPress(notification)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: `${getNotificationColor(notification.type)}20` },
                ]}
              >
                <Ionicons
                  name={getNotificationIcon(notification.type)}
                  size={24}
                  color={getNotificationColor(notification.type)}
                />
              </View>
              <View style={styles.notificationContent}>
                <View style={styles.notificationHeader}>
                  <Text
                    style={[
                      styles.notificationTitle,
                      !notification.is_read && styles.unreadTitle,
                    ]}
                    numberOfLines={1}
                  >
                    {notification.title}
                  </Text>
                  {!notification.is_read && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.notificationMessage} numberOfLines={2}>
                  {notification.message}
                </Text>
                <Text style={styles.notificationTime}>
                  {formatDistanceToNow(new Date(notification.created_at), {
                    addSuffix: true,
                  })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          ))
        )}

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
  headerTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  content: {
    padding: 16,
  },
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  unreadCard: {
    borderColor: Colors.primary,
    backgroundColor: `${Colors.primary}08`,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  notificationContent: {
    flex: 1,
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
    flex: 1,
  },
  unreadTitle: {
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  notificationMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  notificationTime: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 6,
  },
});
