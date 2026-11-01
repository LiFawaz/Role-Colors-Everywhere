export const TAG = '[RoleColorEverywhere]'

let sink: { warn?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void } | undefined

export function setLogger(logger: { warn?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void } | undefined) {
    sink = logger
}

export function report(message: string, err?: unknown) {
    const output = err === undefined ? message : `${message}: ${String(err)}`
    if (sink?.warn) sink.warn(output)
    else console.warn(output)
}
