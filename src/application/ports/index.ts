// LAYER: Application
// Barrel export for application ports. Keeps imports stable across refactors.

export * from './in/categoryClassifier.port';
export * from './output/messaging.port';
export * from './output/categoryFallbackMapper.port';
export * from './output/categoryKeywordVocabularyRepository.port';
export * from './IChatMessenger';
export * from './IncomingMessageJob';
export * from './ProcessMessageJob';
