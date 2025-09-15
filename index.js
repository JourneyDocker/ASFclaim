import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { Octokit } from "@octokit/rest";
import pkg from './package.json' assert { type: 'json' };
import dotenv from 'dotenv';
import winston from 'winston';

// Load environment variables from .env file if it exists
dotenv.config();

// Set up winston logger with console output and clean formatting
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          const time = new Date(timestamp).toLocaleTimeString('en-US', {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          return `${time} ${level}: ${message}`;
        })
      )
    })
  ]
});

// Configuration object containing all environment variables with defaults
const config = {
  protocol: process.env.ASF_PROTOCOL ? process.env.ASF_PROTOCOL : "http",
  host: process.env.ASF_HOST ? process.env.ASF_HOST : "localhost",
  port: process.env.ASF_PORT ? process.env.ASF_PORT : "1242",
  pass: process.env.ASF_PASS ? process.env.ASF_PASS : "",
  prefix: process.env.ASF_COMMAND_PREFIX ? process.env.ASF_COMMAND_PREFIX : "!",
  bots: process.env.ASF_BOTS ? process.env.ASF_BOTS : "asf",
  interval: process.env.ASF_CLAIM_INTERVAL ? process.env.ASF_CLAIM_INTERVAL : "3",
  gistId: process.env.GIST_ID ? process.env.GIST_ID : "e8c5cf365d816f2640242bf01d8d3675",
  webhookUrl: process.env.WEBHOOK_URL ? process.env.WEBHOOK_URL : "none",
  webhookEnabledTypes: process.env.WEBHOOK_ENABLEDTYPES ? process.env.WEBHOOK_ENABLEDTYPES : "error;warn;success",
  webhookShowAccountStatus: process.env.WEBHOOK_SHOWACCOUNTSTATUS ? process.env.WEBHOOK_SHOWACCOUNTSTATUS : "true",
  githubToken: process.env.GITHUB_TOKEN ? process.env.GITHUB_TOKEN : ""
};

// Initialize Octokit with user-agent and optional auth
const octokit = new Octokit({
  userAgent: `ASFClaim/${pkg.version}`,
  ...(config.githubToken && { auth: config.githubToken })
});

/**
 * Validates required configuration parameters and exits if invalid
 */
function validateConfig() {
  if (!config.githubToken) {
    logger.warn("⚠️  GITHUB_TOKEN is not set. You may hit rate limits. Set it for better reliability.");
  }
  if (isNaN(Number(config.interval)) || Number(config.interval) <= 0) {
    logger.error("❌ ASF_CLAIM_INTERVAL must be a positive number.");
    process.exit(1);
  }
}

validateConfig();

// Webhook queue for rate limiting
const webhookQueue = [];
let isProcessingWebhook = false;

/**
 * Processes the webhook queue with rate limiting
 * Sends webhooks at a maximum rate of 5 per second (200ms delay between sends)
 */
async function processWebhookQueue() {
  if (isProcessingWebhook || webhookQueue.length === 0) return;

  isProcessingWebhook = true;
  while (webhookQueue.length > 0) {
    const { url, options, resolve, reject } = webhookQueue.shift();
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
      }
      resolve();
    } catch (error) {
      logger.error("Webhook send failed:", error);
      reject(error);
    }
    // Rate limit: wait 200ms between sends (5 per second max)
    await sleep(0.2);
  }
  isProcessingWebhook = false;
}

/**
 * Queues a webhook for sending with rate limiting
 * @param {string} url - The webhook URL to send to
 * @param {object} options - Fetch options for the webhook request
 * @returns {Promise} Promise that resolves when webhook is sent
 */
async function sendWebhook(url, options) {
  return new Promise((resolve, reject) => {
    webhookQueue.push({ url, options, resolve, reject });
    processWebhookQueue();
  });
}

logger.info("target = " + config.protocol + "://" + config.host + ":" + config.port);

