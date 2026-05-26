/**
 * Star subscription UI removed.
 * Stubs kept so existing imports don't break during the migration.
 */

// Empty no-op components
export const StarHeroBackground = () => null;
export const StarBadge = () => null;
export const StarCard = () => null;
export const StarModal = () => null;

// Hook stub — no modal, no subscription check
export function useStarSubscription() {
  return {
    isPremium: true,
    modalOpen: false,
    setModalOpen: (_v: boolean) => {},
    openModal: () => {},
  } as const;
}
