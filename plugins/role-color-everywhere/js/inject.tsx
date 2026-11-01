import { after, before, instead } from '@valenced/patcher'
import { getModules, lookupModules } from '@valenced/modules/finders'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { createFilterGenerator, FilterScopes, withProps } from '@valenced/modules/finders/filters'
import { Design } from '@valenced/discord/design'
import { React, ReactNative } from '@valenced/react'
import { readSettings } from './settings-store'
import { report, TAG } from './lookup'

interface PatchContext {
    storage: any
    cleanup: (undo: () => void) => void
}

interface MemberContext {
    memberStore?: any
    getMemberStore?: () => any
    getRoleStore: () => any
}

function normalizeHex(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const hex = value.trim().replace(/^#/, '')
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : undefined
}

function colorFromRole(role: any): string | undefined {
    const direct = normalizeHex(role?.colorString)
        ?? normalizeHex(role?.colorStrings?.primaryColor)
        ?? normalizeHex(role?.primaryColor)
    if (direct) return direct

    const numeric = role?.color
    if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 && numeric <= 0xFFFFFF) {
        return `#${Math.trunc(numeric).toString(16).padStart(6, '0').toUpperCase()}`
    }
    return undefined
}

/** Treat grayscale and near-white / near-black role colors as neutral. */
function isNeutralColor(hex: string): boolean {
    const clean = hex.replace('#', '')
    const r = Number.parseInt(clean.slice(0, 2), 16)
    const g = Number.parseInt(clean.slice(2, 4), 16)
    const b = Number.parseInt(clean.slice(4, 6), 16)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const saturation = max === 0 ? 0 : (max - min) / max
    const lightness = (max + min) / 510

    // Skip grays at any brightness, plus strongly dark or nearly white colors.
    return saturation < 0.16 || lightness <= 0.075 || lightness >= 0.93
}

function getMemberRecord(memberStore: any, guildId: string, userId: string): any {
    try {
        return memberStore?.getMember?.(guildId, userId)
            ?? memberStore?.getTrueMember?.(guildId, userId)
            ?? undefined
    } catch (err) {
        report(`${TAG} member lookup failed`, err)
        return undefined
    }
}

function getAssignedRoles(member: any, roleStore: any, guildId: string): any[] {
    const rawRoles = Array.isArray(member?.roles)
        ? member.roles
        : Array.isArray(member?.roleIds)
            ? member.roleIds
            : []
    const memberRoleIds = rawRoles
        .map((role: any) => typeof role === 'string' ? role : role?.id)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0)

    if (!memberRoleIds.length) return []

    const assigned = new Set(memberRoleIds)
    const rolesById = new Map<string, any>()

    // Some Discord builds provide role objects directly on the member.
    for (const role of rawRoles) {
        if (role && typeof role === 'object' && role.id && assigned.has(String(role.id))) {
            rolesById.set(String(role.id), role)
        }
    }

    for (const roleId of memberRoleIds) {
        try {
            const role = roleStore?.getRole?.(guildId, roleId)
            // Never accept a role lookup result unless it is the exact assigned role requested.
            if (role?.id && String(role.id) === roleId) rolesById.set(roleId, role)
        } catch {
            // Fall back to the sorted role list below.
        }
    }

    let sortedGuildRoles: any[] = []
    try {
        const result = roleStore?.getSortedRoles?.(guildId)
        if (Array.isArray(result)) sortedGuildRoles = result
    } catch {
        // A member's explicit role IDs are still usable if sorted roles are unavailable.
    }

    for (const role of sortedGuildRoles) {
        const id = role?.id == null ? undefined : String(role.id)
        if (id && assigned.has(id) && !rolesById.has(id)) rolesById.set(id, role)
    }

    const ordered = [...rolesById.values()]
    const sortedIndex = new Map(sortedGuildRoles.map((role, index) => [String(role?.id), index]))
    ordered.sort((a, b) => {
        const aPosition = Number(a?.position)
        const bPosition = Number(b?.position)
        if (Number.isFinite(aPosition) && Number.isFinite(bPosition) && aPosition !== bPosition) {
            return bPosition - aPosition
        }
        return (sortedIndex.get(String(a?.id)) ?? 0) - (sortedIndex.get(String(b?.id)) ?? 0)
    })
    return ordered
}