// Storage paths for persistent data
let storageDirectory = "./storage/";
let processedLicensesFile = storageDirectory + "processedLicenses";
let migrationFile = storageDirectory + "lastlength";

// Create storage directory if it doesn't exist
try {
  mkdirSync(storageDirectory, { recursive: true });
} catch (err) {
  if (err.code !== "EEXIST") {
    logger.error("Error creating storage directory:", err);
    process.exit(1);
  }
}

// Load processed licenses from file or initialize empty array
let processedLicenses = [];
try {
  processedLicenses = JSON.parse(readFileSync(processedLicensesFile, "utf8"));
} catch (err) {
  if (err.code === "ENOENT") {
    processedLicenses = [];
    writeFileSync(processedLicensesFile, JSON.stringify(processedLicenses));
  } else {
    logger.error("Error loading processed licenses:", err);
    process.exit(1);
  }
}

try {
  const lastLength = parseInt(readFileSync(migrationFile, "utf8").trim(), 10);
  if (!isNaN(lastLength)) {
    try {
      const gist = await octokit.gists.get({ gist_id: config.gistId });
      let codes = gist.data.files["Steam Codes"].content
        .split("\n")
        .map((code) => code.trim())
        .filter((code) => code);

      let migratedLicenses = codes.slice(0, lastLength);
      processedLicenses = [...new Set([...processedLicenses, ...migratedLicenses])];
      saveProcessedLicenses();
    } catch (err) {
      logger.warn("⚠️  Migration failed - could not fetch Gist for migration. Skipping...");
      if (err.status === 401) {
        logger.warn("GitHub authentication required for migration. This is normal if running for the first time.");
      }
    }

    unlinkSync(migrationFile);
  }
} catch {
  // Silently skip the migration if `lastlength` doesn't exist or is invalid
}

/**
 * Saves the processed licenses array to disk
 */
function saveProcessedLicenses() {
  writeFileSync(processedLicensesFile, JSON.stringify(processedLicenses, null, 2));
}

if (config.webhookUrl && config.webhookUrl !== "none") {
  var webhookEnabledTypes = config.webhookEnabledTypes.split(";");
  await consoleAndWebhookAsync("info", "Discord hook enabled! With types: " + String(webhookEnabledTypes));
}

await consoleAndWebhookAsync("info", "ASFClaim started!");

await checkConnection();
await checkUserLoggedIn();

await checkGame();
setInterval(checkGame, Number(config.interval) * 60 * 60 * 1000); // Runs every %config.interval% hours

/**
 * Main function that checks for new Steam codes and processes license claims
 * Fetches codes from GitHub Gist, filters out already processed ones, and claims new licenses
 */
