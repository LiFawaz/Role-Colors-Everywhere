export interface RoleColorSettings {
    typingUser: boolean
    userMentions: boolean
    voiceUsers: boolean
    skipNeutralColors: boolean
}

export const DEFAULTS: RoleColorSettings = {
    typingUser: false,
    userMentions: true,
    voiceUsers: true,
    skipNeutralColors: true,
}

export function normalizeSettings(value: unknown): RoleColorSettings {
    const settings = (value ?? {}) as Partial<RoleColorSettings>
    return {
        typingUser: typeof settings.typingUser === 'boolean' ? settings.typingUser : DEFAULTS.typingUser,
        userMentions: typeof settings.userMentions === 'boolean' ? settings.userMentions : DEFAULTS.userMentions,
        voiceUsers: typeof settings.voiceUsers === 'boolean' ? settings.voiceUsers : DEFAULTS.voiceUsers,
        skipNeutralColors: typeof settings.skipNeutralColors === 'boolean' ? settings.skipNeutralColors : DEFAULTS.skipNeutralColors,
    }
}

export function readSettings(storage: any): RoleColorSettings {
    return normalizeSettings(storage?.cache ?? DEFAULTS)
}
