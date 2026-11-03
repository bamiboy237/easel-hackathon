import type { TLRecord } from 'tldraw'
import { z } from 'zod'

export const CommandOriginSchema = z.enum(['user', 'agent', 'voice'])
export type CommandOrigin = z.infer<typeof CommandOriginSchema>

const RecordSchema = z.custom<TLRecord>((value) => {
	if (!value || typeof value !== 'object') return false
	return (
		'id' in value && typeof value.id === 'string' &&
		'typeName' in value && typeof value.typeName === 'string'
	)
})

export const BoardCommandSchema = z.object({
	commandId: z.uuid(),
	origin: CommandOriginSchema,
	type: z.string().min(1),
	payload: z.object({
		added: z.record(z.string(), RecordSchema),
		updated: z.record(z.string(), z.tuple([RecordSchema, RecordSchema])),
		removed: z.record(z.string(), RecordSchema),
	}).superRefine((diff, context) => {
		const seen = new Set<string>()
		for (const group of ['added', 'updated', 'removed'] as const) {
			for (const [id, value] of Object.entries(diff[group])) {
				const records = Array.isArray(value) ? value : [value]
				if (seen.has(id) || records.some((record) => record.id !== id)) {
					context.addIssue({ code: 'custom', message: 'Invalid record IDs in command changes.' })
				}
				seen.add(id)
			}
		}
	}),
	createdAt: z.number().int().nonnegative(),
})

export type BoardCommand = z.infer<typeof BoardCommandSchema>
