import { getStore } from '@valenced/discord/flux'
import { DEFAULTS } from './settings-store'
import { SettingsComponent } from './settings'
import { report, setLogger, TAG } from './lookup'
import { installMessageMentionColors, installVoiceUserColors } from './inject'

let fallbackUndo: Array<() => void> = []

export default plugin({
    jsonStorage: { load: true, default: DEFAULTS },

    start(api: any) {
        const log = api?.unscoped?.discord?.common?.logger
        setLogger(log ?? { warn: (message: string) => console.warn(message) })
        log?.info?.(`${TAG} started`)

        const cleanup: (fn: () => void) => void =
            typeof api?.cleanup === 'function'
                ? api.cleanup
                : (fn) => { fallbackUndo.push(fn) }

        const storage = api?.jsonStorage
        if (!storage) report(`${TAG} JSON storage unavailable; using default settings`)

        let memberStore: any
        let channelStore: any

        const installMentionsWhenReady = () => {
            if (!memberStore || !channelStore) return
            installMessageMentionColors({
                memberStore,
                channelStore,
                storage,
                cleanup,
            })
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
            installVoiceUserColors({ getMemberStore: () => memberStore, storage, cleanup })
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
