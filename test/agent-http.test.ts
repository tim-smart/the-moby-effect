import { Effect, Schedule } from "effect";

import * as MobyApi from "../src/main.js";

// How long jest has to run the before all and after all hooks.
const WARMUP_TIMEOUT = 30_000;
const COOLDOWN_TIMEOUT = 30_000;

/** The ID of the dind docker container we can test against on the host. */
let testDindContainerId: string | undefined;
let testDindContainerHttpPort: string | undefined;

/** Connects to the local docker daemon on this host. */
const localDocker: MobyApi.IMobyService = MobyApi.makeMobyClient();

/**
 * This bootstraps the tests by using the api to start a docker-in-docker
 * container on the host so that we have something to test the api against
 * without needing to modify the host docker install.
 */
beforeAll(
    async () =>
        await Effect.gen(function* (_: Effect.Adapter) {
            const containerInspectResponse: MobyApi.ContainerInspectResponse = yield* _(
                localDocker.run({
                    imageOptions: { kind: "pull", fromImage: "docker.io/library/docker:dind" },
                    containerOptions: {
                        body: {
                            Image: "docker:dind",
                            Env: ["DOCKER_TLS_CERTDIR="],
                            Cmd: ["--tls=false"],
                            HostConfig: {
                                Privileged: true,
                                PortBindings: { "2375/tcp": [{ HostPort: "0" }], "2376/tcp": [{ HostPort: "0" }] },
                            },
                        },
                    },
                })
            );

            testDindContainerId = containerInspectResponse.Id!;
            testDindContainerHttpPort = containerInspectResponse.NetworkSettings?.Ports?.["2375/tcp"]?.[0]?.HostPort!;
        })
            .pipe(Effect.scoped)
            .pipe(Effect.runPromise),
    WARMUP_TIMEOUT
);

/** Cleans up the container that will be created in the setup helper. */
afterAll(
    async () =>
        await localDocker
            .containerDelete({ id: testDindContainerId!, force: true })
            .pipe(Effect.scoped)
            .pipe(Effect.runPromise),
    COOLDOWN_TIMEOUT
);

describe("MobyApi http agent tests", () => {
    it("http agent should connect but see no containers", async () => {
        const dindHttpMobyClient: MobyApi.IMobyService = MobyApi.makeMobyClient({
            protocol: "http",
            host: "localhost",
            port: Number.parseInt(testDindContainerHttpPort!),
        });

        await Effect.runPromise(
            Effect.retry(
                dindHttpMobyClient.systemPing().pipe(Effect.scoped),
                Schedule.recurs(3).pipe(Schedule.addDelay(() => 1000))
            )
        );

        const testData: readonly MobyApi.ContainerSummary[] = await dindHttpMobyClient
            .containerList({ all: true })
            .pipe(Effect.scoped)
            .pipe(Effect.runPromise);

        expect(testData).toBeInstanceOf(Array);
        expect(testData.length).toBe(0);
    });
});
