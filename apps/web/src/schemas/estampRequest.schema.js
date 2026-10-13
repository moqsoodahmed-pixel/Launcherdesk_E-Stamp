import { z } from "zod";

// Mirrors packages/validation/src/index.js's createEStampRequestSchema exactly.
// Duplicated here (rather than imported from the shared workspace package) so
// the frontend build stays a clean, dependency-free ESM bundle with no
// CommonJS/ESM interop concerns. Keep this in sync with the backend schema
// in packages/validation/src/index.js if you change either one.
export const createEStampRequestSchema = z.object({
  stateCode: z.string().trim().min(2, "State code is required").max(10),
  articleId: z.string().trim().min(1, "Please select an article"),
  firstParty: z.string().trim().min(1, "First party is required").max(300, "First party must be under 300 characters"),
  secondParty: z.string().trim().min(1, "Second party is required").max(300, "Second party must be under 300 characters"),
  descriptionOfDocument: z.string().trim().min(1, "Description of document is required").max(1000, "Description must be under 1000 characters"),
  propertyDescription: z.string().trim().max(2000, "Property description must be under 2000 characters").optional(),
  considerationPrice: z.number().min(0, "Consideration price must be positive"),
  stampDutyPaidBy: z.string().trim().min(1, "Payer must be selected").max(300),
  numberOfEStamps: z.number().int().min(1, "At least 1 E-Stamp").max(100, "Maximum 100 E-Stamps").default(1),
  extraFields: z.record(z.any()).optional(),
});
