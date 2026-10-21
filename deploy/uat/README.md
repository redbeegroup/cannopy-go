# UAT deployment with Portainer

The UAT host runs the stack in `docker-compose.yml` from this folder. GitHub
Actions builds the `api` and `web` images, pushes them to GitHub Container
Registry, then calls a Portainer webhook so the stack re-pulls and restarts.
Nothing is built on the UAT host and no secret is in this repository.

How traffic flows on the host:

```
browser ──HTTPS──> NPMplus (TLS) ──HTTP──> web :8080 ──> /api/ ──> api :3000 ──> db
```

The stack never terminates TLS. It opens one plain-HTTP port (`WEB_PORT`,
default 8080) and NPMplus proxies to it. The `web` container forwards the
proxy's `X-Forwarded-Proto` and `X-Forwarded-For` headers to the API, which
trusts them (`trustProxy`), so rate limits see the real client address and the
API sees HTTPS. The PWA needs HTTPS for its service worker, which is why the
app must be opened through the proxy host name, not through port 8080 directly.

## One-time setup in Portainer

1. **Registry credential (optional).** The repository and both images on
   GitHub Container Registry are public, so Portainer can pull them without a
   credential. If the images are ever made private, add one under
   Registries > Add registry > Custom: name `ghcr`, URL `ghcr.io`,
   authentication on, username `redbeegroup`, password a GitHub personal
   access token (classic) with the `read:packages` scope.
2. **Stack.** Stacks > Add stack > Repository.
   - Name: `cannopygo` (Portainer and Compose only accept lowercase, so this is
     the on-disk spelling of CannopyGo).
   - Repository URL: `https://github.com/redbeegroup/cannopy-go`
   - Repository reference: `refs/heads/main`
   - Compose path: `deploy/uat/docker-compose.yml`
   - Authentication: off (the repository is public). Turn it on with a GitHub
     token that has the `repo` scope if the repository is ever made private.
   - Environment variables (the stack reads these; set them here, never in git):

     | Variable | Required | Notes |
     | --- | --- | --- |
     | `POSTGRES_PASSWORD` | yes | Database password for the `cannopy` user |
     | `AUTH_SECRET` | yes | 32+ random characters, `openssl rand -hex 32` |
     | `IMAGE_REGISTRY` | no | Default `ghcr.io/redbeegroup` |
     | `IMAGE_TAG` | no | Default `latest`; set to a commit SHA to pin |
     | `WEB_PORT` | no | Host port NPMplus forwards to, default 8080 |
     | `CORS_ORIGINS` | no | Leave empty; the web container proxies `/api` so there is no cross-origin call |
     | `LOG_LEVEL` | no | `info` by default |
     | `SMS_PROVIDER` | no | `log` (default) writes sign-in codes to the `api` container log; `webhook` posts them to `SMS_WEBHOOK_URL` |
     | `AUTH_DEV_CODE` | no | Six digits; makes every sign-in code this value. Test data only |

   - GitOps updates: on, mechanism **Webhook**, and tick **Re-pull image**.
     Copy the webhook URL Portainer shows (it ends in a UUID).
   - Deploy the stack. The first pull takes a minute. All three containers
     should show healthy; `api` runs the database migrations on its first start.
3. **GitHub secret.** In the repository, Settings > Secrets and variables >
   Actions > New repository secret: name `PORTAINER_WEBHOOK_URL`, value the
   webhook URL from step 2. The deploy job in `.github/workflows/ci.yml` posts
   to it after each successful image push on `main`. (The job runs in the
   `uat` environment, so an environment secret of the same name works too.)
   Until the secret exists the job logs "skipping deploy" and exits green.

   To deploy without pushing a commit, open Actions > CI > Run workflow on
   `main`; a `workflow_dispatch` run builds, pushes and calls the webhook.
4. **NPMplus proxy host.** Hosts > Proxy Hosts > Add Proxy Host:
   - Domain Names: the host name you want for CannopyGo.
   - Scheme `http`, Forward Hostname the Docker host as NPMplus reaches it,
     Forward Port the `WEB_PORT` value (8080). If NPMplus runs in a container
     on the default bridge network, the host is usually reachable as
     `172.17.0.1` or `host.docker.internal`; if NPMplus uses host networking,
     `127.0.0.1` works.
   - Block Common Exploits: on. Websockets Support: not needed.
   - SSL tab: pick or request a certificate, and turn on Force SSL, HTTP/2 and
     HSTS. NPMplus adds `X-Forwarded-Proto: https` itself, which is what the
     stack relies on. Leave the Advanced tab empty.

## Alternative: Portainer API instead of a webhook

If you prefer the API (for example to pin `IMAGE_TAG` per deploy), set these
secrets instead and switch the deploy step as described in the workflow comments:
`PORTAINER_URL`, `PORTAINER_API_KEY`, `PORTAINER_ENDPOINT_ID`, `PORTAINER_STACK_ID`.
The call is `PUT /api/stacks/{id}/git/redeploy?endpointId={endpointId}` with
`{"pullImage": true, "prune": false}`.

## Checking a deploy

- `https://<your host name>/api/health` returns
  `{"status":"ok","database":"ok","version":"<commit sha>"}` once the proxy is
  up. `version` changes after each deploy, which is the quickest way to see
  that the webhook fired. (`http://<docker host>:8080/api/health` answers the
  same without the proxy.)
- In GitHub, the "Deploy to UAT (Portainer)" job on the latest `main` run
  should print "Portainer redeploy requested." rather than "skipping deploy".
- The `api` container runs database migrations on start. A failed migration
  stops the container, which Portainer shows as unhealthy.
- Roll back by setting `IMAGE_TAG` to an earlier commit SHA on the stack and
  clicking Update the stack.
