# UAT deployment with Portainer

The UAT host runs the stack in `docker-compose.yml` from this folder. GitHub
Actions builds the `api` and `web` images, pushes them to the registry, then
calls a Portainer webhook so the stack re-pulls and restarts. Nothing is built
on the UAT host and no secret is in this repository.

## One-time setup in Portainer

1. **Registry credential.** Registries > Add registry > Custom. URL `ghcr.io`,
   username your GitHub login, password a GitHub personal access token with the
   `read:packages` scope. The images are private, so Portainer needs this to pull.
2. **Stack.** Stacks > Add stack > Repository.
   - Repository URL: `https://github.com/redbeegroup/cannopy-go`
   - Reference: `refs/heads/main`
   - Compose path: `deploy/uat/docker-compose.yml`
   - Authentication: on, with a GitHub token that can read the repository.
   - Environment variables (the stack reads these; set them here, never in git):

     | Variable | Required | Notes |
     | --- | --- | --- |
     | `POSTGRES_PASSWORD` | yes | Database password for the `cannopy` user |
     | `AUTH_SECRET` | yes | 32+ random characters, `openssl rand -hex 32` |
     | `IMAGE_REGISTRY` | no | Default `ghcr.io/redbeegroup` |
     | `IMAGE_TAG` | no | Default `latest`; set to a commit SHA to pin |
     | `WEB_PORT` | no | Host port for the web app, default 8080 |
     | `CORS_ORIGINS` | no | Empty is right when the web container proxies `/api` |
     | `LOG_LEVEL` | no | `info` by default |

   - GitOps updates: on, mechanism **Webhook**, and tick **Re-pull image**.
     Copy the webhook URL Portainer shows.
3. **GitHub secret.** In the repository, Settings > Secrets and variables >
   Actions, add `PORTAINER_WEBHOOK_URL` with that webhook URL. The deploy job in
   `.github/workflows/ci.yml` posts to it after each successful image push on `main`.

## Alternative: Portainer API instead of a webhook

If you prefer the API (for example to pin `IMAGE_TAG` per deploy), set these
secrets instead and switch the deploy step as described in the workflow comments:
`PORTAINER_URL`, `PORTAINER_API_KEY`, `PORTAINER_ENDPOINT_ID`, `PORTAINER_STACK_ID`.
The call is `PUT /api/stacks/{id}/git/redeploy?endpointId={endpointId}` with
`{"pullImage": true, "prune": false}`.

## Checking a deploy

- `https://<uat-host>:8080/api/health` returns `{"status":"ok","database":"ok","version":"<tag>"}`.
- The `api` container runs database migrations on start. A failed migration
  stops the container, which Portainer shows as unhealthy.
- Roll back by setting `IMAGE_TAG` to an earlier commit SHA on the stack and
  clicking Update the stack.
