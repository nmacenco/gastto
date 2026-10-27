import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schema';
import { userCategories, userSubcategories } from '../schema';
import type { VocabularySnapshot } from '../../../application/ports/SettingsVocabularyCommit';

export type VocabularyTransaction = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

export async function loadVocabularySnapshot(
  db: PostgresJsDatabase<typeof schema> | VocabularyTransaction,
  spreadsheetId: string,
): Promise<VocabularySnapshot> {
  const parents = await db
    .select()
    .from(userCategories)
    .where(eq(userCategories.spreadsheetId, spreadsheetId));
  const children = parents.length
    ? await db
        .select()
        .from(userSubcategories)
        .where(
          inArray(
            userSubcategories.categoryId,
            parents.map((row) => row.id),
          ),
        )
    : [];
  return {
    categories: parents.map((row) => ({
      id: row.id,
      name: row.rawValue,
      normalizedName: row.normalizedValue,
      isActive: row.isActive,
    })),
    subcategories: children.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      name: row.rawValue,
      normalizedName: row.normalizedValue,
      isActive: row.isActive,
    })),
  };
}

export class VocabularyIdentityConflict extends Error {}

export async function persistVocabularySnapshot(
  tx: VocabularyTransaction,
  spreadsheetId: string,
  baseline: VocabularySnapshot,
  draft: VocabularySnapshot,
): Promise<void> {
  const parentsById = new Map(baseline.categories.map((row) => [row.id, row]));
  const childrenById = new Map(baseline.subcategories.map((row) => [row.id, row]));
  const parentIds = new Set(draft.categories.map((row) => row.id));
  const childIds = new Set(draft.subcategories.map((row) => row.id));
  if (parentIds.size !== draft.categories.length || childIds.size !== draft.subcategories.length)
    throw new VocabularyIdentityConflict();
  for (const old of baseline.categories)
    if (!parentIds.has(old.id)) throw new VocabularyIdentityConflict();
  for (const old of baseline.subcategories)
    if (!childIds.has(old.id)) throw new VocabularyIdentityConflict();
  if (!draft.categories.some((row) => row.isActive)) throw new VocabularyIdentityConflict();
  const newParentIds = draft.categories
    .filter((row) => !parentsById.has(row.id))
    .map((row) => row.id);
  const newChildIds = draft.subcategories
    .filter((row) => !childrenById.has(row.id))
    .map((row) => row.id);
  if (
    newParentIds.length &&
    (
      await tx
        .select({ id: userCategories.id })
        .from(userCategories)
        .where(inArray(userCategories.id, newParentIds))
    ).length
  )
    throw new VocabularyIdentityConflict();
  if (
    newChildIds.length &&
    (
      await tx
        .select({ id: userSubcategories.id })
        .from(userSubcategories)
        .where(inArray(userSubcategories.id, newChildIds))
    ).length
  )
    throw new VocabularyIdentityConflict();
  const parentNames = new Set<string>();
  for (const category of draft.categories) {
    if (
      !category.name.trim() ||
      category.normalizedName !== category.name.trim().toLowerCase() ||
      parentNames.has(category.normalizedName)
    )
      throw new VocabularyIdentityConflict();
    parentNames.add(category.normalizedName);
    const old = parentsById.get(category.id);
    if (
      old &&
      old.normalizedName !== category.normalizedName &&
      baseline.categories.some(
        (row) => row.id !== category.id && row.normalizedName === category.normalizedName,
      )
    )
      throw new VocabularyIdentityConflict();
  }
  const childNames = new Set<string>();
  for (const child of draft.subcategories) {
    const parent = draft.categories.find((row) => row.id === child.categoryId);
    const key = `${child.categoryId}\u0000${child.normalizedName}`;
    if (
      !parent ||
      (child.isActive && !parent.isActive) ||
      !child.name.trim() ||
      child.normalizedName !== child.name.trim().toLowerCase() ||
      childNames.has(key)
    )
      throw new VocabularyIdentityConflict();
    childNames.add(key);
    const old = childrenById.get(child.id);
    if (
      old &&
      (old.categoryId !== child.categoryId || old.normalizedName !== child.normalizedName) &&
      baseline.subcategories.some(
        (row) =>
          row.id !== child.id &&
          row.categoryId === child.categoryId &&
          row.normalizedName === child.normalizedName,
      )
    )
      throw new VocabularyIdentityConflict();
  }
  for (const category of draft.categories) {
    if (parentsById.has(category.id))
      await tx
        .update(userCategories)
        .set({
          rawValue: category.name,
          normalizedValue: category.normalizedName,
          isActive: category.isActive,
        })
        .where(eq(userCategories.id, category.id));
    else
      await tx.insert(userCategories).values({
        id: category.id,
        spreadsheetId,
        rawValue: category.name,
        normalizedValue: category.normalizedName,
        isActive: category.isActive,
        usageCount: 0,
      });
  }
  for (const child of draft.subcategories) {
    if (childrenById.has(child.id))
      await tx
        .update(userSubcategories)
        .set({
          categoryId: child.categoryId,
          rawValue: child.name,
          normalizedValue: child.normalizedName,
          isActive: child.isActive,
        })
        .where(eq(userSubcategories.id, child.id));
    else
      await tx.insert(userSubcategories).values({
        id: child.id,
        categoryId: child.categoryId,
        rawValue: child.name,
        normalizedValue: child.normalizedName,
        isActive: child.isActive,
        usageCount: 0,
      });
  }
}
