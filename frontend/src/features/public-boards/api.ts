import { http, httpRequest, validateResponse } from '@/lib/http';
import { PublicBoardMetadataSchema, type PublicBoardMetadata } from './schemas';

export async function getPublicBoardMetadata(token: string): Promise<PublicBoardMetadata> {
  const data = await http.get(`/api/public/boards/${token}`);
  return validateResponse(PublicBoardMetadataSchema, data, `GET /api/public/boards/${token}`);
}

export async function getPublicBoardPayload(token: string): Promise<ArrayBuffer> {
  return await httpRequest<ArrayBuffer>(`/api/public/boards/${token}/payload`, {
    responseType: 'arrayBuffer',
  });
}
