# ASFclaim

[DockerHub Repository](https://hub.docker.com/r/journeyover/asfclaim) | Forked from [C4illin/ASFclaim](https://github.com/C4illin/ASFclaim)

ASFclaim is a tool designed to automatically claim new free packages on [Steam](https://store.steampowered.com/) when available, working in conjunction with [ArchiSteamFarm](https://github.com/JustArchiNET/ArchiSteamFarm) (ASF) with IPC enabled.

---

### How It Works

1. **GitHub Gist Integration**: The tool retrieves a list of free Steam packages from a specified GitHub Gist (set by the `GIST_ID` environment variable).
2. **Processed Licenses**: It keeps track of which codes have already been processed to avoid claiming the same package multiple times.
3. **Claiming Process**: The tool claims free Steam packages by sending commands to ASF (ArchiSteamFarm).
4. **Interval-based Processing**: The tool processes up to **40 codes per interval** (as defined by `ASF_CLAIM_INTERVAL`, in hours). This ensures that the tool can claim available packages at a steady pace without hitting the Steam API limit.

> **Important**: On first use, the tool will start processing from the **bottom** of the Gist list and claim up to **40 codes per interval** (as defined by `ASF_CLAIM_INTERVAL`). This allows the tool to prioritize newly added packages, ensuring that recent additions are processed as soon as possible, even if the tool hasn't yet gone through the entire list. This approach helps prevent delays in claiming new packages and avoids processing the same codes multiple times, especially since scanning the entire list could take a couple of days to finish before it starts processing only newly added packages.

---

## Optional: Discord Webhook Integration | Credits to @Mega349 for the original integration code.

Use the optional webhook integration to receive claim notifications on Discord.

### Notification Types

#### **Successfully Claimed Game**
  ![Success](https://raw.githubusercontent.com/JourneyDocker/ASFclaim/main/resources/readme/app_game_status.png)

#### **Claimed Package Containing a DLC (with or without status visibility)**
  ![DLC Status](https://raw.githubusercontent.com/JourneyDocker/ASFclaim/main/resources/readme/sub_dlc_status.png)
  ![DLC No Status](https://raw.githubusercontent.com/JourneyDocker/ASFclaim/main/resources/readme/sub_dlc_no-status.png)

#### **Claimed Game Package with Multiple Results and Visible Botnames**
  ![Multiple Results](https://raw.githubusercontent.com/JourneyDocker/ASFclaim/main/resources/readme/app_game_status-long.png)

When `WEBHOOK_SHOWACCOUNTSTATUS` is set to `false`, bot names and statuses remain hidden—ideal for public channels.

---

## Installation

### Baremetal Prerequisites
1. Enable IPC in [ASF](https://github.com/JustArchiNET/ArchiSteamFarm/wiki/IPC) (add password to `.env` if not empty).
2. Install Node.js (v18 or later).

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/JourneyDocker/ASFclaim.git

# Navigate to directory
cd ASFclaim

# Install dependencies
npm install

# Start the application
node .
```

### Docker Installation

You can use pre-built Docker images to run ASFclaim:

**Pull the Docker Image:**

  You can choose from two Docker image repositories:

  - From Docker Hub:

    ```sh
    journeyover/asfclaim:latest
    ```

  - From GitHub Container Registry:

    ```sh
    ghcr.io/journeydocker/asfclaim:latest
    ```

### Docker Image Tags

  The `ASFclaim` Docker image is available in three primary tag formats, each suited to different use cases:

  - **`main` (Continuous Development)**
    - **Description**: The `main` tag is automatically updated to reflect the latest commit on the main branch in GitHub.
    - **Usage Consideration**: This tag is not recommended for production use, as it changes frequently and may include untested or unstable updates. Use `main` only if you're contributing to development or need access to the latest features and fixes.
    - **Frequency**: Updated with each new commit to the main branch, making this a rapidly evolving image.

    > **Note**: Pulling the `main` tag may introduce breaking changes or instability, as it represents ongoing development work.

  - **`latest` (Latest Stable Release)**
    - **Description**: This tag points to the most recent stable release of `ASFclaim`. Unlike `main`, the `latest` tag is only updated with stable, fully-tested versions.
    - **Usage Recommendation**: Use the `latest` tag if you want the most current stable build without specifying a particular version. Ideal for production environments where stability is critical.

  - **`A.B.C.D` (Versioned Release)**
    - **Description**: Versioned tags, such as `A.B.C.D`, are frozen at a specific release version and will not receive updates after publication.
    - **Usage Recommendation**: Use versioned tags when you need consistency and want to avoid updates that might alter functionality. These tags are ideal for production environments requiring fixed versions.

#### Quick Start with Docker

```sh
docker run -d \
  --name asfclaim \
  -e TZ=America/Chicago \
  -e ASF_PROTOCOL=http \
  -e ASF_HOST=localhost \
  -e ASF_PORT=1242 \
  -e ASF_COMMAND_PREFIX="!" \
  -e ASF_BOTS=asf \
  -e ASF_CLAIM_INTERVAL=3 \
  -e WEBHOOK_URL=none \
  -e WEBHOOK_ENABLEDTYPES="error;warn;success" \
  -e WEBHOOK_SHOWACCOUNTSTATUS=true \
  -v ./storage:/app/storage/ \
  journeyover/asfclaim:latest
```

#### Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
    asfclaim:
        image: journeyover/asfclaim:latest
        environment:
            - TZ=America/Chicago
            - ASF_PROTOCOL=http
            - ASF_HOST=localhost
            - ASF_PORT=1242
            - ASF_COMMAND_PREFIX="!"
            - ASF_BOTS=asf
            - ASF_CLAIM_INTERVAL=3
            - WEBHOOK_URL=none  # Replace with your Discord Webhook URL
            - WEBHOOK_ENABLEDTYPES=error;warn;success  # 'info' might be too verbose
            - WEBHOOK_SHOWACCOUNTSTATUS=true  # Set to 'false' to hide bot names in Discord
        volumes:
            - ./storage:/app/storage/
```

---

## Environment Variables

| ENV                         | Description                                  | Info                                                   | Default Value                      | Required |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------ | ---------------------------------- | -------- |
| `TZ`                        | Your timezone                                | Timezone identifier (e.g., `Europe/Amsterdam`)         | `America/Chicago`                  | No       |
| `ASF_PROTOCOL`              | ASF IPC Transfer protocol                    | Options: `http` or `https`                             | `http`                             | No       |
| `ASF_HOST`                  | ASF IPC Hostname or IP                       | Hostname or IP address                                 | `localhost`                        | No       |
| `ASF_PORT`                  | ASF IPC Port                                 | Port number for IPC                                    | `1242`                             | No       |
| `ASF_PASS`                  | ASF IPC Password                             | Plaintext password for ASF                             | ` `                                | No       |
| `ASF_COMMAND_PREFIX`        | Command prefix for ASF                       | Prefix used before commands                            | `!`                                | No       |
| `ASF_BOTS`                  | List of ASF bot names                        | Comma-separated bot names                              | `asf`                              | No       |
| `ASF_CLAIM_INTERVAL`        | Hours to wait for execution                  | Interval in hours between checks                       | `3`                                | No       |
| `GIST_ID`                   | Gist ID containing Steam codes               | GitHub Gist ID for fetching codes                      | `e8c5cf365d816f2640242bf01d8d3675` | No       |
| `WEBHOOK_URL`               | Discord Webhook URL                          | URL for Discord webhook or `none` to disable           | `none`                             | No       |
| `WEBHOOK_ENABLEDTYPES`      | Displayed notification types in Discord chat | Semicolon-separated types (e.g., `error;warn;success`) | `error;warn;success`               | No       |
| `WEBHOOK_SHOWACCOUNTSTATUS` | Show result from ASF                         | Options: `true` or `false`                             | `true`                             | No       |

---

## External Resources

- Webhook Bot Icon: [ASF GitHub](https://raw.githubusercontent.com/JustArchiNET/ArchiSteamFarm/main/resources/ASF_512x512.png)
- Webhook Placeholder image: [placehold.co](https://placehold.co/460x215.jpg?text=Cant+load+image)
- Claimable Package List: [GitHub: C4illin's Gist](https://gist.github.com/C4illin/e8c5cf365d816f2640242bf01d8d3675) | [Github: JourneyOver's Gist](https://gist.github.com/JourneyOver/590fefa34af75a961a85ff392ebc0932)
- Steam API