/**
 * Pick the highest role that has a usable color. With neutral-color skipping enabled,
 * white, black and gray roles are ignored and the next highest colored role is used.
 */
function roleColor(
    ctx: MemberContext,
    guildId: string | undefined,
    userId: string | undefined,
    skipNeutralColors: boolean,
    fallbackMember?: any,
): string | undefined {
    const memberStore = ctx.getMemberStore?.() ?? ctx.memberStore
    const cachedMember = guildId && userId ? getMemberRecord(memberStore, guildId, userId) : undefined
    // Prefer the live member supplied by the voice row. Cached GuildMemberStore records can be stale.
    const members = [fallbackMember, cachedMember].filter(
        (member, index, all) => member && all.indexOf(member) === index,
    )
    if (!members.length) return undefined

    // Discord already resolves this field to the member's displayed role color.
    // Use it before reconstructing role order, which can vary across client builds.
    for (const member of members) {
        const resolved = normalizeHex(member.colorString) ?? normalizeHex(member.user?.colorString)
        if (resolved && (!skipNeutralColors || !isNeutralColor(resolved))) return resolved
    }

    for (const member of members) {
        const roles = guildId ? getAssignedRoles(member, ctx.getRoleStore(), guildId) : []
        for (const role of roles) {
            const color = colorFromRole(role)
            if (!color) continue
            if (skipNeutralColors && isNeutralColor(color)) continue
            return color
        }
    }
    return undefined
}

/**
 * VoiceUserNameItem can receive a member prop whose colorString is only a default
 * presentation value. The member store is the same authoritative source used by
 * the working mention patch, so always prefer that record for voice names.
 */
function voiceRoleColor(
    ctx: MemberContext,
    guildId: string,
    userId: string,
    skipNeutralColors: boolean,
    fallbackMember?: any,
): string | undefined {
    const memberStore = ctx.getMemberStore?.() ?? ctx.memberStore
    const cachedMember = getMemberRecord(memberStore, guildId, userId)
    const member = cachedMember ?? fallbackMember
    if (!member) return undefined

    const resolved = normalizeHex(member.colorStrings?.primaryColor)
        ?? normalizeHex(member.colorString)
    if (resolved && (!skipNeutralColors || !isNeutralColor(resolved))) return resolved

    // Only use assigned roles when the member's resolved color is absent or neutral.
    const roles = getAssignedRoles(member, ctx.getRoleStore(), guildId)
    for (const role of roles) {
        const color = normalizeHex(role?.colorStrings?.primaryColor) ?? colorFromRole(role)
        if (!color) continue
        if (skipNeutralColors && isNeutralColor(color)) continue
        return color
    }

    // Do not trust the voice component's user.colorString fallback: it can be the
    // app's default text color rather than a color granted by a guild role.
    return undefined
}

function patchComponents(component: any, transform: (node: any) => any): any {
    if (Array.isArray(component)) return component.map((child) => patchComponents(child, transform))
    if (!component || typeof component !== 'object') return component

    let next = component
    if (Array.isArray(component.content)) {
        next = { ...next, content: component.content.map((child: any) => patchComponents(child, transform)) }
    }
    if (Array.isArray(component.items)) {
        next = { ...next, items: component.items.map((child: any) => patchComponents(child, transform)) }
    }

    if (next.type) return transform(next) ?? next
    return next
}

function patchMessageRow(row: any, ctx: PatchContext & MemberContext): void {
    const message = row?.message
    if (!message) return

    const settings = readSettings(ctx.storage)
    if (!settings.userMentions) return

    const channel = ctx.channelStore?.getChannel?.(message.channelId)
    const guildId = channel?.guild_id ?? channel?.guildId ?? message.guildId
    if (!guildId) return

    message.shouldShowRoleOnName = true
    if (message.referencedMessage?.message) {
        message.referencedMessage.message.shouldShowRoleOnName = true
    }

    const patchMention = (node: any) => {
        if (node?.type !== 'mention' || !node.userId) return undefined
        const color = roleColor(ctx, String(guildId), String(node.userId), settings.skipNeutralColors)
        if (!color) return undefined
        const numeric = Number.parseInt(color.slice(1), 16)
        return { ...node, roleColor: numeric, color: numeric, colorString: color }
    }

    if (message.content !== undefined) {
        message.content = patchComponents(message.content, patchMention)
    }
    if (Array.isArray(message.embeds)) {
        for (const embed of message.embeds) {
            if (embed?.description !== undefined) {
                embed.description = patchComponents(embed.description, patchMention)
            }
        }
    }
    const referenced = message.referencedMessage?.message
    if (referenced?.content !== undefined) {
        referenced.content = patchComponents(referenced.content, patchMention)
    }
}

