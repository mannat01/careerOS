import { z } from 'zod';
import { AiSurface } from '../trust';
import type { ApiClient } from '../api/client';

/**
 * Compile-fail sentinels are deliberately outside runtime tests. `tsc --noEmit`
 * must observe a diagnostic at each line; relaxing either API makes TS2578 fail.
 */
export function fm1CompileFailSentinels(client: ApiClient): void {
  // @ts-expect-error FM1 guarantee 1: evidence and confidence are required.
  void <AiSurface>unsafe output</AiSurface>;

  // @ts-expect-error FM1 guarantee 1: evidence cannot be omitted independently.
  void <AiSurface confidence={{ value: 0.8, band: 'high', source: 'test' }}>unsafe output</AiSurface>;

  // @ts-expect-error FM1 guarantee 1: confidence cannot be omitted independently.
  void <AiSurface evidence={[]}>unsafe output</AiSurface>;

  // @ts-expect-error FM1 guarantee 2: Yellow calls require branded ApprovalToken.
  void client.postYellow('draft.send', '/v1/drafts/1/send', {}, z.unknown());

  // @ts-expect-error FM1 guarantee 2: a plain string cannot forge the brand.
  void client.postYellow('draft.send', '/v1/drafts/1/send', {}, z.unknown(), 'plain-token');
}