# Deploy on Phala Cloud

## Step1: Remove `build` from docker compose file since it doesn't support build from source

```
build:
    context: .
    dockerfile: Dockerfile
```

## Step2: Build docker image and push to docker hub

Build docker image with `x86_64` arch and change `image` in docker compose file to image name on docker hub with exact tag name

```
docker build --platform linux/amd64 -t <user>/near-mcp-server .
docker tag <user>/near-mcp-server <user>/near-mcp-server:v0.1.0
docker push <user>/near-mcp-server:v0.1.0
```

## Step3: Deploy with docker-compose.yml

You can use the docker-compose file on Phala Cloud to deploy. Head to [Phala Cloud Doc](https://docs.phala.network/phala-cloud/getting-started) for more details.

### Set environments:

- **NEAR_KEYSTOREDATA=${NEAR_KEYSTOREDATA}**

  You need to use base64 encoding the credential JSON file then pass the value to `NEAR_KEYSTOREDATA`. Under folder `~/near-credentials`, execute:

  ```
  ➜  .near-credentials base64 -i testnet/phala.testnet/ed25519_FrWgBmDnbEERntvSVGizpUxk64LXNbaF3U77Du6VQDFR.json
  eyJwdWJsaWNfa2V5IjoiZWQyNTUxOTpGcldnQm1EbmJFRVJudHZTVkdpenBVeGs2NExYTmJhRjNVNzdEdTZWUURGUiIsInByaXZhdGVfa2V5IjoiZWQyNTUxOTo0NTdQdzJCeUZmNnVUOHI2SGkzWlFzOVJQQ3NNN0FXb3I0a2dlZW50UE1HVXRhb2ZobUtVanF4M1ZwQlAybnREdVVmR0UydjFCcmFka2ptblBjYm1weUdGIn0=
  ```

- NEAR_NETWORK=${NEAR_NETWORK:-mainnet}

  Set it to "testnet"

- NEAR_ACCOUNT_ID=${NEAR_ACCOUNT_ID}

  Set it to `phala.testnet`.

After finished deployment, you will see a public endpoint at **Network** tab on the dashboard, which you can use to access the MCP server.

## Step4: Config MCP client

Config MCP client like Claude Desktop, set MCP server using `sse` transport with the public endpoint get from Phala Cloud. For example: `https://4b21436db1e89bf2879dc72197504ad91e99f775-8000.dstack-prod4.phala.network/sse`:

```
"Near Blockchain MCP": {
  "url": "https://4b21436db1e89bf2879dc72197504ad91e99f775-8000.dstack-prod4.phala.network/sse"
}
```
