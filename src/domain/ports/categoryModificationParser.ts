// LAYER: Domain
// Port for parsing natural-language instructions to modify the
// category hierarchy (add, remove, rename, or move). Keeps the Application layer
// agnostic of the parsing strategy (regex, LLM, etc.).

export interface AddCategoryIntent {
  readonly kind: 'add';
  readonly name: string;
}

export interface RenameCategoryIntent {
  readonly kind: 'rename';
  readonly from: string;
  readonly to: string;
}

export interface RemoveCategoryIntent {
  readonly kind: 'remove';
  readonly name: string;
}

export interface AddSubcategoryIntent {
  readonly kind: 'add-subcategory';
  readonly name: string;
  readonly parent: string;
}

export interface RenameSubcategoryIntent {
  readonly kind: 'rename-subcategory';
  readonly from: string;
  readonly to: string;
  readonly parent: string;
}

export interface MoveSubcategoryIntent {
  readonly kind: 'move-subcategory';
  readonly name: string;
  readonly fromParent: string;
  readonly toParent: string;
}

export interface RemoveSubcategoryIntent {
  readonly kind: 'remove-subcategory';
  readonly name: string;
  readonly parent: string;
}

export interface UnknownCategoryModificationIntent {
  readonly kind: 'unknown';
}

export type CategoryModificationIntent =
  | AddCategoryIntent
  | RemoveCategoryIntent
  | RenameCategoryIntent
  | AddSubcategoryIntent
  | RenameSubcategoryIntent
  | MoveSubcategoryIntent
  | RemoveSubcategoryIntent
  | UnknownCategoryModificationIntent;

export interface CategoryModificationParserPort {
  parse(input: string): Promise<CategoryModificationIntent>;
}
