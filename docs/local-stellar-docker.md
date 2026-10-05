# Local Stellar Docker Compose Guide

This guide describes how to run a local standalone Stellar network (Horizon API + Soroban RPC + Stellar Core) using Docker Compose.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine + Docker Compose installed.

## Quick Start

1. Start the local Stellar container stack:

```bash
docker compose -f docker-compose.local-stellar.yml up -d
```

2. Verify services are running:

- **Horizon API**: `http://localhost:8000/`
- **Soroban RPC**: `http://localhost:8001/`
- **Stellar Core Health**: `http://localhost:11626/info`

3. Configure your Nextellar application environment variables (`.env.local`):

```ini
NEXT_PUBLIC_STELLAR_NETWORK=standalone
NEXT_PUBLIC_HORIZON_URL=http://localhost:8000
NEXT_PUBLIC_SOROBAN_RPC_URL=http://localhost:8001
```

## Stopping & Resetting State

- **Stop services**:
  ```bash
  docker compose -f docker-compose.local-stellar.yml stop
  ```

- **Teardown & wipe data volume**:
  ```bash
  docker compose -f docker-compose.local-stellar.yml down -v
  ```
