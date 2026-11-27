import { describe, expect, it } from 'vitest';
import { onboardingContextIssue } from './ConfirmedOnboardingContext';
import type { ColumnMapping, SpreadsheetConfig } from '../../domain/entities/SpreadsheetConfig';

const config: SpreadsheetConfig = {
  id: 'config',
  userId: 'user',
  provider: 'google',
  fileId: 'file',
  fileName: 'Expenses',
  sheetName: 'Gastos',
  isActive: true,
  headerRowIndex: 2,
  accessVerifiedAt: new Date(),
  categoriesConfirmedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const rows: ColumnMapping[] = [
  {
    id: 'category',
    spreadsheetId: 'config',
    GasttoField: 'categoria',
    columnIndex: 2,
    columnHeader: 'Categoría',
    inferred: false,
    confirmedAt: new Date('2026-11-24T12:00:00Z'),
  },
];
const payload = {
  spreadsheetId: 'config',
  provider: 'google',
  fileId: 'file',
  sheetName: 'Gastos',
  headerRowIndex: 2,
  proposalId: 'proposal',
  confirmedMappings: rows.map((row) => ({
    gasttoField: row.GasttoField,
    columnIndex: row.columnIndex,
    columnHeader: row.columnHeader,
    confirmedAt: row.confirmedAt!.toISOString(),
  })),
};

describe('confirmed onboarding context', () => {
  it('accepts a category-only mapping that deliberately omits payments', () => {
    expect(onboardingContextIssue('user', config, payload, rows)).toBeNull();
  });
  it.each([
    { headerRowIndex: 3 },
    { spreadsheetId: 'old-config' },
    { provider: 'microsoft' },
    { fileId: 'old-file' },
    { sheetName: 'Other' },
    { proposalId: '' },
    { confirmedMappings: [] },
  ])('rejects changed context %j', (change) => {
    expect(onboardingContextIssue('user', config, { ...payload, ...change }, rows)).not.toBeNull();
  });
  it.each([
    { columnIndex: 1 },
    { columnHeader: 'Other' },
    { confirmedAt: null },
    { confirmedAt: new Date('2026-11-24T12:01:00Z') },
    { spreadsheetId: 'other' },
  ])('rejects changed confirmed repository rows %j', (change) => {
    expect(
      onboardingContextIssue(
        'user',
        config,
        payload,
        rows.map((row) => ({ ...row, ...change })),
      ),
    ).toBe('mappings_changed');
  });
  it('rejects a different owner or inactive destination', () => {
    expect(onboardingContextIssue('other', config, payload, rows)).toBe('configuration_ownership');
    expect(onboardingContextIssue('user', { ...config, isActive: false }, payload, rows)).toBe(
      'configuration_ownership',
    );
  });
});
