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

export const CommandStatusSchema = z.enum(['applied', 'rejected'])
export type CommandStatus = z.infer<typeof CommandStatusSchema>

const RevisionSchema = z.number().int().nonnegative()

export const BoardCommandSchema = z.object({
	commandId: z.uuid(),
	origin: CommandOriginSchema,
	type: z.string().min(1),
	status: CommandStatusSchema,
	/** The board revision this command produced. Null for a rejected command, which changes nothing. */
	rev: RevisionSchema.nullable(),
	/** The board revision an agent command was based on. */
	baseRev: RevisionSchema.optional(),
	/** For a stale command, the records that a user or voice command changed after `baseRev`. */
	staleRecordIds: z.array(z.string()).optional(),
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
}).refine((command) => (command.status === 'applied') === (command.rev !== null), {
	message: 'Applied commands have a revision and rejected commands do not.',
})

export type BoardCommand = z.infer<typeof BoardCommandSchema>
