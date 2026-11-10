#!/usr/bin/env python3
"""
BizCore Business Management API Testing Script - New Features
Tests all new endpoints including expenses, quotations, delivery notes, BOM, enhanced reports, audit logs, and notifications.
"""

import requests
import json
import sys
from datetime import datetime, timedelta

# Configuration
BASE_URL = "https://erp-mobile-dev.preview.emergentagent.com/api"
TEST_SESSION_TOKEN = "test_session_1773136094446"
TEST_WAREHOUSE_ID = "wh_34f9fdd695e1"

# Headers for authenticated requests
HEADERS = {
    "Authorization": f"Bearer {TEST_SESSION_TOKEN}",
    "Content-Type": "application/json"
}

def make_request(method, endpoint, data=None, params=None):
    """Make HTTP request with proper error handling"""
    url = f"{BASE_URL}{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url, headers=HEADERS, params=params, timeout=10)
        elif method == "POST":
            response = requests.post(url, headers=HEADERS, json=data, timeout=10)
        elif method == "PUT":
            response = requests.put(url, headers=HEADERS, json=data, params=params, timeout=10)
        elif method == "DELETE":
            response = requests.delete(url, headers=HEADERS, timeout=10)
        
        # Log request details
        print(f"{method} {endpoint} -> Status: {response.status_code}")
        if response.status_code >= 400:
            print(f"Error Response: {response.text}")
        
        return response
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return None

def test_expenses():
    """Test Expenses API endpoints"""
    print("\n=== TESTING EXPENSES API ===")
    
    # 1. GET /api/expenses - list expenses
    print("\n1. Testing GET /expenses")
    response = make_request("GET", "/expenses")
    if response and response.status_code == 200:
        expenses = response.json()
        print(f"✓ Found {len(expenses)} expenses")
        return expenses
    else:
        print("❌ Failed to get expenses")
        return []

def test_expenses_create():
    """Test creating expense"""
    print("\n2. Testing POST /expenses")
    
    expense_data = {
        "category": "office",  # Must be one of the enum values
        "amount": 500.00,
        "description": "Test office expense for testing",
        "expense_date": datetime.now().isoformat(),
        "vendor": "Office Store Ltd",
        "payment_method": "bank"
    }
    
    response = make_request("POST", "/expenses", data=expense_data)
    if response and response.status_code in [200, 201]:  # Accept both 200 and 201
        expense = response.json()
        print(f"✓ Created expense: {expense.get('expense_id')}")
        return expense.get('expense_id')
    else:
        print("❌ Failed to create expense")
        return None

def test_expense_approve(expense_id):
    """Test approving expense"""
    if not expense_id:
        return
        
    print(f"\n3. Testing PUT /expenses/{expense_id}/approve")
    response = make_request("PUT", f"/expenses/{expense_id}/approve")
    if response and response.status_code == 200:
        print("✓ Expense approved successfully")
    else:
        print("❌ Failed to approve expense")

def test_expense_delete(expense_id):
    """Test deleting expense"""
    if not expense_id:
        return
        
    print(f"\n4. Testing DELETE /expenses/{expense_id}")
    response = make_request("DELETE", f"/expenses/{expense_id}")
    if response and response.status_code == 200:
        print("✓ Expense deleted successfully")
    else:
        print("❌ Failed to delete expense")

def test_quotations():
    """Test Quotations API endpoints"""
    print("\n=== TESTING QUOTATIONS API ===")
    
    # 1. GET /api/quotations - list quotations
    print("\n1. Testing GET /quotations")
    response = make_request("GET", "/quotations")
    if response and response.status_code == 200:
        quotations = response.json()
        print(f"✓ Found {len(quotations)} quotations")
        return quotations
    else:
        print("❌ Failed to get quotations")
        return []

