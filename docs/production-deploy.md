# Production auto-deployment

This repository deploys production automatically after a successful push to `main`.

## Production target

- Host: `31.220.108.62`
- SSH user: `root`
- Stable application path used by the existing systemd service: `/root/workspace/enstudy-release-20260714-173624`
- Default health endpoint: `http://127.0.0.1:4173/api/health`

The workflow is `.github/workflows/deploy-production.yml` and the server-side release switch is implemented by `deploy/remote-deploy.sh`.

## One-time GitHub configuration

Create a repository Actions secret named:

```text
CAMILLE_DEPLOY_PASSWORD
```

Set its value to the production SSH password. Never commit the password to the repository.

After the secret is configured, either push a new commit to `main` or run **Build and Deploy Production** manually from the GitHub Actions page to deploy the current `main` commit.

## Deployment flow

For every production deployment:

1. GitHub Actions checks out the exact `main` commit.
2. It installs dependencies with `npm ci`.
3. It runs `npm test`.
4. It runs `npm run build` and requires `dist/index.html` to exist.
5. It creates a release archive that explicitly excludes `storage`.
6. It uploads the archive and `deploy/remote-deploy.sh` to the production server.
7. The server script automatically finds the existing systemd service that references `/root/workspace/enstudy-release-20260714-173624`.
8. The service is stopped briefly so the user-data backup is a consistent snapshot.
9. `storage` is backed up before code is switched.
10. The new release is activated through the stable application path.
11. The systemd service is started.
12. `/api/health` must return successfully; otherwise the application code is rolled back automatically.

Deployments are serialized with both GitHub Actions concurrency and a server-side `flock` lock.

## Storage layout

The first managed deployment migrates the existing installation to this layout:

```text
/root/workspace/
├── enstudy-release-20260714-173624 -> /root/workspace/camille-deploy/releases/<active-release>
└── camille-deploy/
    ├── releases/
    │   ├── legacy-YYYYMMDD-HHMMSS/
    │   ├── <git-sha>/
    │   └── ...
    ├── persistent/
    │   └── storage/
    │       └── users/
    ├── backups/
    │   └── storage/
    │       └── YYYYMMDD-HHMMSS-<sha>-users-<count>.tar.gz
    └── deploy.lock
```

Every release contains a `storage` symlink pointing to the single persistent directory:

```text
/root/workspace/camille-deploy/persistent/storage
```

Therefore code rollback never rolls user data backward. All application versions see the latest user records.

## User-data safeguards

The deployment script deliberately applies the following rules:

- A release archive containing `storage` is rejected.
- On the first deployment, the existing `storage` directory must exist; otherwise deployment aborts.
- The existing application path is not overwritten in-place.
- The service is stopped before the storage snapshot and first migration.
- The number of `storage/users/*.json` records is checked before migration, after migration, and after deployment.
- The persistent storage directory is never deleted during release cleanup.
- A failed health check rolls back only the code release link, not user data.
- The latest 30 storage snapshots are retained by default.
- Several recent application releases are retained for rollback.

## Manual inspection

Current release:

```bash
readlink -f /root/workspace/enstudy-release-20260714-173624
```

Persistent user data:

```bash
ls -lah /root/workspace/camille-deploy/persistent/storage/users
```

Storage backups:

```bash
ls -lht /root/workspace/camille-deploy/backups/storage
```

Service detected by the deployment layout:

```bash
grep -RIlF '/root/workspace/enstudy-release-20260714-173624' \
  /etc/systemd/system /usr/lib/systemd/system /run/systemd/system 2>/dev/null
```

Recent service logs:

```bash
journalctl -u <service-name> -n 100 --no-pager
```

Health check:

```bash
curl -fsS http://127.0.0.1:4173/api/health
```

## Manual code rollback

Normally rollback is automatic when deployment health verification fails. If a manual rollback is needed, choose an older release and repoint the stable path while the service is stopped:

```bash
systemctl stop <service-name>
ln -s /root/workspace/camille-deploy/releases/<older-release> \
  /root/workspace/enstudy-release-20260714-173624.next
mv -Tf /root/workspace/enstudy-release-20260714-173624.next \
  /root/workspace/enstudy-release-20260714-173624
systemctl start <service-name>
```

Do not restore an old `storage` backup as part of a normal code rollback. Persistent storage is intentionally independent of code releases.

## Restoring storage after an actual data-loss incident

Only use a storage backup when the persistent data itself is damaged or lost. Stop the service first, preserve the damaged data separately, then restore the selected snapshot. This is different from normal code rollback and should be done deliberately.
