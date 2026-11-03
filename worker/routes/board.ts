import { IRequest } from 'itty-router'
import { Environment } from '../environment'

const board = (env: Environment) => env.BOARD_DURABLE_OBJECT.get(env.BOARD_DURABLE_OBJECT.idFromName('local'))

const boardId = (request: IRequest) => {
	const id = request.params.boardId
	if (!/^[\w-]{1,64}$/.test(id)) throw new Error('Invalid board ID.')
	return id
}

export async function loadBoard(request: IRequest, env: Environment) {
	return Response.json(await board(env).load(boardId(request)))
}

export async function appendCommands(request: IRequest, env: Environment) {
	const { commands } = (await request.json()) as { commands: any[] }
	if (!Array.isArray(commands)) return new Response('Expected commands.', { status: 400 })
	return Response.json({ added: await board(env).appendCommands(boardId(request), commands) })
}

export async function saveSnapshot(request: IRequest, env: Environment) {
	const { rev, document } = (await request.json()) as { rev: number; document: unknown }
	if (!Number.isInteger(rev) || rev < 0 || !document) return new Response('Expected rev and document.', { status: 400 })
	await board(env).saveSnapshot(boardId(request), rev, document)
	return Response.json({ saved: true })
}
