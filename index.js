import fetch from "node-fetch";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { Octokit } from "@octokit/rest";
import * as dotenv from "dotenv";
const octokit = new Octokit();
dotenv.config();

// Load environment variables or use default values
const args = {
  protocol: process.env.ASF_PROTOCOL ? process.env.ASF_PROTOCOL : "http",
  host: process.env.ASF_HOST ? process.env.ASF_HOST : "localhost",
  port: process.env.ASF_PORT ? process.env.ASF_PORT : "1242",
  pass: process.env.ASF_PASS ? process.env.ASF_PASS : "",
  prefix: process.env.ASF_COMMAND_PREFIX ? process.env.ASF_COMMAND_PREFIX : "!",
  bots: process.env.ASF_BOTS ? process.env.ASF_BOTS : "asf",
  interval: process.env.ASF_CLAIM_INTERVAL ? process.env.ASF_CLAIM_INTERVAL : "3",
  gistId: process.env.GIST_ID ? process.env.GIST_ID : "e8c5cf365d816f2640242bf01d8d3675",
  webhookUrl: process.env.WEBHOOK_URL ? process.env.WEBHOOK_URL : "none",
  hookEnabledTypesStr: process.env.WEBHOOK_ENABLEDTYPES ? process.env.WEBHOOK_ENABLEDTYPES : "error;warn;success",
  hookShowAccountStatus: process.env.WEBHOOK_SHOWACCOUNTSTATUS ? process.env.WEBHOOK_SHOWACCOUNTSTATUS : "true"
};

console.log("target = " + args.protocol + "://" + args.host + ":" + args.port);

let storagePath = "./storage/";
let processedLicensesPath = storagePath + "processedLicenses";
let lastLengthPath = storagePath + "lastlength";

mkdirSync(storagePath, { recursive: true });

// Load processed licenses or initialize an empty array
let processedLicenses = [];
try {
  processedLicenses = JSON.parse(readFileSync(processedLicensesPath, "utf8"));
} catch (err) {
  if (err.code === "ENOENT") {
    processedLicenses = [];
    writeFileSync(processedLicensesPath, JSON.stringify(processedLicenses));
  } else {
    console.error("Error loading processed licenses:", err);
    process.exit(1);
  }
}

// Perform migration only if the lastlength file exists and is valid
try {
  const lastLength = parseInt(readFileSync(lastLengthPath, "utf8").trim(), 10);
  if (!isNaN(lastLength)) {
    await octokit.gists.get({ gist_id: args.gistId }).then(async (gist) => {
      let codes = gist.data.files["Steam Codes"].content
        .split("\n")
        .map((code) => code.trim())
        .filter((code) => code);

      let newProcessed = codes.slice(0, lastLength);
      processedLicenses = [...new Set([...processedLicenses, ...newProcessed])];
      saveProcessedLicenses();
    });

    unlinkSync(lastLengthPath);
  }
} catch {
  // Silently skip the migration if `lastlength` doesn't exist or is invalid
}

// Function to save processed licenses to file
function saveProcessedLicenses() {
  writeFileSync(processedLicensesPath, JSON.stringify(processedLicenses, null, 2));
}

if (args.webhookUrl && args.webhookUrl !== "none") {
  var hookEnabledTypesArr = args.hookEnabledTypesStr.split(";");
  await consoleAndWebhookAsync("info", "Discord hook enabled! With types: " + String(hookEnabledTypesArr));
}

await consoleAndWebhookAsync("info", "ASFClaim started!");

await checkConnection();

await checkGame();
setInterval(checkGame, Number(args.interval) * 60 * 60 * 1000); // Runs every %args.interval% hours

