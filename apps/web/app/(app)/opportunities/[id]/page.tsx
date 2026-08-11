import { OpportunityDetailClient } from '../OpportunityDetailClient';

export default function OpportunityDetailPage({ params }: { readonly params: { readonly id: string } }): JSX.Element {
  return <OpportunityDetailClient opportunityId={params.id} />;
}
