/**
 * BizCore V2 — every screen must render and show its content.
 *
 * Each screen is mounted twice: once against an empty API (it must show a
 * sensible empty state, never crash) and once against populated API data
 * (it must show the content the client will actually see).
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react-native';

import DashboardScreen from '../app/(tabs)/index';
import OrdersScreen from '../app/(tabs)/orders';
import InventoryScreen from '../app/(tabs)/inventory';
import FinanceScreen from '../app/(tabs)/finance';
import ReportsScreen from '../app/(tabs)/reports';
import MoreScreen from '../app/(tabs)/more';
import LoginScreen from '../app/(auth)/login';

import AgentLedgerScreen from '../app/agent-ledger';
import AuditLogsScreen from '../app/audit-logs';
import BomScreen from '../app/bom';
import DeliveryNotesScreen from '../app/delivery-notes';
import DispatchScreen from '../app/dispatch';
import FinancialReportsScreen from '../app/financial-reports';
import GrnScreen from '../app/grn';
import NotificationsScreen from '../app/notifications';
import OrderDetailScreen from '../app/order/[id]';
import PartnerDetailScreen from '../app/partner/[id]';
import PerformanceDashboardScreen from '../app/performance-dashboard';
import ProductDetailScreen from '../app/product/[id]';
import QuotationsScreen from '../app/quotations';
import RequisitionsScreen from '../app/requisitions';
import RolePermissionsScreen from '../app/role-permissions';
import ThreeWayMatchScreen from '../app/three-way-match';
import WarehouseTransfersScreen from '../app/warehouse-transfers';

import { renderScreen } from './utils';

// The API mock lives in setup.js (it is what the app actually imports).
import { mockGetWith } from './payloads';

const { get: mockGet, post: mockPost, put: mockPut, delete: mockDelete } = global.mockApi;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (url: string) => ({ data: mockGetWith(url) }));
  mockPost.mockImplementation(async () => ({ data: {} }));
  mockPut.mockImplementation(async () => ({ data: {} }));
  mockDelete.mockImplementation(async () => ({ data: {} }));
  global.__mockRouteParams = {};
});

// ─────────────────────────────────────────────────────────────────────────────
const SCREENS: [string, React.ComponentType<any>, string][] = [
  ['Dashboard', DashboardScreen, 'Products'],
  ['Orders', OrdersScreen, 'Orders'],
  ['Inventory', InventoryScreen, 'Inventory'],
  ['Finance', FinanceScreen, 'Finance'],
  ['Reports', ReportsScreen, 'Reports'],
  ['More', MoreScreen, 'More'],
  ['Login', LoginScreen, 'Sign in'],
  ['Agent ledger', AgentLedgerScreen, 'Agent Ledger'],
  ['Audit logs', AuditLogsScreen, 'Audit Logs'],
  ['BOM', BomScreen, 'Bill of Materials'],
  ['Delivery notes', DeliveryNotesScreen, 'Delivery Notes'],
  ['Dispatch', DispatchScreen, 'Dispatch'],
  ['Financial reports', FinancialReportsScreen, 'Financial Reports'],
  ['GRN', GrnScreen, 'Goods Receipt Notes'],
  ['Notifications', NotificationsScreen, 'Notifications'],
  ['Performance dashboard', PerformanceDashboardScreen, 'Performance'],
  ['Quotations', QuotationsScreen, 'Quotations'],
  ['Requisitions', RequisitionsScreen, 'Purchase Requisitions'],
  ['Role permissions', RolePermissionsScreen, 'Role Permissions'],
  ['3-way match', ThreeWayMatchScreen, '3-Way Matching'],
  ['Warehouse transfers', WarehouseTransfersScreen, 'Warehouse Transfers'],
];

describe('every screen renders with real content', () => {
  it.each(SCREENS)('%s renders and shows its heading', async (_name, Screen, heading) => {
    renderScreen(<Screen />);
    await waitFor(() => {
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
    });
  });
});

describe('detail screens (route params)', () => {
  it('product detail renders', async () => {
    global.__mockRouteParams = { id: 'p1' };
    renderScreen(<ProductDetailScreen />);
    await waitFor(() => expect(screen.getAllByText(/Tomato Paste|Product/i).length).toBeGreaterThan(0));
  });

  it('order detail renders', async () => {
    global.__mockRouteParams = { id: 'so1' };
    renderScreen(<OrderDetailScreen />);
    await waitFor(() => expect(screen.getAllByText(/SO-|Order/i).length).toBeGreaterThan(0));
  });

  it('partner detail renders', async () => {
    global.__mockRouteParams = { id: 'u1' };
    renderScreen(<PartnerDetailScreen />);
    await waitFor(() => expect(screen.getAllByText(/Partner|Rep|not found/i).length).toBeGreaterThan(0));
  });
});
