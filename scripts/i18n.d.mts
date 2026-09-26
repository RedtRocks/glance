export interface Place { file: string; line: number; text: string }
export function scan(root?: string): { messages: Map<string, string[]>; dynamic: Place[]; hardcoded: Place[] }
export function readCatalog(code: string): Record<string, string>
export function catalogCodes(): string[]
export const LOCALES: string
