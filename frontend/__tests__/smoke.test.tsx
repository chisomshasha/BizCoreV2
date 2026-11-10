import React from 'react';
import { screen } from '@testing-library/react-native';
import InventoryScreen from '../app/(tabs)/inventory';
import { renderScreen } from './utils';

describe('smoke', () => {
  it('renders the inventory screen', async () => {
    renderScreen(<InventoryScreen />);
    expect(await screen.findByText('Inventory')).toBeTruthy();
  });
});