function isNativeUpdateRows(target: any): boolean {
    try {
        return typeof target?.updateRows === 'function' && target.updateRows.toString().includes('[native code]')
    } catch {
        return false
    }
}

// Unlike withProps('updateRows'), this checks both the module namespace and its default export.
// Some Android native bridge modules expose updateRows only on exports.default.
const nativeUpdateRowsFilter = createFilterGenerator(
    (_args: [], _id: number, exports: any) =>
        isNativeUpdateRows(exports) || isNativeUpdateRows(exports?.default),
    () => 'role-color-everywhere.native-updateRows',
    FilterScopes.Initialized,
)()

export function installMessageMentionColors(ctx: PatchContext & MemberContext & { channelStore: any }): void {
    const installed = new WeakSet<object>()

    const patchTarget = (target: any, label: string) => {
        if (!target || typeof target !== 'object' || installed.has(target) || !isNativeUpdateRows(target)) return false
        installed.add(target)
        try {
            ctx.cleanup(before(target, 'updateRows', (args: any[]) => {
                // Valenced before hooks must always return the original argument list.
                if (!Array.isArray(args)) return args

                try {
                    if (!readSettings(ctx.storage).userMentions) return args

                    const payload = args[1]
                    if (payload && typeof payload === 'object' && Array.isArray(payload.rows)) {
                        // Current Discord/Valenced builds pass updateRows(ref, { rows }).
                        for (const row of payload.rows) {
                            try {
                                patchMessageRow(row, ctx)
                            } catch (err) {
                                report(`${TAG} skipped one message row`, err)
                            }
                        }
                    } else if (typeof payload === 'string') {
                        // Keep compatibility with older builds that serialize rows as JSON.
                        const rows = JSON.parse(payload)
                        if (!Array.isArray(rows)) return args

                        for (const row of rows) {
                            try {
                                patchMessageRow(row, ctx)
                            } catch (err) {
                                report(`${TAG} skipped one message row`, err)
                            }
                        }
                        args[1] = JSON.stringify(rows)
                    }
                } catch (err) {
                    report(`${TAG} could not transform Android message rows`, err)
                }

                return args
            }))
            report(`${TAG} Android updateRows patch installed (${label})`)
            return true
        } catch (err) {
            report(`${TAG} failed to patch updateRows (${label})`, err)
            return false
        }
    }

    const targetFromExports = (exports: any) => {
        if (isNativeUpdateRows(exports)) return exports
        if (isNativeUpdateRows(exports?.default)) return exports.default
        return undefined
    }

    // Some Discord builds expose the native bridge directly.
    const nativeModules = ReactNative?.NativeModules as any
    const directTarget = nativeModules?.DCDChatManager
    if (patchTarget(directTarget, 'NativeModules.DCDChatManager')) return

    // Search every currently initialized Metro module, checking both exports and default exports.
    // This mirrors the working Android native-bridge lookup used by the upstream implementation.
    for (const [exports] of lookupModules(nativeUpdateRowsFilter, { returnNamespace: true })) {
        const target = targetFromExports(exports)
        if (patchTarget(target, 'initialized Metro native updateRows')) return
    }

    // If the native bridge has not initialized yet, subscribe for its first initialization.
    let unsubscribe: (() => void) | undefined
    unsubscribe = getModules(
        nativeUpdateRowsFilter,
        (exports: any) => {
            const target = targetFromExports(exports)
            if (patchTarget(target, 'late Metro native updateRows')) unsubscribe?.()
        },
        { max: 1, returnNamespace: true },
    )
    ctx.cleanup(unsubscribe)
}

const VOICE_USER_NAME_ITEM_PATH = 'modules/guild_sidebar/native/VoiceUserNameItem.tsx'

/**
 * Patch Discord's exact voice-name component instead of its parent row.
 * VoiceUserNameItem receives { guildId, user, member } and returns a Text
 * element as its first child. Apply the role hex through React Native's style
 * prop so Discord's semantic color resolver cannot turn it into black.
 */