async function checkGame() {
  // Log message before the process
  await consoleAndWebhookAsync("info", "Checking for new packages...");

  // Get the current time and add the interval to it
  let currentTime = new Date();
  let nextRunTime = new Date(currentTime.getTime() + (Number(args.interval) * 60 * 60 * 1000));

  // Format next run time in 12-hour format
  let nextRunFormatted = nextRunTime.toLocaleString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric'
  });

  await octokit.gists.get({ gist_id: args.gistId }).then(async gist => {
    let codes = gist.data.files["Steam Codes"].content.split("\n").map(code => code.trim()).filter(code => code);

    // Filter out already processed licenses
    let newCodes = codes.filter(code => !processedLicenses.includes(code));

    if (newCodes.length > 0) {
      // Reverse the newCodes array so we start processing from the bottom
      newCodes.reverse();

      // Process the next batch of licenses (e.g., 40 at a time)
      let batch = newCodes.slice(0, 40);

      for (let currentPack of batch) {
        let asfcommand = args.prefix + "addlicense " + args.bots + " " + currentPack;

        let command = { Command: asfcommand };
        sleep(2);

        let headers = { "Content-Type": "application/json" };
        if (args.pass && args.pass.length > 0) {
          headers.Authentication = args.pass;
        }

        await fetch(args.protocol + "://" + args.host + ":" + args.port + "/Api/Command", {
          method: "post",
          body: JSON.stringify(command),
          headers: headers
        })
          .then(async res => res.json())
          .then(async body => {
            if (body.Success) {
              const asfResultObj = parseASFResult(body.Result);
              const hasRateLimit = Object.values(asfResultObj).some(result => result.status.includes('RateLimitExceeded'));

              if (hasRateLimit) {
                console.error("Rate limit exceeded, not marking as processed.");
                console.log(`Command: !addlicense ${args.bots} ${currentPack}`);
                console.log(`Result: ${body.Result.trim()}`);
                console.log(`Message: ${body.Message}`);
                console.log(`----------------------------------`);
                await sendHookAsync("error", "Rate limit exceeded while processing package. Will retry in next run.", currentPack, asfResultObj);
              } else {
                console.log(`Success: License Added`);
                console.log(`Command: !addlicense ${args.bots} ${currentPack}`);
                console.log(`Result: ${body.Result.trim()}`);
                console.log(`Message: ${body.Message}`);
                console.log(`Success: ✅`);
                console.log(`----------------------------------`);
                processedLicenses.push(currentPack); // Add to processed list
                saveProcessedLicenses(); // Save to file
                if (args.hookShowAccountStatus === "true") {
                  await sendHookAsync("success", "Processed a new package!", currentPack, asfResultObj);
                } else {
                  await sendHookAsync("success", "Processed a new package!", currentPack);
                }
              }
            } else {
              console.error("Error: ", body);
              await sendHookAsync("error", "Got non-success result from ASF, check the logs for more information.");
              console.error("Statuscode: " + body.Result.StatusCode + " | Got non-success result from ASF!");
              process.exit(1);
            }
          })
          .catch(async err => {
            console.error(`Error running '${asfcommand}':`);
            await sendHookAsync("error", "An error occurred while connecting to ASF, check the logs for more information.");
            console.log("error", err);
            process.exit(1);
          });
      }
    } else {
      await consoleAndWebhookAsync("info", "No new packages found.");
    }
  });

  // Log the next interval time after the process
  await consoleAndWebhookAsync("info", `Next run scheduled for: ${nextRunFormatted}`);
}

async function checkConnection() {
  let _i = 1,
    _r = 5,
    _s = 5,
    success = false;

  while (true) {
    if (_i > _r) {
      console.error("Can't connect to ASF!");
      process.exit(1);
    }

    let headers = { "Content-Type": "application/json" };
    if (args.pass && args.pass.length > 0) {
      headers.Authentication = args.pass;
    }

    let asfcommand = args.prefix + "stats";
    let command = { Command: asfcommand };
    await fetch(args.protocol + "://" + args.host + ":" + args.port + "/Api/Command", {
      method: "post",
      body: JSON.stringify(command),
      headers: headers
    })
      .then(async res => res.json())
      .then(async body => {
        if (body.Success) {
          success = true;
        } else {
          console.error("Error: ");
          console.error(body);
          success = false;
        }
      })
      .catch(async err => {
        console.error(`Error running '${asfcommand}':`);
        console.error(err);
        success = false;
      });

    if (success) {
      return;
    }

    console.warn("Connection check failed!, retry " + _i + "/" + _r + " in " + _s + " seconds...");
    sleep(_s);
    _i++;
  }
}

async function consoleAndWebhookAsync(type, msg, pack) {
  switch (type) {
    case "error":
      console.error(msg);
      break;
    case "warn":
      console.warn(msg);
      break;
    case "info":
    default:
      console.log(msg);
      break;
  }
  await sendHookAsync(type, msg, pack);
  sleep(2); // Discord rate limit
}

