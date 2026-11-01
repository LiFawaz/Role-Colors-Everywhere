const HEX6 = /^#?[0-9a-fA-F]{6}$/

export function isRoleColor(value: unknown): value is string {
    return typeof value === 'string' && HEX6.test(value)
}
function normalize(hex: string): string { return hex.startsWith('#') ? hex : `#${hex}` }

export function hexToRgba(hex: string, alpha = 1): string | undefined {
    if (!isRoleColor(hex)) return undefined
    const clean = hex.replace('#', '')
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
export function textStyle(hex: string): { color: string } { return { color: normalize(hex) } }
export function chipStyle(hex: string): { color: string; backgroundColor: string } {
    return { color: normalize(hex), backgroundColor: hexToRgba(hex, 0.1) ?? 'transparent' }
}
export const MISSING_STYLE = { textDecorationLine: 'line-through' as const }
export const STRIKE_MISSING_USERS = true
