import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createApi, createApiClient } from '@/api';
import { SESSION_COOKIE_NAME } from '@/auth';
import { loadWebEnv, loadWebServerEnv } from '@/config/env';
import { TrustKitClient, type TrustKitData } from './TrustKitClient';

/** Kept as a named export so the production guard is directly testable. */
export function isTrustKitEnabled(nodeEnv: string | undefined): boolean {
  return nodeEnv !== 'production';
}

export function assertTrustKitEnabled(): void {
  if (!isTrustKitEnabled(loadWebServerEnv().NODE_ENV)) {
    notFound();
  }
}

async function loadTrustKitData(): Promise<TrustKitData> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value ?? null;
  const api = createApi(createApiClient({
    baseUrl: loadWebEnv().NEXT_PUBLIC_API_BASE_URL,
    tokens: { getBearerToken: () => Promise.resolve(token) },
  }));
  await api.me.get();
  const [state, opportunities, audit, briefing] = await Promise.all([
    api.cieState.get(),
    api.opportunities.list(),
    api.audit.list(),
    api.briefings.latest(),
  ]);
  const seededOpportunity = opportunities.data[0];
  if (!seededOpportunity) throw new Error('The live opportunity response contained no seeded opportunity.');
  const match = await api.opportunities.match(seededOpportunity.id);
  return { state, opportunities, match, audit, briefing };
}

export default async function TrustPage(): Promise<JSX.Element> {
  // This must remain first: production cannot read auth state or fetch data.
  assertTrustKitEnabled();
  const data = await loadTrustKitData();
  return <TrustKitClient data={data} />;
}
