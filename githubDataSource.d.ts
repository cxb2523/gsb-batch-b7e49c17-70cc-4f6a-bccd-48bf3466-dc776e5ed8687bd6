import GitHub from "github-api";
import type { FetchResult, Organization } from "./rankingBuilder.js";
export declare function createGitHubClient(): GitHub;
export declare function createGitHubRepositoryFetcher(gh?: GitHub): (organization: Organization) => Promise<FetchResult>;
export {};
