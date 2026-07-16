// LAYER: Domain
// Port for parsing natural-language instructions to modify the
// category vocabulary (add or rename). Keeps the Application layer
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

export interface UnknownCategoryModificationIntent {
  readonly kind: 'unknown';
}

export type CategoryModificationIntent =
  | AddCategoryIntent
  | RenameCategoryIntent
  | UnknownCategoryModificationIntent;

export interface CategoryModificationParserPort {
  parse(input: string): Promise<CategoryModificationIntent>;
}
