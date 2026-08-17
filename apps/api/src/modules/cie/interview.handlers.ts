import {
  interviewPrepRequestSchema,
  interviewPrepResponseSchema,
  type InterviewPrepResponse,
} from '@careeros/contracts';
import type { InterviewPrep, InterviewPrepService } from '@careeros/cie-interview';
import type { RequestContext } from '../../common/auth/request-context.js';
import { errorResponse, ok, type HandlerResponse } from '../../common/errors/http-error.js';

export interface InterviewPrepOpportunityPort {
  exists(opportunityId: string): Promise<boolean>;
  isStoredByUser(userId: string, opportunityId: string): Promise<boolean>;
}

export interface InterviewPrepHandlerDeps {
  service: Pick<InterviewPrepService, 'prepare'>;
  opportunities: InterviewPrepOpportunityPort;
}

/** Green/advisory only: returns practice material and performs no external action. */
export async function prepareInterview(
  ctx: RequestContext,
  body: unknown,
  deps: InterviewPrepHandlerDeps,
): Promise<HandlerResponse<InterviewPrepResponse>> {
  const parsed = interviewPrepRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Expected a valid opportunityId.', {
      details: { issues: parsed.error.issues },
      traceId: ctx.traceId,
    });
  }

  const { opportunityId } = parsed.data;
  if (!await deps.opportunities.exists(opportunityId)) {
    return errorResponse('not_found', 'Opportunity not found.', {
      details: { opportunityId },
      traceId: ctx.traceId,
    });
  }
  if (!await deps.opportunities.isStoredByUser(ctx.userId, opportunityId)) {
    return errorResponse(
      'capability_denied',
      'You can only prepare for an opportunity saved in your pipeline.',
      {
        details: { opportunityId, reason: 'opportunity_not_owned' },
        traceId: ctx.traceId,
      },
    );
  }

  const prep = await deps.service.prepare(ctx.userId, opportunityId);
  return ok(interviewPrepResponseSchema.parse(toResponse(opportunityId, prep)));
}

function toResponse(opportunityId: string, prep: InterviewPrep): InterviewPrepResponse {
  if (prep.questions.length === 0 || prep.answers.length === 0) {
    return {
      status: 'insufficient_data',
      opportunityId,
      reason: 'Not enough real opportunity and profile evidence to build grounded practice material.',
      modelVersion: prep.modelVersion,
    };
  }

  const answersByQuestion = new Map(prep.answers.map((answer) => [answer.questionId, answer]));
  const questions = prep.questions.flatMap((question) => {
    const answer = answersByQuestion.get(question.id);
    if (!answer || question.covers.length === 0 || answer.text.trim().length === 0) return [];
    return [{
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      grounding: {
        opportunityId,
        requirements: question.covers,
        profileFactRefs: answer.evidenceMap.map((evidence) => evidence.factRef),
      },
      suggestedAnswer: {
        framing: answer.text,
        evidence: answer.evidenceMap,
        ...(answer.honestGap ? { honestGap: answer.honestGap } : {}),
      },
    }];
  });

  if (questions.length === 0) {
    return {
      status: 'insufficient_data',
      opportunityId,
      reason: 'The guarded interview service returned no complete grounded practice questions.',
      modelVersion: prep.modelVersion,
    };
  }
  return { status: 'ready', opportunityId, questions, modelVersion: prep.modelVersion };
}