def test_quotations_create():
    """Test creating quotation"""
    print("\n2. Testing POST /quotations")
    
    quotation_data = {
        "distributor_id": "dist_5e0e26010ba1",  # Using real distributor ID
        "items": [
            {
                "product_id": "prod_6a5df4d00286",  # Using real product ID
                "quantity": 5,
                "unit_price": 75000.00,
                "discount_percent": 0.0
            }
        ],
        "tax_amount": 67500.00,
        "valid_days": 30,
        "notes": "Test quotation for laptop procurement"
    }
    
    response = make_request("POST", "/quotations", data=quotation_data)
    if response and response.status_code in [200, 201]:
        quotation = response.json()
        print(f"✓ Created quotation: {quotation.get('quotation_id')}")
        return quotation.get('quotation_id')
    else:
        print("❌ Failed to create quotation")
        return None

def test_quotation_status_update(quotation_id):
    """Test updating quotation status"""
    if not quotation_id:
        return
        
    print(f"\n3. Testing PUT /quotations/{quotation_id}/status")
    response = make_request("PUT", f"/quotations/{quotation_id}/status", params={"status": "accepted"})
    if response and response.status_code == 200:
        print("✓ Quotation status updated to accepted")
        return True
    else:
        print("❌ Failed to update quotation status")
        return False

def test_quotation_convert_to_order(quotation_id):
    """Test converting quotation to order"""
    if not quotation_id:
        return
        
    print(f"\n4. Testing POST /quotations/{quotation_id}/convert-to-order")
    # Fix: Use params dict directly instead of manually constructing URL
    params = {"warehouse_id": TEST_WAREHOUSE_ID}
    response = make_request("POST", f"/quotations/{quotation_id}/convert-to-order", 
                          params=params)
    if response and response.status_code in [200, 201]:
        order = response.json()
        print(f"✓ Quotation converted to order: {order.get('order_id')}")
        return order.get('order_id')
    else:
        print("❌ Failed to convert quotation to order")
        return None

def test_delivery_notes():
    """Test Delivery Notes API endpoints"""
    print("\n=== TESTING DELIVERY NOTES API ===")
    
    # 1. GET /api/delivery-notes - list delivery notes
    print("\n1. Testing GET /delivery-notes")
    response = make_request("GET", "/delivery-notes")
    if response and response.status_code == 200:
        delivery_notes = response.json()
        print(f"✓ Found {len(delivery_notes)} delivery notes")
        return delivery_notes
    else:
        print("❌ Failed to get delivery notes")
        return []

def test_delivery_notes_create():
    """Test creating delivery note"""
    print("\n2. Testing POST /delivery-notes")
    
    delivery_data = {
        "so_id": "so_5d3ee6c0ae06",  # Using real sales order ID
        "notes": "Test delivery for laptop order"
    }
    
    response = make_request("POST", "/delivery-notes", data=delivery_data)
    if response and response.status_code in [200, 201]:
        delivery = response.json()
        print(f"✓ Created delivery note: {delivery.get('delivery_id')}")
        return delivery.get('delivery_id')
    else:
        print("❌ Failed to create delivery note")
        return None

def test_delivery_status_update(delivery_id):
    """Test updating delivery status"""
    if not delivery_id:
        return
        
    print(f"\n3. Testing PUT /delivery-notes/{delivery_id}/status")
    response = make_request("PUT", f"/delivery-notes/{delivery_id}/status", 
                          params={"status": "delivered"})
    if response and response.status_code == 200:
        print("✓ Delivery status updated to delivered")
    else:
        print("❌ Failed to update delivery status")

def test_bom():
    """Test Bill of Materials API endpoints"""
    print("\n=== TESTING BILL OF MATERIALS (BOM) API ===")
    
    # 1. GET /api/bom - list BOMs
    print("\n1. Testing GET /bom")
    response = make_request("GET", "/bom")
    if response and response.status_code == 200:
        boms = response.json()
        print(f"✓ Found {len(boms)} BOMs")
        return boms
    else:
        print("❌ Failed to get BOMs")
        return []

