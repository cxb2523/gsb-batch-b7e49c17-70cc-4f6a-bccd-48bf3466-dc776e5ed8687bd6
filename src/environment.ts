type ActivationAwareNavigator = Navigator & { userActivation?: { hasBeenActive: boolean } }

export const isBrowser = (): boolean => typeof window !== "undefined"

export const canObserveIntersection = (): boolean => typeof IntersectionObserver !== "undefined"

export const prefersReducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

export const hasUserActivation = (): boolean => (navigator as ActivationAwareNavigator).userActivation?.hasBeenActive ?? true
