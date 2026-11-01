export interface RoleColorSettings { typingUser: boolean; userMentions: boolean; voiceUsers: boolean }
export const DEFAULTS: RoleColorSettings = { typingUser: true, userMentions: true, voiceUsers: true }

export function normalizeSettings(value: unknown): RoleColorSettings {
    const v = (value ?? {}) as Partial<RoleColorSettings>
    return {
        typingUser: typeof v.typingUser === 'boolean' ? v.typingUser : DEFAULTS.typingUser,
        userMentions: typeof v.userMentions === 'boolean' ? v.userMentions : DEFAULTS.userMentions,
        voiceUsers: typeof v.voiceUsers === 'boolean' ? v.voiceUsers : DEFAULTS.voiceUsers,
    }
}
export function readSettings(storage: any): RoleColorSettings {
    if (storage?.cache) return normalizeSettings(storage.cache)
    if (typeof storage?.get === 'function') return normalizeSettings(storage.get())
    return DEFAULTS
}
