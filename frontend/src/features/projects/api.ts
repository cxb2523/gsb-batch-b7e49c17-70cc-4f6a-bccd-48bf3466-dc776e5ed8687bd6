import { http, validateResponse } from '@/lib/http';
import {
  ProjectsListSchema,
  ProjectSchema,
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  ProjectMembersListSchema,
  AssignableMembersSchema,
  ProjectMemberItemSchema,
  AddProjectMemberInputSchema,
  UpdateProjectMemberRoleInputSchema,
  ProjectRotationPlanSchema,
  RotateProjectKeyInputSchema,
  RotateProjectKeyResultSchema,
  ProjectKeyHistorySchema,
  type ProjectsListResult,
  type ProjectMembersListResult,
  type AssignableMembersResult,
  type Project,
  type CreateProjectInput,
  type UpdateProjectInput,
  type ProjectMemberItem,
  type AddProjectMemberInput,
  type UpdateProjectMemberRoleInput,
  type ProjectRotationPlan,
  type RotateProjectKeyInput,
  type RotateProjectKeyResult,
  type ProjectKeyHistory,
} from './schemas';

export async function listProjects(
  workspaceId: string,
  params?: { page?: number; limit?: number },
): Promise<ProjectsListResult> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const queryStr = qs.toString() ? `?${qs.toString()}` : '';

  const data = await http.get(`/api/projects${queryStr}`, {
    workspaceId,
  });
  return validateResponse(ProjectsListSchema, data, `GET /api/projects${queryStr}`);
}

export async function createProject(
  workspaceId: string,
  input: CreateProjectInput,
): Promise<Project> {
  CreateProjectInputSchema.parse(input);
  const data = await http.post('/api/projects', input, {
    workspaceId,
  });
  return validateResponse(ProjectSchema, data, 'POST /api/projects');
}

export async function updateProject(
  workspaceId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  UpdateProjectInputSchema.parse(input);
  const data = await http.patch(`/api/projects/${projectId}`, input, {
    workspaceId,
  });
  return validateResponse(ProjectSchema, data, `PATCH /api/projects/${projectId}`);
}

export async function deleteProject(workspaceId: string, projectId: string): Promise<void> {
  await http.delete(`/api/projects/${projectId}`, {
    workspaceId,
  });
}

export async function listProjectMembers(
  workspaceId: string,
  projectId: string,
  params?: { page?: number; limit?: number },
): Promise<ProjectMembersListResult> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const queryStr = qs.toString() ? `?${qs.toString()}` : '';

  const data = await http.get(`/api/projects/${projectId}/members${queryStr}`, {
    workspaceId,
  });
  return validateResponse(
    ProjectMembersListSchema,
    data,
    `GET /api/projects/${projectId}/members${queryStr}`,
  );
}

export async function listAssignableMembers(
  workspaceId: string,
  projectId: string,
  params?: { page?: number; limit?: number },
): Promise<AssignableMembersResult> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const queryStr = qs.toString() ? `?${qs.toString()}` : '';

  const data = await http.get(`/api/projects/${projectId}/assignable-members${queryStr}`, {
    workspaceId,
  });
  return validateResponse(
    AssignableMembersSchema,
    data,
    `GET /api/projects/${projectId}/assignable-members${queryStr}`,
  );
}

export async function addProjectMember(
  workspaceId: string,
  projectId: string,
  input: AddProjectMemberInput,
): Promise<ProjectMemberItem> {
  AddProjectMemberInputSchema.parse(input);
  const data = await http.post(`/api/projects/${projectId}/members`, input, {
    workspaceId,
  });
  return validateResponse(ProjectMemberItemSchema, data, `POST /api/projects/${projectId}/members`);
}

export async function updateProjectMemberRole(
  workspaceId: string,
  projectId: string,
  userId: string,
  input: UpdateProjectMemberRoleInput,
): Promise<ProjectMemberItem> {
  UpdateProjectMemberRoleInputSchema.parse(input);
  const data = await http.patch(`/api/projects/${projectId}/members/${userId}`, input, {
    workspaceId,
  });
  return validateResponse(
    ProjectMemberItemSchema,
    data,
    `PATCH /api/projects/${projectId}/members/${userId}`,
  );
}

export async function removeProjectMember(
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<{ rotationDue?: string[] } | void> {
  return await http.delete<{ rotationDue?: string[] }>(
    `/api/projects/${projectId}/members/${userId}`,
    {
      workspaceId,
    },
  );
}

export async function getProjectRotationPlan(
  workspaceId: string,
  projectId: string,
): Promise<ProjectRotationPlan> {
  const data = await http.get(`/api/projects/${projectId}/rotation-plan`, {
    workspaceId,
  });
  return validateResponse(
    ProjectRotationPlanSchema,
    data,
    `GET /api/projects/${projectId}/rotation-plan`,
  );
}

export async function rotateProjectKey(
  workspaceId: string,
  projectId: string,
  input: RotateProjectKeyInput,
): Promise<RotateProjectKeyResult> {
  RotateProjectKeyInputSchema.parse(input);
  const data = await http.post(`/api/projects/${projectId}/rotate-key`, input, {
    workspaceId,
  });
  return validateResponse(
    RotateProjectKeyResultSchema,
    data,
    `POST /api/projects/${projectId}/rotate-key`,
  );
}

export async function getProjectKeyHistory(
  workspaceId: string,
  projectId: string,
): Promise<ProjectKeyHistory> {
  const data = await http.get(`/api/projects/${projectId}/key-history`, {
    workspaceId,
  });
  return validateResponse(
    ProjectKeyHistorySchema,
    data,
    `GET /api/projects/${projectId}/key-history`,
  );
}
