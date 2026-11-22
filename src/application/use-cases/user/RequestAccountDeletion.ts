// LAYER: Application
// Phase 1 owns confirmation copy and validation; the deletion executor arrives in phase 2.
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';

export class RequestAccountDeletion {
  constructor(
    private readonly transition: TransitionConversationState,
    private readonly messaging: MessagingOutputPort,
  ) {}

  async execute(input: {
    userId: string;
    state: ConversationState;
    externalId: string;
  }): Promise<void> {
    await this.transition.execute({
      userId: input.userId,
      targetState: 'SETTINGS_MENU',
      payload: { screen: 'account_deletion' },
      expiresAt: new Date(Date.now() + 600_000),
      expected: this.transition.precondition(input.state, 'any'),
    });
    await this.messaging.sendMessage(input.externalId, accountDeletionCopies.request);
  }
}
export const accountDeletionCopies = {
  request:
    'Eliminar tu cuenta borrará los datos que Gastto conserva sobre ti y desconectará Google. No borrará ni modificará tu hoja de cálculo. Esta acción es irreversible. Escribe ELIMINAR MI CUENTA en los próximos 10 minutos para confirmar, o cancelar para salir.',
  cancelled: 'Solicitud cancelada. Tu cuenta no se ha eliminado.',
  expired: 'La confirmación venció. Abrí Configuración y elegí Eliminar cuenta de nuevo.',
  unavailable: 'La eliminación de cuenta aún no está disponible. Tu cuenta no se ha eliminado.',
} as const;

export function isExactAccountDeletionConfirmation(message: string): boolean {
  return message.trim() === 'ELIMINAR MI CUENTA';
}
