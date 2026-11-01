import { DEFAULTS } from './settings-store'
import { SettingsComponent } from './settings'
import { byProps, report, setLogger, TAG, waitForModule } from './lookup'
import { type Ctx, injectMentions, injectSlateMention, injectTypingUsers, injectVoiceUsers } from './inject'

let fallbackUndo: Array<() => void> = []

export default plugin({
    jsonStorage: { load: true, default: DEFAULTS },

    start(api: any) {
        const { cleanup, jsonStorage, logger } = api ?? {}
        const log = logger ?? { log: (m: string) => console.log(m), warn: (m: string) => console.warn(m) }
        setLogger(log)
        log.log(`${TAG} started`)

        if (typeof cleanup !== 'function') report(`${TAG} host gave no cleanup(); stop() will undo local patches`)
        const undo: (fn: () => void) => void =
            typeof cleanup === 'function' ? cleanup : (fn) => { fallbackUndo.push(fn) }

        if (!jsonStorage || (!jsonStorage.cache && typeof jsonStorage.get !== 'function')) {
            report(`${TAG} settings are not readable, using defaults`)
        }

        attachAll(undo, jsonStorage).catch((err) => report(`${TAG} start failed`, err))
    },

    stop() {
        for (const fn of fallbackUndo.splice(0)) {
            try { fn() } catch (err) { report(`${TAG} unpatch failed`, err) }
        }
    },

    SettingsComponent,
})

async function attachAll(cleanup: (undo: () => void) => void, jsonStorage: any): Promise<void> {
    const [users, relations, reactNative, parser, slate, voice] = await Promise.all([
        waitForModule('users', byProps('getTrueMember', 'getUser')),
        waitForModule('relationships', byProps('isBlocked', 'isFriend')),
        waitForModule('React Native', byProps('Text', 'View')),
        waitForModule('message parser', byProps('defaultRules')),
        waitForModule('slate mentions', byProps('UserMention', 'ChannelMention')),
        waitForModule('voice user list', byProps('VoiceUserList', 'default')),
    ])

    if (!reactNative?.Text) {
        report(`${TAG} React Native Text not found; no names can be colored`)
        return
    }

    const ctx: Ctx = {
        storage: jsonStorage,
        cleanup,
        Text: reactNative.Text,
        members: {
            member: (guildId, userId) => {
                try { return users?.getTrueMember?.(guildId, userId) }
                catch (err) { report(`${TAG} getTrueMember failed`, err); return undefined }
            },
            user: (userId) => {
                try { return users?.getUser?.(userId) } catch { return undefined }
            },
            currentUserId: () => {
                try { return users?.getCurrentUser?.()?.id } catch { return undefined }
            },
            isBlocked: (userId) => {
                try { return Boolean(relations?.isBlocked?.(userId)) } catch { return false }
            },
        },
    }

    injectMentions(ctx, parser)
    injectSlateMention(ctx, slate)
    injectVoiceUsers(ctx, voice)

    // Valenced's published finder API does not expose the withSource filter used by the
    // original draft. Do not guess a typing module and accidentally patch an unrelated export.
    injectTypingUsers(ctx, undefined)
}
