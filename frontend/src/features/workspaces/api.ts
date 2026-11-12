import { http, validateResponse } from '@/lib/http';
import {
  WorkspaceSchema,
  CreateWorkspaceInputSchema,
  UpdateWorkspaceInputSchema,
  WorkspaceRotationPlanSchema,
  RekeyQueueSchema,
  RotateWorkspaceKeyInputSchema,
  RotateWorkspaceKeyResultSchema,
  TransferOwnershipInputSchema,
  AccessMeSchema,
  DeleteWorkspaceResultSchema,
  type Workspace,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceRotationPlan,
  type RekeyQueue,
  type RotateWorkspaceKeyInput,
  type RotateWorkspaceKeyResult,
  type TransferOwnershipInput,
  type AccessMe,
} from './schemas';

export async function getWorkspace(
  slugOrId: string,
  options?: { workspaceId?: string },
): Promise<Workspace> {
  const data = await http.get(`/api/workspaces/${slugOrId}`, {
    workspaceId: options?.workspaceId ?? slugOrId,
  });
  return validateResponse(WorkspaceSchema, data, `GET /api/workspaces/${slugOrId}`);
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  CreateWorkspaceInputSchema.parse(input);
  const data = await http.post('/api/workspaces', input);
  return validateResponse(WorkspaceSchema, data, 'POST /api/workspaces');
}

export async function updateWorkspace(
  workspaceId: string,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  UpdateWorkspaceInputSchema.parse(input);
  const data = await http.patch(`/api/workspaces/${workspaceId}`, input, {
    workspaceId,
  });
  return validateResponse(WorkspaceSchema, data, `PATCH /api/workspaces/${workspaceId}`);
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const data = await http.delete(`/api/workspaces/${workspaceId}`, {
    workspaceId,
  });
  validateResponse(DeleteWorkspaceResultSchema, data, `DELETE /api/workspaces/${workspaceId}`);
}

export async function getWorkspaceRotationPlan(
  workspaceId: string,
): Promise<WorkspaceRotationPlan> {
  const data = await http.get(`/api/workspaces/${workspaceId}/rotation-plan`, {
    workspaceId,
  });
  return validateResponse(
    WorkspaceRotationPlanSchema,
    data,
    `GET /api/workspaces/${workspaceId}/rotation-plan`,
  );
}

export async function getRekeyQueue(workspaceId: string): Promise<RekeyQueue> {
  const data = await http.get(`/api/workspaces/${workspaceId}/rekey-queue`, { workspaceId });
  return validateResponse(RekeyQueueSchema, data, `GET /api/workspaces/${workspaceId}/rekey-queue`);
}

export async function rotateWorkspaceKey(
  workspaceId: string,
  input: RotateWorkspaceKeyInput,
): Promise<RotateWorkspaceKeyResult> {
  RotateWorkspaceKeyInputSchema.parse(input);
  const data = await http.post(`/api/workspaces/${workspaceId}/rotate-key`, input, {
    workspaceId,
  });
  return validateResponse(
    RotateWorkspaceKeyResultSchema,
    data,
    `POST /api/workspaces/${workspaceId}/rotate-key`,
  );
}

export async function transferOwnership(
  workspaceId: string,
  input: TransferOwnershipInput,
): Promise<void> {
  TransferOwnershipInputSchema.parse(input);
  const data = await http.post(`/api/workspaces/${workspaceId}/transfer-ownership`, input, {
    workspaceId,
  });
  validateResponse(
    DeleteWorkspaceResultSchema,
    data,
    `POST /api/workspaces/${workspaceId}/transfer-ownership`,
  );
}

export async function getAccessMe(workspaceReference?: string): Promise<AccessMe> {
  const qs = workspaceReference ? `?workspace=${encodeURIComponent(workspaceReference)}` : '';
  const data = await http.get(`/api/access/me${qs}`, {
    workspaceId: workspaceReference,
  });
  return validateResponse(AccessMeSchema, data, `GET /api/access/me${qs}`);
}
