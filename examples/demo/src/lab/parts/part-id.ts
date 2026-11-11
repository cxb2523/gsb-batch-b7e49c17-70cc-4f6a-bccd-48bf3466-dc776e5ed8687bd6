import { useId } from "react"

export const usePartId = (prefix: string): string => `${prefix}${useId().replace(/[^\w-]/g, "")}`
