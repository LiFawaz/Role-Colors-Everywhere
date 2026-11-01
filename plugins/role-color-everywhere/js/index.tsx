import { getStore } from '@valenced/discord/flux'
import { DEFAULTS } from './settings-store'
import { SettingsComponent } from './settings'
import { report, setLogger, TAG } from './lookup'
import {
    installMessageMentionColors,
    installTypingUserColors,
    installVoiceUserColors,
} from './inject'

let fallbackUndo: Array<() => void> = []

export default plugin({
    jsonStorage: { load: true, default: DEFAULTS },

    start(api: any) {
        const log = api?.unscoped?.discord?.common?.logger
        setLogger(log ?? { warn: (message: string) => console.warn(message), info: (message: string) => console.log(message) })
        log?.info?.(`${TAG} started`)

        const cleanup: (fn: () => void) => void =
            typeof api?.cleanup === 'function'
                ? api.cleanup
                : (fn) => { fallbackUndo.push(fn) }

        const storage = api?.jsonStorage
        if (!storage) report(`${TAG} JSON storage unavailable; using default settings`)

        let memberStore: any
        let channelStore: any
        let roleStore: any
        let userStore: any
        let mentionPatchInstalled = false

        const installMentionsWhenReady = () => {
            if (mentionPatchInstalled || !memberStore || !channelStore) return
            mentionPatchInstalled = true
            installMessageMentionColors({
                memberStore,
                channelStore,
                getRoleStore: () => roleStore,
                storage,
                cleanup,
            })
            log?.info?.(`${TAG} message color patch setup completed`)
        }

        try {
            cleanup(getStore('GuildMemberStore', (store: any) => {
                memberStore = store
                log?.info?.(`${TAG} GuildMemberStore connected`)
                installMentionsWhenReady()
            }))
            cleanup(getStore('ChannelStore', (store: any) => {
                channelStore = store
                log?.info?.(`${TAG} ChannelStore connected`)
                installMentionsWhenReady()
            }))
            cleanup(getStore('GuildRoleStore', (store: any) => {
                roleStore = store
                log?.info?.(`${TAG} GuildRoleStore connected`)
            }))
            cleanup(getStore('UserStore', (store: any) => {
                userStore = store
                log?.info?.(`${TAG} UserStore connected`)
            }))

            installVoiceUserColors({
                getMemberStore: () => memberStore,
                getRoleStore: () => roleStore,
                storage,
                cleanup,
            })
            installTypingUserColors({
                getMemberStore: () => memberStore,
                getRoleStore: () => roleStore,
                getUserStore: () => userStore,
                storage,
                cleanup,
            })
        } catch (err) {
            report(`${TAG} patch setup failed`, err)
        }
    },

    stop() {
        for (const fn of fallbackUndo.splice(0)) {
            try { fn() } catch (err) { report(`${TAG} unpatch failed`, err) }
        }
    },

    SettingsComponent,
})
