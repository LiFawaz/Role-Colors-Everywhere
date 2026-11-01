import { after, before, instead } from '@valenced/patcher'
import { getModules, lookupModules } from '@valenced/modules/finders'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { createFilterGenerator, FilterScopes } from '@valenced/modules/finders/filters'
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


const TYPING_INDICATOR_PATH = 'modules/chat/native/TypingIndicator.tsx'
const NICKNAME_UTILS_PATH = 'utils/NicknameUtils.tsx'

interface TypingColorContext extends PatchContext, MemberContext {
    getUserStore: () => any
    getTypingStore: () => any
    getSelectedChannelStore: () => any
    getChannelStore: () => any
    getRelationshipStore: () => any
}

interface TypingNameRendererProps {
    original: (properties: any) => any
    context: TypingColorContext
    getNicknameUtils: () => any
    [key: string]: any
}

interface ColoredTypingChunk {
    text: string
    color?: string
}

function isNameCharacter(value: string | undefined): boolean {
    return Boolean(value && /[A-Za-z0-9_À-ɏ̀-ͯ؀-ۿً-ٟ]/.test(value))
}

/** Split the localized typing line while preserving every separator and word. */
function splitTypingLine(
    text: string,
    nameColors: Map<string, string>,
): ColoredTypingChunk[] | undefined {
    const names = [...nameColors.keys()].sort((a, b) => b.length - a.length)
    if (!names.length) return undefined

    const chunks: ColoredTypingChunk[] = []
    let scanFrom = 0
    let outputFrom = 0

    while (scanFrom < text.length) {
        let matchedName: string | undefined
        for (const name of names) {
            if (!text.startsWith(name, scanFrom)) continue

            const before = scanFrom > 0 ? text[scanFrom - 1] : undefined
            const after = text[scanFrom + name.length]
            if (isNameCharacter(before) || isNameCharacter(after)) continue

            matchedName = name
            break
        }

        if (!matchedName) {
            scanFrom++
            continue
        }

        if (scanFrom > outputFrom) {
            chunks.push({ text: text.slice(outputFrom, scanFrom) })
        }
        chunks.push({
            text: matchedName,
            color: nameColors.get(matchedName),
        })
        scanFrom += matchedName.length
        outputFrom = scanFrom
    }

    if (outputFrom === 0) return undefined
    if (outputFrom < text.length) chunks.push({ text: text.slice(outputFrom) })
    return chunks
}

/** Apply role colors to the actual Text nodes used by TypingIndicator. */
function paintTypingTextTree(
    node: any,
    nameColors: Map<string, string>,
    textComponent: any,
    depth = 0,
): any {
    if (depth > 12 || node == null) return node
    if (Array.isArray(node)) {
        const next = node.map(child =>
            paintTypingTextTree(child, nameColors, textComponent, depth + 1),
        )
        return next.some((child, index) => child !== node[index]) ? next : node
    }
    if (typeof React?.isValidElement !== 'function' || !React.isValidElement(node)) {
        return node
    }

    const children = node.props?.children
    if (typeof children === 'string') {
        const chunks = splitTypingLine(children, nameColors)
        if (!chunks) return node

        const coloredChildren = chunks.map((chunk, index) =>
            chunk.color
                ? React.createElement(
                    textComponent,
                    {
                        key: 'role-typing-' + index,
                        style: { color: chunk.color },
                    },
                    chunk.text,
                )
                : chunk.text,
        )
        return React.cloneElement(node, { children: coloredChildren })
    }

    const nextChildren = paintTypingTextTree(
        children,
        nameColors,
        textComponent,
        depth + 1,
    )
    return nextChildren === children
        ? node
        : React.cloneElement(node, { children: nextChildren })
}

