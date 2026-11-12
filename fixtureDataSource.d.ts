import type { FetchResult, Organization, Repository } from "./rankingBuilder.js";
type Fixture = Record<string, {
    repos?: Repository[] | unknown;
    followers?: number;
    error?: string;
}>;
type RepositoryFetcher = (organization: Organization) => Promise<FetchResult>;
export declare function loadFixture(fixturePath: string): Promise<Fixture>;
export declare function createFixtureRepositoryFetcher(fixture: Fixture): RepositoryFetcher;
export declare function createFixtureRepositoryFetcherFromPath(fixturePath: string): Promise<RepositoryFetcher>;
export {};
