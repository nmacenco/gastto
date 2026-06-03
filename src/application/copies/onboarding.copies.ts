export const onboardingCopies = {
  providerPrompt: () => '¿Dónde tenés tu planilla?\n1. Google Drive\n2. OneDrive',
  invalidRePrompt: () => 'No entendí. Escribí _1_ para Google Drive o _2_ para OneDrive.',
  comingSoon: (provider: string) =>
    `${provider} está en camino 🚧. Escribí _1_ para usar Google Drive por ahora.`,
  authLink: (url: string) =>
    `Hacé clic en este enlace para autorizar a Gastto: ${url}\nTenés 10 minutos.`,
  onboardingPlaceholder: () =>
    'Estamos configurando tu cuenta. Por favor sigue las instrucciones anteriores.',
};