export function installVoiceUserColors(ctx: PatchContext & MemberContext): void {
    let unsubscribe: (() => void) | undefined

    try {
        unsubscribe = getModuleWithImportedPath<any>(
            VOICE_USER_NAME_ITEM_PATH,
            (voiceModule: any) => {
                const component = voiceModule?.default
                const target = typeof component === 'function'
                    ? { parent: voiceModule, key: 'default' }
                    : component && typeof component.type === 'function'
                        ? { parent: component, key: 'type' }
                        : component && typeof component.render === 'function'
                            ? { parent: component, key: 'render' }
                            : undefined

                if (!target) {
                    report(`${TAG} found VoiceUserNameItem module, but its default export was not patchable`)
                    return
                }

                try {
                    const unpatch = instead(
                        target.parent,
                        target.key,
                        function (args: any[], original: (...args: any[]) => any) {
                            const result = original.apply(this, args)

                            try {
                                const settings = readSettings(ctx.storage)
                                if (!settings.voiceUsers || !result?.props) return result

                                const props = args?.[0] ?? {}
                                const guildId = props.guildId ?? props.guild_id
                                const userId = props.user?.id ?? props.userId ?? props.user_id
                                if (guildId == null || userId == null) return result

                                const color = voiceRoleColor(
                                    ctx,
                                    String(guildId),
                                    String(userId),
                                    settings.skipNeutralColors,
                                    props.member,
                                )
                                if (!color) return result

                                const children = result.props.children
                                if (!Array.isArray(children) || !children.length) return result

                                const nameElement = children[0]
                                if (!nameElement?.props || typeof React?.cloneElement !== 'function') {
                                    return result
                                }

                                // The first child is Discord's design Text element containing the name.
                                // style is forwarded to React Native Text and reliably accepts raw hex values.
                                const coloredName = React.cloneElement(nameElement, {
                                    style: [nameElement.props.style, { color }],
                                })
                                return React.cloneElement(result, {
                                    children: [coloredName, ...children.slice(1)],
                                })
                            } catch (err) {
                                report(`${TAG} could not color a voice participant name`, err)
                                return result
                            }
                        },
                    )

                    ctx.cleanup(unpatch)
                    report(`${TAG} patched VoiceUserNameItem.default`)
                } catch (err) {
                    report(`${TAG} failed to patch VoiceUserNameItem.default`, err)
                }
            },
        )

        if (unsubscribe) ctx.cleanup(unsubscribe)
    } catch (err) {
        report(`${TAG} could not locate Discord's VoiceUserNameItem module`, err)
    }
}


interface TypingColorContext extends PatchContext, MemberContext {}

interface TypingNameRendererProps {
    original: (properties: any) => any
    originalProps: any
    context: TypingColorContext
}

/**
 * Discord's native typing line is not one plain string. The username is a
 * separate Design.Text child, while separators and "is typing..." are sibling
 * text children. Color only those username elements, in Discord's own user order.
 */
function colorTypingTextTree(
    node: any,
    context: TypingColorContext,
    guildId: string,
    typingUserIds: string[],
    settings: ReturnType<typeof readSettings>,
    depth = 0,
): any {
    if (depth > 16 || node == null) return node

    if (Array.isArray(node)) {
        let changed = false
        const next = node.map((child) => {
            const patched = colorTypingTextTree(
                child, context, guildId, typingUserIds, settings, depth + 1,
            )
            if (patched !== child) changed = true
            return patched
        })
        return changed ? next : node
    }

    if (typeof React?.isValidElement !== 'function' || !React.isValidElement(node)) {
        return node
    }

    // Discord renders each active username as an element child of this Text.
    // Plain string children (commas, spaces, and "is typing...") are not changed.
    if (node.type === Design?.Text && Array.isArray(node.props?.children)) {
        let userIndex = 0
        let changed = false
        const children = node.props.children.map((child: any) => {
            if (!React.isValidElement(child)) return child

            const userId = typingUserIds[userIndex++]
            if (!userId) return child

            const member = getMemberRecord(
                context.getMemberStore?.() ?? context.memberStore,
                guildId,
                String(userId),
            )
            const color = roleColor(
                context,
                guildId,
                String(userId),
                settings.skipNeutralColors,
                member,
            )
            if (!color) return child

            changed = true
            return React.cloneElement(child, {
                style: [child.props?.style, { color }],
            })
        })

        if (changed) return React.cloneElement(node, { children })
    }

    const oldChildren = node.props?.children
    const newChildren = colorTypingTextTree(
        oldChildren, context, guildId, typingUserIds, settings, depth + 1,
    )
    return newChildren === oldChildren
        ? node
        : React.cloneElement(node, { children: newChildren })
}

