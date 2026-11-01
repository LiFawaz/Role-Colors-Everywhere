import { Design } from '@valenced/discord/design'
import { report, TAG } from './lookup'
import { normalizeSettings, type RoleColorSettings } from './settings-store'
export type { RoleColorSettings }

export function SettingsComponent({ api }: { api: any }) {
    const storage = api?.jsonStorage
    if (!storage || typeof storage.use !== 'function' || typeof storage.set !== 'function') {
        report(`${TAG} configure screen unavailable: plugin jsonStorage missing`)
        return null
    }

    const settings = normalizeSettings(storage.use())
    const TableRowGroup = Design?.TableRowGroup
    const TableSwitchRow = Design?.TableSwitchRow
    if (!TableRowGroup || !TableSwitchRow) {
        report(`${TAG} configure screen unavailable: design switch components missing`)
        return null
    }

    return <TableRowGroup>
        <TableSwitchRow
            label="Color User Mentions"
            value={settings.userMentions}
            onValueChange={(value: boolean) => storage.set({ ...settings, userMentions: value })}
        />
        <TableSwitchRow
            label="Color Voice Channel Users"
            value={settings.voiceUsers}
            onValueChange={(value: boolean) => storage.set({ ...settings, voiceUsers: value })}
        />
    </TableRowGroup>
}
