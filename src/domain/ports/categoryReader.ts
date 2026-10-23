// LAYER: Domain
// Port for reading the unique category vocabulary from a spreadsheet.
// Keeps the Application layer agnostic of the spreadsheet provider.

export interface ICategoryReaderPort {
  readCategories(
    fileId: string,
    columnIndex: number,
    sheetName: string,
    dataStartRow?: number,
  ): Promise<string[]>;
}

export interface ICategoryReaderPortFactory {
  create(accessToken: string): ICategoryReaderPort;
}