async function sendHookAsync(type, msg, pack, asfResultObj) {
  if (!args.webhookUrl || args.webhookUrl == "none") {
    return;
  }

  var config = {
    username: "ASFClaim",
    avatarUrl: "https://raw.githubusercontent.com/JustArchiNET/ArchiSteamFarm/main/resources/ASF_512x512.png",
    color: {
      error: "16711680", // #ff0000 -> Red
      warn: "16750899", // #ff9933 -> Deep Saffron (Orange)
      info: "255", // #0000ff -> Blue
      success: "65280" // #00ff00 -> Green
    }
  };

  var license = {};
  if (pack) {
    pack = pack.replace("a/", "app/");
    pack = pack.replace("s/", "sub/");
    pack = pack.replace(/^(\d+)$/, "sub/$1"); // If only the ID is delivered
    license = {
      type: pack.split("/")[0],
      id: pack.split("/")[1]
    }
  }

  for (let i = 0; i <= hookEnabledTypesArr.length; i++) {
    if (hookEnabledTypesArr[i] == type && pack) {
      var appMetas = [];

      if (license.type == "app") {
        appMetas = [await parseAppMetaAsync(license.id)];
      } else {
        appMetas = await parseSubApps(license.id);
      }

      for (var i2 = 0; i2 <= appMetas.length; i2++) {
        if (i2 == appMetas.length && appMetas.length != 0) {
          continue;
        }
        if (appMetas.length > 1) {
          sleep(3);
        }

        // Fill metadata
        var metaData = {
          imageUrl: "https://via.placeholder.com/460x215.jpg?text=Cant+load+image",
          name: "Cant load name",
          type: "Cant load type",
          appId: (license.type == "app") ? license.id : null,
          subId: (license.type == "sub") ? license.id : null,
        };

        if (appMetas[i2]) {
          metaData.imageUrl = (appMetas[i2].header_image) ? appMetas[i2].header_image : metaData.imageUrl;
          metaData.name = (appMetas[i2].name) ? appMetas[i2].name : metaData.name;
          metaData.type = (appMetas[i2].type) ? appMetas[i2].type : metaData.type;
          metaData.appId = (appMetas[i2].steam_appid) ? appMetas[i2].steam_appid : metaData.appId;
        }

        // Prepare description
        var description = {
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

        // Prepare fields if given
        var fields = [];
        if (asfResultObj) {
          var asfResultAsStatus = {};
          for (var user in asfResultObj) {
            if (!asfResultAsStatus[asfResultObj[user].status]) {
              asfResultAsStatus[asfResultObj[user].status] = [user];
            } else {
              asfResultAsStatus[asfResultObj[user].status].push(user);
            }
          }
          for (var status in asfResultAsStatus) {
            var users = "";
            for (var index in asfResultAsStatus[status]) {
              users += asfResultAsStatus[status][index] + "\n";
            }
            users = users.replace(/\n$/, "");
            fields.push({ name: status + ":", value: users })
          }
          if (fields.length == 1) {
            fields[0].value = "Status for all accounts";
          }
        }

        // Send webhook with app metadata
        await fetch(args.webhookUrl, {
          method: "post",
          body: JSON.stringify({
            embeds: [{
              title: msg,
              color: config.color[type],
              image: {
                url: metaData.imageUrl
              },
              description: description.name + "\n" + description.type + "\n" + description.id,
              fields: fields
            }],
            username: config.username,
            avatar_url: config.avatarUrl
          }),
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
    } else if (hookEnabledTypesArr[i] == type) {
      // Send webhook with normal text
      await fetch(args.webhookUrl, {
        method: "post",
        body: JSON.stringify({
          embeds: [{
            title: msg,
            color: config.color[type]
          }],
          username: config.username,
          avatar_url: config.avatarUrl
        }),
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  }
}

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
        // console.debug(body);
        return body[appId].data;
      } else {
        console.warn("Warn: ");
        console.warn(body);
        await sendHookAsync("warn", "Got none-success result from SteamAPI, check the logs for more informations");
      }
    })
    .catch(async err => {
      console.warn("An error occurred while reading metadata from appId: " + appId);
      console.warn(err);
      await sendHookAsync("warn", "An error occurred while connect to Steam API, check the logs for more informations.");
    })
}

async function parseSubApps(subId) {
  var apps = await fetch("https://store.steampowered.com/api/packagedetails?packageids=" + subId, {
    method: "get",
    headers: {
      "Content-Type": "application/json"
    }
  })
    .then(async res => res.json())
    .then(async body => {
      if (body != null && body[subId].success) {
        // console.debug(body);
        return body[subId].data.apps;
      } else {
        console.warn("Warn: ");
        console.warn(body);
        await sendHookAsync("warn", "Got none-success result from SteamAPI, check the logs for more informations");
        return [];
      }
    })
    .catch(async err => {
      console.warn("An error occurred while reading metadata from subId: " + subId);
      console.warn(err);
      await sendHookAsync("warn", "An error occurred while connect to Steam API, check the logs for more informations.");
    })

  var appResults = [];
  for (var i = 0; i < apps.length; i++) {
    var appId = apps[i].id;
    var appResult = await parseAppMetaAsync(appId);
    appResults.push(appResult);
  }

  return appResults;
}

function sleep(seconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < (seconds * 1000));
}

function parseASFResult(result) {
  var lines = result.split("\n");
  var obj = {};
  for (var i in lines) {
    var matchRes = (lines[i].match(/'?<(?<user>.+)>\s*(?:.*ID:\s+(?<id>\w+\/\d+)\s.+Status:\s+)?(?<status>.*?)(?:\\n|\n)?(?:'.*)?$/i));
    if (matchRes) {
      obj[matchRes[1]] = {
        id: matchRes[2],
        status: (matchRes[3] != "OK") ? matchRes[3] : "OK -> Not available for this account" // Status "OK" is not always OK... | a real OK would be like "OK | Items: app/339610, sub/56865" or "OK/NoDetail"
      }
    }
  }
  //console.log(obj);
  return obj;
}
