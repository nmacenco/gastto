import { CategoryVocabulary } from '../../domain/entities/CategoryVocabulary';
import { DomainValidationError } from '../../domain/errors/DomainValidationError';
import type { CategoryModificationIntent } from '../../domain/ports/categoryModificationParser';
import type { VocabularySnapshot } from '../ports/SettingsVocabularyCommit';

const normalize = (name: string) => name.trim().toLowerCase();

export function applyCategoryDraftOperation(
  source: VocabularySnapshot,
  spreadsheetId: string,
  intent: CategoryModificationIntent,
): VocabularySnapshot {
  const draft: VocabularySnapshot = structuredClone(source);
  const vocabulary = new CategoryVocabulary(
    spreadsheetId,
    draft.categories.filter((entry) => entry.isActive),
    draft.subcategories.filter(
      (entry) =>
        entry.isActive &&
        draft.categories.some((parent) => parent.id === entry.categoryId && parent.isActive),
    ),
  );
  const parent = (name: string) => {
    const found = vocabulary
      .getCategories()
      .find((entry) => entry.normalizedName === normalize(name));
    if (!found) throw new DomainValidationError(`No existe la categoría "${name}"`);
    return found;
  };
  const child = (parentName: string, name: string) => {
    const found = vocabulary.findSubcategory(parent(parentName).id, name);
    if (!found)
      throw new DomainValidationError(`No existe la subcategoría "${name}" en "${parentName}"`);
    return found;
  };
  const reservedCategory = (name: string, exceptId?: string) =>
    draft.categories.some(
      (entry) => entry.id !== exceptId && entry.normalizedName === normalize(name),
    );
  const reservedChild = (categoryId: string, name: string, exceptId?: string) =>
    draft.subcategories.some(
      (entry) =>
        entry.id !== exceptId &&
        entry.categoryId === categoryId &&
        entry.normalizedName === normalize(name),
    );

  if (intent.kind === 'unknown') throw new DomainValidationError('No entendí el cambio solicitado');
  if (intent.kind === 'add') {
    if (!normalize(intent.name)) throw new DomainValidationError('El nombre no puede estar vacío');
    if (vocabulary.getCategories().some((entry) => entry.normalizedName === normalize(intent.name)))
      throw new DomainValidationError('La categoría ya existe');
    const inactive = draft.categories.find(
      (entry) => !entry.isActive && entry.normalizedName === normalize(intent.name),
    );
    if (inactive) {
      inactive.isActive = true;
      inactive.name = intent.name.trim();
    } else {
      if (reservedCategory(intent.name))
        throw new DomainValidationError('El nombre está reservado');
      draft.categories.push({ ...vocabulary.addCategory(intent.name), isActive: true });
    }
  } else if (intent.kind === 'remove') {
    const target = parent(intent.name);
    draft.categories.find((entry) => entry.id === target.id)!.isActive = false;
    for (const entry of draft.subcategories)
      if (entry.categoryId === target.id) entry.isActive = false;
  } else if (intent.kind === 'rename') {
    const target = parent(intent.from);
    if (reservedCategory(intent.to, target.id))
      throw new DomainValidationError('Ese nombre pertenece a otra categoría activa o desactivada');
    const updated = vocabulary.renameCategory(target.id, intent.to);
    Object.assign(draft.categories.find((entry) => entry.id === target.id)!, updated);
  } else if (intent.kind === 'add-subcategory') {
    const target = parent(intent.parent);
    if (!normalize(intent.name)) throw new DomainValidationError('El nombre no puede estar vacío');
    if (vocabulary.findSubcategory(target.id, intent.name))
      throw new DomainValidationError('La subcategoría ya existe');
    const inactive = draft.subcategories.find(
      (entry) =>
        !entry.isActive &&
        entry.categoryId === target.id &&
        entry.normalizedName === normalize(intent.name),
    );
    if (inactive) {
      inactive.isActive = true;
      inactive.name = intent.name.trim();
    } else {
      if (reservedChild(target.id, intent.name))
        throw new DomainValidationError('El nombre está reservado');
      draft.subcategories.push({
        ...vocabulary.addSubcategory(target.id, intent.name),
        isActive: true,
      });
    }
  } else if (intent.kind === 'remove-subcategory') {
    draft.subcategories.find(
      (entry) => entry.id === child(intent.parent, intent.name).id,
    )!.isActive = false;
  } else if (intent.kind === 'rename-subcategory') {
    const target = child(intent.parent, intent.from);
    if (reservedChild(target.categoryId, intent.to, target.id))
      throw new DomainValidationError(
        'Ese nombre pertenece a otra subcategoría activa o desactivada',
      );
    Object.assign(
      draft.subcategories.find((entry) => entry.id === target.id)!,
      vocabulary.renameSubcategory(target.id, intent.to),
    );
  } else if (intent.kind === 'move-subcategory') {
    const target = child(intent.fromParent, intent.name);
    const destination = parent(intent.toParent);
    if (reservedChild(destination.id, target.name, target.id))
      throw new DomainValidationError('Ese nombre pertenece a otra subcategoría del destino');
    Object.assign(
      draft.subcategories.find((entry) => entry.id === target.id)!,
      vocabulary.moveSubcategory(target.id, destination.id),
    );
  }
  return draft;
}
