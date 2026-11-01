import { lookupModule } from '@valenced/modules/finders'
import * as filters from '@valenced/modules/finders/filters'

export const TAG = '[RoleColorEverywhere]'
const WAIT_MS: number = (globalThis as any).__roleColorWaitMs ?? 15000
const STEP_MS = 500

let sink: { warn: (message: string) => void } | undefined
export function setLogger(l: { warn: (message: string) => void } | undefined) { sink = l }

export function report(message: string, err?: unknown) {
    const text = err === undefined ? message : `${message}: ${String(err)}`
    if (sink) sink.warn(text)
    else console.warn(text)
}

export type Make = (f: any) => unknown
export const byProps = (...props: string[]): Make => (f) => f.withProps(...props)
export const byName = (name: string): Make => (f) => f.withName(name)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function lookupOnce<T>(make: Make): { mod?: T; error?: unknown } {
    try {
        const result = lookupModule(make(filters as any)) as [T | undefined, number | undefined] | []
        const [mod, moduleId] = result
        return moduleId === undefined || mod == null ? {} : { mod }
    } catch (error) { return { error } }
}

export async function waitForModule<T = any>(label: string, make: Make): Promise<T | undefined> {
    const deadline = Date.now() + WAIT_MS
    let lastError: unknown
    for (;;) {
        const { mod, error } = lookupOnce<T>(make)
        if (mod !== undefined) return mod
        lastError = error ?? lastError
        if (Date.now() >= deadline) {
            report(`${TAG} module not found: ${label}`, lastError)
            return undefined
        }
        await sleep(STEP_MS)
    }
}
