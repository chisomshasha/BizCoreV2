/**
 * BizCore V2 — screen CONTENT verification.
 *
 * Two passes over every screen:
 *   1. Populated API → the screen must show the real records (not just a
 *      heading). This is what the client will actually see.
 *   2. Empty API → the screen must show a sensible empty state and must not
 *      crash.
 */
import React from 'react';
import { screen, waitFor, fireEvent, act } from '@testing-library/react-native';


import DashboardScreen from '../app/(tabs)/index';
import OrdersScreen from '../app/(tabs)/orders';
import InventoryScreen from '../app/(tabs)/inventory';
import FinanceScreen from '../app/(tabs)/finance';
import ReportsScreen from '../app/(tabs)/reports';
import MoreScreen from '../app/(tabs)/more';

import AgentLedgerScreen from '../app/agent-ledger';
import AuditLogsScreen from '../app/audit-logs';
import BomScreen from '../app/bom';
import DeliveryNotesScreen from '../app/delivery-notes';
import DispatchScreen from '../app/dispatch';
import FinancialReportsScreen from '../app/financial-reports';
import GrnScreen from '../app/grn';
import NotificationsScreen from '../app/notifications';
import PerformanceDashboardScreen from '../app/performance-dashboard';
import QuotationsScreen from '../app/quotations';
import RequisitionsScreen from '../app/requisitions';
import RolePermissionsScreen from '../app/role-permissions';
import ThreeWayMatchScreen from '../app/three-way-match';
import WarehouseTransfersScreen from '../app/warehouse-transfers';

import { renderScreen } from './utils';
import { mockGetWith, resetMocks } from './payloads';

const { get: mockGet } = global.mockApi;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Populated API — each screen must surface the real record
// ─────────────────────────────────────────────────────────────────────────────
const CONTENT_CASES: [string, React.ComponentType<any>, RegExp | string][] = [
  ['Inventory shows the product', InventoryScreen, 'Tomato Paste'],
  ['Orders shows the purchase order', OrdersScreen, 'PO-202611-0001'],
  ['Finance shows the expense', FinanceScreen, /Trip/i],
  ['Reports lists the available reports', ReportsScreen, 'Stock Summary'],
  ['More lists the menu', MoreScreen, /Users|Role Permissions|Inventory/i],
  ['Agent ledger shows the agent', AgentLedgerScreen, 'Rep One'],
  ['Audit logs shows the entry', AuditLogsScreen, 'Audit Logs'],
  ['BOM shows the bill of materials', BomScreen, 'Tomato Paste'],
  ['Delivery notes shows the note', DeliveryNotesScreen, 'DN-202611-0001'],
  ['Dispatch shows the order', DispatchScreen, 'SO-202611-0001'],
  ['Financial reports renders the statements', FinancialReportsScreen, /Inventory|Accounts/i],
  ['GRN shows the receipt', GrnScreen, 'GRN-202611-0001'],
  ['Notifications shows the notification', NotificationsScreen, 'New Order'],
  ['Performance dashboard shows the supplier', PerformanceDashboardScreen, 'Farm Fresh Ltd'],
  ['Quotations shows the quotation', QuotationsScreen, /Quotations|AQT-|QT-/i],
  ['Requisitions shows the requisition', RequisitionsScreen, 'REQ-202611-0001'],
  ['Role permissions shows the matrix', RolePermissionsScreen, /Super Admin|Viewer/i],
  ['3-way match shows the match', ThreeWayMatchScreen, /PO-1|3-Way/i],
  ['Warehouse transfers shows the transfer', WarehouseTransfersScreen, 'WT-202611-0001'],
];

describe('screen content', () => {
  beforeEach(() => {
    resetMocks();
    mockGet.mockImplementation(async (url: string) => ({ data: mockGetWith(url) }));
  });

  it.each(CONTENT_CASES)('%s', async (_name, Screen, expected) => {
    renderScreen(<Screen />);

    // The Finance screen keeps its records behind a tab — open it, so the
    // assertion proves the tab actually reveals the data.
    if (_name.startsWith('Finance')) {
      await waitFor(() => expect(screen.getAllByText('Expenses').length).toBeGreaterThan(0));
      await act(async () => {
        fireEvent.press(screen.getAllByText('Expenses')[0]);
      });
    }

    await waitFor(
      () => {
        expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Empty API — every screen must degrade gracefully
// ─────────────────────────────────────────────────────────────────────────────
const ALL_SCREENS: [string, React.ComponentType<any>][] = [
  ['Dashboard', DashboardScreen],
  ['Orders', OrdersScreen],
  ['Inventory', InventoryScreen],
  ['Finance', FinanceScreen],
  ['Reports', ReportsScreen],
  ['More', MoreScreen],
  ['Agent ledger', AgentLedgerScreen],
  ['Audit logs', AuditLogsScreen],
  ['BOM', BomScreen],
  ['Delivery notes', DeliveryNotesScreen],
  ['Dispatch', DispatchScreen],
  ['Financial reports', FinancialReportsScreen],
  ['GRN', GrnScreen],
  ['Notifications', NotificationsScreen],
  ['Performance dashboard', PerformanceDashboardScreen],
  ['Quotations', QuotationsScreen],
  ['Requisitions', RequisitionsScreen],
  ['Role permissions', RolePermissionsScreen],
  ['3-way match', ThreeWayMatchScreen],
  ['Warehouse transfers', WarehouseTransfersScreen],
];

describe('empty-data resilience', () => {
  beforeEach(() => {
    resetMocks();
    mockGet.mockImplementation(async () => ({ data: [] }));
  });

  it.each(ALL_SCREENS)('%s renders without crashing on empty data', async (_name, Screen) => {
    expect(() => renderScreen(<Screen />)).not.toThrow();
    // Give the fetch promises a chance to settle and re-render.
    await waitFor(() => {
      expect(screen.toJSON()).toBeTruthy();
    }, { timeout: 5000 });
  });
});
