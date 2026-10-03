import { describe, expect, it } from 'vitest';
import type { SpreadsheetConfig } from '../../domain/entities/SpreadsheetConfig';
import { readActiveColumnMappingProposal } from './ActiveColumnMappingProposal';

const config: SpreadsheetConfig = {
  id: 'config-1',
  userId: 'user-1',
  provider: 'google',
  fileId: 'file-1',
  fileName: 'Expenses',
  sheetName: 'T 6',
  accessVerifiedAt: new Date('2026-10-03T08:00:00Z'),
  categoriesConfirmedAt: null,
  createdAt: new Date('2026-10-03T08:00:00Z'),
  updatedAt: new Date('2026-10-03T08:00:00Z'),
};

describe('readActiveColumnMappingProposal', () => {
  it('materializes the active proposal with inference provenance', () => {
    const result = readActiveColumnMappingProposal(
      {
        proposalId: 'proposal-1',
        spreadsheetId: 'config-1',
        provider: 'google',
        fileId: 'file-1',
        sheetName: 'T 6',
        mappings: [
          {
            gasttoField: 'medio_pago',
            columnIndex: 0,
            columnHeader: '',
            inferred: false,
          },
        ],
      },
      config,
    );

    expect(result).toEqual({
      proposalId: 'proposal-1',
      mappings: [
        expect.objectContaining({
          spreadsheetId: 'config-1',
          GasttoField: 'medio_pago',
          columnIndex: 0,
          inferred: false,
        }),
      ],
    });
  });

  it('rejects proposals belonging to another file, sheet, or spreadsheet configuration', () => {
    const mappings = [{ gasttoField: 'fecha', columnIndex: 1, columnHeader: 'Fecha' }];

    expect(readActiveColumnMappingProposal({ fileId: 'other', mappings }, config)).toBeNull();
    expect(readActiveColumnMappingProposal({ sheetName: 'Other', mappings }, config)).toBeNull();
    expect(
      readActiveColumnMappingProposal({ spreadsheetId: 'other', mappings }, config),
    ).toBeNull();
  });

  it('rejects duplicate fields and duplicate columns before confirmation', () => {
    expect(
      readActiveColumnMappingProposal(
        {
          mappings: [
            { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha' },
            { gasttoField: 'monto', columnIndex: 0, columnHeader: 'Monto' },
          ],
        },
        config,
      ),
    ).toBeNull();
    expect(
      readActiveColumnMappingProposal(
        {
          mappings: [
            { gasttoField: 'fecha', columnIndex: 0, columnHeader: 'Fecha' },
            { gasttoField: 'fecha', columnIndex: 1, columnHeader: 'Date' },
          ],
        },
        config,
      ),
    ).toBeNull();
  });
});
