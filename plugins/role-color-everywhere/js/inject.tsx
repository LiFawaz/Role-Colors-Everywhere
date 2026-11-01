import { after, before, instead } from '@valenced/patcher'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { ReactNative } from '@valenced/react'
import { readSettings } from './settings-store'
import { report, TAG } from './lookup'

interface PatchContext {
    storage: any
    cleanup: (undo: () => void) => void
}

function roleColor(memberStore: any, guildId: string | undefined, userId: string | undefined): string | undefined {
    if (!guildId || !userId) return undefined
    try {
        const member = memberStore?.getMember?.(guildId, userId)
            ?? memberStore?.getTrueMember?.(guildId, userId)
        const color = member?.colorString
        return typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color) ? (color.startsWith('#') ? color : `#${color}`) : undefined
    } catch (err) {
        report(`${TAG} member color lookup failed`, err)
        return undefined
    }
}

function patchComponents(component: any, transform: (node: any) => any): any {
    if (!component || typeof component !== 'object') return component

    if (Array.isArray(component.content)) {
        component.content = component.content.map((child: any) => patchComponents(child, transform))
    }
    if (Array.isArray(component.items)) {
        component.items = component.items.map((child: any) => patchComponents(child, transform))
    }
    if (Array.isArray(component)) {
        component = component.map((child: any) => patchComponents(child, transform))
    }

    if (component.type) {
        const changed = transform(component)
        if (changed) component = changed
    }
    return component
}

function patchMessageRow(row: any, memberStore: any, channelStore: any): void {
    const message = row?.message
    if (!message) return

    const channel = channelStore?.getChannel?.(message.channelId)
    const guildId = channel?.guild_id ?? channel?.guildId ?? message.guildId
    if (!guildId) return

    const settings = readSettings(undefined)
    if (!settings.userMentions) return

    message.shouldShowRoleOnName = true
    if (message.referencedMessage?.message) {
        message.referencedMessage.message.shouldShowRoleOnName = true
    }

    const patchMention = (node: any) => {
        if (node?.type !== 'mention' || !node.userId) return undefined
        const color = roleColor(memberStore, guildId, String(node.userId))
        if (!color) return undefined
        const numeric = Number.parseInt(color.replace('#', ''), 16)
        return { ...node, roleColor: numeric, color: numeric, colorString: color }
    }

    if (Array.isArray(message.content)) {
        message.content = patchComponents({ content: message.content }, (node) => patchMention(node)).content
    }
    if (Array.isArray(message.embeds)) {
        for (const embed of message.embeds) {
            if (Array.isArray(embed?.description)) {
                embed.description = patchComponents({ content: embed.description }, (node) => patchMention(node)).content
            }
        }
    }
    const referenced = message.referencedMessage?.message
    if (Array.isArray(referenced?.content)) {
        referenced.content = patchComponents({ content: referenced.content }, (node) => patchMention(node)).content
    }
}

export function installMessageMentionColors(ctx: PatchContext & { memberStore: any; channelStore: any }): void {
    const nativeModules = ReactNative?.NativeModules as any
    const chatManager = nativeModules?.DCDChatManager ?? (globalThis as any).nativeModuleProxy?.DCDChatManager

    if (typeof chatManager?.updateRows !== 'function') {
        report(`${TAG} DCDChatManager.updateRows not found; Android message mention patch not installed`)
        return
    }

    try {
        ctx.cleanup(before(chatManager, 'updateRows', (args: any[]) => {
            try {
                if (!readSettings(ctx.storage).userMentions) return
                if (typeof args?.[1] !== 'string') return
                const rows = JSON.parse(args[1])
                if (!Array.isArray(rows)) return
                for (const row of rows) {
                    try { patchMessageRow(row, ctx.memberStore, ctx.channelStore) }
                    catch (err) { report(`${TAG} skipped one message row`, err) }
                }
                args[1] = JSON.stringify(rows)
                return args
            } catch (err) {
                report(`${TAG} could not transform Android message rows`, err)
            }
        }))
        report(`${TAG} Android message mention patch installed`)
    } catch (err) {
        report(`${TAG} failed to patch DCDChatManager.updateRows`, err)
    }
}

function findNode(root: any, predicate: (node: any) => boolean, seen = new Set<any>()): any {
    if (!root || typeof root !== 'object' || seen.has(root)) return undefined
    seen.add(root)
    if (predicate(root)) return root

    const children = root?.props?.children
    if (Array.isArray(children)) {
        for (const child of children) {
            const found = findNode(child, predicate, seen)
            if (found) return found
        }
    } else if (children && typeof children === 'object') {
        const found = findNode(children, predicate, seen)
        if (found) return found
    }
    return undefined
}

export function installVoiceUserColors(ctx: PatchContext & { getMemberStore: () => any }): void {
    let installed = false
    const unsubscribe = getModules(
        withName('VoiceUserConnected'),
        (voiceModule: any) => {
            if (installed) return
            const component = voiceModule?.default
            if (typeof component !== 'function') {
                report(`${TAG} VoiceUserConnected export has an unexpected shape`)
                return
            }
            installed = true

            try {
                ctx.cleanup(instead(voiceModule, 'default', function (args: any[], original: (...args: any[]) => any) {
                    const result = original.apply(this, args)
                    if (!readSettings(ctx.storage).voiceUsers || !result?.type) return result

                    const member = args?.[0]?.member
                    const color = roleColor(ctx.getMemberStore(), member?.guildId ?? member?.guild_id, member?.userId ?? member?.user?.id)
                        ?? member?.colorString
                    if (!color || typeof color !== 'string') return result

                    const innerComponent = result.type
                    if (innerComponent && typeof innerComponent === 'object' && typeof innerComponent.type === 'function') {
                        let unpatchInner: (() => void) | undefined
                        unpatchInner = after(innerComponent, 'type', (innerResult: any) => {
                            unpatchInner?.()
                            const nameItem = findNode(innerResult, (node) => node?.type?.name === 'VoiceUserNameItem')
                            if (nameItem?.props) {
                                nameItem.props = { ...nameItem.props, color }
                            }
                            return innerResult
                        })
                    }
                    return result
                }))
                report(`${TAG} voice participant color patch installed`)
            } catch (err) {
                report(`${TAG} failed to patch VoiceUserConnected`, err)
            }
        },
        { max: 1, returnNamespace: true },
    )
    ctx.cleanup(unsubscribe)
}