function getTypingNameColors(
    context: TypingColorContext,
    nicknameUtils: any,
): Map<string, string> {
    const nameColors = new Map<string, string>()
    const settings = readSettings(context.storage)
    if (!settings.typingIndicatorNames) return nameColors

    try {
        const selectedStore = context.getSelectedChannelStore()
        const channelId =
            selectedStore?.getCurrentlySelectedChannelId?.() ??
            selectedStore?.getChannelId?.() ??
            selectedStore?.getLastSelectedChannelId?.()
        if (!channelId) return nameColors

        const channel = context.getChannelStore()?.getChannel?.(String(channelId))
        const guildId =
            channel?.guild_id ??
            channel?.guildId ??
            channel?.getGuildId?.()
        if (!guildId) return nameColors

        const typingUsers = context.getTypingStore()?.getTypingUsers?.(String(channelId)) ?? {}
        const userStore = context.getUserStore()
        const memberStore = context.getMemberStore?.() ?? context.memberStore
        const relationshipStore = context.getRelationshipStore()
        const ambiguousNames = new Set<string>()
        const nameOwners = new Map<string, string>()

        const addName = (value: unknown, userId: string, color: string) => {
            if (typeof value !== 'string') return
            const name = value.trim()
            if (!name || ambiguousNames.has(name)) return

            const owner = nameOwners.get(name)
            if (owner && owner !== userId) {
                nameColors.delete(name)
                nameOwners.delete(name)
                ambiguousNames.add(name)
                return
            }
            if (!owner) {
                nameOwners.set(name, userId)
                nameColors.set(name, color)
            }
        }

        // The mobile indicator displays at most a small set of active typists.
        for (const userId of Object.keys(typingUsers).slice(0, 8)) {
            const user = userStore?.getUser?.(userId)
            if (!user) continue

            const member = getMemberRecord(memberStore, String(guildId), userId)
            const color = roleColor(
                context,
                String(guildId),
                userId,
                settings.skipNeutralColors,
                member,
            )
            if (!color) continue

            let resolvedName: unknown
            try {
                resolvedName = nicknameUtils?.getName?.(
                    String(guildId),
                    String(channelId),
                    user,
                )
            } catch {
                resolvedName = undefined
            }

            // Include Discord's resolved nickname and common fallbacks. Duplicate
            // display names are omitted rather than coloring the wrong account.
            addName(resolvedName, userId, color)
            addName(memberStore?.getNick?.(String(guildId), userId), userId, color)
            addName(member?.nick ?? member?.nickname, userId, color)
            addName(relationshipStore?.getNickname?.(userId), userId, color)
            addName(user.globalName ?? user.global_name, userId, color)
            addName(user.username, userId, color)
        }
    } catch (err) {
        report(TAG + ' could not resolve users in the typing indicator', err)
    }

    return nameColors
}

function TypingNameRenderer({
    original,
    context,
    getNicknameUtils,
    ...properties
}: TypingNameRendererProps) {
    // Keep Discord's original component props (especially channel and typingUserIds)
    // on this wrapper so other typing-indicator plugins can safely inspect them.
    const result = original(properties)
    const nameColors = getTypingNameColors(context, getNicknameUtils())
    const TextComponent = (ReactNative as any)?.Text
    if (!TextComponent || nameColors.size === 0) return result

    return paintTypingTextTree(result, nameColors, TextComponent)
}

/**
 * Patch Discord's native TypingIndicator renderItem. This is the component that
 * builds the visible typing line; useTypingText alone only supplies its text.
 */
export function installTypingUserColors(context: TypingColorContext): void {
    let nicknameUtils: any

    const stopNicknames = getModuleWithImportedPath<any>(
        NICKNAME_UTILS_PATH,
        (module: any) => {
            nicknameUtils = module?.default ?? module
            report(TAG + ' connected mobile nickname resolver')
        },
    )

    const stopTypingIndicator = getModuleWithImportedPath<any>(
        TYPING_INDICATOR_PATH,
        (typingModule: any) => {
            const holder = typingModule?.default as
                | { type?: (...args: any[]) => any }
                | undefined
            if (typeof holder?.type !== 'function') {
                report(TAG + ' found TypingIndicator module, but its default type was not patchable')
                return
            }

            try {
                const target = holder as { type: (...args: any[]) => any }
                const unpatch = after(target, 'type', (result: any) => {
                    const originalRenderItem = result?.props?.renderItem
                    if (typeof originalRenderItem !== 'function') return result

                    return React.cloneElement(result, {
                        renderItem: (...args: any[]) => {
                            const item = originalRenderItem(...args)
                            if (typeof item?.type !== 'function') return item

                            return React.createElement(TypingNameRenderer, {
                                ...item.props,
                                key: item.key ?? undefined,
                                original: item.type,
                                context,
                                getNicknameUtils: () => nicknameUtils,
                            })
                        },
                    })
                })

                context.cleanup(unpatch)
                report(TAG + ' patched native TypingIndicator renderItem')
            } catch (err) {
                report(TAG + ' failed to patch native TypingIndicator', err)
            }
        },
    )

    context.cleanup(stopNicknames)
    context.cleanup(stopTypingIndicator)
}
