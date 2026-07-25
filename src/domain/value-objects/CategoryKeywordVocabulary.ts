// LAYER: Domain
// Immutable value object that maps keywords to canonical expense categories.
// Provides a base Spanish vocabulary and can be extended with user-specific
// category names without mutating the base instance.

export type CanonicalCategory =
  | 'food'
  | 'transport'
  | 'housing'
  | 'health'
  | 'entertainment'
  | 'services';

export interface CategoryKeywordMatch {
  readonly canonicalCategory: CanonicalCategory | null;
  readonly matchedKeywords: number;
  readonly totalKeywords: number;
}

export interface CategoryKeywordMatches {
  readonly scores: ReadonlyMap<CanonicalCategory, number>;
  readonly totalTokens: number;
}

const CANONICAL_CATEGORY_DISPLAY_NAMES: Readonly<Record<CanonicalCategory, readonly string[]>> = {
  food: ['comida', 'alimentacion', 'alimento', 'alimentos'],
  transport: ['transporte', 'transport', 'movilidad'],
  housing: ['vivienda', 'casa', 'hogar', 'alquiler'],
  health: ['salud', 'medico', 'medicina'],
  entertainment: ['ocio', 'entretenimiento', 'diversion'],
  services: ['servicios', 'servicio'],
};

const BASE_KEYWORDS: Readonly<Record<CanonicalCategory, readonly string[]>> = {
  food: [
    'comida',
    'comidas',
    'almuerzo',
    'almuerzos',
    'cena',
    'cenas',
    'desayuno',
    'desayunos',
    'merienda',
    'meriendas',
    'restaurante',
    'restaurantes',
    'cafe',
    'cafeteria',
    'supermercado',
    'super',
    'mercado',
    'alimentacion',
    'alimento',
    'alimentos',
    'panaderia',
    'verduleria',
    'carniceria',
    'delivery',
    'pedido',
    'pedidos',
  ],
  transport: [
    'transporte',
    'transport',
    'movilidad',
    'taxi',
    'taxis',
    'uber',
    'cabify',
    'bus',
    'colectivo',
    'colectivos',
    'subte',
    'subtes',
    'metro',
    'tren',
    'trenes',
    'boleto',
    'boletos',
    'pasaje',
    'pasajes',
    'combustible',
    'nafta',
    'gasolina',
    'gasoil',
    'estacionamiento',
    'peaje',
    'peajes',
    'auto',
    'moto',
    'mecanico',
  ],
  housing: [
    'vivienda',
    'casa',
    'hogar',
    'alquiler',
    'hipoteca',
    'expensas',
    'luz',
    'gas',
    'agua',
    'internet',
    'wifi',
    'telefono',
    'reparacion',
    'reparaciones',
    'mueble',
    'muebles',
    'decoracion',
    'jardin',
  ],
  health: [
    'salud',
    'medico',
    'medicos',
    'medica',
    'doctor',
    'doctores',
    'hospital',
    'clinica',
    'farmacia',
    'remedio',
    'remedios',
    'medicamento',
    'medicamentos',
    'seguro',
    'seguros',
    'consulta',
    'analisis',
    'ambulancia',
    'terapia',
  ],
  entertainment: [
    'ocio',
    'entretenimiento',
    'diversion',
    'cine',
    'cines',
    'teatro',
    'teatros',
    'concierto',
    'conciertos',
    'evento',
    'eventos',
    'streaming',
    'netflix',
    'spotify',
    'juego',
    'juegos',
    'videojuego',
    'videojuegos',
    'libro',
    'libros',
    'revista',
    'bar',
    'bares',
    'salida',
    'salidas',
    'vacaciones',
    'viaje',
    'viajes',
    'hotel',
    'hoteles',
  ],
  services: [
    'servicios',
    'servicio',
    'limpieza',
    'seguridad',
    'mantenimiento',
    'suscripcion',
    'suscripciones',
    'membresia',
    'membresias',
    'gimnasio',
    'gym',
    'colegio',
    'universidad',
    'curso',
    'cursos',
    'profesor',
    'profesores',
    'abogado',
    'contador',
    'asistente',
    'nube',
    'software',
    'aplicacion',
  ],
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function findCanonicalCategoryForUserCategory(userCategory: string): CanonicalCategory | null {
  const normalizedUserCategory = normalize(userCategory);

  for (const [canonical, displayNames] of Object.entries(CANONICAL_CATEGORY_DISPLAY_NAMES)) {
    for (const displayName of displayNames) {
      if (
        normalizedUserCategory === displayName ||
        normalizedUserCategory.includes(displayName) ||
        displayName.includes(normalizedUserCategory)
      ) {
        return canonical as CanonicalCategory;
      }
    }
  }

  return null;
}

export class CategoryKeywordVocabulary {
  private constructor(
    private readonly keywordToCanonical: ReadonlyMap<string, CanonicalCategory>,
    private readonly canonicalToUserCategories: ReadonlyMap<CanonicalCategory, readonly string[]>,
  ) {}

  static createBase(): CategoryKeywordVocabulary {
    const map = new Map<string, CanonicalCategory>();

    for (const [canonical, keywords] of Object.entries(BASE_KEYWORDS)) {
      for (const keyword of keywords) {
        map.set(normalize(keyword), canonical as CanonicalCategory);
      }
    }

    return new CategoryKeywordVocabulary(map, new Map());
  }

  withUserCategories(userCategories: readonly string[]): CategoryKeywordVocabulary {
    const map = new Map(this.keywordToCanonical);
    const canonicalToUserCategories = new Map<CanonicalCategory, string[]>();

    for (const [canonical, existing] of this.canonicalToUserCategories.entries()) {
      canonicalToUserCategories.set(canonical, [...existing]);
    }

    for (const userCategory of userCategories) {
      const normalizedUserCategory = normalize(userCategory);
      if (normalizedUserCategory.length === 0) continue;

      const inferredCanonical = findCanonicalCategoryForUserCategory(userCategory);
      if (inferredCanonical) {
        map.set(normalizedUserCategory, inferredCanonical);

        const existing = canonicalToUserCategories.get(inferredCanonical) ?? [];
        canonicalToUserCategories.set(inferredCanonical, [...existing, userCategory]);
      }
    }

    return new CategoryKeywordVocabulary(map, canonicalToUserCategories);
  }

  getUserCategories(): readonly string[] {
    return [...this.canonicalToUserCategories.values()].flat();
  }

  getUserCategoryNames(canonical: CanonicalCategory): readonly string[] {
    return this.canonicalToUserCategories.get(canonical) ?? [];
  }

  findAllMatches(text: string): CategoryKeywordMatches {
    const tokens = tokenize(text);
    const scores = new Map<CanonicalCategory, number>();

    for (const token of tokens) {
      const normalizedToken = normalize(token);
      const canonical = this.keywordToCanonical.get(normalizedToken);
      if (canonical) {
        scores.set(canonical, (scores.get(canonical) ?? 0) + 1);
      }
    }

    return { scores, totalTokens: tokens.length };
  }

  findBestMatch(text: string): CategoryKeywordMatch {
    const tokens = tokenize(text);
    if (tokens.length === 0) {
      return { canonicalCategory: null, matchedKeywords: 0, totalKeywords: 0 };
    }

    const scores = new Map<CanonicalCategory, number>();

    for (const token of tokens) {
      const normalizedToken = normalize(token);
      const canonical = this.keywordToCanonical.get(normalizedToken);
      if (canonical) {
        scores.set(canonical, (scores.get(canonical) ?? 0) + 1);
      }
    }

    if (scores.size === 0) {
      return { canonicalCategory: null, matchedKeywords: 0, totalKeywords: tokens.length };
    }

    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const [topCanonical, topScore] = sorted[0]!;

    return {
      canonicalCategory: topCanonical,
      matchedKeywords: topScore,
      totalKeywords: tokens.length,
    };
  }
}
