export interface VerificationEmailPayload {
  to: string;
  token: string;
  expiresAt: Date;
}

export type EmailDispatcher = (payload: VerificationEmailPayload) => Promise<void>;

export const emailDispatcherDeps = {
  sendVerificationEmail: async (_payload: VerificationEmailPayload): Promise<void> => {},
};
