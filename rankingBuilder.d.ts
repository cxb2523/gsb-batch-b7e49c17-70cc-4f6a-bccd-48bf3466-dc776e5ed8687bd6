interface Organization {
    handle: string;
    municipality: string;
    province: string;
    latitude: number;
    longitude: number;
}
interface Repository {
    private?: boolean;
    stargazers_count: number;
    forks: number;
    open_issues: number;
    language: string | null;
    updated_at: string;
    pushed_at: string;
}
interface FetchResult {
    repos: Repository[];
    followers?: number;
}
type FetchRepositories = (organization: Organization) => Promise<FetchResult>;
interface OrganizationData {
    handle: string;
    municipality: string;
    province: string;
    latitude: number;
    longitude: number;
    followers?: number;
    repositories: number;
    stars: number;
    forks: number;
    issues: number;
    lastUpdate: string;
    languages: Record<string, number>;
    status: "success" | "failed";
    error?: string;
}
interface RankingData {
    organizations: OrganizationData[];
    failedOrganizations: OrganizationData[];
    refreshMillis: number;
}
export declare function buildOrganizationData(organization: Organization, repos: Repository[], followers?: number): OrganizationData;
export declare function buildFailedOrganizationData(organization: Organization, errorMessage: string): OrganizationData;
export declare function getErrorMessage(error: unknown): string;
export declare function compareOrganizations(organizationA: OrganizationData, organizationB: OrganizationData): number;
export declare function buildRankingData(organizations: Organization[], fetchRepositories: FetchRepositories, options?: {
    now?: number;
}): Promise<RankingData>;
export type { Organization, Repository, FetchResult, FetchRepositories, OrganizationData, RankingData };
export {};