async function checkGame() {
  await consoleAndWebhookAsync("info", "Checking for new packages...");

  let currentTime = new Date();
  let nextRunTime = new Date(currentTime.getTime() + (Number(config.interval) * 60 * 60 * 1000));

  let nextRunFormatted = nextRunTime.toLocaleString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric'
  });

  try {
    const gist = await octokit.gists.get({ gist_id: config.gistId });
    let codes = gist.data.files["Steam Codes"].content.split("\n").map(code => code.trim()).filter(code => code);

    let newCodes = codes.filter(code => !processedLicenses.includes(code));

    if (newCodes.length > 0) {
      newCodes.reverse();

      let batch = newCodes.slice(0, 40);

      for (let currentLicense of batch) {
        let asfCommand = config.prefix + "addlicense " + config.bots + " " + currentLicense;

        let asfRequest = { Command: asfCommand };
        await sleep(2);

        let headers = { "Content-Type": "application/json" };
        if (config.pass && config.pass.length > 0) {
          headers.Authentication = config.pass;
        }

        await fetch(config.protocol + "://" + config.host + ":" + config.port + "/Api/Command", {
          method: "post",
          body: JSON.stringify(asfRequest),
          headers: headers
        })
          .then(async res => res.json())
          .then(async body => {
            if (body.Success) {
              const asfResult = parseASFResult(body.Result);
              const hasRateLimit = Object.values(asfResult).some(result => result.status.includes('RateLimitExceeded'));

              if (hasRateLimit) {
                logger.info(`----------------------------------`);
                logger.error("Rate limit exceeded, not marking as processed.");
                logger.info(`Command: !addlicense ${config.bots} ${currentLicense}`);
                logger.info(`Result: ${body.Result.trim()}`);
                logger.info(`Message: ${body.Message}`);
                await sendHookAsync("error", "Rate limit exceeded while processing package. Will retry in next run.", currentLicense, asfResult);
              } else {
                logger.info(`----------------------------------`);
                logger.info(`Success: License Added`);
                logger.info(`Command: !addlicense ${config.bots} ${currentLicense}`);
                logger.info(`Result: ${body.Result.trim()}`);
                logger.info(`Message: ${body.Message}`);
                logger.info(`Success: ✅`);
                processedLicenses.push(currentLicense);
                saveProcessedLicenses();
                if (config.webhookShowAccountStatus === "true") {
                  await sendHookAsync("success", "Processed a new package!", currentLicense, asfResult);
                } else {
                  await sendHookAsync("success", "Processed a new package!", currentLicense);
                }
              }
            } else {
              logger.error("Error: ", body);
              await sendHookAsync("error", "Got non-success result from ASF, check the logs for more information.");
              logger.error("Statuscode: " + body.Result.StatusCode + " | Got non-success result from ASF!");
              process.exit(1);
            }
          })
          .catch(async err => {
            logger.error(`Error running '${asfCommand}':`);
            await sendHookAsync("error", "An error occurred while connecting to ASF, check the logs for more information.");
            logger.error("error", err);
            process.exit(1);
          });
      }
    } else {
      await consoleAndWebhookAsync("info", "No new packages found.");
    }
  } catch (err) {
    if (err.status === 401) {
      logger.error("❌ GitHub Authentication Error:");
      logger.error("The GitHub Gist requires authentication. Please set a valid GITHUB_TOKEN in your .env file.");
      logger.error("Get a token from: https://github.com/settings/tokens (with 'gist' scope)");
      logger.error("Then add: GITHUB_TOKEN=\"your_token_here\" to your .env file");
    } else if (err.status === 404) {
      logger.error("❌ GitHub Gist Not Found:");
      logger.error(`The Gist with ID '${config.gistId}' was not found. Please check your GIST_ID in .env file.`);
      logger.error("Make sure the Gist exists and is accessible with your token (if private).");
    } else if (err.status === 403) {
      logger.error("❌ GitHub API Rate Limit Exceeded:");
      logger.error("You've hit GitHub's rate limit. Please wait a while or set a GITHUB_TOKEN to increase the limit.");
    } else {
      logger.error("❌ Error fetching GitHub Gist:");
      logger.error("An unexpected error occurred while fetching the Steam codes from GitHub.");
      logger.error(`Error: ${err.message}`);
    }
    await sendHookAsync("error", "Failed to fetch Steam codes from GitHub Gist. Check the logs for details.");
    process.exit(1);
  }

  await consoleAndWebhookAsync("info", `Next run scheduled for: ${nextRunFormatted}`);
}

/**
 * Tests connection to ASF server with retry logic
 * Attempts to connect up to 5 times with 5-second delays between attempts
 */
