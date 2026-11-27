export interface MessageBlocks {
  readonly explanation?: string;
  readonly action?: string;
  readonly exit?: string;
}

export const CANCEL_EXIT_HINT = 'Escribí cancelar si quieres salir.';

/** Format explicit blocks without interpreting their content or flow eligibility. */
export function composeMessage({ explanation, action, exit }: MessageBlocks): string {
  return [explanation, action, exit]
    .map((block) => block?.trim() ?? '')
    .filter((block) => block.length > 0)
    .join('\n\n');
}