/**
 * Apply a role color to every Design.Text node in a rendered typing-user
 * subtree. This helper is intentionally local to the typing patch and leaves
 * non-text nodes and their children intact.
 */
function colorDesignTextNodes(node: any, color: string, depth = 0): any {
    if (depth > 20 || node == null) return node

    if (Array.isArray(node)) {
        let changed = false
        const next = node.map(child => {
            const patched = colorDesignTextNodes(child, color, depth + 1)
            if (patched !== child) changed = true
            return patched
        })
        return changed ? next : node
    }

    if (typeof React?.isValidElement !== 'function' || !React.isValidElement(node)) {
        return node
    }

    const oldChildren = node.props?.children
    const newChildren = colorDesignTextNodes(oldChildren, color, depth + 1)
    const isDesignText = node.type === Design?.Text
    const style = isDesignText
        ? [node.props?.style, { color }]
        : node.props?.style

    if (isDesignText) {
        return React.cloneElement(node, {
            style,
            ...(newChildren !== oldChildren ? { children: newChildren } : {}),
        })
    }

    return newChildren === oldChildren
        ? node
        : React.cloneElement(node, { children: newChildren })
}

interface BetterTypingRenderContext {
    channel: any
    typingUserIds: string[]
}

interface CustomTypingTextContext extends BetterTypingRenderContext {
    username: string
}

const betterTypingWrappers = new WeakMap<object, Map<string, any>>()
const CUSTOM_TYPING_CONTEXT_PROP = '__roleColorTypingContext'

function findCustomTypingUserId(
    context: TypingColorContext,
    typing: CustomTypingTextContext,
): string | undefined {
    const guildId = typing.channel?.guild_id ?? typing.channel?.guildId
    if (!guildId || !typing.username) return undefined

    const expected = typing.username.trim().toLocaleLowerCase()
    for (const rawId of typing.typingUserIds) {
        const userId = String(rawId)
        const member = getMemberRecord(
            context.getMemberStore?.() ?? context.memberStore,
            String(guildId),
            userId,
        )
        const possibleNames = [
            member?.nick,
            member?.nickname,
            member?.displayName,
            member?.username,
            member?.user?.globalName,
            member?.user?.global_name,
            member?.user?.displayName,
            member?.user?.username,
        ]
        if (possibleNames.some(name =>
            typeof name === 'string' && name.trim().toLocaleLowerCase() === expected
        )) return userId
    }

    // A one-person typing row is unambiguous even when the member cache has
    // not populated the display name yet.
    return typing.typingUserIds.length === 1
        ? String(typing.typingUserIds[0])
        : undefined
}

/**
 * Some Discord custom typing indicators put "Name is typing..." in one
 * Design.Text string instead of rendering Name as a separate child element.
 * Split only the username into a nested Text with its role color.
 */
function colorCustomTypingTextTree(
    node: any,
    context: TypingColorContext,
    typing: CustomTypingTextContext,
    depth = 0,
): any {
    if (depth > 20 || node == null) return node
    if (Array.isArray(node)) {
        let changed = false
        const next = node.map(child => {
            const patched = colorCustomTypingTextTree(child, context, typing, depth + 1)
            if (patched !== child) changed = true
            return patched
        })
        return changed ? next : node
    }
    if (!React?.isValidElement?.(node)) return node

    const children = node.props?.children
    if (node.type === Design?.Text && typeof children === 'string') {
        const index = children.indexOf(typing.username)
        if (index >= 0) {
            const userId = findCustomTypingUserId(context, typing)
            const guildId = typing.channel?.guild_id ?? typing.channel?.guildId
            const settings = readSettings(context.storage)
            const color = userId && guildId
                ? roleColor(context, String(guildId), userId, settings.skipNeutralColors)
                : undefined
            if (color) {
                const coloredName = React.createElement(
                    Design.Text,
                    { style: [node.props?.style, { color }] },
                    typing.username,
                )
                const parts = [
                    children.slice(0, index),
                    coloredName,
                    children.slice(index + typing.username.length),
                ].filter(part => part !== '')
                return React.cloneElement(node, { children: parts })
            }
        }
    }

    const nextChildren = colorCustomTypingTextTree(children, context, typing, depth + 1)
    return nextChildren === children
        ? node
        : React.cloneElement(node, { children: nextChildren })
}

