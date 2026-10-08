import { z } from "zod";

// Mirrors packages/validation/src/index.js's createEStampRequestSchema exactly.
// Duplicated here (rather than imported from the shared workspace package) so
// the frontend build stays a clean, dependency-free ESM bundle with no
// CommonJS/ESM interop concerns. Keep this in sync with the backend schema
// in packages/validation/src/index.js if you change either one.
export const createEStampRequestSchema = z.object({
  stateCode: z.string().min(2).max(10),
  articleId: z.string().min(1),
  firstParty: z.string().min(1).max(300),
  secondParty: z.string().min(1).max(300),
  descriptionOfDocument: z.string().min(1).max(1000),
  propertyDescription: z.string().max(2000).optional(),
  considerationPrice: z.number().min(0),
  stampDutyPaidBy: z.string().min(1).max(300),
  numberOfEStamps: z.number().int().min(1).max(100).default(1),
  extraFields: z.record(z.any()).optional(),
});
