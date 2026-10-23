/**
 * Fields copied onto the JWT for the signed-in user.
 * Account credentials are intentionally absent.
 */
export const sessionUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;

export const accountCredentialFields = [
  "accessToken",
  "refreshToken",
  "idToken",
  "providerAccountId",
  "sessionState",
  "scope",
  "tokenType",
  "expiresAt",
] as const;
