// LAYER: Domain
// Subcategory entity - represents a user-defined child of a category.

export interface Subcategory {
  id: string;
  categoryId: string;
  name: string;
  normalizedName: string;
}