async function checkConnection() {
  let attemptNumber = 1,
    maxRetries = 5,
    retryDelay = 5,
    success = false;

  while (true) {
    if (attemptNumber > maxRetries) {
      logger.error("Can't connect to ASF!");
      process.exit(1);
    }

    let headers = { "Content-Type": "application/json" };
    if (config.pass && config.pass.length > 0) {
      headers.Authentication = config.pass;
    }

    let asfCommand = config.prefix + "stats";
    let asfRequest = { Command: asfCommand };
    await fetch(config.protocol + "://" + config.host + ":" + config.port + "/Api/Command", {
      method: "post",
      body: JSON.stringify(asfRequest),
      headers: headers
    })
      .then(async res => res.json())
      .then(async body => {
        if (body.Success) {
          success = true;
        } else {
          logger.error("Error: ");
          logger.error(body);
          success = false;
        }
      })
      .catch(async err => {
        logger.error(`Error running '${asfCommand}':`);
        logger.error(err);
        success = false;
      });

    if (success) {
      return;
    }

    logger.warn("Connection check failed!, retry " + attemptNumber + "/" + maxRetries + " in " + retryDelay + " seconds...");
    await sleep(retryDelay);
    attemptNumber++;
  }
}

/**
 * Waits for all ASF bots to be logged in and ready
 * Polls ASF status until all bots are connected to Steam network
 */
async function checkUserLoggedIn() {
  let allUsersReady = false;
  let asfCommand = config.prefix + "status asf";
  let asfRequest = { Command: asfCommand };

  while (true) {
    let headers = { "Content-Type": "application/json" };
    if (config.pass && config.pass.length > 0) {
      headers.Authentication = config.pass;
    }

    let result = await fetch(config.protocol + "://" + config.host + ":" + config.port + "/Api/Command", {
      method: "post",
      body: JSON.stringify(asfRequest),
      headers: headers
    })
      .then(async res => res.json())
      .then(async body => {
        return body;
      })
      .catch(async err => {
        logger.error(`Error running '${asfCommand}':`);
        logger.error(err);
        throw err;
      });

    if (result && result.Success && result.Result) {
      var asfStatus = parseASFStatus(result.Result);
      if (asfStatus.isDone) {
        logger.info("All ASF users are connected and ready!");
        allUsersReady = true;
      }
    } else {
      logger.error("Failed to get status from ASF");
      throw new Error("Failed to get status from ASF");
    }

    if (!allUsersReady) {
      logger.info("ASF users are still connecting to Steam network...");
      logger.info("Waiting for 10 seconds...");
      await sleep(10);
    } else {
      break;
    }
  }

  await consoleAndWebhookAsync("info", "ASF users are logged in!");
}

/**
 * Logs a message to console and optionally sends it to Discord webhook
 * @param {string} type - Log level: "error", "warn", or "info"
 * @param {string} msg - The message to log
 * @param {string} [licenseId] - Optional package/license info for webhook
 */
async function consoleAndWebhookAsync(type, msg, pack) {
  switch (type) {
    case "error":
      logger.error(msg);
      break;
    case "warn":
      logger.warn(msg);
      break;
    case "info":
    default:
      logger.info(msg);
      break;
  }
  await sendHookAsync(type, msg, pack);
}

/**
 * Sends a formatted message to Discord webhook if configured
 * @param {string} type - Message type: "error", "warn", "info", or "success"
 * @param {string} msg - The message content
 * @param {string} [licenseId] - Optional package/license identifier
 * @param {object} [asfResult] - Optional ASF result object for detailed status
 */
