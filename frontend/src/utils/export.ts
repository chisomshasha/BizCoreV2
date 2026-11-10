import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import api from './api';
import { Platform } from 'react-native';

export async function downloadAndShareInvoicePdf(invoiceId: string): Promise<void> {
  try {
    // Get PDF as base64 from backend
    const response = await api.get(`/invoices/${invoiceId}/pdf-base64`);
    const { pdf_base64, filename } = response.data;

    if (Platform.OS === 'web') {
      // For web, create a download link
      const byteCharacters = atob(pdf_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      // For mobile, save to file and share
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, pdf_base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share Invoice',
        });
      }
    }
  } catch (error) {
    console.error('Failed to download/share PDF:', error);
    throw error;
  }
}

export async function printInvoice(invoiceId: string): Promise<void> {
  try {
    const response = await api.get(`/invoices/${invoiceId}/pdf-base64`);
    const { pdf_base64 } = response.data;

    // Create HTML from base64 PDF for printing
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Invoice</title>
        </head>
        <body style="margin: 0; padding: 0;">
          <embed src="data:application/pdf;base64,${pdf_base64}" type="application/pdf" width="100%" height="100%" />
        </body>
      </html>
    `;

    await Print.printAsync({ html });
  } catch (error) {
    console.error('Failed to print invoice:', error);
    throw error;
  }
}

/**
 * The backend exposes PDF export for a fixed set of reports. Map the
 * caller's shorthand onto the real route segment and fail loudly for
 * anything unsupported instead of requesting a URL that will 404.
 */
const REPORT_PDF_ROUTES: Record<string, string> = {
  'stock-summary': 'stock-summary',
  'stock_summary': 'stock-summary',
  'profit-loss': 'profit-loss',
  'profit_loss': 'profit-loss',
};

export async function downloadReportPdf(reportType: string, params?: Record<string, string>): Promise<void> {
  const route = REPORT_PDF_ROUTES[reportType];
  if (!route) {
    throw new Error(`No PDF export available for report "${reportType}"`);
  }
  try {
    const queryString = params
      ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : '';

    if (Platform.OS === 'web') {
      // Browsers can consume the binary PDF stream directly.
      const response = await api.get(`/reports/${route}/pdf${queryString}`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${route}_report.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    // React Native has no Blob/ArrayBuffer response support and no
    // FileReader, so the backend must return the PDF base64-encoded.
    const response = await api.get(`/reports/${route}/pdf-base64${queryString}`);
    const { pdf_base64, filename } = response.data;

    const fileUri = `${FileSystem.cacheDirectory}${filename || `${route}_report.pdf`}`;
    await FileSystem.writeAsStringAsync(fileUri, pdf_base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share Report',
      });
    }
  } catch (error) {
    console.error('Failed to download report:', error);
    throw error;
  }
}

export async function exportToCsv(data: any[], filename: string): Promise<void> {
  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }

  // Get headers from first object
  const headers = Object.keys(data[0]);
  
  // Create CSV content
  let csv = headers.join(',') + '\n';
  
  for (const row of data) {
    const values = headers.map((header) => {
      const value = row[header];
      // Escape quotes and wrap in quotes if contains comma
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value ?? '';
    });
    csv += values.join(',') + '\n';
  }

  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } else {
    const fileUri = `${FileSystem.cacheDirectory}${filename}.csv`;
    await FileSystem.writeAsStringAsync(fileUri, csv);

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export CSV',
      });
    }
  }
}