/**
 * Better Typing Indicators may replace native text with TypingText/TypingUser,
 * or wrap Discord's custom indicator component. Handle each at render time so
 * the actual name gets colored after the other plugin has transformed the tree.
 */
function wrapBetterTypingTree(
    node: any,
    context: TypingColorContext,
    depth = 0,
    typingContext?: BetterTypingRenderContext,
): any {
    if (depth > 20 || node == null) return node
    if (Array.isArray(node)) {
        let changed = false
        const next = node.map(child => {
            const patched = wrapBetterTypingTree(child, context, depth + 1, typingContext)
            if (patched !== child) changed = true
            return patched
        })
        return changed ? next : node
    }
    if (!React?.isValidElement?.(node) || typeof node.type !== 'function') {
        if (React?.isValidElement?.(node)) {
            const oldChildren = node.props?.children
            const newChildren = wrapBetterTypingTree(oldChildren, context, depth + 1, typingContext)
            return newChildren === oldChildren ? node : React.cloneElement(node, { children: newChildren })
        }
        return node
    }

    const props = node.props ?? {}
    const isBetterTypingText =
        React?.isValidElement?.(props.text) &&
        Array.isArray(props.typingUserIds) &&
        props.channel

    const isBetterTypingUser =
        props.user?.id != null &&
        props.channel &&
        typeof props.renderName === 'function' &&
        props.settings

    // This matches Better Typing Indicators' CustomTypingIndicator wrapper
    // (config + username) and native Discord variants with the same props.
    const isCustomTypingIndicator =
        'config' in props &&
        typeof props.username === 'string'

    if (isBetterTypingText || isBetterTypingUser || isCustomTypingIndicator) {
        const Original = node.type
        const wrapperKind = isBetterTypingText
            ? 'text'
            : isBetterTypingUser
                ? 'user'
                : 'custom'
        let wrappers = betterTypingWrappers.get(Original)
        if (!wrappers) {
            wrappers = new Map<string, any>()
            betterTypingWrappers.set(Original, wrappers)
        }

        let Wrapped = wrappers.get(wrapperKind)
        if (!Wrapped) {
            if (wrapperKind === 'text') {
                Wrapped = function RoleColorTypingTextWrapper(originalProps: any) {
                    return wrapBetterTypingTree(Original(originalProps), context)
                }
            } else if (wrapperKind === 'user') {
                Wrapped = function RoleColorTypingUserWrapper(originalProps: any) {
                    const result = Original(originalProps)
                    const channel = originalProps?.channel
                    const userId = originalProps?.user?.id
                    const guildId = channel?.guild_id ?? channel?.guildId
                    const settings = readSettings(context.storage)
                    if (!guildId || !userId || !settings.typingIndicatorNames) return result

                    const color = roleColor(
                        context,
                        String(guildId),
                        String(userId),
                        settings.skipNeutralColors,
                    )
                    return color ? colorDesignTextNodes(result, color) : result
                }
            } else {
                Wrapped = function RoleColorCustomTypingIndicatorWrapper(originalProps: any) {
                    const suppliedContext = originalProps?.[CUSTOM_TYPING_CONTEXT_PROP]
                    const cleanProps = { ...originalProps }
                    delete cleanProps[CUSTOM_TYPING_CONTEXT_PROP]
                    const result = Original(cleanProps)
                    const username = cleanProps?.username
                    const channel = cleanProps?.channel ?? suppliedContext?.channel
                    const typingUserIds = Array.isArray(cleanProps?.typingUserIds)
                        ? cleanProps.typingUserIds.map((id: any) => String(id))
                        : (suppliedContext?.typingUserIds ?? []).map((id: any) => String(id))
                    const settings = readSettings(context.storage)
                    if (
                        !settings.typingIndicatorNames ||
                        typeof username !== 'string' ||
                        !channel ||
                        typingUserIds.length === 0
                    ) return result

                    const customContext: CustomTypingTextContext = {
                        username,
                        channel,
                        typingUserIds,
                    }
                    // Handle BTI's transformed TypingText nodes and native text-only output.
                    const transformed = wrapBetterTypingTree(result, context, 0, customContext)
                    return colorCustomTypingTextTree(transformed, context, customContext)
                }
            }
            wrappers.set(wrapperKind, Wrapped)
        }

        let renderProps = props
        if (wrapperKind === 'text' && (typingContext as CustomTypingTextContext | undefined)?.username) {
            const custom = typingContext as CustomTypingTextContext
            const coloredText = colorCustomTypingTextTree(props.text, context, custom)
            if (coloredText !== props.text) renderProps = { ...props, text: coloredText }
        } else if (wrapperKind === 'custom') {
            renderProps = {
                ...props,
                [CUSTOM_TYPING_CONTEXT_PROP]: {
                    channel: props.channel ?? typingContext?.channel,
                    typingUserIds: Array.isArray(props.typingUserIds)
                        ? props.typingUserIds.map((id: any) => String(id))
                        : (typingContext?.typingUserIds ?? []).map(id => String(id)),
                },
            }
        }

        return React.createElement(Wrapped, {
            ...renderProps,
            key: node.key ?? undefined,
        })
    }

    const oldChildren = props.children
    const newChildren = wrapBetterTypingTree(oldChildren, context, depth + 1, typingContext)
    return newChildren === oldChildren ? node : React.cloneElement(node, { children: newChildren })
}
function TypingNameRenderer({
    original,
    originalProps,
    context,
}: TypingNameRendererProps) {
    const result = original(originalProps)
    const settings = readSettings(context.storage)
    if (!settings.typingIndicatorNames) return result

    const channel = originalProps?.channel
    const guildId = channel?.guild_id ?? channel?.guildId ?? channel?.getGuildId?.()
    const rawIds = originalProps?.typingUserIds
    if (!guildId || !Array.isArray(rawIds) || rawIds.length === 0) return result

    // First handle Better Typing Indicators' transformed TypingText/TypingUser
    // components, then fall back to Discord's original Design.Text tree.
    const wrapped = wrapBetterTypingTree(result, context, 0, {
        channel,
        typingUserIds: rawIds.map((id: any) => String(id)),
    })
    return colorTypingTextTree(
        wrapped,
        context,
        String(guildId),
        rawIds.map((id: any) => String(id)),
        settings,
    )
}

