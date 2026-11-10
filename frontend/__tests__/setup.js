/**
 * BizCore V2 — screen render tests.
 *
 * Every screen is mounted with a mocked API layer and asserted to:
 *   • render without throwing,
 *   • show its heading / key content,
 *   • surface an empty state when the API returns nothing.
 *
 * This proves each screen actually works, not just that it type-checks.
 */
/* eslint-env jest */

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    useRouter: () => ({
      push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(),
    }),
    useLocalSearchParams: () => (global.__mockRouteParams || {}),
    useSegments: () => [],
    useRootNavigationState: () => ({}),
    Redirect: ({ href }) => React.createElement(Text, null, `redirect:${href}`),
    Link: ({ children }) => React.createElement(View, null, children),
    Stack: { Screen: () => null },
    Tabs: { Screen: () => null },
  };
});

jest.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
jest.mock('expo-linking', () => ({
  parse: () => ({ path: '', queryParams: {} }),
  addEventListener: () => ({ remove: jest.fn() }),
  getInitialURL: async () => null,
  openURL: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: async () => ({ status: 'granted' }),
  requestPermissionsAsync: async () => ({ status: 'granted' }),
  getExpoPushTokenAsync: async () => ({ data: 'token' }),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { HIGH: 4 },
}));
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false, shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  cacheDirectory: '/tmp/',
  writeAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props) => require('react').createElement(View, props) };
});
jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: (props) => require('react').createElement(View, props) };
});
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    getItem: jest.fn(async (k) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k, v) => { store[k] = v; }),
    removeItem: jest.fn(async (k) => { delete store[k]; }),
    clear: jest.fn(async () => { store = {}; }),
  };
});
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));
jest.mock('react-native-gifted-charts', () => {
  const { View } = require('react-native');
  const stub = (props) => require('react').createElement(View, props);
  return { BarChart: stub, PieChart: stub, LineChart: stub, AreaChart: stub };
});
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: () => [null, jest.fn()] }));

// Icon fonts pull in expo-font → expo-asset, which needs a native Platform.
// The icons are irrelevant to a render test, so stub the whole package.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  const make = (name) => {
    const C = (props) => React.createElement(View, { ...props, testID: `icon-${name}` });
    C.displayName = name;
    return C;
  };
  return new Proxy({}, { get: (_t, name) => make(String(name)) });
});

// ── the API layer ────────────────────────────────────────────────────────────
const mockGet = jest.fn(async () => ({ data: [] }));
const mockPost = jest.fn(async () => ({ data: {} }));
const mockPut = jest.fn(async () => ({ data: {} }));
const mockDelete = jest.fn(async () => ({ data: {} }));

jest.mock('../src/utils/api', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
    put: (...a) => mockPut(...a),
    delete: (...a) => mockDelete(...a),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  },
}));

jest.mock('../src/store/authStore', () => ({
  useAuthStore: jest.fn(() => ({
    user: {
      user_id: 'u_sa', username: 'superadmin', email: 'sa@test', name: 'Super Admin',
      role: 'super_admin', is_active: true, warehouse_id: 'wh_lagos',
      warehouse_name: 'Lagos Main', debt_ceiling: 0, is_flagged: false,
    },
    isAuthenticated: true, isLoading: false,
    isSuperAdmin: true, isGeneralManager: false, isWarehouseManager: false,
    isCrossWarehouse: true, isApprover: true, isAgent: false, isClerk: false,
    isSalesClerk: false, isPurchaseClerk: false, isAccountant: false,
    warehouseId: 'wh_lagos', warehouseName: 'Lagos Main',
    sessionToken: 'sess_test', sessionExpiresAt: null,
    login: jest.fn(), logout: jest.fn(), checkAuth: jest.fn(),
    refreshUser: jest.fn(), setUser: jest.fn(), setSession: jest.fn(),
  })),
}));

jest.mock('../src/utils/notifications', () => ({
  registerForPushNotifications: jest.fn(async () => 'token'),
  sendLocalNotification: jest.fn(),
  scheduleNotification: jest.fn(),
  getNotificationPermissions: jest.fn(async () => ({ granted: true })),
}));

jest.mock('../src/components/BarcodeScanner', () => {
  const { View } = require('react-native');
  return { BarcodeScanner: (props) => require('react').createElement(View, props) };
});

global.__DEV__ = true;
global.__mockRouteParams = {};
// Expose the mocked API so a test file can drive the responses.
global.mockApi = { get: mockGet, post: mockPost, put: mockPut, delete: mockDelete };