async function sendHookAsync(type, msg, licenseId, asfResult) {
  if (!config.webhookUrl || config.webhookUrl == "none") {
    return;
  }

  var webhookConfig = {
    username: "ASFClaim",
    avatarUrl: "https://raw.githubusercontent.com/JustArchiNET/ArchiSteamFarm/main/resources/ASF_512x512.png",
    color: {
      error: "16711680", // #ff0000 -> Red
      warn: "16750899", // #ff9933 -> Deep Saffron (Orange)
      info: "255", // #0000ff -> Blue
      success: "65280" // #00ff00 -> Green
    }
  };

  const license = {};
  if (licenseId) {
    licenseId = licenseId.replace("a/", "app/");
    licenseId = licenseId.replace("s/", "sub/");
    licenseId = licenseId.replace(/^(\d+)$/, "sub/$1"); // If only the ID is delivered
    license.type = licenseId.split("/")[0];
    license.id = licenseId.split("/")[1];
  }

  for (let typeIndex = 0; typeIndex < webhookEnabledTypes.length; typeIndex++) {
    if (webhookEnabledTypes[typeIndex] == type && licenseId) {
      let appMetadata = [];

      if (license.type == "app") {
        appMetadata = [await parseAppMetaAsync(license.id)];
      } else {
        appMetadata = await parseSubApps(license.id);
      }

      for (let metaIndex = 0; metaIndex < appMetadata.length; metaIndex++) {
        const metaData = {
          imageUrl: "https://placehold.co/460x215.jpg?text=Cant+load+image",
          name: "Cant load name",
          type: "Cant load type",
          appId: (license.type == "app") ? license.id : null,
          subId: (license.type == "sub") ? license.id : null,
        };

        if (appMetadata[metaIndex]) {
          metaData.imageUrl = (appMetadata[metaIndex].header_image) ? appMetadata[metaIndex].header_image : metaData.imageUrl;
          metaData.name = (appMetadata[metaIndex].name) ? appMetadata[metaIndex].name : metaData.name;
          metaData.type = (appMetadata[metaIndex].type) ? appMetadata[metaIndex].type : metaData.type;
          metaData.appId = (appMetadata[metaIndex].steam_appid) ? appMetadata[metaIndex].steam_appid : metaData.appId;
        }

        const description = {
          name: "Name: " + metaData.name,
          type: "Type: " + metaData.type,
          id: "AppID: "
        }
        if (metaData.appId) {
          description.id += "[" + metaData.appId + "](https://store.steampowered.com/app/" + metaData.appId + ")";
        } else {
          description.id += "Cant load AppID";
        }
        if (metaData.subId) {
          description.id += " (from SubId: [" + metaData.subId + "](https://store.steampowered.com/sub/" + metaData.subId + "))";
        }

        const fields = [];
        if (asfResult) {
          const asfResultAsStatus = {};
          for (const user in asfResult) {
            if (!asfResultAsStatus[asfResult[user].status]) {
              asfResultAsStatus[asfResult[user].status] = [user];
            } else {
              asfResultAsStatus[asfResult[user].status].push(user);
            }
          }
          for (const status in asfResultAsStatus) {
            let users = "";
            for (const index in asfResultAsStatus[status]) {
              users += asfResultAsStatus[status][index] + "\n";
            }
            users = users.replace(/\n$/, "");
            fields.push({ name: status + ":", value: users })
          }
          if (fields.length == 1) {
            fields[0].value = "Status for all accounts";
          }
        }

        await sendWebhook(config.webhookUrl, {
          method: "post",
          body: JSON.stringify({
            embeds: [{
              title: msg,
              color: webhookConfig.color[type],
              image: {
                url: metaData.imageUrl
              },
              description: description.name + "\n" + description.type + "\n" + description.id,
              fields: fields
            }],
            username: webhookConfig.username,
            avatar_url: webhookConfig.avatarUrl
          }),
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
    } else if (webhookEnabledTypes[typeIndex] == type) {
      await sendWebhook(config.webhookUrl, {
        method: "post",
        body: JSON.stringify({
          embeds: [{
            title: msg,
            color: webhookConfig.color[type]
          }],
          username: webhookConfig.username,
          avatar_url: webhookConfig.avatarUrl
        }),
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  }
}

/**
 * Fetches app metadata from Steam Store API
 * @param {string} appId - Steam application ID
 * @returns {Promise<object>} App metadata object from Steam API
 */
async function parseAppMetaAsync(appId) {
  return await fetch("https://store.steampowered.com/api/appdetails?appids=" + appId, {
    method: "get",
    headers: {
      "Content-Type": "application/json"
    }
  })
    .then(async res => res.json())
    .then(async body => {
      if (body != null && body[appId].success) {
        return body[appId].data;
      } else {
        logger.warn("Warn: ");
        logger.warn(body);
        await sendHookAsync("warn", "Got none-success result from SteamAPI, check the logs for more informations");
      }
    })
    .catch(async err => {
      logger.warn("An error occurred while reading metadata from appId: " + appId);
      logger.warn(err);
      await sendHookAsync("warn", "An error occurred while connect to Steam API, check the logs for more informations.");
    })
}

/**
 * Fetches package details and retrieves metadata for all apps in the package
 * @param {string} subId - Steam package/subscription ID
 * @returns {Promise<Array>} Array of app metadata objects
 */
async function parseSubApps(subId) {
  let packageApps = await fetch("https://store.steampowered.com/api/packagedetails?packageids=" + subId, {
    method: "get",
    headers: {
      "Content-Type": "application/json"
    }
  })
    .then(async res => res.json())
    .then(async body => {
      if (body != null && body[subId].success) {
        return body[subId].data.apps;
      } else {
        logger.warn("Warn: ");
        logger.warn(body);
        await sendHookAsync("warn", "Got none-success result from SteamAPI, check the logs for more informations");
        return [];
      }
    })
    .catch(async err => {
      logger.warn("An error occurred while reading metadata from subId: " + subId);
      logger.warn(err);
      await sendHookAsync("warn", "An error occurred while connect to Steam API, check the logs for more informations.");
    })

  const appMetadataResults = [];
  for (let appIndex = 0; appIndex < packageApps.length; appIndex++) {
    const appId = packageApps[appIndex].id;
    const appResult = await parseAppMetaAsync(appId);
    appMetadataResults.push(appResult);
  }

  return appMetadataResults;
}

/**
 * Utility function to pause execution for specified number of seconds
 * @param {number} seconds - Number of seconds to sleep
 * @returns {Promise} Promise that resolves after the specified delay
 */
function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Parses ASF command result to extract license claiming status for each bot
 * @param {string} result - Raw result string from ASF addlicense command
 * @returns {object} Object mapping bot names to their license claiming results
 */
function parseASFResult(result) {
  const lines = result.split("\n");
  const botResults = {};
  for (let i in lines) {
    const matchRes = (lines[i].match(/'?<(?<user>.+)>\s*(?:.*ID:\s+(?<id>\w+\/\d+)\s.+Status:\s+)?(?<status>.*?)(?:\\n|\n)?(?:'.*)?$/i));
    if (matchRes) {
      botResults[matchRes[1]] = {
        id: matchRes[2],
        status: (matchRes[3] != "OK") ? matchRes[3] : "OK -> Not available for this account" // Status "OK" is not always OK... | a real OK would be like "OK | Items: app/339610, sub/56865" or "OK/NoDetail"
      }
    }
  }
  return botResults;
}

/**
 * Parses ASF status result to check if users are connected and ready
 * @param {string} result - Raw result string from ASF status command
 * @returns {object} Object containing user status info and overall readiness
 * @property {object} user - Map of bot names to their connection status
 * @property {boolean} isDone - Whether all bots are connected and ready
 */
function parseASFStatus(result) {
  const lines = result.split("\n");
  const statusInfo = {
    user: {},
    isDone: true
  };

  for (let i in lines) {
    const matchRes = lines[i].match(/^.*<(?<user>.*)>\s*(?<status>.+?)[\.!?]*(?::.+)?(?:\\n.\s+\+)?$/i);

    if (matchRes) {
      statusInfo.user[matchRes[1]] = {
        status: matchRes[2],
        isDone: true
      };

      logger.info(matchRes[1] + " - " + matchRes[2]);

      if (matchRes[2].match(/Bot is connecting to Steam network/i)) {
        statusInfo.user[matchRes[1]].isDone = false;
        statusInfo.isDone = false;
      }
    }
  }

  return statusInfo;
}
