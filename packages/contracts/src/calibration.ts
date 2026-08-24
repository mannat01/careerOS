import { z } from 'zod';

const unitIntervalSchema = z.number().finite().min(0).max(1);
const signedUnitIntervalSchema = z.number().finite().min(-1).max(1);

/** One measured predicted-confidence versus observed-accuracy reliability bin. */
export const calibrationBucketSchema = z
  .object({
    lower: unitIntervalSchema,
    upper: unitIntervalSchema,
    count: z.number().int().positive(),
    meanConfidence: unitIntervalSchema,
    observedAccuracy: unitIntervalSchema,
  })
  .strict()
  .refine((bucket) => bucket.lower < bucket.upper, {
    message: 'Calibration bucket lower bound must be below its upper bound.',
    path: ['upper'],
  });
export type CalibrationBucket = z.infer<typeof calibrationBucketSchema>;

/** A measured domain slice and the reliability bins that support its figures. */
export const domainCalibrationSchema = z
  .object({
    domain: z.string().trim().min(1),
    sampleSize: z.number().int().positive(),
    bins: z.array(calibrationBucketSchema).min(1),
    expectedCalibrationError: unitIntervalSchema,
    calibrationScore: unitIntervalSchema,
    feedbackAdjustment: signedUnitIntervalSchema,
  })
  .strict()
  .superRefine((domain, ctx) => {
    const binnedSamples = domain.bins.reduce((sum, bin) => sum + bin.count, 0);
    if (binnedSamples !== domain.sampleSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Domain bin counts must equal its sample size.',
        path: ['bins'],
      });
    }
  });
export type DomainCalibration = z.infer<typeof domainCalibrationSchema>;

export const calibrationFeedbackSchema = z
  .object({
    byDomain: z.record(z.string().trim().min(1), signedUnitIntervalSchema),
    overall: signedUnitIntervalSchema,
    modelVersion: z.string().trim().min(1),
  })
  .strict();
export type CalibrationFeedback = z.infer<typeof calibrationFeedbackSchema>;

const calibrationMetadataSchema = z.object({
  modelVersion: z.string().trim().min(1),
  computedAt: z.string().datetime(),
});

export const measuredCalibrationReportSchema = calibrationMetadataSchema
  .extend({
    sampleSize: z.number().int().positive(),
    bins: z.array(calibrationBucketSchema).min(1),
    expectedCalibrationError: unitIntervalSchema,
    calibrationScore: unitIntervalSchema,
    domains: z.array(domainCalibrationSchema).min(1),
  })
  .strict()
  .superRefine((report, ctx) => {
    const binnedSamples = report.bins.reduce((sum, bin) => sum + bin.count, 0);
    if (binnedSamples !== report.sampleSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Overall bin counts must equal the report sample size.',
        path: ['bins'],
      });
    }
    const domainSamples = report.domains.reduce((sum, domain) => sum + domain.sampleSize, 0);
    if (domainSamples !== report.sampleSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Domain sample sizes must equal the report sample size.',
        path: ['domains'],
      });
    }
  });
export type MeasuredCalibrationReport = z.infer<typeof measuredCalibrationReportSchema>;

export const insufficientCalibrationReportSchema = calibrationMetadataSchema
  .extend({ sampleSize: z.literal(0) })
  .strict();
export type InsufficientCalibrationReport = z.infer<typeof insufficientCalibrationReportSchema>;

const measuredCalibrationResponseSchema = z
  .object({
    status: z.literal('measured'),
    report: measuredCalibrationReportSchema,
    feedback: calibrationFeedbackSchema,
  })
  .strict();

const insufficientCalibrationResponseSchema = z
  .object({
    status: z.literal('insufficient_data'),
    report: insufficientCalibrationReportSchema,
    feedback: calibrationFeedbackSchema.extend({ byDomain: z.object({}).strict(), overall: z.literal(0) }).strict(),
  })
  .strict();

/**
 * GET /v1/cie/calibration. Calibration figures are measured outcomes, not a
 * scored inference, so this contract deliberately has no `confidence` field.
 * With no realized outcomes, metric figures and reliability bins are absent.
 */
export const calibrationResponseSchema = z
  .discriminatedUnion('status', [
    measuredCalibrationResponseSchema,
    insufficientCalibrationResponseSchema,
  ])
  .superRefine((response, ctx) => {
    if (response.feedback.modelVersion !== response.report.modelVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Feedback and report model versions must match.',
        path: ['feedback', 'modelVersion'],
      });
    }
  });
export type CalibrationResponse = z.infer<typeof calibrationResponseSchema>;