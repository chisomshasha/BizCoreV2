import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Dark Theme Colors
export const Colors = {
  background: '#0A0A0F',
  card: '#14141F',
  cardAlt: '#1C1C2E',
  border: '#2A2A3E',
  primary: '#6366F1',
  primaryLight: '#818CF8',
  secondary: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  success: '#22C55E',
};

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}

export const Card: React.FC<CardProps> = ({ children, style, onPress }) => {
  if (onPress) {
    return (
      <TouchableOpacity style={[styles.card, style]} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
};

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'small' | 'medium' | 'large';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  icon,
  disabled = false,
  loading = false,
  style,
}) => {
  const getVariantStyle = () => {
    switch (variant) {
      case 'secondary':
        return { backgroundColor: Colors.secondary };
      case 'outline':
        return { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.primary };
      case 'danger':
        return { backgroundColor: Colors.danger };
      default:
        return { backgroundColor: Colors.primary };
    }
  };

  const getSizeStyle = () => {
    switch (size) {
      case 'small':
        return { paddingVertical: 8, paddingHorizontal: 12 };
      case 'large':
        return { paddingVertical: 16, paddingHorizontal: 24 };
      default:
        return { paddingVertical: 12, paddingHorizontal: 16 };
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        getVariantStyle(),
        getSizeStyle(),
        disabled && styles.buttonDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={Colors.text} size="small" />
      ) : (
        <View style={styles.buttonContent}>
          {icon && <Ionicons name={icon} size={18} color={variant === 'outline' ? Colors.primary : Colors.text} style={{ marginRight: 8 }} />}
          <Text style={[styles.buttonText, variant === 'outline' && { color: Colors.primary }]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

interface InputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  multiline?: boolean;
  numberOfLines?: number;
  error?: string;
  style?: TextStyle;
}

export const Input: React.FC<InputProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType = 'default',
  multiline,
  numberOfLines,
  error,
  style,
}) => {
  return (
    <View style={[styles.inputContainer, style]}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <TextInput
        style={StyleSheet.flatten([
          styles.input,
          multiline ? { height: (numberOfLines || 3) * 24, textAlignVertical: 'top' as const } : null,
          error ? styles.inputError : null,
        ])}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={numberOfLines}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

interface StatCardProps {
  title: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon,
  color = Colors.primary,
  trend,
  trendValue,
}) => {
  return (
    <Card style={styles.statCard}>
      <View style={[styles.statIconContainer, { backgroundColor: `${color}20` }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
      {trend && trendValue && (
        <View style={styles.trendContainer}>
          <Ionicons
            name={trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'remove'}
            size={14}
            color={trend === 'up' ? Colors.success : trend === 'down' ? Colors.danger : Colors.textMuted}
          />
          <Text
            style={[
              styles.trendText,
              { color: trend === 'up' ? Colors.success : trend === 'down' ? Colors.danger : Colors.textMuted },
            ]}
          >
            {trendValue}
          </Text>
        </View>
      )}
    </Card>
  );
};

interface BadgeProps {
  text: string;
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
}

export const Badge: React.FC<BadgeProps> = ({ text, variant = 'default' }) => {
  const getVariantColors = () => {
    switch (variant) {
      case 'success':
        return { bg: `${Colors.success}20`, text: Colors.success };
      case 'warning':
        return { bg: `${Colors.warning}20`, text: Colors.warning };
      case 'danger':
        return { bg: `${Colors.danger}20`, text: Colors.danger };
      case 'info':
        return { bg: `${Colors.primary}20`, text: Colors.primary };
      case 'secondary':
        return { bg: `${Colors.secondary}20`, text: Colors.secondary };
      case 'primary':
        return { bg: `${Colors.primary}20`, text: Colors.primary };
      default:
        return { bg: Colors.cardAlt, text: Colors.textSecondary };
    }
  };

  const colors = getVariantColors();

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>{text}</Text>
    </View>
  );
};

interface ListItemProps {
  title: string;
  subtitle?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export const ListItem: React.FC<ListItemProps> = ({
  title,
  subtitle,
  leftIcon,
  rightIcon = 'chevron-forward',
  onPress,
  badge,
  badgeVariant,
}) => {
  return (
    <TouchableOpacity
      style={styles.listItem}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
    >
      {leftIcon && (
        <View style={styles.listItemIcon}>
          <Ionicons name={leftIcon} size={22} color={Colors.primary} />
        </View>
      )}
      <View style={styles.listItemContent}>
        <Text style={styles.listItemTitle}>{title}</Text>
        {subtitle && <Text style={styles.listItemSubtitle}>{subtitle}</Text>}
      </View>
      {badge && <Badge text={badge} variant={badgeVariant} />}
      {onPress && <Ionicons name={rightIcon} size={20} color={Colors.textMuted} />}
    </TouchableOpacity>
  );
};

export const LoadingScreen: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color={Colors.primary} />
  </View>
);

export const EmptyState: React.FC<{
  message: string;
  title?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}> = ({ message, title, icon = 'folder-open-outline' }) => (
  <View style={styles.emptyState}>
    <Ionicons name={icon} size={64} color={Colors.textMuted} />
    {title && <Text style={styles.emptyStateTitle}>{title}</Text>}
    <Text style={styles.emptyStateText}>{message}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  button: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.cardAlt,
    borderRadius: 12,
    padding: 14,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputError: {
    borderColor: Colors.danger,
  },
  errorText: {
    color: Colors.danger,
    fontSize: 12,
    marginTop: 4,
  },
  statCard: {
    alignItems: 'center',
    minWidth: 140,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statValue: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  statTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  trendText: {
    fontSize: 12,
    marginLeft: 4,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  listItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: `${Colors.primary}20`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  listItemSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    color: Colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
  },
  emptyStateTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
  },
});
