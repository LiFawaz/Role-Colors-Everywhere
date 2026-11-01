export interface RoleColorSettings {
    typingUser: boolean
    userMentions: boolean
    voiceUsers: boolean
}

export const DEFAULTS: RoleColorSettings = {
    typingUser: false,
    userMentions: true,
    voiceUsers: true,
}

export function normalizeSettings(value: unknown): RoleColorSettings {
    const settings = (value ?? {}) as Partial<RoleColorSettings>
    return {
        typingUser: typeof settings.typingUser === 'boolean' ? settings.typingUser : DEFAULTS.typingUser,
        userMentions: typeof settings.userMentions === 'boolean' ? settings.userMentions : DEFAULTS.userMentions,
        voiceUsers: typeof settings.voiceUsers === 'boolean' ? settings.voiceUsers : DEFAULTS.voiceUsers,
    }
}

export function readSettings(storage: any): RoleColorSettings {
    // JsonStorage.get() is asynchronous. Reading it synchronously made the old code
    // normalize a Promise and silently fall back to defaults on every render.
    return normalizeSettings(storage?.cache ?? DEFAULTS)
}
