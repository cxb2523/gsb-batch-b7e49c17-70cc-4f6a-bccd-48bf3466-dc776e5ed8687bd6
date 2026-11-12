import { http, httpRequest, validateResponse } from '@/lib/http';
import {
  BoardSchema,
  BoardsListSchema,
  CreateBoardInputSchema,
  UpdateBoardInputSchema,
  SaveBoardPayloadResultSchema,
  PublicShareResultSchema,
  type Board,
  type BoardsListResult,
  type SaveBoardPayloadResult,
  type CreateBoardInput,
  type UpdateBoardInput,
  type PublicShareResult,
} from './schemas';

export async function listBoards(
  workspaceId: string,
  params?: {
    projectId?: string;
    search?: string;
    page?: number;
    limit?: number;
    sort?: string;
  },
): Promise<BoardsListResult> {
  const qs = new URLSearchParams();
  if (params?.projectId) qs.set('projectId', params.projectId);
  if (params?.search) qs.set('search', params.search);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.sort) qs.set('sort', params.sort);
  const queryStr = qs.toString() ? `?${qs.toString()}` : '';

  const data = await http.get(`/api/boards${queryStr}`, {
    workspaceId,
  });
  return validateResponse(BoardsListSchema, data, `GET /api/boards${queryStr}`);
}

export async function getBoard(workspaceId: string, boardId: string): Promise<Board> {
  const data = await http.get(`/api/boards/${boardId}`, {
    workspaceId,
  });
  return validateResponse(BoardSchema, data, `GET /api/boards/${boardId}`);
}

export async function createBoard(workspaceId: string, input: CreateBoardInput): Promise<Board> {
  CreateBoardInputSchema.parse(input);
  const data = await http.post('/api/boards', input, {
    workspaceId,
  });
  return validateResponse(BoardSchema, data, 'POST /api/boards');
}

export async function updateBoard(
  workspaceId: string,
  boardId: string,
  input: UpdateBoardInput,
): Promise<Board> {
  UpdateBoardInputSchema.parse(input);
  const data = await http.patch(`/api/boards/${boardId}`, input, {
    workspaceId,
  });
  return validateResponse(BoardSchema, data, `PATCH /api/boards/${boardId}`);
}

export async function deleteBoard(workspaceId: string, boardId: string): Promise<void> {
  await http.delete(`/api/boards/${boardId}`, {
    workspaceId,
  });
}

export async function getBoardPayload(workspaceId: string, boardId: string): Promise<ArrayBuffer> {
  return await httpRequest<ArrayBuffer>(`/api/boards/${boardId}/payload`, {
    workspaceId,
    responseType: 'arrayBuffer',
  });
}

export interface SaveBoardPayloadOptions {
  /** The revision the save starts from; the server refuses the save if the board moved on. */
  revision: number;
  /** The board key wrapped under the project's current key, when this save re-keys the board. */
  encryptedBoardKey?: string | undefined;
  /** The images the scene still uses; the server drops the rest. Empty means none. */
  fileIds?: string[] | undefined;
}

export async function saveBoardPayload(
  workspaceId: string,
  boardId: string,
  payload: Uint8Array | Blob | ArrayBuffer,
  options: SaveBoardPayloadOptions,
): Promise<SaveBoardPayloadResult> {
  const { revision, encryptedBoardKey, fileIds } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'x-board-revision': String(revision),
  };
  if (encryptedBoardKey) {
    headers['x-encrypted-board-key'] = encryptedBoardKey;
  }
  // An empty list still has to be sent: it tells the server every image was removed from the scene.
  if (fileIds) {
    headers['x-board-file-ids'] = fileIds.join(',');
  }

  const data = await http.put(`/api/boards/${boardId}/payload`, payload, {
    workspaceId,
    headers,
  });
  return validateResponse(SaveBoardPayloadResultSchema, data, `PUT /api/boards/${boardId}/payload`);
}

export async function uploadBoardFile(
  workspaceId: string,
  boardId: string,
  fileId: string,
  data: Uint8Array,
): Promise<void> {
  await http.put(`/api/boards/${boardId}/files/${fileId}`, data, {
    workspaceId,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

export async function getBoardFile(
  workspaceId: string,
  boardId: string,
  fileId: string,
): Promise<ArrayBuffer> {
  return await httpRequest<ArrayBuffer>(`/api/boards/${boardId}/files/${fileId}`, {
    workspaceId,
    responseType: 'arrayBuffer',
  });
}

export async function getPublicBoardFile(token: string, fileId: string): Promise<ArrayBuffer> {
  return await httpRequest<ArrayBuffer>(`/api/public/boards/${token}/files/${fileId}`, {
    responseType: 'arrayBuffer',
  });
}

export async function enablePublicShare(
  workspaceId: string,
  boardId: string,
): Promise<PublicShareResult> {
  const data = await http.post(`/api/boards/${boardId}/public-share`, undefined, {
    workspaceId,
  });
  return validateResponse(
    PublicShareResultSchema,
    data,
    `POST /api/boards/${boardId}/public-share`,
  );
}

export async function disablePublicShare(workspaceId: string, boardId: string): Promise<void> {
  await http.delete(`/api/boards/${boardId}/public-share`, {
    workspaceId,
  });
}