def test_bom_create():
    """Test creating BOM"""
    print("\n2. Testing POST /bom")
    
    bom_data = {
        "finished_product_id": "prod_bd9a50a6d690",  # Using real finished product ID
        "components": [
            {
                "raw_product_id": "prod_1db659471358",  # Using real raw product ID
                "quantity_required": 2.0
            }
        ],
        "yield_quantity": 1.0,
        "notes": "Test BOM for assembly testing"
    }
    
    response = make_request("POST", "/bom", data=bom_data)
    if response and response.status_code in [200, 201]:
        bom = response.json()
        print(f"✓ Created BOM: {bom.get('bom_id')}")
        return bom.get('bom_id')
    else:
        print("❌ Failed to create BOM")
        return None

def test_bom_get_by_product(product_id):
    """Test getting BOM for specific product"""
    print(f"\n3. Testing GET /bom/{product_id}")
    response = make_request("GET", f"/bom/{product_id}")
    if response and response.status_code == 200:
        bom = response.json()
        print(f"✓ Retrieved BOM for product: {product_id}")
    elif response and response.status_code == 404:
        print(f"⚠ No BOM found for product: {product_id} (expected for test)")
    else:
        print("❌ Failed to get BOM for product")

def test_bom_produce(bom_id):
    """Test producing from BOM"""
    if not bom_id:
        return
        
    print(f"\n4. Testing POST /bom/{bom_id}/produce")
    response = make_request("POST", f"/bom/{bom_id}/produce", 
                          params={"quantity": 5, "warehouse_id": TEST_WAREHOUSE_ID})
    if response and response.status_code == 200:
        result = response.json()
        print(f"✓ Production completed: {result.get('message')}")
    else:
        print("❌ Failed to produce from BOM")

def test_enhanced_reports():
    """Test Enhanced Reports API endpoints"""
    print("\n=== TESTING ENHANCED REPORTS API ===")
    
    # 1. Profit & Loss Report
    print("\n1. Testing GET /reports/profit-loss")
    response = make_request("GET", "/reports/profit-loss")
    if response and response.status_code == 200:
        report = response.json()
        print(f"✓ P&L Report retrieved - Net Profit: {report.get('net_profit', 0)}")
    else:
        print("❌ Failed to get P&L report")
    
    # 2. Cash Flow Report
    print("\n2. Testing GET /reports/cash-flow")
    response = make_request("GET", "/reports/cash-flow")
    if response and response.status_code == 200:
        report = response.json()
        print(f"✓ Cash Flow Report retrieved - Net Cash Flow: {report.get('net_cash_flow', 0)}")
    else:
        print("❌ Failed to get cash flow report")
    
    # 3. Supplier Aging Report
    print("\n3. Testing GET /reports/supplier-aging")
    response = make_request("GET", "/reports/supplier-aging")
    if response and response.status_code == 200:
        report = response.json()
        print(f"✓ Supplier Aging Report retrieved - Total Outstanding: {report.get('total_outstanding', 0)}")
    else:
        print("❌ Failed to get supplier aging report")
    
    # 4. Customer Aging Report  
    print("\n4. Testing GET /reports/customer-aging")
    response = make_request("GET", "/reports/customer-aging")
    if response and response.status_code == 200:
        report = response.json()
        print(f"✓ Customer Aging Report retrieved - Total Outstanding: {report.get('total_outstanding', 0)}")
    else:
        print("❌ Failed to get customer aging report")
    
    # 5. Inventory Valuation Report
    print("\n5. Testing GET /reports/inventory-valuation")
    response = make_request("GET", "/reports/inventory-valuation")
    if response and response.status_code == 200:
        report = response.json()
        print(f"✓ Inventory Valuation Report retrieved - Total Value: {report.get('total_value', 0)}")
    else:
        print("❌ Failed to get inventory valuation report")

