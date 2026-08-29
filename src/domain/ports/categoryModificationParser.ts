// LAYER: Domain
// Port for parsing natural-language instructions to modify the
// category vocabulary (add, remove, or rename). Keeps the Application layer
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

export interface UnknownCategoryModificationIntent {
  readonly kind: 'unknown';
}

export type CategoryModificationIntent =
  | AddCategoryIntent
  | RemoveCategoryIntent
  | RenameCategoryIntent
  | UnknownCategoryModificationIntent;

export interface CategoryModificationParserPort {
  parse(input: string): Promise<CategoryModificationIntent>;
}
