export interface CategorySubcategoryPair {
  category: string;
  subcategory: string;
}

export interface CategoryHierarchyReadResult {
  categories: string[];
  pairs: CategorySubcategoryPair[];
  orphanSubcategories: string[];
}

export interface ICategoryHierarchyReaderPort {
  readHierarchy(
    fileId: string,
    categoryColumnIndex: number,
    subcategoryColumnIndex: number,
    sheetName: string,
    dataStartRow?: number,
  ): Promise<CategoryHierarchyReadResult>;
}

export interface ICategoryHierarchyReaderPortFactory {
  create(accessToken: string): ICategoryHierarchyReaderPort;
}
