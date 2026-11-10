import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Render a screen inside the providers the app supplies at runtime. */
export function renderScreen(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics ?? metrics}>
      {ui}
    </SafeAreaProvider>,
  );
}
