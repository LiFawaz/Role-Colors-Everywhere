import { after, instead } from '@valenced/patcher'
import { readSettings } from './settings-store'
import { chipStyle, isRoleColor, MISSING_STYLE, STRIKE_MISSING_USERS, textStyle } from './colors'
import { report, TAG } from './lookup'

export interface Ctx {
    storage: any
    cleanup: (undo: () => void) => void
    Text: any
    members: {
        member(guildId: string, userId: string): { userId?: string; colorString?: string } | undefined
        user(userId: string): unknown
        currentUserId(): string | undefined
        isBlocked(userId: string): boolean
    }
}

type Look = { kind: 'color'; style: object } | { kind: 'missing' }

function lookFor(ctx: Ctx, guildId: string, userId: string, chip: boolean): Look | undefined {
    const member = ctx.members.member(guildId, userId)
    if (!member) {
        if (!STRIKE_MISSING_USERS) return undefined
        return ctx.members.user(userId) ? { kind: 'missing' } : undefined
    }
    if (!isRoleColor(member.colorString)) return undefined
    return { kind: 'color', style: chip ? chipStyle(member.colorString) : textStyle(member.colorString) }
}

function wrapMention(ctx: Ctx, guildId: string, userId: string, res: any): any {
    const look = lookFor(ctx, guildId, userId, true)
    if (!look) return res
    return <ctx.Text style={look.kind === 'missing' ? MISSING_STYLE : look.style}>{res}</ctx.Text>
}

export function injectMentions(ctx: Ctx, parser: any): void {
    const rule = parser?.defaultRules?.mention
    if (typeof rule?.react !== 'function') {
        report(`${TAG} mention rule not found; message mentions not colored`)
        return
    }

    // Valenced instead hooks receive (args, originalFunction); after hooks receive result only.
    ctx.cleanup(instead(rule, 'react', function (args: any[], original: (...args: any[]) => any) {
        const res = original.apply(this, args)
        if (!readSettings(ctx.storage).userMentions || res == null) return res
        const first = args[0] as { userId?: string; guildId?: string } | undefined
        if (!first?.guildId || !first.userId) return res
        return wrapMention(ctx, first.guildId, first.userId, res)
    }))
}

export function injectSlateMention(ctx: Ctx, slate: any): void {
    if (typeof slate?.UserMention !== 'function') {
        report(`${TAG} UserMention not found; composer mentions not colored`)
        return
    }
    ctx.cleanup(instead(slate, 'UserMention', function (args: any[], original: (...args: any[]) => any) {
        const res = original.apply(this, args)
        if (!readSettings(ctx.storage).userMentions || res == null) return res
        const first = args[0] as { id?: string; guildId?: string } | undefined
        if (!first?.guildId || !first.id) return res
        return wrapMention(ctx, first.guildId, first.id, res)
    }))
}

export function injectVoiceUsers(ctx: Ctx, voice: any): void {
    const proto = voice?.default?.prototype
    if (typeof proto?.renderName !== 'function') {
        report(`${TAG} voice user list not found; voice names not colored`)
        return
    }
    ctx.cleanup(instead(proto, 'renderName', function (args: any[], original: (...args: any[]) => any) {
        const res = original.apply(this, args)
        if (!readSettings(ctx.storage).voiceUsers || !res) return res
        const pending = res?._owner?.pendingProps as { guildId?: string; user?: { id?: string } } | undefined
        if (!pending?.guildId || !pending.user?.id) return res
        const look = lookFor(ctx, pending.guildId, pending.user.id, false)
        return look?.kind === 'color' ? <ctx.Text style={look.style}>{res}</ctx.Text> : res
    }))
}

// Kept isolated until a real Android typing module signature is confirmed.
export function injectTypingUsers(_ctx: Ctx, typing: any): void {
    if (!typing) {
        report(`${TAG} typing colors are disabled: no verified Valenced finder for the typing module`)
        return
    }
    if (typeof typing?.default !== 'function') {
        report(`${TAG} typing indicator export not found`)
        return
    }
    report(`${TAG} typing module was found, but its Android render tree has not been verified`)
}