/**
 * Use the same native TypingIndicator module signature used by Better Typing
 * Indicators. Its renderItem supplies the exact channel and typingUserIds for
 * this row, so no selected-channel guessing or display-name text matching is
 * needed. Wrapping the returned inner component preserves all of its props.
 */
export function installTypingUserColors(context: TypingColorContext): void {
    const filter = withProps<{
        default: { type?: (...args: any[]) => any }
        useTypingUserIdsForDisplay: unknown
    }>('useTypingUserIdsForDisplay')

    const installed = new WeakSet<object>()
    const unsubscribe = getModules(
        filter,
        (typingModule: any) => {
            const component = typingModule?.default
            if (!component || (typeof component !== 'object' && typeof component !== 'function') || installed.has(component)) {
                return
            }

            const target = typeof component?.type === 'function'
                ? { parent: component, key: 'type' }
                : typeof component?.render === 'function'
                    ? { parent: component, key: 'render' }
                    : typeof component === 'function'
                        ? { parent: typingModule, key: 'default' }
                        : undefined
            if (!target) return

            installed.add(component)
            try {
                const unpatch = after(target.parent, target.key, (tree: any) => {
                    const renderItem = tree?.props?.renderItem
                    if (typeof renderItem !== 'function') return tree

                    return React.cloneElement(tree, {
                        renderItem: (...args: any[]) => {
                            const item = renderItem(...args)
                            if (
                                !React?.isValidElement?.(item) ||
                                typeof item.type !== 'function'
                            ) return item

                            return React.createElement(TypingNameRenderer, {
                                key: item.key ?? undefined,
                                original: item.type,
                                originalProps: item.props ?? {},
                                context,
                            })
                        },
                    })
                })

                context.cleanup(unpatch)
                report(TAG + ' patched native TypingIndicator username elements')
            } catch (err) {
                report(TAG + ' failed to patch native TypingIndicator', err)
            }
        },
        { max: 1 },
    )

    context.cleanup(unsubscribe)
}
