# Releasing

**Policy: every milestone ends in a release.** A milestone is not finished when its
last issue is closed — it is finished when a tagged, versioned release exists and
the running app reports that version on its About page.

The reason is that Astraya's correctness claims are only meaningful about a
specific build. "The golden-chart gate is green" means nothing without a version to
attach it to, and the AGPL obliges us to offer users the source _for the instance
they are using_. Releasing per milestone keeps those anchored.

## Version plan

Pre-1.0 while the app is incomplete; 1.0.0 when M9 ships and it is genuinely
usable end to end.

| Milestone                             | Release  | Marks                                                    |
| ------------------------------------- | -------- | -------------------------------------------------------- |
| M0 Foundation, licence & architecture | `v0.1.0` | Ephemeris boundary verified against JPL Horizons         |
| M1 Delivery pipeline                  | `v0.2.0` | A pullable Docker image exists                           |
| M2 Time & place                       | `v0.3.0` | Birth moment resolves correctly, historical DST included |
| M3 Local-first data & people          | `v0.4.0` | People persist offline; the app is usable                |
| M4 Calculation core                   | `v0.5.0` | Full chart data: bodies, houses, aspects, dignities      |
| M5 Chart rendering                    | `v0.6.0` | The wheel is drawn                                       |
| M6 Progressions & returns             | `v0.7.0` | Predictive techniques                                    |
| M7 Interpretation                     | `v0.8.0` | The written report                                       |
| M8 Accounts, sync & export            | `v0.9.0` | Multi-device sync, sharing, export                       |
| M9 Polish & launch                    | `v1.0.0` | Accessible, fast, tested, deployed                       |

A milestone that has to ship incomplete gets a minor bump and an honest changelog
entry saying what is missing. Patch releases happen whenever a correctness bug is
fixed, without waiting for a milestone — a wrong chart is not something to sit on.

## Checklist

1. Every issue in the milestone is closed, or moved out with a reason.
2. `npm run check` is green (format, lint, typecheck, tests).
3. The **golden-chart gate** passes at its historical tolerance of 0.2″. This is
   never waived. If reference agreement has degraded, that is the release blocker.
4. `npm run ephe:sync` reports no digest change, or the change is explained in the
   changelog.
5. Bump `version` in `package.json` to the table's value. The hard-coded release
   badge in `README.md` follows it; `test/readme.test.ts` fails if it does not, so
   step 2 catches a forgotten bump.
6. `CHANGELOG.md` has a section for the release. Start from
   `npm run changelog:draft`, which groups conventional commit subjects since the
   last tag by change type, then **edit it for humans** — say what changed for a
   _user_, not which files moved. The draft is not written to the file on purpose: it
   guarantees nothing is forgotten, not that the result is worth reading. It also
   lists any commit whose subject did not parse, so nothing user-facing is dropped;
   CI rejects those on pull requests, so this should be empty.
7. Tag and push: `git tag -a v0.1.0 -m 'M0: foundation' && git push origin v0.1.0`.
   The tag triggers `.github/workflows/release.yml`, which builds, attaches the
   changelog, and publishes the GitHub release.
8. Close the milestone.
9. Confirm the deployed app's About page shows the new version and commit, and that
   `docker pull niqck/astraya:latest` gets that same version.

## Docker image tags

The image is `niqck/astraya` on Docker Hub, built for `linux/amd64` and
`linux/arm64` from a single `Dockerfile`.

| Trigger        | Tags pushed                   | Notes                                  |
| -------------- | ----------------------------- | -------------------------------------- |
| `v1.2.3` tag   | `1.2.3`, `1.2`, `1`, `latest` | Pin as tightly or loosely as you like  |
| `v1.2.3-rc.1`  | `1.2.3-rc.1` only             | A prerelease never moves a rolling tag |
| push to `main` | `edge`, `sha-<short>`         | Buildable, not a release               |
| pull request   | _none_ — built but not pushed | A fork PR has no access to the secrets |

`latest` is set by an explicit condition in the workflow rather than by
`docker/metadata-action`'s automatic behaviour, which would also move it for a
prerelease tag.

After pushing, the workflow starts the amd64 image it just published and waits for
`/healthz`, then checks the served page carries its CSP header. A pushed image that
cannot serve a request is worse than a failed build, because it looks like success.

Credentials come from the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository
secrets. They are referenced only by `docker/login-action` and are never echoed.

## Correctness note

The release workflow runs the full check suite itself and refuses to publish if it
fails. That is intentional duplication: a release must never be able to escape the
gate because someone tagged in a hurry.
