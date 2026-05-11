import { useQuery } from '@tanstack/react-query';

export { getIsPremium } from './premium-cache';

interface SubscriptionResponse {
  premium: boolean;
}

const QUERY_KEY = ['me', 'subscription'] as const;

async function fetchSubscription(): Promise<SubscriptionResponse> {
  return { premium: true };
}

export function useSubscription(enabled: boolean) {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchSubscription,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    select: (d) => d.premium,
  });
}
