import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Button } from './ThemedComponents';

interface Props {
  children: React.ReactNode;
  /** Optional fallback component. Defaults to the built-in one below. */
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches uncaught render errors in any wrapped screen and shows a clean
 * recovery UI instead of letting the whole app crash.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <MoreScreen />
 *   </ErrorBoundary>
 *
 * Wrap individual tab screens so a bug in one screen doesn't kill the
 * whole tab navigator.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info?.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <View style={styles.container}>
          <View style={styles.iconWrap}>
            <Ionicons name="alert-circle" size={48} color={Colors.danger} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            The screen hit an unexpected error and was paused to keep the rest of the app stable.
          </Text>
          {this.state.error?.message ? (
            <ScrollView style={styles.errorBox} contentContainerStyle={{ padding: 12 }}>
              <Text style={styles.errorText} selectable>
                {this.state.error.message}
              </Text>
            </ScrollView>
          ) : null}
          <Button title="Try again" onPress={this.reset} style={{ marginTop: 8 }} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
    paddingTop: 80,
    alignItems: 'center',
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: `${Colors.danger}15`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  errorBox: {
    alignSelf: 'stretch',
    maxHeight: 160,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  errorText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: Colors.textMuted,
  },
});