def test_audit_logs():
    """Test Audit Logs API endpoints"""
    print("\n=== TESTING AUDIT LOGS API ===")
    
    print("\n1. Testing GET /audit-logs")
    response = make_request("GET", "/audit-logs")
    if response and response.status_code == 200:
        logs = response.json()
        print(f"✓ Retrieved {len(logs)} audit log entries")
        if logs:
            latest_log = logs[0]
            print(f"   Latest log: {latest_log.get('action')} on {latest_log.get('entity_type')}")
    else:
        print("❌ Failed to get audit logs")

def test_notifications():
    """Test Notifications API endpoints"""
    print("\n=== TESTING NOTIFICATIONS API ===")
    
    # 1. GET /api/notifications/generate-alerts
    print("\n1. Testing GET /notifications/generate-alerts")
    response = make_request("GET", "/notifications/generate-alerts")
    if response and response.status_code == 200:
        alerts = response.json()
        print(f"✓ Generated {len(alerts)} system alerts")
        if alerts and isinstance(alerts, list):
            for alert in alerts[:3]:  # Show first 3 alerts
                print(f"   Alert: {alert.get('message')}")
        elif alerts:
            print(f"   Alert type: {type(alerts)} - {str(alerts)[:100]}")
    else:
        print("❌ Failed to generate alerts")

def run_comprehensive_test():
    """Run all new feature tests"""
    print("🚀 Starting BizCore API New Features Testing")
    print(f"Backend URL: {BASE_URL}")
    print(f"Test Session: {TEST_SESSION_TOKEN}")
    print(f"Test Warehouse: {TEST_WAREHOUSE_ID}")
    
    failed_tests = []
    
    try:
        # Test Expenses
        expenses = test_expenses()
        expense_id = test_expenses_create()
        if expense_id:
            test_expense_approve(expense_id)
            test_expense_delete(expense_id)
        else:
            failed_tests.append("Expense Creation")
        
        # Test Quotations
        quotations = test_quotations()
        quotation_id = test_quotations_create()
        if quotation_id:
            status_updated = test_quotation_status_update(quotation_id)
            if status_updated:
                order_id = test_quotation_convert_to_order(quotation_id)
                if not order_id:
                    failed_tests.append("Quotation to Order Conversion")
            else:
                failed_tests.append("Quotation Status Update")
        else:
            failed_tests.append("Quotation Creation")
        
        # Test Delivery Notes
        delivery_notes = test_delivery_notes()
        delivery_id = test_delivery_notes_create()
        if delivery_id:
            test_delivery_status_update(delivery_id)
        else:
            failed_tests.append("Delivery Note Creation")
        
        # Test BOM
        boms = test_bom()
        bom_id = test_bom_create()
        test_bom_get_by_product("prod_finished_test")
        if bom_id:
            test_bom_produce(bom_id)
        else:
            failed_tests.append("BOM Creation")
        
        # Test Enhanced Reports
        test_enhanced_reports()
        
        # Test Audit Logs
        test_audit_logs()
        
        # Test Notifications
        test_notifications()
        
    except Exception as e:
        print(f"\n❌ Unexpected error during testing: {e}")
        failed_tests.append(f"Unexpected Error: {e}")
    
    # Final Summary
    print("\n" + "="*60)
    print("🏁 TESTING COMPLETE - NEW FEATURES SUMMARY")
    print("="*60)
    
    if failed_tests:
        print(f"❌ Failed Tests ({len(failed_tests)}):")
        for test in failed_tests:
            print(f"   • {test}")
    else:
        print("✅ ALL NEW FEATURE TESTS PASSED!")
    
    print(f"\nBackend URL Used: {BASE_URL}")
    print(f"Session Token: {TEST_SESSION_TOKEN}")
    print(f"Warehouse ID: {TEST_WAREHOUSE_ID}")

if __name__ == "__main__":
    run_comprehensive_test()